#!/bin/bash
# test_port2_strategy_v1.sh — Regression test for PORT2 strategy recommender
# Location: ops/taxpod/tests/test_port2_strategy_v1.sh
#
# Runs strategy recommender + report renderer against fixtures, compares to expected output.
# No network calls. No external test framework.
#
# Exit codes: 0=all pass, 1=at least one fail

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAXPOD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RECOMMENDER="${TAXPOD_DIR}/recommend_payment_strategy_v1.js"
RENDERER="${TAXPOD_DIR}/render_payment_plan_recommendation_md.js"
WRAPPER="${TAXPOD_DIR}/run_port2_strategy_recommendation.sh"

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

echo "=== PORT2 StrategyRecommendationV1 Test Suite ==="
echo ""

# We run from TAXPOD_DIR so relative fixture paths match expected outputs
cd "$TAXPOD_DIR"

# ══════════════════════════════════════════════
# SUITE A: case_short_term (SHORT_TERM_PAYMENT_PLAN)
# ══════════════════════════════════════════════
FIX_A="fixtures/port2/case_short_term"

echo "━━━ Suite A: case_short_term ━━━"
echo ""

# ── Test A1: Recommender output matches expected ──
echo "--- Test A1: Recommender output matches expected ---"
TMP_A=$(mktemp -d)
node "$RECOMMENDER" \
  --case case_short_term \
  --bundle "$FIX_A/bundle" \
  --model "$FIX_A/model/payment_plan_model.json" \
  --out "$TMP_A" \
  --as-of-utc 20260220T000000Z 2>&1 | head -6
EXIT_A1=$?

check "Recommender exits 0" "$([ $EXIT_A1 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_A/strategy_recommendation.json" ]; then
  if diff -q "$TMP_A/strategy_recommendation.json" "$FIX_A/expected/strategy_recommendation.json" >/dev/null 2>&1; then
    check "strategy_recommendation.json matches expected" "PASS"
  else
    check "strategy_recommendation.json matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_A/strategy_recommendation.json" "$FIX_A/expected/strategy_recommendation.json" | head -10
  fi
else
  check "strategy_recommendation.json exists" "FAIL"
fi

# ── Test A2: Renderer output matches expected ──
echo ""
echo "--- Test A2: Renderer output matches expected ---"
node "$RENDERER" \
  --strategy "$TMP_A/strategy_recommendation.json" \
  --out "$TMP_A" 2>&1 | head -2
EXIT_A2=$?

check "Renderer exits 0" "$([ $EXIT_A2 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_A/payment_plan_recommendation.md" ]; then
  if diff -q "$TMP_A/payment_plan_recommendation.md" "$FIX_A/expected/payment_plan_recommendation.md" >/dev/null 2>&1; then
    check "payment_plan_recommendation.md matches expected" "PASS"
  else
    check "payment_plan_recommendation.md matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_A/payment_plan_recommendation.md" "$FIX_A/expected/payment_plan_recommendation.md" | head -10
  fi
else
  check "payment_plan_recommendation.md exists" "FAIL"
fi

# ── Test A3: Strategy type correct ──
echo ""
echo "--- Test A3: Strategy type ---"
TYPE_A=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_A/strategy_recommendation.json','utf8')).strategy.type)")
check "Strategy is SHORT_TERM_PAYMENT_PLAN" "$([ "$TYPE_A" = "SHORT_TERM_PAYMENT_PLAN" ] && echo PASS || echo FAIL)"

# ── Test A4: Months correct ──
MONTHS_A=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_A/strategy_recommendation.json','utf8')).strategy.estimated_months_to_payoff)")
check "Months is 5" "$([ "$MONTHS_A" = "5" ] && echo PASS || echo FAIL)"

rm -rf "$TMP_A"
echo ""

# ══════════════════════════════════════════════
# SUITE B: case_long_term (LONG_TERM_INSTALLMENT_AGREEMENT)
# ══════════════════════════════════════════════
FIX_B="fixtures/port2/case_long_term"

echo "━━━ Suite B: case_long_term ━━━"
echo ""

echo "--- Test B1: Recommender output matches expected ---"
TMP_B=$(mktemp -d)
node "$RECOMMENDER" \
  --case case_long_term \
  --bundle "$FIX_B/bundle" \
  --model "$FIX_B/model/payment_plan_model.json" \
  --out "$TMP_B" \
  --as-of-utc 20260220T000000Z 2>&1 | head -6
EXIT_B1=$?

check "Recommender exits 0" "$([ $EXIT_B1 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_B/strategy_recommendation.json" ]; then
  if diff -q "$TMP_B/strategy_recommendation.json" "$FIX_B/expected/strategy_recommendation.json" >/dev/null 2>&1; then
    check "strategy_recommendation.json matches expected" "PASS"
  else
    check "strategy_recommendation.json matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_B/strategy_recommendation.json" "$FIX_B/expected/strategy_recommendation.json" | head -10
  fi
else
  check "strategy_recommendation.json exists" "FAIL"
fi

echo ""
echo "--- Test B2: Renderer output matches expected ---"
node "$RENDERER" \
  --strategy "$TMP_B/strategy_recommendation.json" \
  --out "$TMP_B" 2>&1 | head -2
EXIT_B2=$?

check "Renderer exits 0" "$([ $EXIT_B2 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_B/payment_plan_recommendation.md" ]; then
  if diff -q "$TMP_B/payment_plan_recommendation.md" "$FIX_B/expected/payment_plan_recommendation.md" >/dev/null 2>&1; then
    check "payment_plan_recommendation.md matches expected" "PASS"
  else
    check "payment_plan_recommendation.md matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_B/payment_plan_recommendation.md" "$FIX_B/expected/payment_plan_recommendation.md" | head -10
  fi
else
  check "payment_plan_recommendation.md exists" "FAIL"
fi

echo ""
echo "--- Test B3: Strategy type and months ---"
TYPE_B=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_B/strategy_recommendation.json','utf8')).strategy.type)")
MONTHS_B=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_B/strategy_recommendation.json','utf8')).strategy.estimated_months_to_payoff)")
check "Strategy is LONG_TERM_INSTALLMENT_AGREEMENT" "$([ "$TYPE_B" = "LONG_TERM_INSTALLMENT_AGREEMENT" ] && echo PASS || echo FAIL)"
check "Months is 37" "$([ "$MONTHS_B" = "37" ] && echo PASS || echo FAIL)"

# ── Test B4: Call script includes installment question ──
echo ""
echo "--- Test B4: Call script questions ---"
HAS_IA_Q=$(node -e "const r=JSON.parse(require('fs').readFileSync('$TMP_B/strategy_recommendation.json','utf8')); console.log(r.execution.call_script_questions.some(q => q.includes('installment agreement')))")
check "Call script includes installment agreement question" "$([ "$HAS_IA_Q" = "true" ] && echo PASS || echo FAIL)"

rm -rf "$TMP_B"
echo ""

# ══════════════════════════════════════════════
# SUITE C: case_partial_pay (PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT)
# ══════════════════════════════════════════════
FIX_C="fixtures/port2/case_partial_pay"

echo "━━━ Suite C: case_partial_pay ━━━"
echo ""

echo "--- Test C1: Recommender output matches expected ---"
TMP_C=$(mktemp -d)
node "$RECOMMENDER" \
  --case case_partial_pay \
  --bundle "$FIX_C/bundle" \
  --model "$FIX_C/model/payment_plan_model.json" \
  --out "$TMP_C" \
  --as-of-utc 20260220T000000Z 2>&1 | head -6
EXIT_C1=$?

check "Recommender exits 0" "$([ $EXIT_C1 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_C/strategy_recommendation.json" ]; then
  if diff -q "$TMP_C/strategy_recommendation.json" "$FIX_C/expected/strategy_recommendation.json" >/dev/null 2>&1; then
    check "strategy_recommendation.json matches expected" "PASS"
  else
    check "strategy_recommendation.json matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_C/strategy_recommendation.json" "$FIX_C/expected/strategy_recommendation.json" | head -10
  fi
else
  check "strategy_recommendation.json exists" "FAIL"
fi

echo ""
echo "--- Test C2: Renderer output matches expected ---"
node "$RENDERER" \
  --strategy "$TMP_C/strategy_recommendation.json" \
  --out "$TMP_C" 2>&1 | head -2
EXIT_C2=$?

check "Renderer exits 0" "$([ $EXIT_C2 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_C/payment_plan_recommendation.md" ]; then
  if diff -q "$TMP_C/payment_plan_recommendation.md" "$FIX_C/expected/payment_plan_recommendation.md" >/dev/null 2>&1; then
    check "payment_plan_recommendation.md matches expected" "PASS"
  else
    check "payment_plan_recommendation.md matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_C/payment_plan_recommendation.md" "$FIX_C/expected/payment_plan_recommendation.md" | head -10
  fi
else
  check "payment_plan_recommendation.md exists" "FAIL"
fi

echo ""
echo "--- Test C3: Strategy type and months ---"
TYPE_C=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_C/strategy_recommendation.json','utf8')).strategy.type)")
MONTHS_C=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_C/strategy_recommendation.json','utf8')).strategy.estimated_months_to_payoff)")
check "Strategy is PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT" "$([ "$TYPE_C" = "PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT" ] && echo PASS || echo FAIL)"
check "Months is 809" "$([ "$MONTHS_C" = "809" ] && echo PASS || echo FAIL)"

# ── Test C4: Call script includes 433-A question ──
echo ""
echo "--- Test C4: Call script questions ---"
HAS_433=$(node -e "const r=JSON.parse(require('fs').readFileSync('$TMP_C/strategy_recommendation.json','utf8')); console.log(r.execution.call_script_questions.some(q => q.includes('433-A')))")
check "Call script includes Form 433-A question" "$([ "$HAS_433" = "true" ] && echo PASS || echo FAIL)"

# ── Test C5: Risk flags ──
echo ""
echo "--- Test C5: Risk flags ---"
HAS_LOW=$(node -e "const r=JSON.parse(require('fs').readFileSync('$TMP_C/strategy_recommendation.json','utf8')); console.log(r.risk_flags.includes('LOW_DISPOSABLE'))")
check "LOW_DISPOSABLE flag present" "$([ "$HAS_LOW" = "true" ] && echo PASS || echo FAIL)"

rm -rf "$TMP_C"
echo ""

# ══════════════════════════════════════════════
# SUITE D: case_escalate (CPA_ESCALATION_REQUIRED)
# ══════════════════════════════════════════════
FIX_D="fixtures/port2/case_escalate"

echo "━━━ Suite D: case_escalate ━━━"
echo ""

echo "--- Test D1: Recommender output matches expected ---"
TMP_D=$(mktemp -d)
node "$RECOMMENDER" \
  --case case_escalate \
  --bundle "$FIX_D/bundle" \
  --model "$FIX_D/model/payment_plan_model.json" \
  --out "$TMP_D" \
  --as-of-utc 20260220T000000Z 2>&1 | head -6
EXIT_D1=$?

check "Recommender exits 0" "$([ $EXIT_D1 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_D/strategy_recommendation.json" ]; then
  if diff -q "$TMP_D/strategy_recommendation.json" "$FIX_D/expected/strategy_recommendation.json" >/dev/null 2>&1; then
    check "strategy_recommendation.json matches expected" "PASS"
  else
    check "strategy_recommendation.json matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_D/strategy_recommendation.json" "$FIX_D/expected/strategy_recommendation.json" | head -10
  fi
else
  check "strategy_recommendation.json exists" "FAIL"
fi

echo ""
echo "--- Test D2: Renderer output matches expected ---"
node "$RENDERER" \
  --strategy "$TMP_D/strategy_recommendation.json" \
  --out "$TMP_D" 2>&1 | head -2
EXIT_D2=$?

check "Renderer exits 0" "$([ $EXIT_D2 -eq 0 ] && echo PASS || echo FAIL)"

if [ -f "$TMP_D/payment_plan_recommendation.md" ]; then
  if diff -q "$TMP_D/payment_plan_recommendation.md" "$FIX_D/expected/payment_plan_recommendation.md" >/dev/null 2>&1; then
    check "payment_plan_recommendation.md matches expected" "PASS"
  else
    check "payment_plan_recommendation.md matches expected" "FAIL"
    echo "    DIFF:"
    diff "$TMP_D/payment_plan_recommendation.md" "$FIX_D/expected/payment_plan_recommendation.md" | head -10
  fi
else
  check "payment_plan_recommendation.md exists" "FAIL"
fi

echo ""
echo "--- Test D3: Strategy type ---"
TYPE_D=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_D/strategy_recommendation.json','utf8')).strategy.type)")
check "Strategy is CPA_ESCALATION_REQUIRED" "$([ "$TYPE_D" = "CPA_ESCALATION_REQUIRED" ] && echo PASS || echo FAIL)"

# ── Test D4: Payment is 0 and months is null ──
echo ""
echo "--- Test D4: Escalation values ---"
PAY_D=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_D/strategy_recommendation.json','utf8')).strategy.recommended_monthly_payment)")
MONTHS_D=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_D/strategy_recommendation.json','utf8')).strategy.estimated_months_to_payoff)")
check "Payment is 0" "$([ "$PAY_D" = "0" ] && echo PASS || echo FAIL)"
check "Months is null" "$([ "$MONTHS_D" = "null" ] && echo PASS || echo FAIL)"

# ── Test D5: INCOMPLETE_TAX_DATA flag present ──
echo ""
echo "--- Test D5: Risk flags ---"
HAS_INC=$(node -e "const r=JSON.parse(require('fs').readFileSync('$TMP_D/strategy_recommendation.json','utf8')); console.log(r.risk_flags.includes('INCOMPLETE_TAX_DATA'))")
check "INCOMPLETE_TAX_DATA flag present" "$([ "$HAS_INC" = "true" ] && echo PASS || echo FAIL)"

rm -rf "$TMP_D"
echo ""

# ══════════════════════════════════════════════
# SUITE E: Determinism
# ══════════════════════════════════════════════
echo "━━━ Suite E: Determinism ━━━"
echo ""

echo "--- Test E1: Two recommender runs produce identical output ---"
TMP_E1=$(mktemp -d)
TMP_E2=$(mktemp -d)
node "$RECOMMENDER" --case case_short_term --bundle "$FIX_A/bundle" --model "$FIX_A/model/payment_plan_model.json" --out "$TMP_E1" --as-of-utc 20260220T000000Z >/dev/null 2>&1
node "$RECOMMENDER" --case case_short_term --bundle "$FIX_A/bundle" --model "$FIX_A/model/payment_plan_model.json" --out "$TMP_E2" --as-of-utc 20260220T000000Z >/dev/null 2>&1

if diff -q "$TMP_E1/strategy_recommendation.json" "$TMP_E2/strategy_recommendation.json" >/dev/null 2>&1; then
  check "Recommender determinism (two runs identical)" "PASS"
else
  check "Recommender determinism (two runs identical)" "FAIL"
fi

# Add renderer to both
node "$RENDERER" --strategy "$TMP_E1/strategy_recommendation.json" --out "$TMP_E1" >/dev/null 2>&1
node "$RENDERER" --strategy "$TMP_E2/strategy_recommendation.json" --out "$TMP_E2" >/dev/null 2>&1

if diff -q "$TMP_E1/payment_plan_recommendation.md" "$TMP_E2/payment_plan_recommendation.md" >/dev/null 2>&1; then
  check "Renderer determinism (two runs identical)" "PASS"
else
  check "Renderer determinism (two runs identical)" "FAIL"
fi

rm -rf "$TMP_E1" "$TMP_E2"
echo ""

# ══════════════════════════════════════════════
# SUITE F: Fail-closed behaviors
# ══════════════════════════════════════════════
echo "━━━ Suite F: Fail-closed behaviors ━━━"
echo ""

echo "--- Test F1: Missing bundle ---"
TMP_F=$(mktemp -d)
node "$RECOMMENDER" --case test --bundle /nonexistent/bundle --model "$FIX_A/model/payment_plan_model.json" --out "$TMP_F/out1" --as-of-utc 20260220T000000Z >/dev/null 2>&1
check "Missing bundle exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test F2: Missing model ---"
node "$RECOMMENDER" --case test --bundle "$FIX_A/bundle" --model /nonexistent/model.json --out "$TMP_F/out2" --as-of-utc 20260220T000000Z >/dev/null 2>&1
check "Missing model exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test F3: Output exists guard ---"
TMP_F3=$(mktemp -d)
node "$RECOMMENDER" --case case_short_term --bundle "$FIX_A/bundle" --model "$FIX_A/model/payment_plan_model.json" --out "$TMP_F3" --as-of-utc 20260220T000000Z >/dev/null 2>&1
# Run again without --force
node "$RECOMMENDER" --case case_short_term --bundle "$FIX_A/bundle" --model "$FIX_A/model/payment_plan_model.json" --out "$TMP_F3" --as-of-utc 20260220T000000Z >/dev/null 2>&1
EXIT_F3=$?
check "Output exists exits 3" "$([ $EXIT_F3 -eq 3 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test F4: Missing --case arg ---"
node "$RECOMMENDER" --bundle "$FIX_A/bundle" --model "$FIX_A/model/payment_plan_model.json" >/dev/null 2>&1
check "Missing --case exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test F5: Renderer missing --strategy ---"
node "$RENDERER" --out "$TMP_F/out3" >/dev/null 2>&1
check "Renderer missing --strategy exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

rm -rf "$TMP_F" "$TMP_F3"
echo ""

# ══════════════════════════════════════════════
# SUITE G: Wrapper script
# ══════════════════════════════════════════════
echo "━━━ Suite G: Wrapper script ━━━"
echo ""

echo "--- Test G1: Wrapper produces both outputs ---"
TMP_G=$(mktemp -d)
OUTPUT_G=$(bash "$WRAPPER" --case case_short_term --bundle "$FIX_A/bundle" --model "$FIX_A/model/payment_plan_model.json" --out "$TMP_G" --as-of-utc 20260220T000000Z --force 2>&1)
EXIT_G=$?
check "Wrapper exits 0" "$([ $EXIT_G -eq 0 ] && echo PASS || echo FAIL)"
check "Wrapper output contains PORT2_OK" "$(echo "$OUTPUT_G" | grep -q PORT2_OK && echo PASS || echo FAIL)"
check "Wrapper creates strategy_recommendation.json" "$([ -f "$TMP_G/strategy_recommendation.json" ] && echo PASS || echo FAIL)"
check "Wrapper creates payment_plan_recommendation.md" "$([ -f "$TMP_G/payment_plan_recommendation.md" ] && echo PASS || echo FAIL)"
rm -rf "$TMP_G"
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
