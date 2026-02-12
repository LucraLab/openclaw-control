#!/usr/bin/env bash
# task_pr_sync.sh — Sync task state with PR events (polling mode v1)
#
# Usage:
#   bash scripts/task_pr_sync.sh \
#     --objective <id> \
#     --tasks-file <path> \
#     [--dry-run]
#
# Maps:
#   PR opened          → task IN_PROGRESS
#   CI checks failing  → task BLOCKED + failing check list
#   CI checks passing + no approval → task WAITING_APPROVAL
#   CI checks passing + approved + qa-approved → task READY_FOR_STAGING
#   PR merged          → task READY_FOR_STAGING
#
# Environment:
#   GH_MOCK — Set to 1 for test mode
#   DELIVERY_OS_HOME — Path to Delivery OS store
#   OC_AGENT_ID     — Required. Must be: builder|executor|auditor
#
set -uo pipefail

# --- Configuration ---
DELIVERY_OS_HOME="${DELIVERY_OS_HOME:-$HOME/.openclaw}"
GH_MOCK="${GH_MOCK:-0}"

# Required CI checks
REQUIRED_CHECKS="scan-secrets scan-public-safe qa-gate"

# --- Source shared libraries ---
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${_SCRIPT_DIR}/lib/oc_paths.sh"
source "${_SCRIPT_DIR}/lib/oc_events.sh"

# --- Require agent identity (Layer 4 isolation) ---
oc_require_agent_id || exit 1

# --- Parse arguments ---
OBJ_ID=""
TASKS_FILE=""
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --objective) OBJ_ID="$2"; shift 2 ;;
    --tasks-file) TASKS_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$OBJ_ID" ]; then
  echo "ERROR: Missing --objective" >&2; exit 1
fi
if [ -z "$TASKS_FILE" ]; then
  echo "ERROR: Missing --tasks-file" >&2; exit 1
fi
if [ ! -f "$TASKS_FILE" ]; then
  echo "ERROR: Tasks file not found: $TASKS_FILE" >&2; exit 1
fi

# --- Process each task with a PR ---
echo "=== task_pr_sync.sh ==="
echo "Objective: $OBJ_ID"
echo "Tasks file: $TASKS_FILE"
echo "Agent: $OC_AGENT_ID"
echo ""

TRANSITIONS=$(python3 << 'PYEOF'
import json, subprocess, sys, os

tasks_file = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('TASKS_FILE_PATH', '')
dry_run = os.environ.get('SYNC_DRY_RUN', 'false') == 'true'
gh_mock = os.environ.get('GH_MOCK', '0') == '1'
required_checks = os.environ.get('REQUIRED_CHECKS', 'scan-secrets scan-public-safe qa-gate').split()

with open(tasks_file) as f:
    tasks = json.load(f)

transitions = []

for task in tasks:
    pr_url = task.get('pr_url', '')
    if not pr_url:
        continue

    task_key = task.get('task_key', 'unknown')
    old_status = task.get('status', 'UNKNOWN')

    # Get PR number from URL
    try:
        pr_number = pr_url.rstrip('/').split('/')[-1]
    except:
        continue

    # Query PR status via gh
    try:
        pr_json_str = subprocess.check_output(
            ['gh', 'pr', 'view', pr_number, '--json',
             'state,statusCheckRollup,reviews,labels',
             '--repo', task.get('repo', 'LucraLab/openclaw-control')],
            stderr=subprocess.DEVNULL, timeout=30
        ).decode('utf-8').strip()
        pr_data = json.loads(pr_json_str)
    except Exception as e:
        transitions.append({
            'task_key': task_key,
            'old_status': old_status,
            'new_status': old_status,
            'reason': f'gh query failed: {str(e)[:80]}'
        })
        continue

    pr_state = pr_data.get('state', 'UNKNOWN')

    # Check CI status
    checks = pr_data.get('statusCheckRollup', []) or []
    check_results = {}
    for c in checks:
        ctx = c.get('context', c.get('name', ''))
        state = c.get('state', c.get('conclusion', 'UNKNOWN'))
        check_results[ctx] = state

    all_checks_pass = True
    failing_checks = []
    for rc in required_checks:
        result = check_results.get(rc, 'MISSING')
        if result not in ('SUCCESS', 'PASS'):
            all_checks_pass = False
            failing_checks.append(f'{rc}={result}')

    # Check reviews
    reviews = pr_data.get('reviews', []) or []
    has_approval = any(r.get('state') == 'APPROVED' for r in reviews)

    # Check labels
    labels = [l.get('name', '') if isinstance(l, dict) else l
              for l in (pr_data.get('labels', []) or [])]
    has_qa_label = 'qa-approved' in labels

    # Determine new status
    new_status = old_status
    reason = ''

    if pr_state == 'MERGED':
        new_status = 'READY_FOR_STAGING'
        reason = 'PR merged'
    elif pr_state == 'CLOSED':
        new_status = 'BLOCKED'
        reason = 'PR closed without merge'
    elif not all_checks_pass:
        new_status = 'BLOCKED'
        reason = f'CI checks failing: {", ".join(failing_checks)}'
    elif all_checks_pass and not has_approval:
        new_status = 'WAITING_APPROVAL'
        reason = 'CI passing, waiting for CODEOWNERS approval'
    elif all_checks_pass and has_approval and not has_qa_label:
        new_status = 'WAITING_APPROVAL'
        reason = 'CI passing, approved, waiting for qa-approved label'
    elif all_checks_pass and has_approval and has_qa_label:
        new_status = 'READY_FOR_STAGING'
        reason = 'All gates passed — ready to merge'

    # Update task
    if new_status != old_status:
        task['status'] = new_status
        task['last_sync'] = __import__('datetime').datetime.now(
            __import__('datetime').timezone.utc
        ).strftime('%Y-%m-%dT%H:%M:%SZ')

    transitions.append({
        'task_key': task_key,
        'old_status': old_status,
        'new_status': new_status,
        'reason': reason,
        'checks_pass': all_checks_pass,
        'has_approval': has_approval,
        'has_qa_label': has_qa_label,
        'pr_state': pr_state
    })

# Write updated tasks (unless dry-run)
if not dry_run:
    import stat
    tmp = tasks_file + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(tasks, f, indent=2)
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    os.rename(tmp, tasks_file)

# Output transitions
print(json.dumps(transitions, indent=2))
PYEOF
)

# Pass environment to python
export TASKS_FILE_PATH="$TASKS_FILE"
export SYNC_DRY_RUN="$DRY_RUN"
export REQUIRED_CHECKS="$REQUIRED_CHECKS"

TRANSITIONS=$(TASKS_FILE_PATH="$TASKS_FILE" SYNC_DRY_RUN="$DRY_RUN" REQUIRED_CHECKS="$REQUIRED_CHECKS" python3 -c "
import json, subprocess, sys, os, stat
from datetime import datetime, timezone

tasks_file = os.environ['TASKS_FILE_PATH']
dry_run = os.environ.get('SYNC_DRY_RUN', 'false') == 'true'
required_checks = os.environ.get('REQUIRED_CHECKS', 'scan-secrets scan-public-safe qa-gate').split()

with open(tasks_file) as f:
    tasks = json.load(f)

transitions = []

for task in tasks:
    pr_url = task.get('pr_url', '')
    if not pr_url:
        continue

    task_key = task.get('task_key', 'unknown')
    old_status = task.get('status', 'UNKNOWN')

    try:
        pr_number = pr_url.rstrip('/').split('/')[-1]
    except:
        continue

    repo = task.get('repo', 'LucraLab/openclaw-control')

    try:
        pr_json_str = subprocess.check_output(
            ['gh', 'pr', 'view', pr_number, '--json',
             'state,statusCheckRollup,reviews,labels',
             '--repo', repo],
            stderr=subprocess.DEVNULL, timeout=30
        ).decode('utf-8').strip()
        pr_data = json.loads(pr_json_str)
    except Exception as e:
        transitions.append({
            'task_key': task_key,
            'old_status': old_status,
            'new_status': old_status,
            'reason': f'gh query failed: {str(e)[:80]}'
        })
        continue

    pr_state = pr_data.get('state', 'UNKNOWN')

    checks = pr_data.get('statusCheckRollup', []) or []
    check_results = {}
    for c in checks:
        ctx = c.get('context', c.get('name', ''))
        state = c.get('state', c.get('conclusion', 'UNKNOWN'))
        check_results[ctx] = state

    all_checks_pass = True
    failing_checks = []
    for rc in required_checks:
        result = check_results.get(rc, 'MISSING')
        if result not in ('SUCCESS', 'PASS'):
            all_checks_pass = False
            failing_checks.append(f'{rc}={result}')

    reviews = pr_data.get('reviews', []) or []
    has_approval = any(r.get('state') == 'APPROVED' for r in reviews)

    labels = [l.get('name', '') if isinstance(l, dict) else l
              for l in (pr_data.get('labels', []) or [])]
    has_qa_label = 'qa-approved' in labels

    new_status = old_status
    reason = ''

    if pr_state == 'MERGED':
        new_status = 'READY_FOR_STAGING'
        reason = 'PR merged'
    elif pr_state == 'CLOSED':
        new_status = 'BLOCKED'
        reason = 'PR closed without merge'
    elif not all_checks_pass:
        new_status = 'BLOCKED'
        reason = f'CI checks failing: {chr(44).join(failing_checks)}'
    elif all_checks_pass and not has_approval:
        new_status = 'WAITING_APPROVAL'
        reason = 'CI passing, waiting for CODEOWNERS approval'
    elif all_checks_pass and has_approval and not has_qa_label:
        new_status = 'WAITING_APPROVAL'
        reason = 'CI passing, approved, waiting for qa-approved label'
    elif all_checks_pass and has_approval and has_qa_label:
        new_status = 'READY_FOR_STAGING'
        reason = 'All gates passed'

    if new_status != old_status:
        task['status'] = new_status
        task['last_sync'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    transitions.append({
        'task_key': task_key,
        'old_status': old_status,
        'new_status': new_status,
        'reason': reason,
        'checks_pass': all_checks_pass,
        'has_approval': has_approval,
        'has_qa_label': has_qa_label,
        'pr_state': pr_state
    })

if not dry_run:
    tmp = tasks_file + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(tasks, f, indent=2)
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    os.rename(tmp, tasks_file)

print(json.dumps(transitions, indent=2))
" 2>&1)

echo "$TRANSITIONS"

# Emit events for transitions
echo ""
echo "=== State Transitions ==="
echo "$TRANSITIONS" | python3 -c "
import json, sys
try:
    transitions = json.load(sys.stdin)
    for t in transitions:
        old = t.get('old_status', '?')
        new = t.get('new_status', '?')
        key = t.get('task_key', '?')
        reason = t.get('reason', '')
        if old != new:
            print(f'  {key}: {old} -> {new} ({reason})')
        else:
            print(f'  {key}: {old} (no change) — {reason}')
except:
    print('  (no transitions to report)')
" 2>/dev/null
