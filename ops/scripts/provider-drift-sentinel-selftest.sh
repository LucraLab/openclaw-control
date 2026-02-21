#!/bin/bash
# provider-drift-sentinel-selftest.sh — Regression anchor for prior incident
# Location: ops/scripts/provider-drift-sentinel-selftest.sh
#
# Runs the sentinel in simulation mode to verify it correctly detects
# the exact failure pattern from the Builder1 MODEL_OK incident:
#   - Chain: moonshot/kimi-k2.5 + anthropic/claude-opus-4-6 only (no openai)
#   - OPENAI_BASE_URL: http://127.0.0.1:4010/v1 (loopback, nothing listening)
#
# Expected: sentinel exits 2 with FAIL_CHAIN + FAIL_OPENAI_BASEURL markers
#
# Exit codes:
#   0 — selftest PASSED (sentinel correctly detected the simulated drift)
#   1 — selftest FAILED (sentinel did NOT detect the simulated drift)
#
# Usage:
#   bash provider-drift-sentinel-selftest.sh

set -uo pipefail

TS=$(date -u +%Y-%m-%dT%H%M%SZ)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROOF_DIR="${REPO_ROOT}/ops/proofs"
PROOF_FILE="${PROOF_DIR}/PROOF_PROVIDER_DRIFT_SENTINEL_SELFTEST_${TS}.md"
SENTINEL="${SCRIPT_DIR}/provider-drift-sentinel.sh"

echo "=== Provider Drift Sentinel — Selftest ==="
echo "Date: $TS"
echo ""

if [ ! -f "$SENTINEL" ]; then
  echo "ERROR: Sentinel script not found at $SENTINEL"
  exit 1
fi

# Run sentinel in simulation mode
echo "--- Running sentinel with SENTINEL_SIMULATE=baseline_dead_chain ---"
echo ""

SENTINEL_EXIT=0
SENTINEL_OUTPUT=$(SENTINEL_SIMULATE=baseline_dead_chain bash "$SENTINEL" 2>&1) || SENTINEL_EXIT=$?

echo "$SENTINEL_OUTPUT"
echo ""

# Verify exit code
EXIT_OK=0
if [ "$SENTINEL_EXIT" -eq 2 ]; then
  echo "[SELFTEST OK] Sentinel exited with code 2 (FAIL) as expected"
  EXIT_OK=1
else
  echo "[SELFTEST FAIL] Sentinel exited with code $SENTINEL_EXIT (expected 2)"
fi

# Verify FAIL_CHAIN marker in output
CHAIN_OK=0
if echo "$SENTINEL_OUTPUT" | grep -q "FAIL_CHAIN"; then
  echo "[SELFTEST OK] FAIL_CHAIN marker found in output"
  CHAIN_OK=1
else
  echo "[SELFTEST FAIL] FAIL_CHAIN marker NOT found in output"
fi

# Verify FAIL_OPENAI_BASEURL marker in output
BASEURL_OK=0
if echo "$SENTINEL_OUTPUT" | grep -q "FAIL_OPENAI_BASEURL"; then
  echo "[SELFTEST OK] FAIL_OPENAI_BASEURL marker found in output"
  BASEURL_OK=1
else
  echo "[SELFTEST FAIL] FAIL_OPENAI_BASEURL marker NOT found in output"
fi

# Verify JSON file was created
JSON_OK=0
JSON_FILE=$(echo "$SENTINEL_OUTPUT" | grep "^JSON:" | awk '{print $2}')
if [ -n "$JSON_FILE" ] && [ -f "$JSON_FILE" ]; then
  # Check JSON contains the markers
  if python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
markers = [m.strip('\"') for m in d.get('fail_markers', [])] if isinstance(d.get('fail_markers'), list) else []
# Also check string representation
raw = open(sys.argv[1]).read()
has_chain = 'FAIL_CHAIN' in raw
has_baseurl = 'FAIL_OPENAI_BASEURL' in raw
if has_chain and has_baseurl and d.get('exit_code') == 2:
    print('JSON_MARKERS_OK')
    sys.exit(0)
else:
    print(f'JSON_MARKERS_MISSING chain={has_chain} baseurl={has_baseurl} exit={d.get(\"exit_code\")}')
    sys.exit(1)
" "$JSON_FILE" 2>/dev/null; then
    JSON_OK=1
    echo "[SELFTEST OK] JSON contains FAIL_CHAIN + FAIL_OPENAI_BASEURL + exit_code=2"
  else
    echo "[SELFTEST FAIL] JSON missing expected markers"
  fi
else
  echo "[SELFTEST FAIL] JSON file not found: $JSON_FILE"
fi

echo ""

# Overall verdict
ALL_OK=0
if [ "$EXIT_OK" -eq 1 ] && [ "$CHAIN_OK" -eq 1 ] && [ "$BASEURL_OK" -eq 1 ] && [ "$JSON_OK" -eq 1 ]; then
  ALL_OK=1
  echo "========================================="
  echo "  SELFTEST: PASSED (4/4 checks)"
  echo "  Sentinel correctly detects the prior"
  echo "  incident pattern and fails closed."
  echo "========================================="
else
  PASSED=$((EXIT_OK + CHAIN_OK + BASEURL_OK + JSON_OK))
  echo "========================================="
  echo "  SELFTEST: FAILED ($PASSED/4 checks)"
  echo "  Sentinel does NOT correctly detect the"
  echo "  prior incident pattern."
  echo "========================================="
fi

# ── Proof markdown ──
mkdir -p "$PROOF_DIR"
BRANCH_NAME=$(cd "$REPO_ROOT" && su -s /bin/bash openclaw -c 'git rev-parse --abbrev-ref HEAD' 2>/dev/null || echo 'unknown')
HEAD_SHA=$(cd "$REPO_ROOT" && su -s /bin/bash openclaw -c 'git rev-parse --short HEAD' 2>/dev/null || echo 'unknown')

cat > "$PROOF_FILE" << PROOFEOF
# Proof: Provider Drift Sentinel — Selftest

**Date:** $TS
**Branch:** $BRANCH_NAME
**HEAD:** $HEAD_SHA

---

## Purpose

Regression anchor: verifies the sentinel correctly detects the exact failure
pattern from the Builder1 MODEL_OK incident (2026-02-21T194309Z).

## Simulated Conditions

| Setting | Simulated Value | Why |
|---------|-----------------|-----|
| Primary | \`moonshot/kimi-k2.5\` | Dead (billing exhausted) |
| Fallbacks | \`["anthropic/claude-opus-4-6"]\` | Dead (usage limit) — no openai |
| OPENAI_BASE_URL | \`http://127.0.0.1:4010/v1\` | Loopback, no listener on Builder |
| Live checks | Skipped | Simulation mode |

## Expected vs Actual

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Exit code | 2 (FAIL) | $SENTINEL_EXIT | $([ "$EXIT_OK" -eq 1 ] && echo "PASS" || echo "FAIL") |
| FAIL_CHAIN marker | Present | $([ "$CHAIN_OK" -eq 1 ] && echo "Present" || echo "Missing") | $([ "$CHAIN_OK" -eq 1 ] && echo "PASS" || echo "FAIL") |
| FAIL_OPENAI_BASEURL marker | Present | $([ "$BASEURL_OK" -eq 1 ] && echo "Present" || echo "Missing") | $([ "$BASEURL_OK" -eq 1 ] && echo "PASS" || echo "FAIL") |
| JSON markers | Both present | $([ "$JSON_OK" -eq 1 ] && echo "Both present" || echo "Missing") | $([ "$JSON_OK" -eq 1 ] && echo "PASS" || echo "FAIL") |

## Selftest Verdict: $([ "$ALL_OK" -eq 1 ] && echo "PASSED (4/4)" || echo "FAILED ($PASSED/4)")

## Sentinel Output (simulation)

\`\`\`
$SENTINEL_OUTPUT
\`\`\`

## JSON File

$([ -n "$JSON_FILE" ] && [ -f "$JSON_FILE" ] && echo "Location: \`$JSON_FILE\`" && echo "" && echo "\`\`\`json" && cat "$JSON_FILE" && echo "\`\`\`" || echo "Not generated")

---

**sha256:** (computed at commit time)
PROOFEOF

echo ""
echo "Proof: $PROOF_FILE"

if [ "$ALL_OK" -eq 1 ]; then
  exit 0
else
  exit 1
fi
