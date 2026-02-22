#!/bin/bash
# test_port1_payment_model_v1.sh — Regression test for PORT1 payment capacity model
# Location: ops/taxpod/tests/test_port1_payment_model_v1.sh
#
# Runs model builder + docs renderer against fixtures, compares to expected output.
# No network calls. No external test framework.
#
# Exit codes: 0=all pass, 1=at least one fail

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAXPOD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODEL_BUILDER="${TAXPOD_DIR}/build_payment_plan_model_v1.js"
DOCS_RENDERER="${TAXPOD_DIR}/render_financial_docs_needed_md.js"
WRAPPER="${TAXPOD_DIR}/run_port1_payment_capacity.sh"

PASS=0
FAIL=0
TOTAL=0

check() {
  local label="$1"
  local result="$2"
  TOTAL=$((TOTAL + 1))
  if [ "$result" = "PASS" ]; then
    PASS=$((PASS + 1))
    echo "  [PASS] $label"
  else
    FAIL=$((FAIL + 1))
    echo "  [FAIL] $label"
  fi
}

echo "=== PORT1 PaymentPlanModelV1 Test Suite ==="
echo ""

# ══════════════════════════════════════════════
# SUITE A: case_tight (income barely > expenses)
# ══════════════════════════════════════════════
FIX_DIR="${TAXPOD_DIR}/fixtures/port1/case_tight"

echo "━━━ Suite A: case_tight ━━━"
echo ""

# ── Test A1: Model output matches expected ──
echo "--- Test A1: Model output matches expected ---"
TMP_A1=$(mktemp -d)
node "$MODEL_BUILDER" \
  --case case_tight \
  --bundle "$FIX_DIR/bundle" \
  --intake "$FIX_DIR/intake/financial_intake.json" \
  --out "$TMP_A1" \
  --as-of-utc 20260220T000000Z 2>&1 | head -4
EXIT_A1=$?

check "Model builder exits 0" "$([ $EXIT_A1 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_A1/payment_plan_model.json" ]; then
  if diff -q "$TMP_A1/payment_plan_model.json" "$FIX_DIR/expected/payment_plan_model.json" >/dev/null 2>&1; then
    check "payment_plan_model.json matches expected" "PASS"
  else
    check "payment_plan_model.json matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_A1/payment_plan_model.json" "$FIX_DIR/expected/payment_plan_model.json" | head -10
  fi
else
  check "payment_plan_model.json exists" "FAIL"
fi

# ── Test A2: Docs output matches expected ──
echo ""
echo "--- Test A2: Docs output matches expected ---"
node "$DOCS_RENDERER" \
  --intake "$FIX_DIR/intake/financial_intake.json" \
  --model "$TMP_A1/payment_plan_model.json" \
  --out "$TMP_A1" 2>&1 | head -2
EXIT_A2=$?

check "Docs renderer exits 0" "$([ $EXIT_A2 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_A1/financial_docs_needed.md" ]; then
  if diff -q "$TMP_A1/financial_docs_needed.md" "$FIX_DIR/expected/financial_docs_needed.md" >/dev/null 2>&1; then
    check "financial_docs_needed.md matches expected" "PASS"
  else
    check "financial_docs_needed.md matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_A1/financial_docs_needed.md" "$FIX_DIR/expected/financial_docs_needed.md" | head -10
  fi
else
  check "financial_docs_needed.md exists" "FAIL"
fi

# ── Test A3: Risk flags correct (case_tight has none) ──
echo ""
echo "--- Test A3: Risk flags ---"
FLAGS_A=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_A1/payment_plan_model.json','utf8')).risk_flags.length)")
check "case_tight has 0 risk flags" "$([ "$FLAGS_A" = "0" ] && echo PASS || echo FAIL)"

rm -rf "$TMP_A1"
echo ""

# ══════════════════════════════════════════════
# SUITE B: case_stressed (negative cashflow)
# ══════════════════════════════════════════════
FIX_DIR_S="${TAXPOD_DIR}/fixtures/port1/case_stressed"

echo "━━━ Suite B: case_stressed ━━━"
echo ""

# ── Test B1: Model output matches expected ──
echo "--- Test B1: Model output matches expected ---"
TMP_B1=$(mktemp -d)
node "$MODEL_BUILDER" \
  --case case_stressed \
  --bundle "$FIX_DIR_S/bundle" \
  --intake "$FIX_DIR_S/intake/financial_intake.json" \
  --out "$TMP_B1" \
  --as-of-utc 20260220T000000Z 2>&1 | head -4
EXIT_B1=$?

check "Model builder exits 0" "$([ $EXIT_B1 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_B1/payment_plan_model.json" ]; then
  if diff -q "$TMP_B1/payment_plan_model.json" "$FIX_DIR_S/expected/payment_plan_model.json" >/dev/null 2>&1; then
    check "payment_plan_model.json matches expected" "PASS"
  else
    check "payment_plan_model.json matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_B1/payment_plan_model.json" "$FIX_DIR_S/expected/payment_plan_model.json" | head -10
  fi
else
  check "payment_plan_model.json exists" "FAIL"
fi

# ── Test B2: Docs output matches expected ──
echo ""
echo "--- Test B2: Docs output matches expected ---"
node "$DOCS_RENDERER" \
  --intake "$FIX_DIR_S/intake/financial_intake.json" \
  --model "$TMP_B1/payment_plan_model.json" \
  --out "$TMP_B1" 2>&1 | head -2
EXIT_B2=$?

check "Docs renderer exits 0" "$([ $EXIT_B2 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_B1/financial_docs_needed.md" ]; then
  if diff -q "$TMP_B1/financial_docs_needed.md" "$FIX_DIR_S/expected/financial_docs_needed.md" >/dev/null 2>&1; then
    check "financial_docs_needed.md matches expected" "PASS"
  else
    check "financial_docs_needed.md matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_B1/financial_docs_needed.md" "$FIX_DIR_S/expected/financial_docs_needed.md" | head -10
  fi
else
  check "financial_docs_needed.md exists" "FAIL"
fi

# ── Test B3: Risk flags correct ──
echo ""
echo "--- Test B3: Risk flags ---"
HAS_NEG=$(node -e "const f=JSON.parse(require('fs').readFileSync('$TMP_B1/payment_plan_model.json','utf8')).risk_flags; console.log(f.includes('NEGATIVE_CASHFLOW'))")
HAS_SE=$(node -e "const f=JSON.parse(require('fs').readFileSync('$TMP_B1/payment_plan_model.json','utf8')).risk_flags; console.log(f.includes('SELF_EMPLOYMENT_COMPLEXITY'))")
HAS_INC=$(node -e "const f=JSON.parse(require('fs').readFileSync('$TMP_B1/payment_plan_model.json','utf8')).risk_flags; console.log(f.includes('INCOMPLETE_TAX_DATA'))")
check "NEGATIVE_CASHFLOW flag present" "$([ "$HAS_NEG" = "true" ] && echo PASS || echo FAIL)"
check "SELF_EMPLOYMENT_COMPLEXITY flag present" "$([ "$HAS_SE" = "true" ] && echo PASS || echo FAIL)"
check "INCOMPLETE_TAX_DATA flag present" "$([ "$HAS_INC" = "true" ] && echo PASS || echo FAIL)"

# ── Test B4: Disposable is negative ──
echo ""
echo "--- Test B4: Disposable value ---"
DISP=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_B1/payment_plan_model.json','utf8')).monthly_capacity.estimated_disposable_monthly)")
check "Disposable is negative" "$(node -e "console.log($DISP < 0 ? 'PASS' : 'FAIL')")"

rm -rf "$TMP_B1"
echo ""

# ══════════════════════════════════════════════
# SUITE C: Determinism
# ══════════════════════════════════════════════
echo "━━━ Suite C: Determinism ━━━"
echo ""

echo "--- Test C1: Two model runs produce identical output ---"
TMP_C1=$(mktemp -d)
TMP_C2=$(mktemp -d)
node "$MODEL_BUILDER" --case case_tight --bundle "$FIX_DIR/bundle" --intake "$FIX_DIR/intake/financial_intake.json" --out "$TMP_C1" --as-of-utc 20260220T000000Z >/dev/null 2>&1
node "$MODEL_BUILDER" --case case_tight --bundle "$FIX_DIR/bundle" --intake "$FIX_DIR/intake/financial_intake.json" --out "$TMP_C2" --as-of-utc 20260220T000000Z >/dev/null 2>&1

if diff -q "$TMP_C1/payment_plan_model.json" "$TMP_C2/payment_plan_model.json" >/dev/null 2>&1; then
  check "Model determinism (two runs identical)" "PASS"
else
  check "Model determinism (two runs identical)" "FAIL"
fi

# Now add docs to both
node "$DOCS_RENDERER" --intake "$FIX_DIR/intake/financial_intake.json" --model "$TMP_C1/payment_plan_model.json" --out "$TMP_C1" >/dev/null 2>&1
node "$DOCS_RENDERER" --intake "$FIX_DIR/intake/financial_intake.json" --model "$TMP_C2/payment_plan_model.json" --out "$TMP_C2" >/dev/null 2>&1

if diff -q "$TMP_C1/financial_docs_needed.md" "$TMP_C2/financial_docs_needed.md" >/dev/null 2>&1; then
  check "Docs determinism (two runs identical)" "PASS"
else
  check "Docs determinism (two runs identical)" "FAIL"
fi

rm -rf "$TMP_C1" "$TMP_C2"
echo ""

# ══════════════════════════════════════════════
# SUITE D: Fail-closed behaviors
# ══════════════════════════════════════════════
echo "━━━ Suite D: Fail-closed behaviors ━━━"
echo ""

echo "--- Test D1: Missing required intake field ---"
TMP_D=$(mktemp -d)
# Create intake missing case_id
echo '{"as_of_date":"2026-01-01","income":{"sources":[{"type":"employment","description":"job","monthly_amount":3000}]},"expenses":{"housing":[],"transportation":[],"insurance_medical":[],"other_essential":[]},"debts":[],"dependents":0,"assets":{"checking":0,"savings":0,"retirement":0,"home_equity":0,"other_value":0}}' > "$TMP_D/bad_intake.json"
node "$MODEL_BUILDER" --case test --bundle "$FIX_DIR/bundle" --intake "$TMP_D/bad_intake.json" --out "$TMP_D/out" --as-of-utc 20260220T000000Z >/dev/null 2>&1
check "Missing case_id exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test D2: Missing bundle file ---"
node "$MODEL_BUILDER" --case test --bundle /nonexistent/bundle --intake "$FIX_DIR/intake/financial_intake.json" --out "$TMP_D/out2" --as-of-utc 20260220T000000Z >/dev/null 2>&1
check "Missing bundle exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test D3: Missing intake file ---"
node "$MODEL_BUILDER" --case test --bundle "$FIX_DIR/bundle" --intake /nonexistent/intake.json --out "$TMP_D/out3" --as-of-utc 20260220T000000Z >/dev/null 2>&1
check "Missing intake exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test D4: Output exists guard ---"
TMP_D4=$(mktemp -d)
node "$MODEL_BUILDER" --case case_tight --bundle "$FIX_DIR/bundle" --intake "$FIX_DIR/intake/financial_intake.json" --out "$TMP_D4" --as-of-utc 20260220T000000Z >/dev/null 2>&1
# Run again without --force
node "$MODEL_BUILDER" --case case_tight --bundle "$FIX_DIR/bundle" --intake "$FIX_DIR/intake/financial_intake.json" --out "$TMP_D4" --as-of-utc 20260220T000000Z >/dev/null 2>&1
EXIT_D4=$?
check "Output exists exits 3" "$([ $EXIT_D4 -eq 3 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test D5: Missing required args ---"
node "$MODEL_BUILDER" --bundle "$FIX_DIR/bundle" --intake "$FIX_DIR/intake/financial_intake.json" >/dev/null 2>&1
check "Missing --case exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

rm -rf "$TMP_D" "$TMP_D4"
echo ""

# ══════════════════════════════════════════════
# SUITE E: Wrapper script
# ══════════════════════════════════════════════
echo "━━━ Suite E: Wrapper script ━━━"
echo ""

echo "--- Test E1: Wrapper produces both outputs ---"
TMP_E=$(mktemp -d)
OUTPUT_E=$(bash "$WRAPPER" --case case_tight --bundle "$FIX_DIR/bundle" --intake "$FIX_DIR/intake/financial_intake.json" --out "$TMP_E" --as-of-utc 20260220T000000Z --force 2>&1)
EXIT_E=$?
check "Wrapper exits 0" "$([ $EXIT_E -eq 0 ] && echo PASS || echo FAIL)"
check "Wrapper output contains PORT1_OK" "$(echo "$OUTPUT_E" | grep -q PORT1_OK && echo PASS || echo FAIL)"
check "Wrapper creates payment_plan_model.json" "$([ -f "$TMP_E/payment_plan_model.json" ] && echo PASS || echo FAIL)"
check "Wrapper creates financial_docs_needed.md" "$([ -f "$TMP_E/financial_docs_needed.md" ] && echo PASS || echo FAIL)"
rm -rf "$TMP_E"
echo ""

# ══════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════
echo "========================================="
echo "  TESTS: $PASS / $TOTAL PASSED"
if [ $FAIL -gt 0 ]; then
  echo "  FAILURES: $FAIL"
fi
echo "========================================="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
exit 0
