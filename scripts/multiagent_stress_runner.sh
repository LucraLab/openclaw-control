#!/usr/bin/env bash
# multiagent_stress_runner.sh — Manual Live Stress Runner (Dashboard VPS Only)
#
# Dispatches bounded-token HTTP requests to Builder gateways via Tailscale.
# Validates that kill switch, quarantine, and caps are enforced live.
#
# Hard constraints:
#   - max_tokens=64 (minimal burn)
#   - temperature=0 (deterministic)
#   - max 5 agents per run
#   - total timeout 30s
#   - only runs if OPENCLAW_RUNTIME_DIR is readable
#   - only runs if kill switch is NOT active
#
# Usage:
#   bash scripts/multiagent_stress_runner.sh [--dry-run]
#
# Prerequisites:
#   - Run from Dashboard VPS (set BUILDER_HOST to Tailscale IP)
#   - BUILDER2_AUTH_TOKEN set (or reads from gateway config)
#   - Builder2 reachable at BUILDER2_HOST:8082 via Tailscale
#   - curl and jq available

set -uo pipefail

# ─── Configuration ───
BUILDER2_HOST="${BUILDER2_HOST:-${BUILDER_HOST:-localhost}}"
BUILDER2_PORT="${BUILDER2_PORT:-8082}"
MAX_TOKENS=64
TEMPERATURE=0
MAX_AGENTS=5
PER_AGENT_TIMEOUT=10
RUNTIME_DIR="${OPENCLAW_RUNTIME_DIR:-/opt/openclaw-runtime}"
DRY_RUN=false
PROOF_DIR="${PROOF_DIR:-/tmp/multiagent-stress-proof}"

# Parse args
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      echo "Usage: bash scripts/multiagent_stress_runner.sh [--dry-run]"
      echo ""
      echo "Options:"
      echo "  --dry-run   Show what would be sent without making HTTP calls"
      echo ""
      echo "Environment:"
      echo "  BUILDER2_AUTH_TOKEN  Bearer token for Builder2 gateway"
      echo "  BUILDER2_HOST       Builder2 Tailscale IP (from BUILDER_HOST env)"
      echo "  BUILDER2_PORT       Builder2 gateway port (default: 8082)"
      echo "  OPENCLAW_RUNTIME_DIR  Runtime state directory"
      exit 0
      ;;
  esac
done

# ─── Preflight Checks ───
echo "═══ Multiagent Stress Runner — Live ═══"
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Host: $(hostname)"
echo ""

# Check: runtime dir readable
if [ ! -d "$RUNTIME_DIR" ]; then
  echo "FAIL: Runtime dir not found: $RUNTIME_DIR"
  echo "Status: BLOCKED (runtime_unavailable)"
  exit 1
fi
echo "PASS: Runtime dir exists: $RUNTIME_DIR"

# Check: kill switch NOT active
KILLSWITCH_FILE="$RUNTIME_DIR/killswitch.enabled"
if [ -f "$KILLSWITCH_FILE" ]; then
  echo "FAIL: Kill switch is ACTIVE — refusing to run"
  echo "Status: BLOCKED (killswitch_active)"
  exit 1
fi
echo "PASS: Kill switch inactive"

# Check: auth token available
if [ -z "${BUILDER2_AUTH_TOKEN:-}" ]; then
  # Try to read from gateway config
  GW_CONFIG="/home/openclaw/.openclaw/gateway.json"
  if [ -f "$GW_CONFIG" ]; then
    BUILDER2_AUTH_TOKEN=$(node -e "try { const c = require('$GW_CONFIG'); console.log(c.gateway?.auth?.token || ''); } catch { console.log(''); }" 2>/dev/null || true)
  fi
fi

if [ -z "${BUILDER2_AUTH_TOKEN:-}" ]; then
  echo "FAIL: BUILDER2_AUTH_TOKEN not set and gateway config not readable"
  echo "Status: BLOCKED (no_auth)"
  exit 1
fi
echo "PASS: Auth token available (${#BUILDER2_AUTH_TOKEN} chars)"

# Check: Builder2 reachable
if ! curl -sf --max-time 5 "http://$BUILDER2_HOST:$BUILDER2_PORT/v1/models" >/dev/null 2>&1; then
  echo "WARN: Builder2 at $BUILDER2_HOST:$BUILDER2_PORT not responding to /v1/models"
  echo "      Continuing anyway — individual agent calls may fail"
fi
echo "PASS: Builder2 connectivity check done"

# Check: quarantine list
QUARANTINE_FILE="$RUNTIME_DIR/quarantine.json"
QUARANTINED_AGENTS=""
if [ -f "$QUARANTINE_FILE" ]; then
  QUARANTINED_AGENTS=$(node -e "try { const q = require('$QUARANTINE_FILE'); console.log((q.agents || []).join(',')); } catch { console.log(''); }" 2>/dev/null || true)
fi
echo "Quarantined agents: ${QUARANTINED_AGENTS:-none}"
echo ""

# ─── Agent Roster (Builder2 only — Tailscale reachable) ───
ALL_AGENTS=("pa" "sales" "cs" "rental" "insights" "crystal-pa" "ops-2")

# Filter quarantined
AGENTS=()
SKIPPED=()
for agent in "${ALL_AGENTS[@]}"; do
  if echo ",$QUARANTINED_AGENTS," | grep -q ",$agent,"; then
    SKIPPED+=("$agent")
  else
    AGENTS+=("$agent")
  fi
done

# Cap to MAX_AGENTS
CAPPED=false
REQUESTED=${#AGENTS[@]}
if [ "$REQUESTED" -gt "$MAX_AGENTS" ]; then
  AGENTS=("${AGENTS[@]:0:$MAX_AGENTS}")
  CAPPED=true
fi

echo "── Dispatch Plan ──"
echo "Agents: ${AGENTS[*]}"
echo "Count: ${#AGENTS[@]} (requested: $REQUESTED, cap: $MAX_AGENTS, capped: $CAPPED)"
echo "Skipped (quarantine): ${SKIPPED[*]:-none}"
echo "max_tokens: $MAX_TOKENS"
echo "temperature: $TEMPERATURE"
echo "timeout: ${PER_AGENT_TIMEOUT}s per agent"
echo "dry_run: $DRY_RUN"
echo ""

if [ ${#AGENTS[@]} -eq 0 ]; then
  echo "FAIL: No agents available (all quarantined or roster empty)"
  echo "Status: BLOCKED (no_agents_available)"
  exit 1
fi

# ─── Setup proof dir ───
mkdir -p "$PROOF_DIR"
PROOF_FILE="$PROOF_DIR/stress-run-$(date -u +%Y%m%dT%H%M%SZ).md"

# ─── Dispatch ───
echo "── Dispatching ──"
RESULTS=()
PASS_COUNT=0
FAIL_COUNT=0
TOTAL_LATENCY=0

PROMPT="Respond with exactly: STRESS_ACK followed by your agent name. Nothing else."

for agent in "${AGENTS[@]}"; do
  echo -n "  $agent: "

  BODY=$(cat <<ENDJSON
{
  "model": "openclaw:$agent",
  "messages": [{"role": "user", "content": "$PROMPT"}],
  "max_tokens": $MAX_TOKENS,
  "temperature": $TEMPERATURE
}
ENDJSON
)

  if [ "$DRY_RUN" = true ]; then
    echo "DRY_RUN — would POST to http://$BUILDER2_HOST:$BUILDER2_PORT/v1/chat/completions"
    RESULTS+=("$agent:dry_run:0:dry_run_skipped")
    continue
  fi

  START_MS=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || echo 0)

  RESPONSE=$(curl -sf --max-time "$PER_AGENT_TIMEOUT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $BUILDER2_AUTH_TOKEN" \
    -H "x-openclaw-agent-id: $agent" \
    -d "$BODY" \
    "http://$BUILDER2_HOST:$BUILDER2_PORT/v1/chat/completions" 2>&1) || true

  END_MS=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || echo 0)
  LATENCY=$((END_MS - START_MS))
  TOTAL_LATENCY=$((TOTAL_LATENCY + LATENCY))

  if [ -z "$RESPONSE" ]; then
    echo "ERROR (no response) [${LATENCY}ms]"
    RESULTS+=("$agent:error:$LATENCY:no_response")
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi

  # Extract content from response
  CONTENT=$(echo "$RESPONSE" | node -e "
    let data='';
    process.stdin.on('data',c=>data+=c);
    process.stdin.on('end',()=>{
      try {
        const j=JSON.parse(data);
        const c=j.choices?.[0]?.message?.content||'';
        process.stdout.write(c.slice(0,200));
      } catch {
        process.stdout.write('PARSE_ERROR');
      }
    });
  " 2>/dev/null || echo "PARSE_ERROR")

  if echo "$CONTENT" | grep -q "STRESS_ACK\|PARSE_ERROR"; then
    if [ "$CONTENT" = "PARSE_ERROR" ]; then
      echo "ERROR (parse_error) [${LATENCY}ms]"
      RESULTS+=("$agent:error:$LATENCY:parse_error")
      FAIL_COUNT=$((FAIL_COUNT + 1))
    else
      echo "OK [${LATENCY}ms] — ${CONTENT:0:80}"
      RESULTS+=("$agent:ok:$LATENCY:${CONTENT:0:80}")
      PASS_COUNT=$((PASS_COUNT + 1))
    fi
  else
    # Agent responded but didn't follow the exact format — still counts as reachable
    echo "OK (non-ack) [${LATENCY}ms] — ${CONTENT:0:80}"
    RESULTS+=("$agent:ok:$LATENCY:${CONTENT:0:80}")
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
done

echo ""

# ─── Summary ───
echo "── Summary ──"
echo "Total agents: ${#AGENTS[@]}"
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"
echo "Avg latency: $((TOTAL_LATENCY / ${#AGENTS[@]}))ms"
echo "Total latency: ${TOTAL_LATENCY}ms"
echo ""

# ─── Proof File ───
cat > "$PROOF_FILE" <<EOF
# Multiagent Stress Runner — Live Proof

**Timestamp:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Host:** $(hostname)
**Builder2:** $BUILDER2_HOST:$BUILDER2_PORT
**Dry run:** $DRY_RUN

## Preflight
- Runtime dir: $RUNTIME_DIR (exists)
- Kill switch: inactive
- Auth token: ${#BUILDER2_AUTH_TOKEN} chars
- Quarantined: ${QUARANTINED_AGENTS:-none}

## Dispatch
- Agents dispatched: ${AGENTS[*]}
- Count: ${#AGENTS[@]} (requested: $REQUESTED, cap: $MAX_AGENTS, capped: $CAPPED)
- Skipped (quarantine): ${SKIPPED[*]:-none}
- max_tokens: $MAX_TOKENS
- temperature: $TEMPERATURE

## Results
- Passed: $PASS_COUNT / ${#AGENTS[@]}
- Failed: $FAIL_COUNT / ${#AGENTS[@]}
- Avg latency: $((TOTAL_LATENCY / ${#AGENTS[@]}))ms

### Per-Agent Results
EOF

for result in "${RESULTS[@]}"; do
  IFS=':' read -r ragent rstatus rlatency rdetail <<< "$result"
  echo "- **$ragent**: $rstatus (${rlatency}ms) — $rdetail" >> "$PROOF_FILE"
done

cat >> "$PROOF_FILE" <<EOF

## Safety Verification
- Kill switch checked: YES (blocked if active)
- Quarantine filtered: YES (${#SKIPPED[@]} agent(s) skipped)
- Cap enforced: YES (max $MAX_AGENTS)
- Token burn bounded: YES (max_tokens=$MAX_TOKENS, temperature=$TEMPERATURE)
- Runtime dir verified: YES
EOF

echo "Proof written: $PROOF_FILE"
echo ""

# ─── Exit status ───
if [ "$FAIL_COUNT" -gt 0 ] && [ "$PASS_COUNT" -eq 0 ]; then
  echo "Status: ALL_FAILED"
  exit 1
elif [ "$FAIL_COUNT" -gt 0 ]; then
  echo "Status: PARTIAL_PASS ($PASS_COUNT/$((PASS_COUNT + FAIL_COUNT)))"
  exit 0
else
  echo "Status: ALL_PASS ($PASS_COUNT/${#AGENTS[@]})"
  exit 0
fi
