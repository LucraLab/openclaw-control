#!/usr/bin/env bash
# delivery_loop.sh — Execute delivery loop steps for a task/objective
#
# Usage:
#   bash scripts/delivery_loop.sh \
#     --objective <id> \
#     --task <task-key> \
#     --repo LucraLab/openclaw-control \
#     [--dry-run] [--once] [--close-check]
#
# Environment:
#   DELIVERY_OS_HOME — Path to Delivery OS store (default: ~/.openclaw)
#   GH_MOCK — Set to 1 for test mode (uses mock gh)
#
# Exit codes:
#   0 = success
#   1 = validation/constraint failure (fail-closed)
#   2 = dry-run completed (no changes made)
#
set -uo pipefail

# --- Configuration ---
DELIVERY_OS_HOME="${DELIVERY_OS_HOME:-$HOME/.openclaw}"
OBJECTIVES_DIR="$DELIVERY_OS_HOME/objectives"
EVENTS_LOG="$DELIVERY_OS_HOME/_logs/agent-events.jsonl"
GH_MOCK="${GH_MOCK:-0}"

# Allowed repos (v1: hard-coded single repo)
ALLOWED_REPOS="LucraLab/openclaw-control"

# Forbidden path patterns (never modify these)
FORBIDDEN_PATHS=".github/workflows/ .env credentials/ secrets/"

# Secret redaction pattern
SECRET_PATTERN='(API_KEY|APIKEY|_KEY$|TOKEN|SECRET|PASSWORD|PASSWD|AUTH_|BEARER|PRIVATE_KEY)'

# Pre-commit safety patterns (matching gate-publicsafe)
UNSAFE_PATTERNS='([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|hstgr\.cloud|srv[0-9]+|ssh\s+\w+@|BEGIN.*PRIVATE.*KEY|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16})'

# --- Parse arguments ---
OBJ_ID=""
TASK_KEY=""
REPO=""
DRY_RUN=false
ONCE=false
CLOSE_CHECK=false

while [ $# -gt 0 ]; do
  case "$1" in
    --objective) OBJ_ID="$2"; shift 2 ;;
    --task) TASK_KEY="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --once) ONCE=true; shift ;;
    --close-check) CLOSE_CHECK=true; shift ;;
    *) echo "ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# --- Helper: emit event ---
emit_event() {
  local event_name="$1"
  shift
  local extra_fields="$*"

  [ -d "$(dirname "$EVENTS_LOG")" ] || return 0

  local seq_file="$DELIVERY_OS_HOME/_logs/event-seq.txt"
  local seq=1
  if [ -f "$seq_file" ]; then
    seq=$(cat "$seq_file" 2>/dev/null || echo "0")
    seq=$((seq + 1))
  fi
  echo "$seq" > "$seq_file"

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  python3 -c "
import json
evt = {
    'event_seq': $seq,
    'event': '$event_name',
    'timestamp': '$ts',
    'objective_id': '${OBJ_ID:-unknown}',
    'task_key': '${TASK_KEY:-unknown}',
    'repo': '${REPO:-unknown}'
}
# Parse extra fields (key=value pairs)
for pair in '''$extra_fields'''.split():
    if '=' in pair:
        k, v = pair.split('=', 1)
        evt[k] = v
print(json.dumps(evt))
" >> "$EVENTS_LOG" 2>/dev/null
}

# --- Close-check mode ---
if [ "$CLOSE_CHECK" = "true" ]; then
  if [ -z "$OBJ_ID" ]; then
    echo "ERROR: --close-check requires --objective" >&2
    exit 1
  fi

  OBJ_FILE="$OBJECTIVES_DIR/${OBJ_ID}.json"
  TASKS_FILE="$OBJECTIVES_DIR/${OBJ_ID}-tasks.json"

  if [ ! -f "$OBJ_FILE" ]; then
    echo "ERROR: Objective file not found: $OBJ_FILE" >&2
    exit 1
  fi

  # Check if all tasks are DONE
  ALL_DONE=$(python3 -c "
import json
tasks = json.load(open('$TASKS_FILE'))
all_done = all(t.get('status') == 'DONE' for t in tasks)
print('true' if all_done else 'false')
" 2>/dev/null || echo "false")

  # Check if staging smoke passed
  HAS_SMOKE=$(python3 -c "
import json
obj = json.load(open('$OBJ_FILE'))
print('true' if obj.get('staging_smoke_pass') else 'false')
" 2>/dev/null || echo "false")

  if [ "$ALL_DONE" = "false" ]; then
    echo "Cannot close objective: not all tasks are DONE" >&2
    exit 1
  fi

  if [ "$HAS_SMOKE" = "false" ]; then
    echo "Cannot close objective: staging smoke not passed. Run staging_smoke.sh first." >&2
    exit 1
  fi

  if [ "$DRY_RUN" = "true" ]; then
    echo "DRY-RUN: Would close objective $OBJ_ID (all tasks DONE, smoke passed)"
    exit 2
  fi

  # Close objective
  python3 -c "
import json, os, stat
with open('$OBJ_FILE') as f:
    obj = json.load(f)
obj['status'] = 'COMPLETE'
obj['completed_at'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
tmp = '${OBJ_FILE}.tmp'
with open(tmp, 'w') as f:
    json.dump(obj, f, indent=2)
os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
os.rename(tmp, '$OBJ_FILE')
" 2>/dev/null

  emit_event "DELIVERY_OBJECTIVE_COMPLETE"
  echo "Objective $OBJ_ID closed as COMPLETE"
  exit 0
fi

# --- Validation ---
if [ -z "$OBJ_ID" ]; then
  echo "ERROR: Missing --objective" >&2; exit 1
fi
if [ -z "$TASK_KEY" ]; then
  echo "ERROR: Missing --task" >&2; exit 1
fi
if [ -z "$REPO" ]; then
  echo "ERROR: Missing --repo" >&2; exit 1
fi

# Validate repo against allowlist
REPO_OK=false
for r in $ALLOWED_REPOS; do
  if [ "$REPO" = "$r" ]; then
    REPO_OK=true
    break
  fi
done

if [ "$REPO_OK" = "false" ]; then
  echo "REFUSED: Repository '$REPO' is not in the allowlist. Allowed: $ALLOWED_REPOS" >&2
  emit_event "DELIVERY_REFUSED" "reason=repo_not_allowed"
  exit 1
fi

# Validate gh auth (unless in mock mode)
if [ "$GH_MOCK" != "1" ]; then
  if ! gh auth status >/dev/null 2>&1; then
    echo "REFUSED: gh auth required. Run 'gh auth login' first." >&2
    emit_event "DELIVERY_REFUSED" "reason=gh_auth_missing"
    exit 1
  fi
fi

# Check objective exists
OBJ_FILE="$OBJECTIVES_DIR/${OBJ_ID}.json"
if [ ! -f "$OBJ_FILE" ]; then
  echo "ERROR: Objective not found: $OBJ_FILE" >&2
  exit 1
fi

# Read objective risk
OBJ_RISK=$(python3 -c "import json; print(json.load(open('$OBJ_FILE')).get('risk','unknown'))" 2>/dev/null || echo "unknown")

# High-risk validation
if [ "$OBJ_RISK" = "high" ]; then
  echo "REFUSED: High-risk objectives require explicit approval (not implemented in v1)" >&2
  emit_event "DELIVERY_REFUSED" "reason=high_risk_no_approval"
  exit 1
fi

# --- Branch naming ---
SLUG=$(echo "$TASK_KEY" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-')
BRANCH_NAME="obj-${OBJ_ID}/task-${SLUG}"

# --- Dry-run mode ---
if [ "$DRY_RUN" = "true" ]; then
  echo "DRY-RUN: delivery_loop.sh"
  echo "  Objective: $OBJ_ID"
  echo "  Task: $TASK_KEY"
  echo "  Repo: $REPO"
  echo "  Risk: $OBJ_RISK"
  echo "  Branch: $BRANCH_NAME"
  echo "  Would create branch, apply changes, run local checks, open PR"
  echo "  Would request CODEOWNERS review"
  echo "  Skipping all write operations (dry-run mode)"
  exit 2
fi

# --- Execute delivery steps ---
echo "=== delivery_loop.sh ==="
echo "Objective: $OBJ_ID"
echo "Task: $TASK_KEY"
echo "Repo: $REPO"
echo "Risk: $OBJ_RISK"
echo ""

# Step 1: Clone/update repo
WORK_DIR="${DELIVERY_OS_HOME}/workspaces/${REPO##*/}"
if [ -d "$WORK_DIR/.git" ]; then
  echo "Step 1: Updating existing clone..."
  cd "$WORK_DIR"
  git fetch origin main 2>&1
  git checkout main 2>&1
  git pull origin main 2>&1
else
  echo "Step 1: Cloning repo..."
  mkdir -p "$(dirname "$WORK_DIR")"
  gh repo clone "$REPO" "$WORK_DIR" -- --depth=50 2>&1
  cd "$WORK_DIR"
fi

# Step 2: Create branch
echo "Step 2: Creating branch $BRANCH_NAME..."
git checkout -b "$BRANCH_NAME" origin/main 2>&1 || {
  # Branch may already exist
  git checkout "$BRANCH_NAME" 2>&1
  git reset --hard origin/main 2>&1
}

emit_event "DELIVERY_BRANCH_CREATED" "branch=$BRANCH_NAME"

# Step 3: Apply changes (v1: only docs/templates/scripts)
echo "Step 3: Applying changes..."
# The actual change depends on the task. For v1, changes are passed
# via objective metadata or are deterministic template additions.
# This section would be extended per-task-type.

OBJ_DESC=$(python3 -c "import json; print(json.load(open('$OBJ_FILE')).get('description',''))" 2>/dev/null)
echo "  Change description: $OBJ_DESC"
echo "  (Changes should be staged before running delivery_loop.sh)"

# Step 4: Pre-commit safety scan
echo "Step 4: Pre-commit safety scan..."
STAGED=$(git diff --cached --name-only 2>/dev/null || echo "")
if [ -n "$STAGED" ]; then
  SAFETY_FAIL=false
  for file in $STAGED; do
    # Check forbidden paths
    for fp in $FORBIDDEN_PATHS; do
      if echo "$file" | grep -q "^$fp"; then
        echo "  BLOCKED: $file is in forbidden path $fp"
        SAFETY_FAIL=true
      fi
    done

    # Check for unsafe content
    if [ -f "$file" ]; then
      if grep -PqE "$UNSAFE_PATTERNS" "$file" 2>/dev/null; then
        echo "  BLOCKED: Unsafe content detected in $file"
        SAFETY_FAIL=true
      fi
    fi
  done

  if [ "$SAFETY_FAIL" = "true" ]; then
    echo "ABORT: Pre-commit safety scan failed. Not committing." >&2
    emit_event "DELIVERY_REFUSED" "reason=safety_scan_failed"
    exit 1
  fi
  echo "  Pre-commit scan: PASS"
fi

# Step 5: Run local checks
echo "Step 5: Running local checks..."
LOCAL_CHECKS_OK=true

# Markdownlint (if available)
if command -v markdownlint-cli2 >/dev/null 2>&1 || command -v npx >/dev/null 2>&1; then
  echo "  Running markdownlint..."
  npx markdownlint-cli2 "**/*.md" 2>&1 || LOCAL_CHECKS_OK=false
fi

# Schema validation (if registry changes)
if git diff --cached --name-only | grep -q "^registry/"; then
  echo "  Running schema validation..."
  if [ -f "scripts/coverage_report.js" ]; then
    node scripts/coverage_report.js --json >/dev/null 2>&1 || LOCAL_CHECKS_OK=false
  fi
fi

# Tests (if they exist)
if [ -f "scripts/coverage_report.test.js" ]; then
  echo "  Running tests..."
  node scripts/coverage_report.test.js 2>&1 || LOCAL_CHECKS_OK=false
fi

if [ "$LOCAL_CHECKS_OK" = "false" ]; then
  echo "BLOCKED: Local checks failed. Fix issues before proceeding." >&2
  emit_event "DELIVERY_CI_FAILED" "stage=local_checks"
  exit 1
fi
echo "  Local checks: PASS"

# Step 6: Commit
echo "Step 6: Committing..."
COMMIT_MSG="feat(${TASK_KEY}): ${OBJ_DESC}

Objective: ${OBJ_ID}
Task: ${TASK_KEY}
Risk: ${OBJ_RISK}
Generated-by: delivery_loop_v1"

git commit -m "$COMMIT_MSG" 2>&1 || {
  echo "WARN: Nothing to commit (changes may already be committed)"
}

# Step 7: Push branch
echo "Step 7: Pushing branch..."
git push origin "$BRANCH_NAME" 2>&1

# Step 8: Open PR
echo "Step 8: Opening PR..."
PR_TITLE="feat(${TASK_KEY}): ${OBJ_DESC}"
PR_BODY="## Summary

**Objective:** ${OBJ_ID}
**Task:** ${TASK_KEY}
**Type:** $(python3 -c "import json; print(json.load(open('$OBJ_FILE')).get('objective_type','unknown'))" 2>/dev/null)
**Risk:** ${OBJ_RISK}

${OBJ_DESC}

## CI Gates Required

- \`scan-secrets\` — No credential patterns
- \`scan-public-safe\` — No infrastructure identifiers
- \`qa-gate\` — \`qa-approved\` label present

---
*Generated by delivery_loop_v1*"

PR_URL=$(gh pr create \
  --repo "$REPO" \
  --base main \
  --head "$BRANCH_NAME" \
  --title "$PR_TITLE" \
  --body "$PR_BODY" 2>&1)

echo "  PR: $PR_URL"

emit_event "DELIVERY_PR_OPENED" "pr_url=$PR_URL branch=$BRANCH_NAME"

# Update task with PR URL
TASKS_FILE="$OBJECTIVES_DIR/${OBJ_ID}-tasks.json"
if [ -f "$TASKS_FILE" ]; then
  python3 -c "
import json, os, stat
with open('$TASKS_FILE') as f:
    tasks = json.load(f)
for t in tasks:
    if t.get('task_key') == '$TASK_KEY':
        t['pr_url'] = '$PR_URL'
        t['status'] = 'IN_PROGRESS'
        t['branch'] = '$BRANCH_NAME'
tmp = '${TASKS_FILE}.tmp'
with open(tmp, 'w') as f:
    json.dump(tasks, f, indent=2)
os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
os.rename(tmp, '$TASKS_FILE')
" 2>/dev/null
fi

echo ""
echo "=== Delivery loop complete ==="
echo "PR opened. Next steps:"
echo "  1. Wait for CI gates (scan-secrets, scan-public-safe, qa-gate)"
echo "  2. Add qa-approved label (qa_gatekeeper role)"
echo "  3. Get CODEOWNERS approval"
echo "  4. Merge PR"
echo "  5. Run staging smoke: bash scripts/staging_smoke.sh --repo-dir $WORK_DIR"
echo "  6. Close objective: bash scripts/delivery_loop.sh --objective $OBJ_ID --close-check"
