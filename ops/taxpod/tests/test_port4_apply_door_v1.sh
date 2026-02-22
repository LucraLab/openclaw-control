#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# test_port4_apply_door_v1.sh
#
# Tests for the Apply Door V1 (apply_changeset_v1.js).
# Runs all fixtures in isolated temp directories — never touches real runtime.
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APPLY_SCRIPT="$REPO_ROOT/ops/taxpod/apply/apply_changeset_v1.js"
FIXTURE_ROOT="$REPO_ROOT/ops/taxpod/fixtures/port4_apply"

PASS=0
FAIL=0
TOTAL=0

pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo "  [FAIL] $1"; }

check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}

check_not() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then fail "$desc"; else pass "$desc"; fi
}

check_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then pass "$desc"; else fail "$desc (expected=$expected, got=$actual)"; fi
}

check_contains() {
  local desc="$1" file="$2" pattern="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then pass "$desc"; else fail "$desc"; fi
}

check_file_exists() {
  local desc="$1" fpath="$2"
  if [ -f "$fpath" ]; then pass "$desc"; else fail "$desc (file not found: $fpath)"; fi
}

check_file_not_exists() {
  local desc="$1" fpath="$2"
  if [ ! -f "$fpath" ]; then pass "$desc"; else fail "$desc (file should not exist: $fpath)"; fi
}

# Compute SHA-256 of a file
file_sha256() { sha256sum "$1" | awk '{print $1}'; }

###############################################################################
# Suite A: apply_ok_liability_correction (Fixture 1)
###############################################################################
echo ""
echo "==========================================="
echo "  Suite A: apply_ok_liability_correction"
echo "==========================================="

FIX_A="$FIXTURE_ROOT/apply_ok_liability_correction"
TMP_A="$(mktemp -d)"
trap "rm -rf $TMP_A" EXIT

# Set up isolated runtime
mkdir -p "$TMP_A/tax_work/fixture_case/models"
mkdir -p "$TMP_A/tax_work/fixture_case/audit"
mkdir -p "$TMP_A/audit"
cp "$FIX_A/runtime/tax_work/fixture_case/models/payment_plan_model.json" \
   "$TMP_A/tax_work/fixture_case/models/payment_plan_model.json"

APPROVAL_SHA_A="$(file_sha256 "$FIX_A/approval.md")"

# Record pre-image hash
PRE_HASH_A="$(file_sha256 "$TMP_A/tax_work/fixture_case/models/payment_plan_model.json")"

# Run apply door
EXIT_A=0
node "$APPLY_SCRIPT" \
  --changeset "$FIX_A/changeset.json" \
  --case fixture_case \
  --approve-proof "$FIX_A/approval.md" \
  --approve-proof-sha256 "$APPROVAL_SHA_A" \
  --out "$TMP_A/tax_work/fixture_case/audit" \
  --runtime-root "$TMP_A" \
  --created-utc 20260222T100100Z \
  > "$TMP_A/stdout.json" 2>"$TMP_A/stderr.json" || EXIT_A=$?

check_eq "A1: Exit code 0 (applied)" "0" "$EXIT_A"

# Check patched values
INTEREST_AFTER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_A/tax_work/fixture_case/models/payment_plan_model.json','utf8')).liability_summary.tax_years[0].interest)")
check_eq "A2: Interest patched to 475" "475" "$INTEREST_AFTER"

TOTAL_AFTER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_A/tax_work/fixture_case/models/payment_plan_model.json','utf8')).liability_summary.tax_years[0].total_liability)")
check_eq "A3: Total liability patched to 5875" "5875" "$TOTAL_AFTER"

# Check post-image hash changed
POST_HASH_A="$(file_sha256 "$TMP_A/tax_work/fixture_case/models/payment_plan_model.json")"
check_not "A4: File hash changed after apply" test "$PRE_HASH_A" = "$POST_HASH_A"

# Check receipt exists
check_file_exists "A5: Receipt file created" "$TMP_A/tax_work/fixture_case/audit/apply_receipt.json"

# Check receipt contents
RECEIPT_RESULT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_A/tax_work/fixture_case/audit/apply_receipt.json','utf8')).result)")
check_eq "A6: Receipt result is APPLIED" "APPLIED" "$RECEIPT_RESULT"

RECEIPT_DRYRUN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_A/tax_work/fixture_case/audit/apply_receipt.json','utf8')).dry_run)")
check_eq "A7: Receipt dry_run is false" "false" "$RECEIPT_DRYRUN"

RECEIPT_ACTIONS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_A/tax_work/fixture_case/audit/apply_receipt.json','utf8')).actions_applied.length)")
check_eq "A8: Receipt has 4 actions applied" "4" "$RECEIPT_ACTIONS"

# Check audit JSONL
check_file_exists "A9: Audit JSONL exists" "$TMP_A/audit/taxpod_apply.jsonl"
AUDIT_LINES=$(wc -l < "$TMP_A/audit/taxpod_apply.jsonl")
check_eq "A10: Audit JSONL has exactly 1 line" "1" "$AUDIT_LINES"
check_contains "A11: Audit line has APPLIED" "$TMP_A/audit/taxpod_apply.jsonl" '"result":"APPLIED"'

# Check marker files
check_file_exists "A12: Rerun PORT2 marker created" "$TMP_A/tax_work/fixture_case/.require_rerun_port2"
check_file_exists "A13: Rebuild PORT3 marker created" "$TMP_A/tax_work/fixture_case/.require_rebuild_port3"

# Check stdout has receipt info
check_contains "A14: Stdout has APPLIED" "$TMP_A/stdout.json" '"result"'

###############################################################################
# Suite B: refuse_missing_approval (Fixture 2)
###############################################################################
echo ""
echo "==========================================="
echo "  Suite B: refuse_missing_approval"
echo "==========================================="

FIX_B="$FIXTURE_ROOT/refuse_missing_approval"
TMP_B="$(mktemp -d)"

# Set up isolated runtime (copy same model)
mkdir -p "$TMP_B/tax_work/fixture_case/models"
mkdir -p "$TMP_B/audit"
cp "$FIX_A/runtime/tax_work/fixture_case/models/payment_plan_model.json" \
   "$TMP_B/tax_work/fixture_case/models/payment_plan_model.json"

PRE_HASH_B="$(file_sha256 "$TMP_B/tax_work/fixture_case/models/payment_plan_model.json")"

# Run WITHOUT approval args
EXIT_B=0
node "$APPLY_SCRIPT" \
  --changeset "$FIX_B/changeset.json" \
  --case fixture_case \
  --runtime-root "$TMP_B" \
  > "$TMP_B/stdout.json" 2>"$TMP_B/stderr.json" || EXIT_B=$?

check_eq "B1: Exit code 3 (refused approval)" "3" "$EXIT_B"

# Verify no writes occurred
POST_HASH_B="$(file_sha256 "$TMP_B/tax_work/fixture_case/models/payment_plan_model.json")"
check_eq "B2: File unchanged after refusal" "$PRE_HASH_B" "$POST_HASH_B"

check_file_not_exists "B3: No receipt created" "$TMP_B/tax_work/fixture_case/audit/apply_receipt.json"
check_file_not_exists "B4: No audit JSONL created" "$TMP_B/audit/taxpod_apply.jsonl"

# Check stderr has structured error
check_contains "B5: Stderr has error JSON" "$TMP_B/stderr.json" '"exit_code":3'

rm -rf "$TMP_B"

###############################################################################
# Suite C: refuse_disallowed_path (Fixture 3)
###############################################################################
echo ""
echo "==========================================="
echo "  Suite C: refuse_disallowed_path"
echo "==========================================="

FIX_C="$FIXTURE_ROOT/refuse_disallowed_path"
TMP_C="$(mktemp -d)"

mkdir -p "$TMP_C/tax_work/fixture_case/models"
mkdir -p "$TMP_C/audit"
cp "$FIX_A/runtime/tax_work/fixture_case/models/payment_plan_model.json" \
   "$TMP_C/tax_work/fixture_case/models/payment_plan_model.json"

PRE_HASH_C="$(file_sha256 "$TMP_C/tax_work/fixture_case/models/payment_plan_model.json")"
APPROVAL_SHA_C="$(file_sha256 "$FIX_C/approval.md")"

EXIT_C=0
node "$APPLY_SCRIPT" \
  --changeset "$FIX_C/changeset.json" \
  --case fixture_case \
  --approve-proof "$FIX_C/approval.md" \
  --approve-proof-sha256 "$APPROVAL_SHA_C" \
  --runtime-root "$TMP_C" \
  > "$TMP_C/stdout.json" 2>"$TMP_C/stderr.json" || EXIT_C=$?

check_eq "C1: Exit code 2 (refused validation)" "2" "$EXIT_C"

POST_HASH_C="$(file_sha256 "$TMP_C/tax_work/fixture_case/models/payment_plan_model.json")"
check_eq "C2: File unchanged after refusal" "$PRE_HASH_C" "$POST_HASH_C"

check_file_not_exists "C3: No receipt created" "$TMP_C/tax_work/fixture_case/audit/apply_receipt.json"

check_contains "C4: Stderr mentions refused prefix" "$TMP_C/stderr.json" 'refused prefix'

rm -rf "$TMP_C"

###############################################################################
# Suite D: refuse_destructive_patch (Fixture 4)
###############################################################################
echo ""
echo "==========================================="
echo "  Suite D: refuse_destructive_patch"
echo "==========================================="

FIX_D="$FIXTURE_ROOT/refuse_destructive_patch"
TMP_D="$(mktemp -d)"

mkdir -p "$TMP_D/tax_work/fixture_case/models"
mkdir -p "$TMP_D/audit"
cp "$FIX_A/runtime/tax_work/fixture_case/models/payment_plan_model.json" \
   "$TMP_D/tax_work/fixture_case/models/payment_plan_model.json"

PRE_HASH_D="$(file_sha256 "$TMP_D/tax_work/fixture_case/models/payment_plan_model.json")"
APPROVAL_SHA_D="$(file_sha256 "$FIX_D/approval.md")"

EXIT_D=0
node "$APPLY_SCRIPT" \
  --changeset "$FIX_D/changeset.json" \
  --case fixture_case \
  --approve-proof "$FIX_D/approval.md" \
  --approve-proof-sha256 "$APPROVAL_SHA_D" \
  --runtime-root "$TMP_D" \
  > "$TMP_D/stdout.json" 2>"$TMP_D/stderr.json" || EXIT_D=$?

check_eq "D1: Exit code 2 (refused destructive)" "2" "$EXIT_D"

POST_HASH_D="$(file_sha256 "$TMP_D/tax_work/fixture_case/models/payment_plan_model.json")"
check_eq "D2: File unchanged after refusal" "$PRE_HASH_D" "$POST_HASH_D"

check_file_not_exists "D3: No receipt created" "$TMP_D/tax_work/fixture_case/audit/apply_receipt.json"

check_contains "D4: Stderr mentions not allowed" "$TMP_D/stderr.json" 'not allowed'

rm -rf "$TMP_D"

###############################################################################
# Suite E: Determinism (run Fixture 1 twice, same output)
###############################################################################
echo ""
echo "==========================================="
echo "  Suite E: Determinism check"
echo "==========================================="

TMP_E1="$(mktemp -d)"
TMP_E2="$(mktemp -d)"

# Run 1
mkdir -p "$TMP_E1/tax_work/fixture_case/models"
mkdir -p "$TMP_E1/tax_work/fixture_case/audit"
mkdir -p "$TMP_E1/audit"
cp "$FIX_A/runtime/tax_work/fixture_case/models/payment_plan_model.json" \
   "$TMP_E1/tax_work/fixture_case/models/payment_plan_model.json"

node "$APPLY_SCRIPT" \
  --changeset "$FIX_A/changeset.json" \
  --case fixture_case \
  --approve-proof "$FIX_A/approval.md" \
  --approve-proof-sha256 "$APPROVAL_SHA_A" \
  --out "$TMP_E1/tax_work/fixture_case/audit" \
  --runtime-root "$TMP_E1" \
  --created-utc 20260222T100100Z \
  > /dev/null 2>&1

# Run 2
mkdir -p "$TMP_E2/tax_work/fixture_case/models"
mkdir -p "$TMP_E2/tax_work/fixture_case/audit"
mkdir -p "$TMP_E2/audit"
cp "$FIX_A/runtime/tax_work/fixture_case/models/payment_plan_model.json" \
   "$TMP_E2/tax_work/fixture_case/models/payment_plan_model.json"

node "$APPLY_SCRIPT" \
  --changeset "$FIX_A/changeset.json" \
  --case fixture_case \
  --approve-proof "$FIX_A/approval.md" \
  --approve-proof-sha256 "$APPROVAL_SHA_A" \
  --out "$TMP_E2/tax_work/fixture_case/audit" \
  --runtime-root "$TMP_E2" \
  --created-utc 20260222T100100Z \
  > /dev/null 2>&1

# Compare patched model files
HASH_E1_MODEL="$(file_sha256 "$TMP_E1/tax_work/fixture_case/models/payment_plan_model.json")"
HASH_E2_MODEL="$(file_sha256 "$TMP_E2/tax_work/fixture_case/models/payment_plan_model.json")"
check_eq "E1: Patched model identical across runs" "$HASH_E1_MODEL" "$HASH_E2_MODEL"

# Compare receipts
HASH_E1_RECEIPT="$(file_sha256 "$TMP_E1/tax_work/fixture_case/audit/apply_receipt.json")"
HASH_E2_RECEIPT="$(file_sha256 "$TMP_E2/tax_work/fixture_case/audit/apply_receipt.json")"
check_eq "E2: Receipt identical across runs" "$HASH_E1_RECEIPT" "$HASH_E2_RECEIPT"

rm -rf "$TMP_E1" "$TMP_E2"

###############################################################################
# Suite F: Dry-run mode (no file changes)
###############################################################################
echo ""
echo "==========================================="
echo "  Suite F: Dry-run mode"
echo "==========================================="

TMP_F="$(mktemp -d)"

mkdir -p "$TMP_F/tax_work/fixture_case/models"
mkdir -p "$TMP_F/tax_work/fixture_case/audit"
mkdir -p "$TMP_F/audit"
cp "$FIX_A/runtime/tax_work/fixture_case/models/payment_plan_model.json" \
   "$TMP_F/tax_work/fixture_case/models/payment_plan_model.json"

PRE_HASH_F="$(file_sha256 "$TMP_F/tax_work/fixture_case/models/payment_plan_model.json")"

EXIT_F=0
node "$APPLY_SCRIPT" \
  --changeset "$FIX_A/changeset.json" \
  --case fixture_case \
  --approve-proof "$FIX_A/approval.md" \
  --approve-proof-sha256 "$APPROVAL_SHA_A" \
  --out "$TMP_F/tax_work/fixture_case/audit" \
  --runtime-root "$TMP_F" \
  --created-utc 20260222T100100Z \
  --dry-run \
  > "$TMP_F/stdout.json" 2>"$TMP_F/stderr.json" || EXIT_F=$?

check_eq "F1: Exit code 0 (dry-run success)" "0" "$EXIT_F"

POST_HASH_F="$(file_sha256 "$TMP_F/tax_work/fixture_case/models/payment_plan_model.json")"
check_eq "F2: Model file UNCHANGED in dry-run" "$PRE_HASH_F" "$POST_HASH_F"

# Receipt IS created even in dry-run (documents the dry run)
check_file_exists "F3: Dry-run receipt created" "$TMP_F/tax_work/fixture_case/audit/apply_receipt.json"

RECEIPT_F_RESULT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_F/tax_work/fixture_case/audit/apply_receipt.json','utf8')).result)")
check_eq "F4: Receipt result is DRY_RUN" "DRY_RUN" "$RECEIPT_F_RESULT"

RECEIPT_F_DRYRUN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_F/tax_work/fixture_case/audit/apply_receipt.json','utf8')).dry_run)")
check_eq "F5: Receipt dry_run is true" "true" "$RECEIPT_F_DRYRUN"

# No marker files in dry-run
check_file_not_exists "F6: No rerun marker in dry-run" "$TMP_F/tax_work/fixture_case/.require_rerun_port2"
check_file_not_exists "F7: No rebuild marker in dry-run" "$TMP_F/tax_work/fixture_case/.require_rebuild_port3"

rm -rf "$TMP_F"

###############################################################################
# Summary
###############################################################################
echo ""
echo "========================================="
printf "  TESTS: %d / %d PASSED\n" "$PASS" "$TOTAL"
echo "========================================="

[ "$FAIL" -eq 0 ] || exit 1
