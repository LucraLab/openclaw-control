#!/bin/bash
# routing_smoke_suite.sh — E2E routing validation for Builder agent targeting
# Location: ops/scripts/routing_smoke_suite.sh
#
# Semantics:
#   ROUTE_OK  = HTTP reached gateway, agent resolution accepted (not 401/404)
#   MODEL_OK  = LLM response contains normal completion (not provider error)
#
#   PASS          = ROUTE_OK + MODEL_OK
#   PASS_ROUTE    = ROUTE_OK but MODEL_OK failed (provider/billing issue)
#   FAIL          = ROUTE_OK failed
#
# Verdict:
#   FAIL if any required ROUTE_OK check fails
#   WARN (exit 0) if ROUTE_OK passes but MODEL_OK fails
#
# Output:
#   - PASS/FAIL/WARN summary to stdout
#   - JSON log to /tmp/routing-smoke-<ts>.json
#   - Proof markdown to ops/proofs/
#
# Usage: bash routing_smoke_suite.sh

set -uo pipefail

TS=$(date -u +%Y-%m-%dT%H%M%SZ)
LOG_FILE="/tmp/routing-smoke-${TS}.json"
PROOF_DIR="/home/openclaw/staging/current/ops/proofs"
PROOF_FILE="${PROOF_DIR}/PROOF_ROUTING_SMOKE_SUITE_ROUTE_VS_MODEL_${TS}.md"

# Builder connectivity
BUILDER_TS_IP="100.75.216.57"
B1_PORT=8080
B2_PORT=8082

# Auth tokens (redacted in all output)
B1_TOKEN="2b7526a0647a3925a61cb113fe65a38e8bf749435f991276a85c6ab7182d9d6a"
B2_TOKEN="d0ef2036e033134523d2ecb0585902b10acd393962154cac67fe2802d7fc2827"

# Known agents
B1_KNOWN_AGENT="developer"
B2_KNOWN_AGENT="sales"
INVALID_AGENT="definitely-not-real-agent-xyz"

TOTAL=0
ROUTE_PASS=0
MODEL_PASS=0
ROUTE_FAIL=0
WARN_COUNT=0
RESULTS_JSON=""

redact_token() {
  echo "$1" | sed -E 's/[a-f0-9]{64}/[REDACTED-64-HEX]/g; s/Bearer [^ ]+/Bearer [REDACTED]/g'
}

# Core test runner with ROUTE_OK / MODEL_OK split
run_http_test() {
  local name="$1" target="$2" method="$3"
  shift 3
  local curl_cmd="$*"
  TOTAL=$((TOTAL + 1))

  local output http_code
  output=$(eval "$curl_cmd -w '\\n%{http_code}'" 2>&1)
  http_code=$(echo "$output" | tail -1)
  local body
  body=$(echo "$output" | sed '$d')

  local route_ok=0 model_ok=0 error_class="none" status="FAIL"

  # ROUTE_OK: gateway accepted the request (200, 500 with JSON body, etc.)
  # NOT route_ok: connection refused, 401, 404
  case "$http_code" in
    200)
      route_ok=1
      # Check if response has normal completion
      if echo "$body" | grep -q '"choices"' && ! echo "$body" | grep -qi 'billing\|rate.limit\|credits\|balance\|models failed'; then
        model_ok=1
      elif echo "$body" | grep -qiE 'billing|rate.limit|credits|balance|models failed'; then
        error_class="provider_billing"
      fi
      ;;
    500)
      # 500 with JSON error body = gateway processed but LLM failed = route OK
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
    404) error_class="not_found" ;;
    000) error_class="connection_refused" ;;
    *)   error_class="http_${http_code}" ;;
  esac

  if [ "$route_ok" -eq 1 ] && [ "$model_ok" -eq 1 ]; then
    status="PASS"
    ROUTE_PASS=$((ROUTE_PASS + 1))
    MODEL_PASS=$((MODEL_PASS + 1))
  elif [ "$route_ok" -eq 1 ]; then
    status="PASS_ROUTE"
    ROUTE_PASS=$((ROUTE_PASS + 1))
    WARN_COUNT=$((WARN_COUNT + 1))
  else
    status="FAIL"
    ROUTE_FAIL=$((ROUTE_FAIL + 1))
  fi

  local redacted_body
  redacted_body=$(redact_token "$body" | head -1 | head -c 120)

  echo "  [$status] $name (http=$http_code, route=$route_ok, model=$model_ok, err=$error_class)"

  # Append to JSON results
  local entry
  entry=$(printf '{"name":"%s","target":"%s","method":"%s","route_ok":%d,"model_ok":%d,"http_code":"%s","error_class":"%s","status":"%s"}' \
    "$name" "$target" "$method" "$route_ok" "$model_ok" "$http_code" "$error_class" "$status")
  if [ -n "$RESULTS_JSON" ]; then
    RESULTS_JSON="${RESULTS_JSON},${entry}"
  else
    RESULTS_JSON="$entry"
  fi
}

# Allowlist test runner (no HTTP)
run_allowlist_test() {
  local name="$1" expected_result="$2"
  shift 2
  local cmd_desc="$*"
  TOTAL=$((TOTAL + 1))

  local output
  output=$(eval "$cmd_desc" 2>&1) || true
  eval "$cmd_desc" > /dev/null 2>&1
  local exit_code=$?

  local status="FAIL" route_ok=0 model_ok=0 error_class="none"

  case "$expected_result" in
    refused)
      if echo "$output" | grep -q 'AGENT_ROUTE_REFUSED'; then
        status="PASS"; route_ok=1; model_ok=1
      else
        error_class="expected_refusal_missing"
      fi
      ;;
    allowed)
      if echo "$output" | grep -q 'AGENT_ALLOWED'; then
        status="PASS"; route_ok=1; model_ok=1
      else
        error_class="expected_allow_missing"
      fi
      ;;
  esac

  if [ "$status" = "PASS" ]; then
    ROUTE_PASS=$((ROUTE_PASS + 1))
    MODEL_PASS=$((MODEL_PASS + 1))
  else
    ROUTE_FAIL=$((ROUTE_FAIL + 1))
  fi

  local redacted_output
  redacted_output=$(echo "$output" | head -1 | head -c 100)
  echo "  [$status] $name (exit=$exit_code)"

  local entry
  entry=$(printf '{"name":"%s","target":"dude","method":"allowlist","route_ok":%d,"model_ok":%d,"http_code":"n/a","error_class":"%s","status":"%s"}' \
    "$name" "$route_ok" "$model_ok" "$error_class" "$status")
  if [ -n "$RESULTS_JSON" ]; then
    RESULTS_JSON="${RESULTS_JSON},${entry}"
  else
    RESULTS_JSON="$entry"
  fi
}

echo "=== Routing Smoke Suite (ROUTE_OK / MODEL_OK) — $TS ==="
echo ""

# ── HTTP Agent Targeting (Builder2) ──
echo "--- HTTP Agent Targeting (Builder2 port $B2_PORT) ---"

run_http_test "B2 model:openclaw/$B2_KNOWN_AGENT" "builder2:$B2_PORT" "model_prefix" \
  "curl -s -X POST http://${BUILDER_TS_IP}:${B2_PORT}/v1/chat/completions \
   -H 'Content-Type: application/json' \
   -H 'Authorization: Bearer ${B2_TOKEN}' \
   -d '{\"model\":\"openclaw/${B2_KNOWN_AGENT}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply pong\"}],\"max_tokens\":5}'"

run_http_test "B2 model:agent:$B2_KNOWN_AGENT" "builder2:$B2_PORT" "agent_prefix" \
  "curl -s -X POST http://${BUILDER_TS_IP}:${B2_PORT}/v1/chat/completions \
   -H 'Content-Type: application/json' \
   -H 'Authorization: Bearer ${B2_TOKEN}' \
   -d '{\"model\":\"agent:${B2_KNOWN_AGENT}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply pong\"}],\"max_tokens\":5}'"

run_http_test "B2 header:X-OpenClaw-Agent-Id=$B2_KNOWN_AGENT" "builder2:$B2_PORT" "header" \
  "curl -s -X POST http://${BUILDER_TS_IP}:${B2_PORT}/v1/chat/completions \
   -H 'Content-Type: application/json' \
   -H 'Authorization: Bearer ${B2_TOKEN}' \
   -H 'X-OpenClaw-Agent-Id: ${B2_KNOWN_AGENT}' \
   -d '{\"model\":\"openclaw\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply pong\"}],\"max_tokens\":5}'"

# ── HTTP Agent Targeting (Builder1) ──
echo ""
echo "--- HTTP Agent Targeting (Builder1 port $B1_PORT) ---"

run_http_test "B1 model:openclaw/$B1_KNOWN_AGENT" "builder1:$B1_PORT" "model_prefix" \
  "curl -s -X POST http://${BUILDER_TS_IP}:${B1_PORT}/v1/chat/completions \
   -H 'Content-Type: application/json' \
   -H 'Authorization: Bearer ${B1_TOKEN}' \
   -d '{\"model\":\"openclaw/${B1_KNOWN_AGENT}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply pong\"}],\"max_tokens\":5}'"

# ── Dude Allowlist Validation ──
echo ""
echo "--- Dude Allowlist Validation ---"

run_allowlist_test "Dude REFUSE invalid (builder2)" "refused" \
  "python3 /root/bin/agent-allowlist-check.py builder2 ${INVALID_AGENT}"

run_allowlist_test "Dude ALLOW valid (builder2/$B2_KNOWN_AGENT)" "allowed" \
  "python3 /root/bin/agent-allowlist-check.py builder2 ${B2_KNOWN_AGENT}"

run_allowlist_test "Dude ALLOW valid (builder1/$B1_KNOWN_AGENT)" "allowed" \
  "python3 /root/bin/agent-allowlist-check.py builder1 ${B1_KNOWN_AGENT}"

run_allowlist_test "Dude REFUSE invalid (builder1)" "refused" \
  "python3 /root/bin/agent-allowlist-check.py builder1 ${INVALID_AGENT}"

run_allowlist_test "Dude dispatch REFUSE before SSH" "refused" \
  "OPENCLAW_VIA_JOBMGR=1 /root/bin/dispatch-to-builder.sh agent-task ${INVALID_AGENT} 'smoke test'"

# ── Summary ──
echo ""
echo "========================================="
echo "  ROUTE_OK: $ROUTE_PASS / $TOTAL"
echo "  MODEL_OK: $MODEL_PASS / $TOTAL"
echo "  Warnings: $WARN_COUNT (route ok, model failed)"
echo "  Failures: $ROUTE_FAIL (route failed)"
echo "========================================="

VERDICT="ALL_PASS"
EXIT_CODE=0
if [ "$ROUTE_FAIL" -gt 0 ]; then
  VERDICT="FAIL"
  EXIT_CODE=1
elif [ "$WARN_COUNT" -gt 0 ]; then
  VERDICT="WARN_ROUTE_ONLY"
  EXIT_CODE=0
fi
echo "VERDICT: $VERDICT"

# ── JSON Log ──
{
  printf '{\n'
  printf '  "timestamp": "%s",\n' "$TS"
  printf '  "total": %d,\n' "$TOTAL"
  printf '  "route_pass": %d,\n' "$ROUTE_PASS"
  printf '  "model_pass": %d,\n' "$MODEL_PASS"
  printf '  "route_fail": %d,\n' "$ROUTE_FAIL"
  printf '  "warn_count": %d,\n' "$WARN_COUNT"
  printf '  "verdict": "%s",\n' "$VERDICT"
  printf '  "builder_ts_ip": "%s",\n' "$BUILDER_TS_IP"
  printf '  "b1_port": %d,\n' "$B1_PORT"
  printf '  "b2_port": %d,\n' "$B2_PORT"
  printf '  "results": [%s]\n' "$RESULTS_JSON"
  printf '}\n'
} > "$LOG_FILE"
echo ""
echo "JSON log: $LOG_FILE"

# ── Proof Markdown ──
mkdir -p "$PROOF_DIR"
{
  echo "# Proof: Routing Smoke Suite (ROUTE_OK / MODEL_OK)"
  echo ""
  echo "**Date:** $TS"
  echo "**Branch:** $(cd /home/openclaw/staging/current && su -s /bin/bash openclaw -c 'git rev-parse --abbrev-ref HEAD' 2>/dev/null || echo 'unknown')"
  echo "**HEAD:** $(cd /home/openclaw/staging/current && su -s /bin/bash openclaw -c 'git rev-parse --short HEAD' 2>/dev/null || echo 'unknown')"
  echo ""
  echo "---"
  echo ""
  echo "## Verdict: $VERDICT"
  echo ""
  echo "| Metric | Value |"
  echo "|--------|-------|"
  echo "| Total tests | $TOTAL |"
  echo "| ROUTE_OK | $ROUTE_PASS / $TOTAL |"
  echo "| MODEL_OK | $MODEL_PASS / $TOTAL |"
  echo "| Warnings (route ok, model failed) | $WARN_COUNT |"
  echo "| Failures (route failed) | $ROUTE_FAIL |"
  echo ""
  echo "## Semantics"
  echo ""
  echo "- **PASS** = ROUTE_OK + MODEL_OK (gateway accepted, LLM responded normally)"
  echo "- **PASS_ROUTE** = ROUTE_OK only (gateway accepted, but LLM provider error e.g. billing)"
  echo "- **FAIL** = ROUTE_OK failed (gateway unreachable, auth rejected, etc.)"
  echo ""
  echo "## Test Results"
  echo ""
  echo "| # | Status | Test | HTTP | Route | Model | Error |"
  echo "|---|--------|------|------|-------|-------|-------|"
  # Parse JSON results for table
  python3 -c "
import sys, json
data = json.loads('[' + sys.argv[1] + ']')
for i, r in enumerate(data, 1):
    print(f'| {i} | {r[\"status\"]} | {r[\"name\"]} | {r[\"http_code\"]} | {r[\"route_ok\"]} | {r[\"model_ok\"]} | {r[\"error_class\"]} |')
" "$RESULTS_JSON" 2>/dev/null || echo "| - | - | (table generation failed) | - | - | - | - |"
  echo ""
  echo "## Infrastructure"
  echo ""
  echo "- **Builder Tailscale IP:** $BUILDER_TS_IP"
  echo "- **Builder1 port:** $B1_PORT (\`--bind tailnet\`)"
  echo "- **Builder2 port:** $B2_PORT (\`--bind tailnet\`)"
  echo "- **Auth:** Token-based (Bearer, [REDACTED])"
  echo "- **Dude allowlist:** /root/bin/agent-allowlist.json (installed from ops/dude/)"
  echo ""
  echo "## JSON Log"
  echo ""
  echo "Location: \`$LOG_FILE\`"
} > "$PROOF_FILE"

echo "Proof: $PROOF_FILE"

exit $EXIT_CODE
