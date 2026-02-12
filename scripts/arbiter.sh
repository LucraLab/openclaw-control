#!/usr/bin/env bash
# arbiter.sh — Objective Arbitration for Delivery OS (Port #9)
#
# Selects the next objective to run for an agent, acquires resource locks,
# and outputs a machine-readable run token (JSON).
#
# Usage:
#   bash scripts/arbiter.sh [--output <path>]
#
# Environment:
#   DELIVERY_OS_HOME — Path to Delivery OS store (default: ~/.openclaw)
#   OC_AGENT_ID      — Required. Must be: builder|executor|auditor
#
# Behavior:
#   1. Check kill switch (Port #11)
#   2. Enumerate objectives in $OC_AGENT_ROOT/objectives/
#   3. Filter: status != COMPLETE/FAILED, not manual_only, risk != high
#   4. Sort by created_at ascending (deterministic, stable)
#   5. For each candidate:
#      a. Check quarantine (Port #11) — skip if quarantined
#      b. Find next eligible task (status != DONE)
#      c. Compute repo_branch lock ID
#      d. Attempt resource_lock_acquire
#      e. If acquired → emit ARBITRATION_SELECTED, output run token
#      f. If blocked → emit ARBITRATION_BLOCKED, try next
#   6. If no candidate selected → emit ARBITRATION_SKIPPED, exit 0
#
# Exit codes:
#   0 = selected (run token written) or no candidates
#   1 = error (validation, environment)
#   7 = kill switch engaged (Port #11)
#
set -uo pipefail

# --- Configuration ---
DELIVERY_OS_HOME="${DELIVERY_OS_HOME:-$HOME/.openclaw}"

# --- Source shared libraries ---
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${_SCRIPT_DIR}/lib/oc_paths.sh"
source "${_SCRIPT_DIR}/lib/oc_events.sh"
source "${_SCRIPT_DIR}/lib/oc_resource_lock.sh"
source "${_SCRIPT_DIR}/lib/oc_control.sh"

# --- Require agent identity ---
oc_require_agent_id || exit 1
OC_AGENT_ROOT="$(oc_agent_root)"
OBJECTIVES_DIR="$OC_AGENT_ROOT/objectives"

# --- Kill switch check (Port #11) ---
if oc_kill_switch_engaged; then
  emit_event "KILL_SWITCH_ENGAGED" "agent_id=${OC_AGENT_ID}" "hostname=$(hostname -s 2>/dev/null || echo unknown)"
  echo "Kill switch engaged; remove STOP file to resume." >&2
  exit "$OC_KILL_SWITCH_EXIT_CODE"
fi

# --- Quarantine validity check (Port #11 — fail closed) ---
if ! oc_quarantine_is_valid; then
  emit_event "QUARANTINE_CORRUPT" "action=fail_closed"
  echo "REFUSED: quarantine.json is corrupt — fail closed. Fix or remove $_OC_QUARANTINE_FILE" >&2
  exit 1
fi

# --- Parse arguments ---
OUTPUT_PATH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) OUTPUT_PATH="$2"; shift 2 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# --- Enumerate eligible objectives ---
# Returns JSON lines: one per eligible objective, sorted by created_at
_enumerate_objectives() {
  python3 -c "
import json, os, glob, sys

obj_dir = '${OBJECTIVES_DIR}'
results = []

for f in glob.glob(os.path.join(obj_dir, 'obj-*.json')):
    # Skip task files
    if f.endswith('-tasks.json'):
        continue
    # Skip lock dirs and stale markers
    if '.lock.d' in f or '.stale.' in f:
        continue
    try:
        with open(f) as fh:
            obj = json.load(fh)
    except (json.JSONDecodeError, IOError):
        continue

    status = obj.get('status', '')
    if status in ('COMPLETE', 'FAILED'):
        continue
    if obj.get('manual_only', False):
        continue
    if obj.get('risk', '') == 'high':
        continue

    obj['_path'] = f
    results.append(obj)

# Deterministic sort: created_at ascending, then objective_id
results.sort(key=lambda x: (x.get('created_at', ''), x.get('objective_id', '')))

for r in results:
    print(json.dumps(r))
" 2>/dev/null
}

# Find next eligible task for an objective.
# Returns JSON: {task_key, status} or empty if none.
_next_task() {
  local obj_id="$1"
  local tasks_file="$OBJECTIVES_DIR/${obj_id}-tasks.json"

  if [ ! -f "$tasks_file" ]; then
    return 1
  fi

  python3 -c "
import json, sys
try:
    with open('${tasks_file}') as f:
        tasks = json.load(f)
except (json.JSONDecodeError, IOError):
    sys.exit(1)

for t in tasks:
    status = t.get('status', 'NEW')
    if status not in ('DONE', 'IN_PROGRESS'):
        print(json.dumps({
            'task_key': t.get('task_key', ''),
            'status': status
        }))
        sys.exit(0)

# All tasks done or in progress — no eligible task
sys.exit(1)
" 2>/dev/null
}

# Compute branch name from obj_id and task_key (mirrors delivery_loop.sh).
_compute_branch() {
  local obj_id="$1"
  local task_key="$2"
  local slug
  slug=$(echo "$task_key" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-')
  echo "obj-${obj_id}/task-${slug}"
}

# Compute resource lock ID for a repo+branch.
_resource_lock_id() {
  local repo="$1"
  local branch="$2"
  echo "repo_branch:${repo}@${branch}"
}

# --- Optional strategy hints (Port #13) ---
# Reads executive-strategy-hints.json and adjusts objective ordering.
# Missing/invalid hints -> passthrough (fail closed).
_apply_strategy_hints() {
  local hints_file="${DELIVERY_OS_HOME:-$HOME/.openclaw}/artifacts/executive-strategy-hints.json"
  local status_file
  status_file="$(mktemp 2>/dev/null || echo /tmp/arbiter-hints-status-$$)"

  if [ ! -f "${_SCRIPT_DIR}/lib/oc_arbiter_hints.py" ]; then
    cat
    emit_event "ARBITER_HINTS_SKIPPED" "reason=module_not_found"
    rm -f "$status_file"
    return
  fi

  python3 "${_SCRIPT_DIR}/lib/oc_arbiter_hints.py"     --hints "$hints_file"     --status-file "$status_file"

  local status
  status="$(cat "$status_file" 2>/dev/null || echo UNKNOWN)"
  rm -f "$status_file"

  case "$status" in
    APPLIED*)
      emit_event "ARBITER_HINTS_APPLIED" "detail=$status" ;;
    SKIPPED*)
      emit_event "ARBITER_HINTS_SKIPPED" "reason=${status#SKIPPED:}" ;;
    FAILCLOSED*)
      emit_event "ARBITER_HINTS_FAILCLOSED" "reason=${status#FAILCLOSED:}" ;;
    *)
      emit_event "ARBITER_HINTS_SKIPPED" "reason=unknown_status" ;;
  esac
}

# --- Main arbitration loop ---
SELECTED=false

while IFS= read -r obj_line; do
  [ -z "$obj_line" ] && continue

  OBJ_ID=$(echo "$obj_line" | python3 -c "import json,sys; print(json.load(sys.stdin).get('objective_id',''))" 2>/dev/null)
  REPO=$(echo "$obj_line" | python3 -c "import json,sys; print(json.load(sys.stdin).get('repo',''))" 2>/dev/null)

  if [ -z "$OBJ_ID" ] || [ -z "$REPO" ]; then
    continue
  fi

  # --- Quarantine check (Port #11) ---
  if oc_quarantine_is_blocked "$OBJ_ID"; then
    emit_event "OBJECTIVE_SKIPPED_QUARANTINE" "obj_id=$OBJ_ID"
    continue
  fi

  # Find next eligible task
  TASK_JSON=$(_next_task "$OBJ_ID" 2>/dev/null) || {
    emit_event "ARBITRATION_SKIPPED" "reason=no_eligible_task"
    continue
  }

  TASK_KEY=$(echo "$TASK_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('task_key',''))" 2>/dev/null)
  if [ -z "$TASK_KEY" ]; then
    emit_event "ARBITRATION_SKIPPED" "reason=empty_task_key"
    continue
  fi

  # Compute branch and resource lock ID
  BRANCH_NAME=$(_compute_branch "$OBJ_ID" "$TASK_KEY")
  LOCK_ID=$(_resource_lock_id "$REPO" "$BRANCH_NAME")

  # Attempt resource lock
  if resource_lock_acquire "$LOCK_ID" >/dev/null 2>&1; then
    # Selected! Build run token
    TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    RUN_TOKEN=$(python3 -c "
import json
token = {
    'obj_id': '${OBJ_ID}',
    'task_key': '${TASK_KEY}',
    'repo': '${REPO}',
    'branch': '${BRANCH_NAME}',
    'resource_lock_ids': ['${LOCK_ID}'],
    'agent_id': '${OC_AGENT_ID}',
    'issued_at': '${TS}',
    'arbiter_pid': ${$}
}
print(json.dumps(token, indent=2))
" 2>/dev/null)

    emit_event "ARBITRATION_SELECTED" "lock_id=$LOCK_ID" "branch=$BRANCH_NAME"

    if [ -n "$OUTPUT_PATH" ]; then
      echo "$RUN_TOKEN" > "$OUTPUT_PATH"
      echo "Selected: $OBJ_ID/$TASK_KEY → $OUTPUT_PATH"
    else
      echo "$RUN_TOKEN"
    fi

    SELECTED=true
    break
  fi
  # If we reach here, resource_lock_acquire already emitted ARBITRATION_BLOCKED
done < <(_enumerate_objectives | _apply_strategy_hints)

if [ "$SELECTED" = "false" ]; then
  emit_event "ARBITRATION_SKIPPED" "reason=no_candidate_selected"
  echo "No eligible objective selected" >&2
fi

exit 0
