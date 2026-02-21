#!/bin/bash
# test_export_bundle_v1.sh — Regression test for PaymentPlanBundleV1 exporter
# Location: ops/taxpod/tests/test_export_bundle_v1.sh
#
# Runs exporter against fixtures, compares to expected output.
# No network calls. No external test framework.
#
# Exit codes: 0=all pass, 1=at least one fail

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAXPOD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXPORTER="${TAXPOD_DIR}/export_payment_plan_bundle_v1.js"

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

echo "=== PaymentPlanBundleV1 Test Suite ==="
echo ""

# ══════════════════════════════════════════════
# SUITE A: case_demo_1 (original fixture)
# ══════════════════════════════════════════════
FIXTURE_DIR="${TAXPOD_DIR}/fixtures/bundles/case_demo_1"
SOURCE_DIR="${FIXTURE_DIR}/source"
EXPECTED_DIR="${FIXTURE_DIR}/expected/payment_plan_bundle_v1"

echo "━━━ Suite A: case_demo_1 ━━━"
echo ""

# ── Test A1: Fixture export produces expected output ──
echo "--- Test A1: Fixture export matches expected ---"
TMP_OUT=$(mktemp -d)
OUTPUT=$( node "$EXPORTER" \
  --case case_demo_1 \
  --index "$SOURCE_DIR/index.json" \
  --ledger "$SOURCE_DIR/facts_ledger.jsonl" \
  --out "$TMP_OUT" \
  --vault-version 13.2.0 \
  --export-utc 20260220T000000Z 2>&1 )
EXIT=$?

check "Exporter exits 0" "$([ $EXIT -eq 0 ] && echo PASS || echo FAIL)"
check "Output contains BUNDLE_OK" "$(echo "$OUTPUT" | grep -q BUNDLE_OK && echo PASS || echo FAIL)"

BUNDLE_DIR="$TMP_OUT/case_demo_1/20260220T000000Z/payment_plan_bundle_v1"
for f in liability_snapshot.json transcripts_manifest.json notices_manifest.json supporting_docs_index.json citations.json bundle_manifest.json; do
  if [ -f "$BUNDLE_DIR/$f" ]; then
    if diff -q "$BUNDLE_DIR/$f" "$EXPECTED_DIR/$f" >/dev/null 2>&1; then
      check "$f matches expected" "PASS"
    else
      check "$f matches expected" "FAIL"
      echo "    DIFF:"
      diff "$BUNDLE_DIR/$f" "$EXPECTED_DIR/$f" | head -10
    fi
  else
    check "$f exists" "FAIL"
  fi
done
rm -rf "$TMP_OUT"
echo ""

# ── Test A2: sha256 in manifest matches file hashes ──
echo "--- Test A2: Manifest hashes match file contents ---"
TMP_OUT2=$(mktemp -d)
node "$EXPORTER" \
  --case case_demo_1 \
  --index "$SOURCE_DIR/index.json" \
  --ledger "$SOURCE_DIR/facts_ledger.jsonl" \
  --out "$TMP_OUT2" \
  --vault-version 13.2.0 \
  --export-utc 20260220T000000Z >/dev/null 2>&1

BUNDLE_DIR2="$TMP_OUT2/case_demo_1/20260220T000000Z/payment_plan_bundle_v1"
if [ -f "$BUNDLE_DIR2/bundle_manifest.json" ]; then
  for f in liability_snapshot.json transcripts_manifest.json notices_manifest.json supporting_docs_index.json citations.json; do
    EXPECTED_HASH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$BUNDLE_DIR2/bundle_manifest.json','utf8')).files['$f'])")
    ACTUAL_HASH=$(sha256sum "$BUNDLE_DIR2/$f" | awk '{print $1}')
    check "sha256 $f" "$([ "$EXPECTED_HASH" = "$ACTUAL_HASH" ] && echo PASS || echo FAIL)"
  done
else
  check "bundle_manifest.json exists for hash check" "FAIL"
fi
rm -rf "$TMP_OUT2"
echo ""

# ── Test A3: Deterministic (two runs produce identical output) ──
echo "--- Test A3: Deterministic output ---"
TMP_A=$(mktemp -d)
TMP_B=$(mktemp -d)
node "$EXPORTER" --case case_demo_1 --index "$SOURCE_DIR/index.json" --ledger "$SOURCE_DIR/facts_ledger.jsonl" --out "$TMP_A" --vault-version 13.2.0 --export-utc 20260220T000000Z >/dev/null 2>&1
node "$EXPORTER" --case case_demo_1 --index "$SOURCE_DIR/index.json" --ledger "$SOURCE_DIR/facts_ledger.jsonl" --out "$TMP_B" --vault-version 13.2.0 --export-utc 20260220T000000Z >/dev/null 2>&1

DIFF_OUT=$(diff -r "$TMP_A" "$TMP_B" 2>&1)
check "Two runs produce identical output" "$([ -z "$DIFF_OUT" ] && echo PASS || echo FAIL)"
rm -rf "$TMP_A" "$TMP_B"
echo ""

# ══════════════════════════════════════════════
# SUITE B: case_demo_tn (transcript + notice coverage)
# ══════════════════════════════════════════════
TN_FIXTURE_DIR="${TAXPOD_DIR}/fixtures/bundles/case_demo_tn"
TN_SOURCE_DIR="${TN_FIXTURE_DIR}/source"
TN_EXPECTED_DIR="${TN_FIXTURE_DIR}/expected/payment_plan_bundle_v1"

echo "━━━ Suite B: case_demo_tn (TN coverage) ━━━"
echo ""

# ── Test B1: TN fixture export matches expected ──
echo "--- Test B1: TN fixture export matches expected ---"
TMP_TN=$(mktemp -d)
TN_OUTPUT=$( node "$EXPORTER" \
  --case case_demo_tn \
  --index "$TN_SOURCE_DIR/index.json" \
  --ledger "$TN_SOURCE_DIR/facts_ledger.jsonl" \
  --out "$TMP_TN" \
  --vault-version 13.2.0 \
  --export-utc 20260221T000000Z 2>&1 )
TN_EXIT=$?

check "TN exporter exits 0" "$([ $TN_EXIT -eq 0 ] && echo PASS || echo FAIL)"
check "TN output contains BUNDLE_OK" "$(echo "$TN_OUTPUT" | grep -q BUNDLE_OK && echo PASS || echo FAIL)"

TN_BUNDLE_DIR="$TMP_TN/case_demo_tn/20260221T000000Z/payment_plan_bundle_v1"
for f in liability_snapshot.json transcripts_manifest.json notices_manifest.json supporting_docs_index.json citations.json bundle_manifest.json; do
  if [ -f "$TN_BUNDLE_DIR/$f" ]; then
    if diff -q "$TN_BUNDLE_DIR/$f" "$TN_EXPECTED_DIR/$f" >/dev/null 2>&1; then
      check "TN $f matches expected" "PASS"
    else
      check "TN $f matches expected" "FAIL"
      echo "    DIFF:"
      diff "$TN_BUNDLE_DIR/$f" "$TN_EXPECTED_DIR/$f" | head -10
    fi
  else
    check "TN $f exists" "FAIL"
  fi
done

# ── Test B2: TN coverage assertions ──
echo ""
echo "--- Test B2: TN coverage assertions ---"
if [ -f "$TN_BUNDLE_DIR/transcripts_manifest.json" ]; then
  T_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TN_BUNDLE_DIR/transcripts_manifest.json','utf8')).transcripts.length)")
  check "transcripts_manifest has >= 1 transcript" "$([ "$T_COUNT" -ge 1 ] && echo PASS || echo FAIL)"
else
  check "transcripts_manifest.json exists" "FAIL"
fi
if [ -f "$TN_BUNDLE_DIR/notices_manifest.json" ]; then
  N_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TN_BUNDLE_DIR/notices_manifest.json','utf8')).notices.length)")
  check "notices_manifest has >= 1 notice" "$([ "$N_COUNT" -ge 1 ] && echo PASS || echo FAIL)"
else
  check "notices_manifest.json exists" "FAIL"
fi

# ── Test B3: TN sha256 verification ──
echo ""
echo "--- Test B3: TN manifest hashes match file contents ---"
if [ -f "$TN_BUNDLE_DIR/bundle_manifest.json" ]; then
  for f in liability_snapshot.json transcripts_manifest.json notices_manifest.json supporting_docs_index.json citations.json; do
    EXPECTED_HASH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TN_BUNDLE_DIR/bundle_manifest.json','utf8')).files['$f'])")
    ACTUAL_HASH=$(sha256sum "$TN_BUNDLE_DIR/$f" | awk '{print $1}')
    check "TN sha256 $f" "$([ "$EXPECTED_HASH" = "$ACTUAL_HASH" ] && echo PASS || echo FAIL)"
  done
else
  check "TN bundle_manifest.json exists for hash check" "FAIL"
fi

# ── Test B4: TN determinism ──
echo ""
echo "--- Test B4: TN deterministic output ---"
TMP_TN_A=$(mktemp -d)
TMP_TN_B=$(mktemp -d)
node "$EXPORTER" --case case_demo_tn --index "$TN_SOURCE_DIR/index.json" --ledger "$TN_SOURCE_DIR/facts_ledger.jsonl" --out "$TMP_TN_A" --vault-version 13.2.0 --export-utc 20260221T000000Z >/dev/null 2>&1
node "$EXPORTER" --case case_demo_tn --index "$TN_SOURCE_DIR/index.json" --ledger "$TN_SOURCE_DIR/facts_ledger.jsonl" --out "$TMP_TN_B" --vault-version 13.2.0 --export-utc 20260221T000000Z >/dev/null 2>&1

TN_DIFF=$(diff -r "$TMP_TN_A" "$TMP_TN_B" 2>&1)
check "TN two runs produce identical output" "$([ -z "$TN_DIFF" ] && echo PASS || echo FAIL)"
rm -rf "$TMP_TN" "$TMP_TN_A" "$TMP_TN_B"
echo ""

# ══════════════════════════════════════════════
# SUITE C: Fail-closed behaviors
# ══════════════════════════════════════════════
echo "━━━ Suite C: Fail-closed behaviors ━━━"
echo ""

# ── Test C1: Fail-closed on missing index ──
echo "--- Test C1: Missing inputs ---"
TMP_FC=$(mktemp -d)

node "$EXPORTER" --case case_demo_1 --index /nonexistent/index.json --ledger "$SOURCE_DIR/facts_ledger.jsonl" --out "$TMP_FC" --vault-version 13.2.0 --export-utc 20260220T000000Z >/dev/null 2>&1
check "Missing index exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

node "$EXPORTER" --case case_demo_1 --index "$SOURCE_DIR/index.json" --ledger /nonexistent/ledger.jsonl --out "$TMP_FC" --vault-version 13.2.0 --export-utc 20260220T000000Z >/dev/null 2>&1
check "Missing ledger exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"

# Test output-exists guard
mkdir -p "$TMP_FC/case_demo_1/20260220T000000Z/payment_plan_bundle_v1"
node "$EXPORTER" --case case_demo_1 --index "$SOURCE_DIR/index.json" --ledger "$SOURCE_DIR/facts_ledger.jsonl" --out "$TMP_FC" --vault-version 13.2.0 --export-utc 20260220T000000Z >/dev/null 2>&1
EXIT_EXISTS=$?
check "Existing output exits 3" "$([ $EXIT_EXISTS -eq 3 ] && echo PASS || echo FAIL)"

rm -rf "$TMP_FC"
echo ""

# ── Test C2: Missing required args ──
echo "--- Test C2: Missing required args ---"
node "$EXPORTER" --index "$SOURCE_DIR/index.json" --ledger "$SOURCE_DIR/facts_ledger.jsonl" >/dev/null 2>&1
check "Missing --case exits non-zero" "$([ $? -ne 0 ] && echo PASS || echo FAIL)"
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
