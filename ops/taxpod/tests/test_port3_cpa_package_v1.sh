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
# SUITE E: case_partial_payment (PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT)
# ══════════════════════════════════════════════
echo "━━━ Suite E: case_partial_payment ━━━"
echo ""

FIX_PP="fixtures/port3/case_partial_payment"

echo "--- Test E1: Builder exits 0 ---"
TMP_E=$(mktemp -d)
OUTPUT_E=$(node "$BUILDER" \
  --case case_partial_payment \
  --bundle "$FIX_PP/bundle" \
  --model "$FIX_PP/model/payment_plan_model.json" \
  --strategy "$FIX_PP/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX_PP/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX_PP/model/financial_docs_needed.md" \
  --out-root "$TMP_E" \
  --package-utc 20260220T000000Z 2>&1)
EXIT_E1=$?
echo "$OUTPUT_E" | head -3

check "Builder exits 0 (partial_payment)" "$([ $EXIT_E1 -eq 0 ] && echo PASS || echo FAIL)"
check "Output contains PORT3_OK" "$(echo "$OUTPUT_E" | grep -q PORT3_OK && echo PASS || echo FAIL)"

PKG_E="$TMP_E/case_partial_payment/20260220T000000Z/cpa_package_v1"

echo ""
echo "--- Test E2: Cover sheet matches expected ---"
if diff -q "$PKG_E/00_COVER_SHEET.md" "$FIX_PP/expected/00_COVER_SHEET.md" >/dev/null 2>&1; then
  check "Cover sheet matches (partial_payment)" "PASS"
else
  check "Cover sheet matches (partial_payment)" "FAIL"
  diff "$PKG_E/00_COVER_SHEET.md" "$FIX_PP/expected/00_COVER_SHEET.md" | head -10
fi

echo ""
echo "--- Test E3: Manifest matches expected ---"
if diff -q "$PKG_E/manifest.json" "$FIX_PP/expected/manifest.json" >/dev/null 2>&1; then
  check "Manifest matches (partial_payment)" "PASS"
else
  check "Manifest matches (partial_payment)" "FAIL"
  diff "$PKG_E/manifest.json" "$FIX_PP/expected/manifest.json" | head -10
fi

echo ""
echo "--- Test E4: Transcript stubs (2 expected) ---"
STUB_E_COUNT=$(find "$PKG_E/04_TRANSCRIPTS" -name '*__REFERENCE.json' -type f | wc -l)
check "2 transcript stubs generated" "$([ "$STUB_E_COUNT" = "2" ] && echo PASS || echo FAIL)"
if diff -q "$PKG_E/04_TRANSCRIPTS/pp_transcript_2019__REFERENCE.json" "$FIX_PP/expected/04_TRANSCRIPTS/pp_transcript_2019__REFERENCE.json" >/dev/null 2>&1; then
  check "Transcript stub 2019 matches" "PASS"
else
  check "Transcript stub 2019 matches" "FAIL"
fi
if diff -q "$PKG_E/04_TRANSCRIPTS/pp_transcript_2020__REFERENCE.json" "$FIX_PP/expected/04_TRANSCRIPTS/pp_transcript_2020__REFERENCE.json" >/dev/null 2>&1; then
  check "Transcript stub 2020 matches" "PASS"
else
  check "Transcript stub 2020 matches" "FAIL"
fi

echo ""
echo "--- Test E5: Notice stubs (2 expected) ---"
NOTICE_E_COUNT=$(find "$PKG_E/05_NOTICES" -name '*__REFERENCE.json' -type f | wc -l)
check "2 notice stubs generated" "$([ "$NOTICE_E_COUNT" = "2" ] && echo PASS || echo FAIL)"
if diff -q "$PKG_E/05_NOTICES/pp_notice_cp501_2020__REFERENCE.json" "$FIX_PP/expected/05_NOTICES/pp_notice_cp501_2020__REFERENCE.json" >/dev/null 2>&1; then
  check "Notice stub cp501 2020 matches" "PASS"
else
  check "Notice stub cp501 2020 matches" "FAIL"
fi
if diff -q "$PKG_E/05_NOTICES/pp_notice_cp504_2019__REFERENCE.json" "$FIX_PP/expected/05_NOTICES/pp_notice_cp504_2019__REFERENCE.json" >/dev/null 2>&1; then
  check "Notice stub cp504 2019 matches" "PASS"
else
  check "Notice stub cp504 2019 matches" "FAIL"
fi

echo ""
echo "--- Test E6: Strategy type is PARTIAL_PAYMENT ---"
STRAT_TYPE_E=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_E/03_STRATEGY_RECOMMENDATION.json','utf8')).strategy.type)")
check "Strategy is PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT" "$([ "$STRAT_TYPE_E" = "PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT" ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test E7: Risk flag LOW_DISPOSABLE present ---"
LOW_DISP_E=$(node -e "const s=JSON.parse(require('fs').readFileSync('$PKG_E/03_STRATEGY_RECOMMENDATION.json','utf8')); console.log(s.risk_flags.includes('LOW_DISPOSABLE'))")
check "LOW_DISPOSABLE flag present" "$([ "$LOW_DISP_E" = "true" ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test E8: File count ---"
FILE_COUNT_E=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_E/manifest.json','utf8')).files.length)")
check "Manifest has 11 file entries" "$([ "$FILE_COUNT_E" = "11" ] && echo PASS || echo FAIL)"

rm -rf "$TMP_E"
echo ""

# ══════════════════════════════════════════════
# SUITE F: case_multi_doc (SHORT_TERM, many docs)
# ══════════════════════════════════════════════
echo "━━━ Suite F: case_multi_doc ━━━"
echo ""

FIX_MD="fixtures/port3/case_multi_doc"

echo "--- Test F1: Builder exits 0 ---"
TMP_F=$(mktemp -d)
OUTPUT_F=$(node "$BUILDER" \
  --case case_multi_doc \
  --bundle "$FIX_MD/bundle" \
  --model "$FIX_MD/model/payment_plan_model.json" \
  --strategy "$FIX_MD/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX_MD/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX_MD/model/financial_docs_needed.md" \
  --out-root "$TMP_F" \
  --package-utc 20260220T000000Z 2>&1)
EXIT_F1=$?
echo "$OUTPUT_F" | head -3

check "Builder exits 0 (multi_doc)" "$([ $EXIT_F1 -eq 0 ] && echo PASS || echo FAIL)"
check "Output contains PORT3_OK" "$(echo "$OUTPUT_F" | grep -q PORT3_OK && echo PASS || echo FAIL)"

PKG_F="$TMP_F/case_multi_doc/20260220T000000Z/cpa_package_v1"

echo ""
echo "--- Test F2: Cover sheet matches expected ---"
if diff -q "$PKG_F/00_COVER_SHEET.md" "$FIX_MD/expected/00_COVER_SHEET.md" >/dev/null 2>&1; then
  check "Cover sheet matches (multi_doc)" "PASS"
else
  check "Cover sheet matches (multi_doc)" "FAIL"
  diff "$PKG_F/00_COVER_SHEET.md" "$FIX_MD/expected/00_COVER_SHEET.md" | head -10
fi

echo ""
echo "--- Test F3: Manifest matches expected ---"
if diff -q "$PKG_F/manifest.json" "$FIX_MD/expected/manifest.json" >/dev/null 2>&1; then
  check "Manifest matches (multi_doc)" "PASS"
else
  check "Manifest matches (multi_doc)" "FAIL"
  diff "$PKG_F/manifest.json" "$FIX_MD/expected/manifest.json" | head -10
fi

echo ""
echo "--- Test F4: Transcript stubs (3 expected) ---"
STUB_F_COUNT=$(find "$PKG_F/04_TRANSCRIPTS" -name '*__REFERENCE.json' -type f | wc -l)
check "3 transcript stubs generated" "$([ "$STUB_F_COUNT" = "3" ] && echo PASS || echo FAIL)"
for STUB_ID in md_transcript_2021 md_transcript_2022 md_transcript_2023; do
  if diff -q "$PKG_F/04_TRANSCRIPTS/${STUB_ID}__REFERENCE.json" "$FIX_MD/expected/04_TRANSCRIPTS/${STUB_ID}__REFERENCE.json" >/dev/null 2>&1; then
    check "${STUB_ID} stub matches" "PASS"
  else
    check "${STUB_ID} stub matches" "FAIL"
  fi
done

echo ""
echo "--- Test F5: Notice stubs (2 expected) ---"
NOTICE_F_COUNT=$(find "$PKG_F/05_NOTICES" -name '*__REFERENCE.json' -type f | wc -l)
check "2 notice stubs generated" "$([ "$NOTICE_F_COUNT" = "2" ] && echo PASS || echo FAIL)"
for NOTICE_ID in md_notice_cp2000_2023 md_notice_cp501_2023; do
  if diff -q "$PKG_F/05_NOTICES/${NOTICE_ID}__REFERENCE.json" "$FIX_MD/expected/05_NOTICES/${NOTICE_ID}__REFERENCE.json" >/dev/null 2>&1; then
    check "${NOTICE_ID} stub matches" "PASS"
  else
    check "${NOTICE_ID} stub matches" "FAIL"
  fi
done

echo ""
echo "--- Test F6: Strategy type is SHORT_TERM ---"
STRAT_TYPE_F=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_F/03_STRATEGY_RECOMMENDATION.json','utf8')).strategy.type)")
check "Strategy is SHORT_TERM_PAYMENT_PLAN" "$([ "$STRAT_TYPE_F" = "SHORT_TERM_PAYMENT_PLAN" ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test F7: No risk flags ---"
FLAG_COUNT_F=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_F/03_STRATEGY_RECOMMENDATION.json','utf8')).risk_flags.length)")
check "Zero risk flags" "$([ "$FLAG_COUNT_F" = "0" ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test F8: File count ---"
FILE_COUNT_F=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_F/manifest.json','utf8')).files.length)")
check "Manifest has 12 file entries" "$([ "$FILE_COUNT_F" = "12" ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test F9: Supporting docs count = 3 ---"
SUPP_COUNT_F=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_F/99_SUPPORTING_DOCS_INDEX.json','utf8')).documents.length)")
check "Supporting docs count is 3" "$([ "$SUPP_COUNT_F" = "3" ] && echo PASS || echo FAIL)"

rm -rf "$TMP_F"
echo ""

# ══════════════════════════════════════════════
# SUITE G: case_bad_strategy (malformed strategy → fail-closed)
# ══════════════════════════════════════════════
echo "━━━ Suite G: case_bad_strategy (fail-closed) ━━━"
echo ""

FIX_BS="fixtures/port3/case_bad_strategy"

echo "--- Test G1: Missing strategy.strategy field ---"
TMP_G=$(mktemp -d)
node "$BUILDER" \
  --case case_bad_strategy \
  --bundle "$FIX_BS/bundle" \
  --model "$FIX_BS/model/payment_plan_model.json" \
  --strategy "$FIX_BS/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX_BS/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX_BS/model/financial_docs_needed.md" \
  --out-root "$TMP_G" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
EXIT_G1=$?
check "Malformed strategy exits non-zero" "$([ $EXIT_G1 -ne 0 ] && echo PASS || echo FAIL)"
check "Exit code is 1 (input error)" "$([ $EXIT_G1 -eq 1 ] && echo PASS || echo FAIL)"

echo ""
echo "--- Test G2: No output directory created ---"
if [ ! -d "$TMP_G/case_bad_strategy" ]; then
  check "No output created on failure" "PASS"
else
  check "No output created on failure" "FAIL"
fi

rm -rf "$TMP_G"
echo ""

# ══════════════════════════════════════════════
# SUITE H: Determinism for extended fixtures
# ══════════════════════════════════════════════
echo "━━━ Suite H: Determinism (extended fixtures) ━━━"
echo ""

echo "--- Test H1: case_partial_payment determinism ---"
TMP_H1A=$(mktemp -d)
TMP_H1B=$(mktemp -d)
node "$BUILDER" \
  --case case_partial_payment \
  --bundle "$FIX_PP/bundle" \
  --model "$FIX_PP/model/payment_plan_model.json" \
  --strategy "$FIX_PP/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX_PP/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX_PP/model/financial_docs_needed.md" \
  --out-root "$TMP_H1A" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
node "$BUILDER" \
  --case case_partial_payment \
  --bundle "$FIX_PP/bundle" \
  --model "$FIX_PP/model/payment_plan_model.json" \
  --strategy "$FIX_PP/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX_PP/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX_PP/model/financial_docs_needed.md" \
  --out-root "$TMP_H1B" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
if diff -q "$TMP_H1A/case_partial_payment/20260220T000000Z/cpa_package_v1/manifest.json" \
          "$TMP_H1B/case_partial_payment/20260220T000000Z/cpa_package_v1/manifest.json" >/dev/null 2>&1; then
  check "Partial payment determinism (manifest)" "PASS"
else
  check "Partial payment determinism (manifest)" "FAIL"
fi
rm -rf "$TMP_H1A" "$TMP_H1B"

echo ""
echo "--- Test H2: case_multi_doc determinism ---"
TMP_H2A=$(mktemp -d)
TMP_H2B=$(mktemp -d)
node "$BUILDER" \
  --case case_multi_doc \
  --bundle "$FIX_MD/bundle" \
  --model "$FIX_MD/model/payment_plan_model.json" \
  --strategy "$FIX_MD/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX_MD/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX_MD/model/financial_docs_needed.md" \
  --out-root "$TMP_H2A" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
node "$BUILDER" \
  --case case_multi_doc \
  --bundle "$FIX_MD/bundle" \
  --model "$FIX_MD/model/payment_plan_model.json" \
  --strategy "$FIX_MD/strategy/strategy_recommendation.json" \
  --strategy-md "$FIX_MD/strategy/payment_plan_recommendation.md" \
  --docs-md "$FIX_MD/model/financial_docs_needed.md" \
  --out-root "$TMP_H2B" \
  --package-utc 20260220T000000Z >/dev/null 2>&1
if diff -q "$TMP_H2A/case_multi_doc/20260220T000000Z/cpa_package_v1/manifest.json" \
          "$TMP_H2B/case_multi_doc/20260220T000000Z/cpa_package_v1/manifest.json" >/dev/null 2>&1; then
  check "Multi doc determinism (manifest)" "PASS"
else
  check "Multi doc determinism (manifest)" "FAIL"
fi
rm -rf "$TMP_H2A" "$TMP_H2B"
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
