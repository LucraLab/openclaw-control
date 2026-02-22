#!/bin/bash
# test_port3_cpa_package_v1.sh — Regression test for PORT3 CPA package builder
# Location: ops/taxpod/tests/test_port3_cpa_package_v1.sh
#
# Runs package builder against fixtures, compares to expected output.
# No network calls. No external test framework.
#
# Exit codes: 0=all pass, 1=at least one fail

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAXPOD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILDER="${TAXPOD_DIR}/build_cpa_package_v1.js"
WRAPPER="${TAXPOD_DIR}/run_port3_cpa_package.sh"

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

echo "=== PORT3 CpaPackageV1 Test Suite ==="
echo ""

cd "$TAXPOD_DIR"

FIX="fixtures/port3/case_demo_package"

# ══════════════════════════════════════════════
# SUITE A: Package build matches expected
# ══════════════════════════════════════════════
echo "━━━ Suite A: Package build ━━━"
echo ""

echo "--- Test A1: Builder exits 0 ---"
TMP_A=$(mktemp -d)
OUTPUT_A=$(node "$BUILDER" \
  --case case_demo_package \
  --bundle "$FIX/bundle" \
  --model "$FIX/model/payment_plan_model.json" \
  --strategy "$FIX/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX/model/financial_docs_needed.md" \
  --out-root "$TMP_A" \
  --package-utc 20260220T000000Z 2>&1)
EXIT_A1=$?
echo "$OUTPUT_A" | head -3

check "Builder exits 0" "$([ $EXIT_A1 -eq 0 ] && echo PASS || echo FAIL)"
check "Output contains PORT3_OK" "$(echo "$OUTPUT_A" | grep -q PORT3_OK && echo PASS || echo FAIL)"

PKG_DIR="$TMP_A/case_demo_package/20260220T000000Z/cpa_package_v1"

# ── Test A2: Cover sheet matches ──
echo ""
echo "--- Test A2: Cover sheet matches expected ---"
if [ -f "$PKG_DIR/00_COVER_SHEET.md" ]; then
  if diff -q "$PKG_DIR/00_COVER_SHEET.md" "$FIX/expected/00_COVER_SHEET.md" >/dev/null 2>&1; then
    check "00_COVER_SHEET.md matches expected" "PASS"
  else
    check "00_COVER_SHEET.md matches expected" "FAIL"
    echo "    DIFF:"
    diff "$PKG_DIR/00_COVER_SHEET.md" "$FIX/expected/00_COVER_SHEET.md" | head -10
  fi
else
  check "00_COVER_SHEET.md exists" "FAIL"
fi

# ── Test A3: Manifest matches ──
echo ""
echo "--- Test A3: Manifest matches expected ---"
if [ -f "$PKG_DIR/manifest.json" ]; then
  if diff -q "$PKG_DIR/manifest.json" "$FIX/expected/manifest.json" >/dev/null 2>&1; then
    check "manifest.json matches expected" "PASS"
  else
    check "manifest.json matches expected" "FAIL"
    echo "    DIFF:"
    diff "$PKG_DIR/manifest.json" "$FIX/expected/manifest.json" | head -10
  fi
else
  check "manifest.json exists" "FAIL"
fi

# ── Test A4: All expected files present ──
echo ""
echo "--- Test A4: All expected files present ---"
check "01_LIABILITY_SNAPSHOT.json exists" "$([ -f "$PKG_DIR/01_LIABILITY_SNAPSHOT.json" ] && echo PASS || echo FAIL)"
check "02_PAYMENT_PLAN_MODEL.json exists" "$([ -f "$PKG_DIR/02_PAYMENT_PLAN_MODEL.json" ] && echo PASS || echo FAIL)"
check "03_STRATEGY_RECOMMENDATION.json exists" "$([ -f "$PKG_DIR/03_STRATEGY_RECOMMENDATION.json" ] && echo PASS || echo FAIL)"
check "03_STRATEGY_RECOMMENDATION.md exists" "$([ -f "$PKG_DIR/03_STRATEGY_RECOMMENDATION.md" ] && echo PASS || echo FAIL)"
check "06_DOCUMENT_CHECKLIST.md exists" "$([ -f "$PKG_DIR/06_DOCUMENT_CHECKLIST.md" ] && echo PASS || echo FAIL)"
check "99_SUPPORTING_DOCS_INDEX.json exists" "$([ -f "$PKG_DIR/99_SUPPORTING_DOCS_INDEX.json" ] && echo PASS || echo FAIL)"

# ── Test A5: Reference stubs match ──
echo ""
echo "--- Test A5: Reference stubs match expected ---"
if [ -f "$PKG_DIR/04_TRANSCRIPTS/pkg_transcript_2022__REFERENCE.json" ]; then
  if diff -q "$PKG_DIR/04_TRANSCRIPTS/pkg_transcript_2022__REFERENCE.json" "$FIX/expected/04_TRANSCRIPTS/pkg_transcript_2022__REFERENCE.json" >/dev/null 2>&1; then
    check "Transcript stub matches expected" "PASS"
  else
    check "Transcript stub matches expected" "FAIL"
    diff "$PKG_DIR/04_TRANSCRIPTS/pkg_transcript_2022__REFERENCE.json" "$FIX/expected/04_TRANSCRIPTS/pkg_transcript_2022__REFERENCE.json" | head -5
  fi
else
  check "Transcript stub exists" "FAIL"
fi

if [ -f "$PKG_DIR/05_NOTICES/pkg_notice_cp2000_2022__REFERENCE.json" ]; then
  if diff -q "$PKG_DIR/05_NOTICES/pkg_notice_cp2000_2022__REFERENCE.json" "$FIX/expected/05_NOTICES/pkg_notice_cp2000_2022__REFERENCE.json" >/dev/null 2>&1; then
    check "Notice stub matches expected" "PASS"
  else
    check "Notice stub matches expected" "FAIL"
    diff "$PKG_DIR/05_NOTICES/pkg_notice_cp2000_2022__REFERENCE.json" "$FIX/expected/05_NOTICES/pkg_notice_cp2000_2022__REFERENCE.json" | head -5
  fi
else
  check "Notice stub exists" "FAIL"
fi

# ── Test A6: Copied files match originals ──
echo ""
echo "--- Test A6: Copied files match originals ---"
if diff -q "$PKG_DIR/01_LIABILITY_SNAPSHOT.json" "$FIX/expected/01_LIABILITY_SNAPSHOT.json" >/dev/null 2>&1; then
  check "Liability snapshot matches" "PASS"
else
  check "Liability snapshot matches" "FAIL"
fi
if diff -q "$PKG_DIR/03_STRATEGY_RECOMMENDATION.md" "$FIX/expected/03_STRATEGY_RECOMMENDATION.md" >/dev/null 2>&1; then
  check "Strategy MD matches" "PASS"
else
  check "Strategy MD matches" "FAIL"
fi
if diff -q "$PKG_DIR/06_DOCUMENT_CHECKLIST.md" "$FIX/expected/06_DOCUMENT_CHECKLIST.md" >/dev/null 2>&1; then
  check "Docs checklist matches" "PASS"
else
  check "Docs checklist matches" "FAIL"
fi

# ── Test A7: Manifest hash verification ──
echo ""
echo "--- Test A7: Manifest hash verification ---"
EXPECTED_COVER_HASH=$(node -e "const m=JSON.parse(require('fs').readFileSync('$PKG_DIR/manifest.json','utf8')); const f=m.files.find(x=>x.path==='00_COVER_SHEET.md'); console.log(f.sha256)")
ACTUAL_COVER_HASH=$(sha256sum "$PKG_DIR/00_COVER_SHEET.md" | cut -d' ' -f1)
check "Cover sheet hash in manifest matches actual" "$([ "$EXPECTED_COVER_HASH" = "$ACTUAL_COVER_HASH" ] && echo PASS || echo FAIL)"

EXPECTED_LIB_HASH=$(node -e "const m=JSON.parse(require('fs').readFileSync('$PKG_DIR/manifest.json','utf8')); const f=m.files.find(x=>x.path==='01_LIABILITY_SNAPSHOT.json'); console.log(f.sha256)")
ACTUAL_LIB_HASH=$(sha256sum "$PKG_DIR/01_LIABILITY_SNAPSHOT.json" | cut -d' ' -f1)
check "Liability hash in manifest matches actual" "$([ "$EXPECTED_LIB_HASH" = "$ACTUAL_LIB_HASH" ] && echo PASS || echo FAIL)"

rm -rf "$TMP_A"
echo ""

# ══════════════════════════════════════════════
# SUITE B: Determinism
# ══════════════════════════════════════════════
echo "━━━ Suite B: Determinism ━━━"
echo ""

echo "--- Test B1: Two builds produce identical output ---"
TMP_B1=$(mktemp -d)
TMP_B2=$(mktemp -d)

node "$BUILDER" \
  --case case_demo_package \
  --bundle "$FIX/bundle" \
  --model "$FIX/model/payment_plan_model.json" \
  --strategy "$FIX/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX/model/financial_docs_needed.md" \
  --out-root "$TMP_B1" \
  --package-utc 20260220T000000Z >/dev/null 2>&1

node "$BUILDER" \
  --case case_demo_package \
  --bundle "$FIX/bundle" \
  --model "$FIX/model/payment_plan_model.json" \
  --strategy "$FIX/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX/model/financial_docs_needed.md" \
  --out-root "$TMP_B2" \
  --package-utc 20260220T000000Z >/dev/null 2>&1

PKG_B1="$TMP_B1/case_demo_package/20260220T000000Z/cpa_package_v1"
PKG_B2="$TMP_B2/case_demo_package/20260220T000000Z/cpa_package_v1"

if diff -q "$PKG_B1/manifest.json" "$PKG_B2/manifest.json" >/dev/null 2>&1; then
  check "Manifest determinism (two runs identical)" "PASS"
else
  check "Manifest determinism (two runs identical)" "FAIL"
fi

if diff -q "$PKG_B1/00_COVER_SHEET.md" "$PKG_B2/00_COVER_SHEET.md" >/dev/null 2>&1; then
  check "Cover sheet determinism (two runs identical)" "PASS"
else
  check "Cover sheet determinism (two runs identical)" "FAIL"
fi

if diff -rq "$PKG_B1/04_TRANSCRIPTS" "$PKG_B2/04_TRANSCRIPTS" >/dev/null 2>&1; then
  check "Transcript stubs determinism" "PASS"
else
  check "Transcript stubs determinism" "FAIL"
fi

rm -rf "$TMP_B1" "$TMP_B2"
echo ""

# ══════════════════════════════════════════════
# SUITE C: Fail-closed behaviors
# ══════════════════════════════════════════════
echo "━━━ Suite C: Fail-closed ━━━"
echo ""

TMP_C=$(mktemp -d)

echo "--- Test C1: Missing bundle ---"
node "$BUILDER" \
  --case test \
  --bundle /nonexistent/bundle \
  --model "$FIX/model/payment_plan_model.json" \
  --strategy "$FIX/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX/model/financial_docs_needed.md" \
  --out-root "$TMP_C/out1" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
check "Missing bundle exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test C2: Missing model ---"
node "$BUILDER" \
  --case test \
  --bundle "$FIX/bundle" \
  --model /nonexistent/model.json \
  --strategy "$FIX/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX/model/financial_docs_needed.md" \
  --out-root "$TMP_C/out2" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
check "Missing model exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test C3: Missing strategy ---"
node "$BUILDER" \
  --case test \
  --bundle "$FIX/bundle" \
  --model "$FIX/model/payment_plan_model.json" \
  --strategy /nonexistent/strategy.json \
  --strategy-md "$FIX/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX/model/financial_docs_needed.md" \
  --out-root "$TMP_C/out3" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
check "Missing strategy exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test C4: Missing strategy-md ---"
node "$BUILDER" \
  --case test \
  --bundle "$FIX/bundle" \
  --model "$FIX/model/payment_plan_model.json" \
  --strategy "$FIX/strategy/strategy_recommendation.json" \
  --strategy-md /nonexistent/recommendation.md \
  --docs-md "$FIX/model/financial_docs_needed.md" \
  --out-root "$TMP_C/out4" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
check "Missing strategy-md exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test C5: Missing docs-md ---"
node "$BUILDER" \
  --case test \
  --bundle "$FIX/bundle" \
  --model "$FIX/model/payment_plan_model.json" \
  --strategy "$FIX/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX/strategy/payment_plan_recommendation.md" \
  --docs-md /nonexistent/docs.md \
  --out-root "$TMP_C/out5" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
check "Missing docs-md exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test C6: Output exists guard ---"
TMP_C6=$(mktemp -d)
node "$BUILDER" \
  --case case_demo_package \
  --bundle "$FIX/bundle" \
  --model "$FIX/model/payment_plan_model.json" \
  --strategy "$FIX/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX/model/financial_docs_needed.md" \
  --out-root "$TMP_C6" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
# Run again without --force
node "$BUILDER" \
  --case case_demo_package \
  --bundle "$FIX/bundle" \
  --model "$FIX/model/payment_plan_model.json" \
  --strategy "$FIX/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX/model/financial_docs_needed.md" \
  --out-root "$TMP_C6" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
EXIT_C6=$?
check "Output exists exits 3" "$([ $EXIT_C6 -eq 3 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test C7: Missing required args ---"
node "$BUILDER" --bundle "$FIX/bundle" >/dev/null 2>&1
check "Missing --case exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

rm -rf "$TMP_C" "$TMP_C6"
echo ""

# ══════════════════════════════════════════════
# SUITE D: File count and version check
# ══════════════════════════════════════════════
echo "━━━ Suite D: Content validation ━━━"
echo ""

TMP_D=$(mktemp -d)
node "$BUILDER" \
  --case case_demo_package \
  --bundle "$FIX/bundle" \
  --model "$FIX/model/payment_plan_model.json" \
  --strategy "$FIX/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX/model/financial_docs_needed.md" \
  --out-root "$TMP_D" \
  --package-utc 20260220T000000Z >/dev/null 2>&1

PKG_D="$TMP_D/case_demo_package/20260220T000000Z/cpa_package_v1"

echo "--- Test D1: Manifest version ---"
VERSION_D=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_D/manifest.json','utf8')).version)")
check "Manifest version is CpaPackageV1" "$([ "$VERSION_D" = "CpaPackageV1" ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test D2: File count in manifest ---"
FILE_COUNT_D=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_D/manifest.json','utf8')).files.length)")
check "Manifest has 9 file entries" "$([ "$FILE_COUNT_D" = "9" ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test D3: Package UTC in manifest ---"
PKG_UTC_D=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_D/manifest.json','utf8')).package_utc)")
check "Package UTC is 20260220T000000Z" "$([ "$PKG_UTC_D" = "20260220T000000Z" ] && echo PASS || echo FAIL)"

rm -rf "$TMP_D"
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
