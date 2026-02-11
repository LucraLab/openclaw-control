#!/usr/bin/env bash
# test_delivery_loop.sh — Acceptance tests for delivery_loop_v1
# TDD: These tests are written FIRST, before implementation.
# All tests must FAIL initially, then PASS after implementation.
#
# Usage: bash test_delivery_loop.sh [--repo-root <path>]
#
# Requirements:
#   - gh CLI available (or GH_MOCK=1 for unit tests)
#   - DELIVERY_OS_HOME set (or uses temp dir for isolation)
#
set -uo pipefail

# --- Configuration ---
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
SCRIPTS_DIR="$REPO_ROOT/scripts"
SKILL_DIR="$REPO_ROOT/skills/delivery_loop_v1"

# Isolated test environment
TEST_DIR=$(mktemp -d)
export DELIVERY_OS_HOME="$TEST_DIR/delivery_os"
mkdir -p "$DELIVERY_OS_HOME/objectives" "$DELIVERY_OS_HOME/_logs"

# Mock gh CLI for unit tests
export GH_MOCK=1
GH_MOCK_DIR="$TEST_DIR/gh_mock"
mkdir -p "$GH_MOCK_DIR"

# Counters
PASSED=0
FAILED=0
TOTAL=0

check() {
  local name="$1" result="$2" detail="${3:-}"
  TOTAL=$((TOTAL + 1))
  if [ "$result" = "PASS" ]; then
    PASSED=$((PASSED + 1))
    echo "  PASS: $name${detail:+ ($detail)}"
  else
    FAILED=$((FAILED + 1))
    echo "  FAIL: $name${detail:+ ($detail)}"
  fi
}

echo "============================================"
echo "  delivery_loop_v1 — Acceptance Test Suite"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  REPO_ROOT=$REPO_ROOT"
echo "  TEST_DIR=$TEST_DIR"
echo "============================================"
echo ""

# --- T1: objective_create creates a record ---
echo "--- T1: Objective Create ---"
if [ -f "$SCRIPTS_DIR/objective_create.sh" ]; then
  OBJ_OUT=$(bash "$SCRIPTS_DIR/objective_create.sh" \
    --type feature_small_cli \
    --repo LucraLab/openclaw-control \
    --title "Test objective for T1" \
    --risk low \
    --dry-run 2>&1) || true

  # Check that dry-run produces a JSON-like record
  if echo "$OBJ_OUT" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    OBJ_TYPE=$(echo "$OBJ_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('objective_type',''))" 2>/dev/null)
    if [ "$OBJ_TYPE" = "feature_small_cli" ]; then
      check "objective_create_creates_record" "PASS" "type=$OBJ_TYPE"
    else
      check "objective_create_creates_record" "FAIL" "wrong type: $OBJ_TYPE"
    fi
  else
    check "objective_create_creates_record" "FAIL" "output not valid JSON"
  fi

  # Check non-dry-run writes file
  OBJ_ID=$(bash "$SCRIPTS_DIR/objective_create.sh" \
    --type feature_small_cli \
    --repo LucraLab/openclaw-control \
    --title "Test objective T1 write" \
    --risk low 2>&1 | python3 -c "import sys,json; print(json.load(sys.stdin).get('objective_id',''))" 2>/dev/null) || true

  if [ -n "$OBJ_ID" ] && [ -f "$DELIVERY_OS_HOME/objectives/${OBJ_ID}.json" ]; then
    check "objective_create_writes_file" "PASS" "id=$OBJ_ID"
  else
    check "objective_create_writes_file" "FAIL" "no file created"
  fi
else
  check "objective_create_creates_record" "FAIL" "script not found"
  check "objective_create_writes_file" "FAIL" "script not found"
fi
echo ""

# --- T2: Delivery loop refuses non-allowed repo ---
echo "--- T2: Repo Allowlist ---"
if [ -f "$SCRIPTS_DIR/delivery_loop.sh" ]; then
  DENY_OUT=$(bash "$SCRIPTS_DIR/delivery_loop.sh" \
    --objective test-obj-1 \
    --task test-task-1 \
    --repo some-other/repo \
    --dry-run 2>&1) || true
  DENY_RC=$?

  if echo "$DENY_OUT" | grep -qi "refuse\|denied\|not.allowed\|blocked\|forbidden"; then
    check "delivery_loop_refuses_non_allowed_repo" "PASS" "rc=$DENY_RC"
  else
    check "delivery_loop_refuses_non_allowed_repo" "FAIL" "no refusal message"
  fi
else
  check "delivery_loop_refuses_non_allowed_repo" "FAIL" "script not found"
fi
echo ""

# --- T3: Delivery loop fails closed without gh auth ---
echo "--- T3: Fail-Closed Without GH Auth ---"
if [ -f "$SCRIPTS_DIR/delivery_loop.sh" ]; then
  # Unset GH auth for this test
  NO_AUTH_OUT=$(GH_MOCK=0 GH_TOKEN="" GITHUB_TOKEN="" bash "$SCRIPTS_DIR/delivery_loop.sh" \
    --objective test-obj-2 \
    --task test-task-2 \
    --repo LucraLab/openclaw-control \
    --dry-run 2>&1) || true
  NO_AUTH_RC=$?

  if [ "$NO_AUTH_RC" -ne 0 ] && echo "$NO_AUTH_OUT" | grep -qi "auth\|token\|credential\|not.logged"; then
    check "delivery_loop_fail_closed_without_gh_auth" "PASS" "rc=$NO_AUTH_RC"
  else
    check "delivery_loop_fail_closed_without_gh_auth" "FAIL" "did not fail on missing auth (rc=$NO_AUTH_RC)"
  fi
else
  check "delivery_loop_fail_closed_without_gh_auth" "FAIL" "script not found"
fi
echo ""

# --- T4: PR creation flow (mock mode) ---
echo "--- T4: PR Creation Flow ---"
if [ -f "$SCRIPTS_DIR/delivery_loop.sh" ]; then
  # Create a mock gh command
  cat > "$GH_MOCK_DIR/gh" << 'MOCKEOF'
#!/bin/bash
# Mock gh CLI — records commands to a log file
echo "$@" >> "${GH_MOCK_LOG:-/tmp/gh_mock.log}"
case "$1" in
  auth) echo "Logged in to github.com" ;;
  pr)
    case "$2" in
      create) echo "https://github.com/LucraLab/openclaw-control/pull/999" ;;
      view) echo '{"state":"OPEN","statusCheckRollup":[]}' ;;
    esac ;;
  api) echo '[]' ;;
esac
MOCKEOF
  chmod +x "$GH_MOCK_DIR/gh"
  export GH_MOCK_LOG="$TEST_DIR/gh_commands.log"

  # Create a test objective for the flow
  mkdir -p "$DELIVERY_OS_HOME/objectives"
  cat > "$DELIVERY_OS_HOME/objectives/test-pr-flow.json" << EOBJ
{
  "objective_id": "test-pr-flow",
  "objective_type": "feature_small_cli",
  "status": "PLANNED",
  "risk": "low",
  "repo": "LucraLab/openclaw-control"
}
EOBJ

  # Run delivery loop with mock gh in PATH
  PR_OUT=$(PATH="$GH_MOCK_DIR:$PATH" GH_MOCK=1 bash "$SCRIPTS_DIR/delivery_loop.sh" \
    --objective test-pr-flow \
    --task test-task-pr \
    --repo LucraLab/openclaw-control \
    --dry-run 2>&1) || true

  # Check that it attempted branch creation and PR
  if echo "$PR_OUT" | grep -qi "branch\|pr\|pull.request"; then
    check "pr_creation_flow_creates_branch_and_pr" "PASS"
  else
    check "pr_creation_flow_creates_branch_and_pr" "FAIL" "no branch/PR activity detected"
  fi
else
  check "pr_creation_flow_creates_branch_and_pr" "FAIL" "script not found"
fi
echo ""

# --- T5: Task/PR sync transitions states ---
echo "--- T5: Task/PR Sync ---"
if [ -f "$SCRIPTS_DIR/task_pr_sync.sh" ]; then
  # Create task file with known state
  cat > "$DELIVERY_OS_HOME/objectives/test-sync-tasks.json" << 'ETASK'
[{
  "task_id": "test-sync--t1",
  "task_key": "implement",
  "status": "ASSIGNED",
  "pr_url": "https://github.com/LucraLab/openclaw-control/pull/999",
  "assigned_agent": "main"
}]
ETASK

  # Mock gh to return PR as open with checks passing
  cat > "$GH_MOCK_DIR/gh" << 'MOCKEOF'
#!/bin/bash
echo "$@" >> "${GH_MOCK_LOG:-/tmp/gh_mock.log}"
case "$*" in
  *"pr view"*"--json"*)
    echo '{"state":"OPEN","reviews":[],"statusCheckRollup":[{"context":"scan-secrets","state":"SUCCESS"},{"context":"scan-public-safe","state":"SUCCESS"},{"context":"qa-gate","state":"SUCCESS"}],"labels":[]}' ;;
  *) echo '{}' ;;
esac
MOCKEOF
  chmod +x "$GH_MOCK_DIR/gh"

  SYNC_OUT=$(PATH="$GH_MOCK_DIR:$PATH" bash "$SCRIPTS_DIR/task_pr_sync.sh" \
    --objective test-sync \
    --tasks-file "$DELIVERY_OS_HOME/objectives/test-sync-tasks.json" \
    --dry-run 2>&1) || true

  if echo "$SYNC_OUT" | grep -qi "in_progress\|waiting\|transition\|state"; then
    check "task_pr_sync_transitions_states" "PASS"
  else
    check "task_pr_sync_transitions_states" "FAIL" "no state transitions detected"
  fi
else
  check "task_pr_sync_transitions_states" "FAIL" "script not found"
fi
echo ""

# --- T6: Merge blocked without required checks ---
echo "--- T6: Merge Without Required Checks ---"
if [ -f "$SCRIPTS_DIR/task_pr_sync.sh" ]; then
  # Mock gh to return PR with failing checks
  cat > "$GH_MOCK_DIR/gh" << 'MOCKEOF'
#!/bin/bash
echo "$@" >> "${GH_MOCK_LOG:-/tmp/gh_mock.log}"
case "$*" in
  *"pr view"*"--json"*)
    echo '{"state":"OPEN","reviews":[],"statusCheckRollup":[{"context":"scan-secrets","state":"FAILURE"},{"context":"scan-public-safe","state":"SUCCESS"},{"context":"qa-gate","state":"PENDING"}],"labels":[]}' ;;
  *) echo '{}' ;;
esac
MOCKEOF
  chmod +x "$GH_MOCK_DIR/gh"

  BLOCK_OUT=$(PATH="$GH_MOCK_DIR:$PATH" bash "$SCRIPTS_DIR/task_pr_sync.sh" \
    --objective test-sync \
    --tasks-file "$DELIVERY_OS_HOME/objectives/test-sync-tasks.json" \
    --dry-run 2>&1) || true

  if echo "$BLOCK_OUT" | grep -qi "blocked\|fail\|not.ready\|check.*fail"; then
    check "merge_blocked_without_required_checks" "PASS"
  else
    check "merge_blocked_without_required_checks" "FAIL" "no block detected on failing checks"
  fi
else
  check "merge_blocked_without_required_checks" "FAIL" "script not found"
fi
echo ""

# --- T7: Merge blocked without CODEOWNERS approval ---
echo "--- T7: Merge Without CODEOWNERS Approval ---"
if [ -f "$SCRIPTS_DIR/task_pr_sync.sh" ]; then
  # Mock: checks pass but no reviews
  cat > "$GH_MOCK_DIR/gh" << 'MOCKEOF'
#!/bin/bash
echo "$@" >> "${GH_MOCK_LOG:-/tmp/gh_mock.log}"
case "$*" in
  *"pr view"*"--json"*)
    echo '{"state":"OPEN","reviews":[],"statusCheckRollup":[{"context":"scan-secrets","state":"SUCCESS"},{"context":"scan-public-safe","state":"SUCCESS"},{"context":"qa-gate","state":"SUCCESS"}],"labels":["qa-approved"]}' ;;
  *) echo '{}' ;;
esac
MOCKEOF
  chmod +x "$GH_MOCK_DIR/gh"

  NOAPPROVAL_OUT=$(PATH="$GH_MOCK_DIR:$PATH" bash "$SCRIPTS_DIR/task_pr_sync.sh" \
    --objective test-sync \
    --tasks-file "$DELIVERY_OS_HOME/objectives/test-sync-tasks.json" \
    --dry-run 2>&1) || true

  if echo "$NOAPPROVAL_OUT" | grep -qi "approval\|review\|waiting\|codeowner"; then
    check "merge_blocked_without_codeowners_approval" "PASS"
  else
    check "merge_blocked_without_codeowners_approval" "FAIL" "no block on missing approval"
  fi
else
  check "merge_blocked_without_codeowners_approval" "FAIL" "script not found"
fi
echo ""

# --- T8: Staging smoke required before objective close ---
echo "--- T8: Staging Smoke Before Close ---"
if [ -f "$SCRIPTS_DIR/delivery_loop.sh" ]; then
  # Create a "merged" task without smoke pass
  cat > "$DELIVERY_OS_HOME/objectives/test-smoke.json" << EOBJ
{
  "objective_id": "test-smoke",
  "objective_type": "feature_small_cli",
  "status": "PLANNED",
  "risk": "low",
  "repo": "LucraLab/openclaw-control"
}
EOBJ
  cat > "$DELIVERY_OS_HOME/objectives/test-smoke-tasks.json" << 'ETASK'
[{
  "task_id": "test-smoke--implement",
  "task_key": "implement",
  "status": "DONE",
  "pr_url": "https://github.com/LucraLab/openclaw-control/pull/998",
  "staging_smoke": null
}]
ETASK

  SMOKE_OUT=$(bash "$SCRIPTS_DIR/delivery_loop.sh" \
    --objective test-smoke \
    --close-check \
    --dry-run 2>&1) || true

  if echo "$SMOKE_OUT" | grep -qi "smoke\|staging.*required\|cannot.*close\|not.*ready"; then
    check "staging_smoke_required_before_objective_close" "PASS"
  else
    check "staging_smoke_required_before_objective_close" "FAIL" "no smoke requirement enforced"
  fi
else
  check "staging_smoke_required_before_objective_close" "FAIL" "script not found"
fi
echo ""

# --- T9: Rollback plan exists and is referenced ---
echo "--- T9: Rollback Plan ---"
RUNBOOK="$SKILL_DIR/runbook.md"
if [ -f "$RUNBOOK" ]; then
  if grep -qi "rollback" "$RUNBOOK"; then
    ROLLBACK_LINES=$(grep -ci "rollback" "$RUNBOOK")
    check "rollback_plan_exists_and_is_referenced" "PASS" "$ROLLBACK_LINES rollback references"
  else
    check "rollback_plan_exists_and_is_referenced" "FAIL" "runbook exists but no rollback section"
  fi
else
  check "rollback_plan_exists_and_is_referenced" "FAIL" "runbook.md not found"
fi
echo ""

# --- T10: E2E dry-run integration test ---
echo "--- T10: E2E Dry-Run ---"
if [ -f "$SCRIPTS_DIR/objective_create.sh" ] && [ -f "$SCRIPTS_DIR/delivery_loop.sh" ]; then
  # Step 1: Create objective
  E2E_OBJ=$(bash "$SCRIPTS_DIR/objective_create.sh" \
    --type feature_small_cli \
    --repo LucraLab/openclaw-control \
    --title "E2E dry-run test" \
    --risk low 2>&1) || true

  E2E_ID=$(echo "$E2E_OBJ" | python3 -c "import sys,json; print(json.load(sys.stdin).get('objective_id',''))" 2>/dev/null) || true

  if [ -z "$E2E_ID" ]; then
    check "e2e_dryrun_integration" "FAIL" "could not create objective"
  else
    # Step 2: Run delivery loop in dry-run
    E2E_LOOP=$(PATH="$GH_MOCK_DIR:$PATH" GH_MOCK=1 bash "$SCRIPTS_DIR/delivery_loop.sh" \
      --objective "$E2E_ID" \
      --task "implement" \
      --repo LucraLab/openclaw-control \
      --dry-run 2>&1) || true

    if echo "$E2E_LOOP" | grep -qi "dry.run\|would\|skip\|simul"; then
      check "e2e_dryrun_integration" "PASS"
    else
      check "e2e_dryrun_integration" "FAIL" "dry-run did not indicate simulation"
    fi
  fi
else
  check "e2e_dryrun_integration" "FAIL" "scripts not found"
fi
echo ""

# --- Cleanup ---
rm -rf "$TEST_DIR" 2>/dev/null

# --- Summary ---
echo "============================================"
echo "  Results: $PASSED/$TOTAL PASS, $FAILED FAIL"
echo "============================================"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
