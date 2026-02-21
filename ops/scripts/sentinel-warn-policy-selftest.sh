#!/bin/bash
# sentinel-warn-policy-selftest.sh — Prove both WARN policy modes
# Location: ops/scripts/sentinel-warn-policy-selftest.sh
#
# Runs three deterministic checks:
#   1. Default mode: WARN continues (smoke does not abort)
#   2. Strict mode:  SENTINEL_WARN_IS_FAIL=1 → smoke aborts
#   3. FAIL mode:    baseline_dead_chain → smoke aborts (unchanged)
#
# Exit codes:
#   0 — all 3 checks passed
#   1 — at least one check failed
#
# Usage:
#   bash sentinel-warn-policy-selftest.sh

set -uo pipefail

TS=$(date -u +%Y-%m-%dT%H%M%SZ)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROOF_DIR="${REPO_ROOT}/ops/proofs"
PROOF_FILE="${PROOF_DIR}/PROOF_SENTINEL_WARN_POLICY_RUN_${TS}.md"

SENTINEL="${SCRIPT_DIR}/provider-drift-sentinel.sh"
SMOKE="${SCRIPT_DIR}/routing_smoke_suite.sh"

PASS_COUNT=0
FAIL_COUNT=0
CHECK1_STATUS="FAIL" CHECK1_OUTPUT=""
CHECK2_STATUS="FAIL" CHECK2_OUTPUT=""
CHECK3_STATUS="FAIL" CHECK3_OUTPUT=""

echo "=== Sentinel WARN Policy Selftest — $TS ==="
echo ""

# ── Check 1: Default mode (WARN continues) ──
echo "--- Check 1: Default mode (WARN continues) ---"
echo ""

# Run sentinel in warn_upstream mode first to confirm it exits 1
SENTINEL_EXIT=0
SENTINEL_OUT=$(SENTINEL_SIMULATE=warn_upstream bash "$SENTINEL" 2>&1) || SENTINEL_EXIT=$?

if [ "$SENTINEL_EXIT" -ne 1 ]; then
  echo "[CHECK 1 FAIL] Sentinel warn_upstream exited $SENTINEL_EXIT (expected 1)"
  CHECK1_OUTPUT="Sentinel exit=$SENTINEL_EXIT (expected 1)"
else
  echo "[CHECK 1 OK] Sentinel warn_upstream exits 1"

  # Now run the smoke suite preflight-only by injecting the simulated WARN.
  # We run the full smoke suite with SENTINEL_SIMULATE=warn_upstream.
  # In default mode, it should NOT abort — it should print the WARN banner
  # and continue to the routing tests.
  SMOKE_EXIT=0
  SMOKE_OUT=$(SENTINEL_SIMULATE=warn_upstream bash "$SMOKE" 2>&1) || SMOKE_EXIT=$?

  # The smoke suite should succeed (exit 0) or at worst exit 0 with WARN
  # It should NOT exit 1 or 2 due to the sentinel WARN
  # It should contain the WARN banner
  if echo "$SMOKE_OUT" | grep -q "WARN: Sentinel detected upstream provider"; then
    if [ "$SMOKE_EXIT" -eq 0 ]; then
      echo "[CHECK 1 PASS] Smoke continues with WARN banner (exit=$SMOKE_EXIT)"
      CHECK1_STATUS="PASS"
      PASS_COUNT=$((PASS_COUNT + 1))
      CHECK1_OUTPUT="Smoke exit=$SMOKE_EXIT, WARN banner present, tests ran"
    else
      echo "[CHECK 1 FAIL] Smoke exited $SMOKE_EXIT (expected 0 with WARN)"
      CHECK1_OUTPUT="Smoke exit=$SMOKE_EXIT (expected 0)"
    fi
  else
    echo "[CHECK 1 FAIL] WARN banner not found in smoke output"
    CHECK1_OUTPUT="WARN banner missing, smoke exit=$SMOKE_EXIT"
  fi
fi
echo ""

# ── Check 2: Strict mode (WARN aborts) ──
echo "--- Check 2: Strict mode (SENTINEL_WARN_IS_FAIL=1) ---"
echo ""

SMOKE_EXIT=0
SMOKE_OUT=$(SENTINEL_SIMULATE=warn_upstream SENTINEL_WARN_IS_FAIL=1 bash "$SMOKE" 2>&1) || SMOKE_EXIT=$?

# In strict mode, smoke should abort with exit 2
if [ "$SMOKE_EXIT" -eq 2 ]; then
  if echo "$SMOKE_OUT" | grep -q "SENTINEL_WARN_POLICY_FAIL=1"; then
    echo "[CHECK 2 PASS] Smoke aborted (exit=2) with SENTINEL_WARN_POLICY_FAIL=1"
    CHECK2_STATUS="PASS"
    PASS_COUNT=$((PASS_COUNT + 1))
    CHECK2_OUTPUT="Smoke exit=2, SENTINEL_WARN_POLICY_FAIL=1 present"
  else
    echo "[CHECK 2 FAIL] Smoke exited 2 but SENTINEL_WARN_POLICY_FAIL=1 marker missing"
    CHECK2_OUTPUT="Smoke exit=2, marker missing"
  fi
else
  echo "[CHECK 2 FAIL] Smoke exited $SMOKE_EXIT (expected 2)"
  CHECK2_OUTPUT="Smoke exit=$SMOKE_EXIT (expected 2)"
fi
echo ""

# ── Check 3: FAIL mode unchanged (baseline_dead_chain) ──
echo "--- Check 3: FAIL mode unchanged (baseline_dead_chain) ---"
echo ""

SMOKE_EXIT=0
SMOKE_OUT=$(SENTINEL_SIMULATE=baseline_dead_chain bash "$SMOKE" 2>&1) || SMOKE_EXIT=$?

# Smoke should abort with exit 1 (sentinel FAIL → smoke exit 1)
if [ "$SMOKE_EXIT" -eq 1 ]; then
  if echo "$SMOKE_OUT" | grep -q "SMOKE ABORTED: Provider drift detected"; then
    echo "[CHECK 3 PASS] Smoke aborted (exit=1) on drift detection"
    CHECK3_STATUS="PASS"
    PASS_COUNT=$((PASS_COUNT + 1))
    CHECK3_OUTPUT="Smoke exit=1, drift abort message present"
  else
    echo "[CHECK 3 FAIL] Smoke exited 1 but drift abort message missing"
    CHECK3_OUTPUT="Smoke exit=1, message missing"
  fi
else
  echo "[CHECK 3 FAIL] Smoke exited $SMOKE_EXIT (expected 1)"
  CHECK3_OUTPUT="Smoke exit=$SMOKE_EXIT (expected 1)"
fi
echo ""

# ── Summary ──
TOTAL=3
FAIL_COUNT=$((TOTAL - PASS_COUNT))
echo "========================================="
echo "  SELFTEST: $PASS_COUNT / $TOTAL PASSED"
echo "  Check 1 (default WARN): $CHECK1_STATUS"
echo "  Check 2 (strict WARN):  $CHECK2_STATUS"
echo "  Check 3 (FAIL mode):    $CHECK3_STATUS"
echo "========================================="

# ── Proof markdown ──
mkdir -p "$PROOF_DIR"
BRANCH_NAME=$(cd "$REPO_ROOT" && su -s /bin/bash openclaw -c 'git rev-parse --abbrev-ref HEAD' 2>/dev/null || echo 'unknown')
HEAD_SHA=$(cd "$REPO_ROOT" && su -s /bin/bash openclaw -c 'git rev-parse --short HEAD' 2>/dev/null || echo 'unknown')

cat > "$PROOF_FILE" << PROOFEOF
# Proof: Sentinel WARN Policy — Selftest

**Date:** $TS
**Branch:** $BRANCH_NAME
**HEAD:** $HEAD_SHA

---

## Selftest: $PASS_COUNT / $TOTAL PASSED

## Check Results

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | Default mode (WARN continues) | Smoke continues, WARN banner | $CHECK1_OUTPUT | $CHECK1_STATUS |
| 2 | Strict mode (WARN aborts) | Smoke exit=2, SENTINEL_WARN_POLICY_FAIL=1 | $CHECK2_OUTPUT | $CHECK2_STATUS |
| 3 | FAIL mode unchanged | Smoke exit=1, drift abort | $CHECK3_OUTPUT | $CHECK3_STATUS |

## How to Enable Strict Mode

\`\`\`bash
# One-shot:
SENTINEL_WARN_IS_FAIL=1 bash routing_smoke_suite.sh

# Persistent (export):
export SENTINEL_WARN_IS_FAIL=1
bash routing_smoke_suite.sh
\`\`\`

## Policy Decision Table

| SENTINEL_WARN_IS_FAIL | Sentinel Exit 1 (WARN) | Smoke Behavior |
|----------------------|----------------------|----------------|
| unset / 0 | WARN | Continues with banner |
| 1 | WARN → FAIL | Aborts (exit 2), prints SENTINEL_WARN_POLICY_FAIL=1 |

---

**sha256:** (computed at commit time)
PROOFEOF

echo ""
echo "Proof: $PROOF_FILE"

if [ "$PASS_COUNT" -eq "$TOTAL" ]; then
  exit 0
else
  exit 1
fi
