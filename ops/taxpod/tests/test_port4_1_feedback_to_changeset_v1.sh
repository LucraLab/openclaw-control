#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# test_port4_1_feedback_to_changeset_v1.sh
#
# Tests for PORT4.1 FeedbackV1 → ChangeSetV1 transformer.
#
# Suites:
#   A: case_correction_liability (exact match)
#   B: case_enrichment_missing_doc (exact match)
#   C: case_dispute_uncertain (exact match)
#   D: Determinism (same input → identical output bytes)
#   E: Fail-closed (invalid inputs → exit 2, no output)
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TRANSFORMER="$REPO_ROOT/ops/taxpod/feedback/feedback_to_changeset_v1.js"
FIXTURE_ROOT="$REPO_ROOT/ops/taxpod/fixtures/port4_feedback"

PASS=0
FAIL=0
TOTAL=0

check() {
  TOTAL=$((TOTAL + 1))
  local label="$1"
  local condition="$2"
  if eval "$condition"; then
    echo "  [PASS] $label"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label"
    FAIL=$((FAIL + 1))
  fi
}

echo "========================================="
echo "  Suite A: case_correction_liability"
echo "========================================="

FIXTURE_A="$FIXTURE_ROOT/case_correction_liability"
TMPOUT_A=$(mktemp -d)

A_EXIT=0
node "$TRANSFORMER" \
  --feedback "$FIXTURE_A/input_feedback.json" \
  --out "$TMPOUT_A" \
  --created-utc 20260222T140100Z \
  >/dev/null 2>&1 || A_EXIT=$?

check "A1: Exit code 0" "[ $A_EXIT -eq 0 ]"
check "A2: changeset.json exists" "[ -f '$TMPOUT_A/changeset.json' ]"
check "A3: Exact match with expected" "diff -q '$TMPOUT_A/changeset.json' '$FIXTURE_A/expected_changeset.json' >/dev/null 2>&1"

# Verify specific fields
A_CS_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_A/changeset.json','utf8')).changeset_id)")
A_ACTIONS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_A/changeset.json','utf8')).actions.length)")
A_IMPACTS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_A/changeset.json','utf8')).derived_impacts.join(','))")
A_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_A/changeset.json','utf8')).version)")
A_INPUT_SHA=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_A/changeset.json','utf8')).audit.input_feedback_sha256)")
A_CS_SHA=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_A/changeset.json','utf8')).audit.changeset_sha256)")

check "A4: changeset_id correct" "[ '$A_CS_ID' = 'case_demo_package_cs_20260222T140100Z' ]"
check "A5: 4 actions" "[ '$A_ACTIONS' = '4' ]"
check "A6: Derived impacts correct" "[ '$A_IMPACTS' = 'REQUIRE_REBUILD_PORT3,REQUIRE_RERUN_PORT2' ]"
check "A7: Version is ChangeSetV1" "[ '$A_VERSION' = 'ChangeSetV1' ]"
check "A8: input_feedback_sha256 non-empty" "[ -n '$A_INPUT_SHA' ]"
check "A9: changeset_sha256 non-empty" "[ -n '$A_CS_SHA' ]"

# Verify action types in order
A_ACT_TYPES=$(node -e "const c=JSON.parse(require('fs').readFileSync('$TMPOUT_A/changeset.json','utf8'));console.log(c.actions.map(a=>a.action_type).join(','))")
check "A10: Action types ordered correctly" "[ '$A_ACT_TYPES' = 'PATCH_JSON,PATCH_JSON,REQUIRE_RERUN_PORT2,REQUIRE_REBUILD_PORT3' ]"

rm -rf "$TMPOUT_A"

echo ""
echo "========================================="
echo "  Suite B: case_enrichment_missing_doc"
echo "========================================="

FIXTURE_B="$FIXTURE_ROOT/case_enrichment_missing_doc"
TMPOUT_B=$(mktemp -d)

B_EXIT=0
node "$TRANSFORMER" \
  --feedback "$FIXTURE_B/input_feedback.json" \
  --out "$TMPOUT_B" \
  --created-utc 20260222T150100Z \
  >/dev/null 2>&1 || B_EXIT=$?

check "B1: Exit code 0" "[ $B_EXIT -eq 0 ]"
check "B2: changeset.json exists" "[ -f '$TMPOUT_B/changeset.json' ]"
check "B3: Exact match with expected" "diff -q '$TMPOUT_B/changeset.json' '$FIXTURE_B/expected_changeset.json' >/dev/null 2>&1"

B_ACTIONS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_B/changeset.json','utf8')).actions.length)")
B_IMPACTS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_B/changeset.json','utf8')).derived_impacts.join(','))")
B_ACT_TYPES=$(node -e "const c=JSON.parse(require('fs').readFileSync('$TMPOUT_B/changeset.json','utf8'));console.log(c.actions.map(a=>a.action_type).join(','))")

check "B4: 4 actions" "[ '$B_ACTIONS' = '4' ]"
check "B5: Derived impacts correct" "[ '$B_IMPACTS' = 'REQUIRE_REBUILD_PORT3,REQUIRE_REEXPORT_BUNDLE' ]"
check "B6: Action types ordered correctly" "[ '$B_ACT_TYPES' = 'ADD_DOC_REFERENCE,ADD_DOC_REFERENCE,REQUIRE_REEXPORT_BUNDLE,REQUIRE_REBUILD_PORT3' ]"

rm -rf "$TMPOUT_B"

echo ""
echo "========================================="
echo "  Suite C: case_dispute_uncertain"
echo "========================================="

FIXTURE_C="$FIXTURE_ROOT/case_dispute_uncertain"
TMPOUT_C=$(mktemp -d)

C_EXIT=0
node "$TRANSFORMER" \
  --feedback "$FIXTURE_C/input_feedback.json" \
  --out "$TMPOUT_C" \
  --created-utc 20260222T160100Z \
  >/dev/null 2>&1 || C_EXIT=$?

check "C1: Exit code 0" "[ $C_EXIT -eq 0 ]"
check "C2: changeset.json exists" "[ -f '$TMPOUT_C/changeset.json' ]"
check "C3: Exact match with expected" "diff -q '$TMPOUT_C/changeset.json' '$FIXTURE_C/expected_changeset.json' >/dev/null 2>&1"

C_ACTIONS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_C/changeset.json','utf8')).actions.length)")
C_IMPACTS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_C/changeset.json','utf8')).derived_impacts.join(','))")
C_FLAG_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPOUT_C/changeset.json','utf8')).actions[0].flag.name)")

check "C4: 2 actions" "[ '$C_ACTIONS' = '2' ]"
check "C5: Derived impacts correct" "[ '$C_IMPACTS' = 'REQUIRE_REEXPORT_BUNDLE' ]"
check "C6: Flag name is NEEDS_VERIFICATION" "[ '$C_FLAG_NAME' = 'NEEDS_VERIFICATION' ]"

rm -rf "$TMPOUT_C"

echo ""
echo "========================================="
echo "  Suite D: Determinism"
echo "========================================="

FIXTURE_DET="$FIXTURE_ROOT/case_correction_liability"
TMPOUT_D1=$(mktemp -d)
TMPOUT_D2=$(mktemp -d)

node "$TRANSFORMER" --feedback "$FIXTURE_DET/input_feedback.json" --out "$TMPOUT_D1" --created-utc 20260222T140100Z >/dev/null 2>&1
node "$TRANSFORMER" --feedback "$FIXTURE_DET/input_feedback.json" --out "$TMPOUT_D2" --created-utc 20260222T140100Z >/dev/null 2>&1

D_SHA1=$(sha256sum "$TMPOUT_D1/changeset.json" | awk '{print $1}')
D_SHA2=$(sha256sum "$TMPOUT_D2/changeset.json" | awk '{print $1}')

check "D1: Run 1 == Run 2 (byte-identical)" "[ '$D_SHA1' = '$D_SHA2' ]"

# Run fixture B twice too
TMPOUT_D3=$(mktemp -d)
TMPOUT_D4=$(mktemp -d)
node "$TRANSFORMER" --feedback "$FIXTURE_ROOT/case_enrichment_missing_doc/input_feedback.json" --out "$TMPOUT_D3" --created-utc 20260222T150100Z >/dev/null 2>&1
node "$TRANSFORMER" --feedback "$FIXTURE_ROOT/case_enrichment_missing_doc/input_feedback.json" --out "$TMPOUT_D4" --created-utc 20260222T150100Z >/dev/null 2>&1

D_SHA3=$(sha256sum "$TMPOUT_D3/changeset.json" | awk '{print $1}')
D_SHA4=$(sha256sum "$TMPOUT_D4/changeset.json" | awk '{print $1}')

check "D2: Fixture B Run 1 == Run 2 (byte-identical)" "[ '$D_SHA3' = '$D_SHA4' ]"

rm -rf "$TMPOUT_D1" "$TMPOUT_D2" "$TMPOUT_D3" "$TMPOUT_D4"

echo ""
echo "========================================="
echo "  Suite E: Fail-closed"
echo "========================================="

# E1: Missing package_manifest_sha256
TMPOUT_E1=$(mktemp -d)
cat > "$TMPOUT_E1/bad_feedback.json" << 'EOF'
{
  "version": "FeedbackV1",
  "feedback_id": "test_fb_20260222T000000Z",
  "case_id": "test_case",
  "source": "CPA",
  "received_utc": "20260222T000000Z",
  "items": [
    {
      "item_id": "item_001",
      "type": "LIABILITY_CORRECTION",
      "target": { "artifact": "LIABILITY_SNAPSHOT", "path": "x", "year": 2022 },
      "proposed_change": { "field": "x", "old_value": 1, "new_value": 2 },
      "evidence": { "notes": "test", "attachments": [], "confidence": "HIGH" },
      "requires_human_approval": true
    }
  ]
}
EOF

E1_EXIT=0
node "$TRANSFORMER" --feedback "$TMPOUT_E1/bad_feedback.json" --out "$TMPOUT_E1/out" --created-utc 20260222T000100Z 2>/dev/null || E1_EXIT=$?
check "E1: Missing package_manifest_sha256 → exit 2" "[ $E1_EXIT -eq 2 ]"
check "E2: No changeset written" "[ ! -f '$TMPOUT_E1/out/changeset.json' ]"

# E3: Unknown item.type
cat > "$TMPOUT_E1/bad_type.json" << 'EOF'
{
  "version": "FeedbackV1",
  "feedback_id": "test_fb_20260222T000000Z",
  "case_id": "test_case",
  "source": "CPA",
  "received_utc": "20260222T000000Z",
  "package_manifest_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "items": [
    {
      "item_id": "item_001",
      "type": "TOTALLY_UNKNOWN_TYPE",
      "target": { "artifact": "LIABILITY_SNAPSHOT", "year": 2022 },
      "proposed_change": { "field": "x" },
      "evidence": { "notes": "test", "attachments": [], "confidence": "HIGH" },
      "requires_human_approval": true
    }
  ]
}
EOF

E3_EXIT=0
node "$TRANSFORMER" --feedback "$TMPOUT_E1/bad_type.json" --out "$TMPOUT_E1/out2" --created-utc 20260222T000100Z 2>/dev/null || E3_EXIT=$?
check "E3: Unknown type → exit 2" "[ $E3_EXIT -eq 2 ]"
check "E4: No changeset written" "[ ! -f '$TMPOUT_E1/out2/changeset.json' ]"

# E5: Malformed JSON
echo "NOT JSON AT ALL" > "$TMPOUT_E1/malformed.json"
E5_EXIT=0
node "$TRANSFORMER" --feedback "$TMPOUT_E1/malformed.json" --out "$TMPOUT_E1/out3" --created-utc 20260222T000100Z 2>/dev/null || E5_EXIT=$?
check "E5: Malformed JSON → exit 2" "[ $E5_EXIT -eq 2 ]"
check "E6: No changeset written" "[ ! -f '$TMPOUT_E1/out3/changeset.json' ]"

# E7: Missing --feedback arg
E7_EXIT=0
node "$TRANSFORMER" --out "$TMPOUT_E1/out4" --created-utc 20260222T000100Z 2>/dev/null || E7_EXIT=$?
check "E7: Missing --feedback → exit 2" "[ $E7_EXIT -eq 2 ]"

# E8: No writes outside temp dir
OUTSIDE_CHECK=$(find "$TMPOUT_E1" -name 'changeset.json' -type f 2>/dev/null | wc -l)
check "E8: No changeset.json written anywhere in fail cases" "[ $OUTSIDE_CHECK -eq 0 ]"

rm -rf "$TMPOUT_E1"

echo ""
echo "========================================="
echo "  TESTS: $PASS / $TOTAL PASSED"
echo "========================================="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
