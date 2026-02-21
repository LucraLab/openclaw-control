#!/bin/bash
# provider-drift-sentinel.sh — Fail-closed provider drift detection
# Location: ops/scripts/provider-drift-sentinel.sh
#
# Prevents silent reoccurrence of the Builder1 MODEL_OK incident:
#   - Dead primary (moonshot billing) + Dead fallback (anthropic limit)
#   - Missing working fallback (no openai/gpt-4o)
#   - Bad OPENAI_BASE_URL (loopback with no listener)
#
# Exit codes (fail-closed):
#   0 — OK: all builders have working provider chains + MODEL_OK
#   1 — WARN: config looks good but MODEL_OK=0 (upstream provider issue)
#   2 — FAIL: drift detected (chain missing fallback, bad base URL, etc.)
#
# Environment overrides (for selftest simulation):
#   SENTINEL_SIMULATE=baseline_dead_chain  — simulate the prior incident
#   SENTINEL_SIMULATE=warn_upstream        — simulate upstream provider issue (exit 1)
#   SENTINEL_DRY_RUN=1                     — skip live HTTP checks
#
# Output:
#   /tmp/provider-drift-sentinel-<UTC>.json  (stable key order)
#   ops/proofs/PROOF_PROVIDER_DRIFT_SENTINEL_RUN_<UTC>.md
#
# Usage:
#   bash provider-drift-sentinel.sh

set -uo pipefail

TS=$(date -u +%Y-%m-%dT%H%M%SZ)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROOF_DIR="${REPO_ROOT}/ops/proofs"
JSON_FILE="/tmp/provider-drift-sentinel-${TS}.json"
PROOF_FILE="${PROOF_DIR}/PROOF_PROVIDER_DRIFT_SENTINEL_RUN_${TS}.md"

# Builder connectivity (Tailscale)
BUILDER_TS_IP="100.75.216.57"
BUILDER_SSH_USER="openclaw"
BUILDER_SSH_HOST="187.77.6.191"
B1_PORT=8080
B2_PORT=8082

# Auth tokens (never printed)
B1_TOKEN="2b7526a0647a3925a61cb113fe65a38e8bf749435f991276a85c6ab7182d9d6a"
B2_TOKEN="d0ef2036e033134523d2ecb0585902b10acd393962154cac67fe2802d7fc2827"

# Test agents
B1_AGENT="developer"
B2_AGENT="sales"

# Required fallback providers (at least one must be present)
REQUIRED_FALLBACKS="openai/gpt-4o"

# Known-bad OPENAI_BASE_URL patterns (prior incident)
BAD_BASEURL_PATTERNS="127\.0\.0\.1|localhost"
KNOWN_BAD_BASEURL="http://127.0.0.1:4010/v1"

# ── State ──
EXIT_CODE=0
CHECKS_JSON=""
FAIL_MARKERS=""
WARN_MARKERS=""

add_check() {
  local name="$1" status="$2" detail="$3"
  local escaped_detail
  escaped_detail=$(printf '%s' "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g' | head -c 200)
  local entry
  entry=$(printf '    {"detail":"%s","name":"%s","status":"%s"}' \
    "$escaped_detail" "$name" "$status")
  if [ -n "$CHECKS_JSON" ]; then
    CHECKS_JSON="${CHECKS_JSON},
${entry}"
  else
    CHECKS_JSON="$entry"
  fi
}

add_fail() {
  local marker="$1"
  if [ -n "$FAIL_MARKERS" ]; then
    FAIL_MARKERS="${FAIL_MARKERS},\"${marker}\""
  else
    FAIL_MARKERS="\"${marker}\""
  fi
  if [ "$EXIT_CODE" -lt 2 ]; then EXIT_CODE=2; fi
}

add_warn() {
  local marker="$1"
  if [ -n "$WARN_MARKERS" ]; then
    WARN_MARKERS="${WARN_MARKERS},\"${marker}\""
  else
    WARN_MARKERS="\"${marker}\""
  fi
  if [ "$EXIT_CODE" -lt 1 ]; then EXIT_CODE=1; fi
}

# ── Simulation mode ──
SIMULATE="${SENTINEL_SIMULATE:-}"
DRY_RUN="${SENTINEL_DRY_RUN:-0}"

if [ -n "$SIMULATE" ]; then
  echo "[SENTINEL] Simulation mode: $SIMULATE"
fi

# ── Phase A: Gather configuration ──
echo "=== Provider Drift Sentinel — $TS ==="
echo ""
echo "--- Phase A: Configuration Gathering ---"

CHAIN_PRIMARY=""
CHAIN_FALLBACKS="[]"
OPENAI_BASEURL=""
OPENAI_BASEURL_SOURCE=""

if [ "$SIMULATE" = "baseline_dead_chain" ]; then
  # Simulate the exact prior incident state
  CHAIN_PRIMARY="moonshot/kimi-k2.5"
  CHAIN_FALLBACKS='["anthropic/claude-opus-4-6"]'
  OPENAI_BASEURL="http://127.0.0.1:4010/v1"
  OPENAI_BASEURL_SOURCE="simulation"
  echo "  [SIM] Chain: primary=$CHAIN_PRIMARY fallbacks=$CHAIN_FALLBACKS"
  echo "  [SIM] OPENAI_BASE_URL=$OPENAI_BASEURL"
elif [ "$SIMULATE" = "warn_upstream" ]; then
  # Simulate: config is healthy but upstream providers are billing-dead
  # Chain includes openai/gpt-4o (passes drift checks) but live check = MODEL_OK=0
  CHAIN_PRIMARY="moonshot/kimi-k2.5"
  CHAIN_FALLBACKS='["anthropic/claude-opus-4-6", "openai/gpt-4o"]'
  OPENAI_BASEURL="https://api.openai.com/v1"
  OPENAI_BASEURL_SOURCE="simulation"
  echo "  [SIM] Chain: primary=$CHAIN_PRIMARY fallbacks=$CHAIN_FALLBACKS"
  echo "  [SIM] OPENAI_BASE_URL=$OPENAI_BASEURL (healthy config, upstream dead)"
else
  # Read real config from Builder VPS
  CHAIN_JSON=$(ssh "${BUILDER_SSH_USER}@${BUILDER_SSH_HOST}" \
    "cat /home/openclaw/.openclaw/openclaw.json" 2>/dev/null) || {
    add_check "config_read" "FAIL" "Cannot SSH to Builder VPS to read openclaw.json"
    add_fail "FAIL_CONFIG_READ"
    CHAIN_JSON=""
  }

  if [ -n "$CHAIN_JSON" ]; then
    CHAIN_PRIMARY=$(echo "$CHAIN_JSON" | python3 -c "
import json, sys
cfg = json.load(sys.stdin)
print(cfg.get('agents',{}).get('defaults',{}).get('model',{}).get('primary','NONE'))
" 2>/dev/null || echo "PARSE_ERROR")

    CHAIN_FALLBACKS=$(echo "$CHAIN_JSON" | python3 -c "
import json, sys
cfg = json.load(sys.stdin)
print(json.dumps(cfg.get('agents',{}).get('defaults',{}).get('model',{}).get('fallbacks',[])))
" 2>/dev/null || echo "[]")

    echo "  Chain: primary=$CHAIN_PRIMARY fallbacks=$CHAIN_FALLBACKS"
    add_check "config_read" "OK" "primary=$CHAIN_PRIMARY fallbacks=$CHAIN_FALLBACKS"
  fi

  # Read OPENAI_BASE_URL from systemd runtime environment
  OPENAI_BASEURL=$(ssh "${BUILDER_SSH_USER}@${BUILDER_SSH_HOST}" \
    'systemctl --user show openclaw-gateway.service 2>/dev/null | grep -oP "OPENAI_BASE_URL=\K[^ ]+"' 2>/dev/null || echo "NOT_FOUND")

  if [ "$OPENAI_BASEURL" = "NOT_FOUND" ] || [ -z "$OPENAI_BASEURL" ]; then
    # Fallback: check drop-in files directly
    OPENAI_BASEURL=$(ssh "${BUILDER_SSH_USER}@${BUILDER_SSH_HOST}" \
      'grep -h "OPENAI_BASE_URL=" /home/openclaw/.config/systemd/user/openclaw-gateway.service.d/*.conf 2>/dev/null | tail -1 | sed "s/.*OPENAI_BASE_URL=//"' 2>/dev/null || echo "NOT_FOUND")
    OPENAI_BASEURL_SOURCE="drop-in-file"
  else
    OPENAI_BASEURL_SOURCE="systemd-runtime"
  fi
  echo "  OPENAI_BASE_URL=$OPENAI_BASEURL (source: $OPENAI_BASEURL_SOURCE)"
fi

# ── Phase B: Detect drift conditions ──
echo ""
echo "--- Phase B: Drift Detection ---"

# B1: Check for required fallback
HAS_REQUIRED_FALLBACK=0
for req in $REQUIRED_FALLBACKS; do
  if echo "$CHAIN_FALLBACKS" | grep -q "$req"; then
    HAS_REQUIRED_FALLBACK=1
    echo "  [OK] Required fallback '$req' present in chain"
    add_check "chain_has_${req//\//_}" "OK" "Found in fallbacks"
  else
    echo "  [FAIL] Required fallback '$req' MISSING from chain"
    add_check "chain_has_${req//\//_}" "FAIL" "Not found in fallbacks: $CHAIN_FALLBACKS"
    add_fail "FAIL_CHAIN"
  fi
done

# B2: Check if chain is only moonshot+anthropic with no OpenAI (exact prior incident)
CHAIN_ALL="${CHAIN_PRIMARY} ${CHAIN_FALLBACKS}"
HAS_OPENAI=$(echo "$CHAIN_ALL" | grep -c "openai/" || true)
HAS_MOONSHOT=$(echo "$CHAIN_ALL" | grep -c "moonshot/" || true)
HAS_ANTHROPIC=$(echo "$CHAIN_ALL" | grep -c "anthropic/" || true)

if [ "$HAS_OPENAI" -eq 0 ] && [ "$HAS_MOONSHOT" -gt 0 ] && [ "$HAS_ANTHROPIC" -gt 0 ]; then
  echo "  [FAIL] Chain is moonshot+anthropic only — no OpenAI fallback (matches prior incident)"
  add_check "chain_diversity" "FAIL" "moonshot+anthropic only, no openai"
  add_fail "FAIL_CHAIN"
else
  echo "  [OK] Chain has provider diversity (not moonshot+anthropic-only)"
  add_check "chain_diversity" "OK" "Multiple provider families present"
fi

# B3: Check OPENAI_BASE_URL
if echo "$OPENAI_BASEURL" | grep -qE "$BAD_BASEURL_PATTERNS"; then
  echo "  [FAIL] OPENAI_BASE_URL points to loopback: $OPENAI_BASEURL"
  add_check "openai_baseurl" "FAIL" "Loopback detected: $OPENAI_BASEURL"
  add_fail "FAIL_OPENAI_BASEURL"

  # Extra check: is anything listening on that loopback port on Builder VPS?
  if [ "$SIMULATE" != "baseline_dead_chain" ]; then
    LOOPBACK_PORT=$(echo "$OPENAI_BASEURL" | grep -oP ':\K[0-9]+' | head -1)
    if [ -n "$LOOPBACK_PORT" ]; then
      LISTENER=$(ssh "${BUILDER_SSH_USER}@${BUILDER_SSH_HOST}" \
        "ss -tlnp 2>/dev/null | grep ':${LOOPBACK_PORT} ' || echo 'NONE'" 2>/dev/null)
      if echo "$LISTENER" | grep -q "NONE"; then
        echo "  [FAIL] Nothing listening on port $LOOPBACK_PORT on Builder VPS"
        add_check "loopback_listener" "FAIL" "Port $LOOPBACK_PORT: no listener"
      else
        echo "  [WARN] Something IS listening on loopback:$LOOPBACK_PORT — but still flagged"
        add_check "loopback_listener" "WARN" "Port $LOOPBACK_PORT: listener exists but loopback is risky"
      fi
    fi
  else
    echo "  [SIM] Skipping loopback listener check (simulation mode)"
    add_check "loopback_listener" "FAIL" "Simulated: no listener on 127.0.0.1:4010"
  fi
elif [ "$OPENAI_BASEURL" = "$KNOWN_BAD_BASEURL" ]; then
  echo "  [FAIL] OPENAI_BASE_URL is the exact known-bad value: $KNOWN_BAD_BASEURL"
  add_check "openai_baseurl" "FAIL" "Exact match to known-bad: $KNOWN_BAD_BASEURL"
  add_fail "FAIL_OPENAI_BASEURL"
elif [ "$OPENAI_BASEURL" = "NOT_FOUND" ]; then
  echo "  [WARN] OPENAI_BASE_URL not found in systemd config"
  add_check "openai_baseurl" "WARN" "Not found — SDK default will be used"
  add_warn "WARN_OPENAI_BASEURL_MISSING"
else
  echo "  [OK] OPENAI_BASE_URL=$OPENAI_BASEURL (not loopback)"
  add_check "openai_baseurl" "OK" "$OPENAI_BASEURL"
fi

# ── Phase C: Live checks ──
echo ""
echo "--- Phase C: Live Checks ---"

B1_HTTP="" B1_ROUTE_OK=0 B1_MODEL_OK=0 B1_ERROR_CLASS="skipped"
B2_HTTP="" B2_ROUTE_OK=0 B2_MODEL_OK=0 B2_ERROR_CLASS="skipped"

run_live_check() {
  local port="$1" token="$2" agent="$3"

  local output http_code body route_ok=0 model_ok=0 error_class="unknown"

  output=$(curl -s -m 30 -w '\n%{http_code}' -X POST \
    "http://${BUILDER_TS_IP}:${port}/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${token}" \
    -d "{\"model\":\"openclaw/${agent}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply pong\"}],\"max_tokens\":5}" 2>&1)

  http_code=$(echo "$output" | tail -1)
  body=$(echo "$output" | sed '$d')

  case "$http_code" in
    200)
      route_ok=1
      if echo "$body" | grep -q '"choices"' && ! echo "$body" | grep -qiE 'billing|rate.limit|credits|balance|models failed'; then
        model_ok=1; error_class="none"
      elif echo "$body" | grep -qiE 'billing|rate.limit|credits|balance'; then
        error_class="provider_billing"
      elif echo "$body" | grep -qiE 'models failed'; then
        error_class="all_models_failed"
      fi
      ;;
    500)
      if echo "$body" | grep -q '"error"'; then
        route_ok=1
        if echo "$body" | grep -qiE 'billing|rate.limit|credits|balance|models failed'; then
          error_class="provider_billing"
        else
          error_class="gateway_500"
        fi
      fi
      ;;
    401) error_class="auth_failed" ;;
    000) error_class="connection_refused" ;;
    *)   error_class="http_${http_code}" ;;
  esac

  echo "$http_code $route_ok $model_ok $error_class"
}

if [ "$SIMULATE" = "warn_upstream" ]; then
  # Simulate: route works but models are billing-dead → WARN
  echo "  [SIM] Builder1: route_ok=1 model_ok=0 (simulated upstream billing)"
  echo "  [SIM] Builder2: route_ok=1 model_ok=0 (simulated upstream billing)"
  B1_HTTP="SIM" B1_ROUTE_OK=1 B1_MODEL_OK=0 B1_ERROR_CLASS="provider_billing"
  B2_HTTP="SIM" B2_ROUTE_OK=1 B2_MODEL_OK=0 B2_ERROR_CLASS="provider_billing"
  add_check "live_b1" "WARN" "Simulated: route=1 model=0 err=provider_billing"
  add_check "live_b2" "WARN" "Simulated: route=1 model=0 err=provider_billing"
  add_warn "MODEL_WARN"
elif [ "$DRY_RUN" = "1" ] || [ -n "$SIMULATE" ]; then
  echo "  [SIM/DRY] Skipping live HTTP checks"
  B1_HTTP="SIM" B1_ROUTE_OK=0 B1_MODEL_OK=0 B1_ERROR_CLASS="simulated"
  B2_HTTP="SIM" B2_ROUTE_OK=0 B2_MODEL_OK=0 B2_ERROR_CLASS="simulated"
  add_check "live_b1" "SKIP" "Simulation/dry-run mode"
  add_check "live_b2" "SKIP" "Simulation/dry-run mode"
else
  # Builder1
  B1_RESULT=$(run_live_check "$B1_PORT" "$B1_TOKEN" "$B1_AGENT")
  B1_HTTP=$(echo "$B1_RESULT" | awk '{print $1}')
  B1_ROUTE_OK=$(echo "$B1_RESULT" | awk '{print $2}')
  B1_MODEL_OK=$(echo "$B1_RESULT" | awk '{print $3}')
  B1_ERROR_CLASS=$(echo "$B1_RESULT" | awk '{print $4}')
  echo "  Builder1: http=$B1_HTTP route_ok=$B1_ROUTE_OK model_ok=$B1_MODEL_OK err=$B1_ERROR_CLASS"

  if [ "$B1_ROUTE_OK" -eq 1 ] && [ "$B1_MODEL_OK" -eq 1 ]; then
    add_check "live_b1" "OK" "http=$B1_HTTP route=1 model=1"
  elif [ "$B1_ROUTE_OK" -eq 1 ] && [ "$B1_MODEL_OK" -eq 0 ]; then
    add_check "live_b1" "WARN" "http=$B1_HTTP route=1 model=0 err=$B1_ERROR_CLASS"
    add_warn "MODEL_WARN"
  else
    add_check "live_b1" "FAIL" "http=$B1_HTTP route=0 err=$B1_ERROR_CLASS"
    add_fail "FAIL_LIVE_B1"
  fi

  # Builder2
  B2_RESULT=$(run_live_check "$B2_PORT" "$B2_TOKEN" "$B2_AGENT")
  B2_HTTP=$(echo "$B2_RESULT" | awk '{print $1}')
  B2_ROUTE_OK=$(echo "$B2_RESULT" | awk '{print $2}')
  B2_MODEL_OK=$(echo "$B2_RESULT" | awk '{print $3}')
  B2_ERROR_CLASS=$(echo "$B2_RESULT" | awk '{print $4}')
  echo "  Builder2: http=$B2_HTTP route_ok=$B2_ROUTE_OK model_ok=$B2_MODEL_OK err=$B2_ERROR_CLASS"

  if [ "$B2_ROUTE_OK" -eq 1 ] && [ "$B2_MODEL_OK" -eq 1 ]; then
    add_check "live_b2" "OK" "http=$B2_HTTP route=1 model=1"
  elif [ "$B2_ROUTE_OK" -eq 1 ] && [ "$B2_MODEL_OK" -eq 0 ]; then
    add_check "live_b2" "WARN" "http=$B2_HTTP route=1 model=0 err=$B2_ERROR_CLASS"
    add_warn "MODEL_WARN"
  else
    add_check "live_b2" "FAIL" "http=$B2_HTTP route=0 err=$B2_ERROR_CLASS"
    add_fail "FAIL_LIVE_B2"
  fi
fi

# ── Verdict ──
echo ""
echo "========================================="
VERDICT="OK"
if [ "$EXIT_CODE" -eq 2 ]; then
  VERDICT="FAIL"
elif [ "$EXIT_CODE" -eq 1 ]; then
  VERDICT="WARN"
fi
echo "  VERDICT: $VERDICT (exit $EXIT_CODE)"
if [ -n "$FAIL_MARKERS" ]; then echo "  FAIL markers: [$FAIL_MARKERS]"; fi
if [ -n "$WARN_MARKERS" ]; then echo "  WARN markers: [$WARN_MARKERS]"; fi
echo "========================================="

# ── JSON output (stable key order) ──
{
  printf '{\n'
  printf '  "builder1": {\n'
  printf '    "error_class": "%s",\n' "$B1_ERROR_CLASS"
  printf '    "http_code": "%s",\n' "$B1_HTTP"
  printf '    "model_ok": %d,\n' "$B1_MODEL_OK"
  printf '    "route_ok": %d\n' "$B1_ROUTE_OK"
  printf '  },\n'
  printf '  "builder2": {\n'
  printf '    "error_class": "%s",\n' "$B2_ERROR_CLASS"
  printf '    "http_code": "%s",\n' "$B2_HTTP"
  printf '    "model_ok": %d,\n' "$B2_MODEL_OK"
  printf '    "route_ok": %d\n' "$B2_ROUTE_OK"
  printf '  },\n'
  printf '  "checks": [\n%s\n  ],\n' "$CHECKS_JSON"
  printf '  "config": {\n'
  printf '    "chain_fallbacks": %s,\n' "$CHAIN_FALLBACKS"
  printf '    "chain_primary": "%s",\n' "$CHAIN_PRIMARY"
  printf '    "openai_baseurl": "%s",\n' "$OPENAI_BASEURL"
  printf '    "openai_baseurl_source": "%s"\n' "$OPENAI_BASEURL_SOURCE"
  printf '  },\n'
  printf '  "exit_code": %d,\n' "$EXIT_CODE"
  printf '  "fail_markers": [%s],\n' "$FAIL_MARKERS"
  printf '  "timestamp": "%s",\n' "$TS"
  printf '  "verdict": "%s",\n' "$VERDICT"
  printf '  "warn_markers": [%s]\n' "$WARN_MARKERS"
  printf '}\n'
} > "$JSON_FILE"
echo ""
echo "JSON: $JSON_FILE"

# ── Proof markdown ──
mkdir -p "$PROOF_DIR"
BRANCH_NAME=$(cd "$REPO_ROOT" && su -s /bin/bash openclaw -c 'git rev-parse --abbrev-ref HEAD' 2>/dev/null || echo 'unknown')
HEAD_SHA=$(cd "$REPO_ROOT" && su -s /bin/bash openclaw -c 'git rev-parse --short HEAD' 2>/dev/null || echo 'unknown')

cat > "$PROOF_FILE" << PROOFEOF
# Proof: Provider Drift Sentinel Run

**Date:** $TS
**Branch:** $BRANCH_NAME
**HEAD:** $HEAD_SHA

---

## Verdict: $VERDICT (exit $EXIT_CODE)

$([ -n "$FAIL_MARKERS" ] && echo "**FAIL markers:** \`[$FAIL_MARKERS]\`" && echo "")
$([ -n "$WARN_MARKERS" ] && echo "**WARN markers:** \`[$WARN_MARKERS]\`" && echo "")

## Exit Code Policy

| Code | Meaning | Action |
|------|---------|--------|
| 0 | OK | All builders have working chains + MODEL_OK |
| 1 | WARN | Config OK but upstream provider issue (MODEL_OK=0) |
| 2 | FAIL | Drift detected — chain missing fallback or bad base URL |

## Configuration (redacted)

| Setting | Value |
|---------|-------|
| Primary | \`$CHAIN_PRIMARY\` |
| Fallbacks | \`$CHAIN_FALLBACKS\` |
| OPENAI_BASE_URL | \`$OPENAI_BASEURL\` (source: $OPENAI_BASEURL_SOURCE) |

## Drift Checks

| # | Check | Status | Detail |
|---|-------|--------|--------|
$(python3 -c "
import json, sys
checks = json.loads('[' + sys.argv[1] + ']')
for i, c in enumerate(checks, 1):
    print(f'| {i} | {c[\"name\"]} | {c[\"status\"]} | {c[\"detail\"]} |')
" "$CHECKS_JSON" 2>/dev/null || echo "| - | (table generation failed) | - | - |")

## Live Check Results

| Builder | HTTP | ROUTE_OK | MODEL_OK | Error Class |
|---------|------|----------|----------|-------------|
| Builder1 | $B1_HTTP | $B1_ROUTE_OK | $B1_MODEL_OK | $B1_ERROR_CLASS |
| Builder2 | $B2_HTTP | $B2_ROUTE_OK | $B2_MODEL_OK | $B2_ERROR_CLASS |

## JSON Log

Location: \`$JSON_FILE\`

---

**sha256:** (computed at commit time)
PROOFEOF

echo "Proof: $PROOF_FILE"

exit $EXIT_CODE
