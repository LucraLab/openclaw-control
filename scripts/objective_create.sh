#!/usr/bin/env bash
# objective_create.sh — Create a new objective in the Delivery OS
#
# Usage:
#   bash scripts/objective_create.sh \
#     --type feature_small_cli \
#     --repo LucraLab/openclaw-control \
#     --title "Add new template" \
#     --risk low \
#     [--dry-run]
#
# Environment:
#   DELIVERY_OS_HOME — Path to Delivery OS store (default: ~/.openclaw)
#
# Exit codes:
#   0 = objective created (JSON printed to stdout)
#   1 = validation error
#   2 = write error
#
set -uo pipefail

# --- Configuration ---
DELIVERY_OS_HOME="${DELIVERY_OS_HOME:-$HOME/.openclaw}"
OBJECTIVES_DIR="$DELIVERY_OS_HOME/objectives"
EVENTS_LOG="$DELIVERY_OS_HOME/_logs/agent-events.jsonl"

# Secret redaction pattern
SECRET_PATTERN='(API_KEY|APIKEY|_KEY$|TOKEN|SECRET|PASSWORD|PASSWD|AUTH_|BEARER|PRIVATE_KEY)'

# Allowed repos (v1: single repo)
ALLOWED_REPOS="LucraLab/openclaw-control"

# Allowed types (must match objective templates)
ALLOWED_TYPES="feature_small_cli ops_hardening validator_or_ci_gate docs_only_change"

# --- Source shared libraries ---
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${_SCRIPT_DIR}/lib/oc_paths.sh"
source "${_SCRIPT_DIR}/lib/oc_events.sh"

# --- Parse arguments ---
OBJ_TYPE=""
OBJ_REPO=""
OBJ_TITLE=""
OBJ_RISK=""
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --type) OBJ_TYPE="$2"; shift 2 ;;
    --repo) OBJ_REPO="$2"; shift 2 ;;
    --title) OBJ_TITLE="$2"; shift 2 ;;
    --risk) OBJ_RISK="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# --- Validation ---
ERRORS=""

if [ -z "$OBJ_TYPE" ]; then
  ERRORS="${ERRORS}Missing --type. "
fi

if [ -z "$OBJ_REPO" ]; then
  ERRORS="${ERRORS}Missing --repo. "
fi

if [ -z "$OBJ_TITLE" ]; then
  ERRORS="${ERRORS}Missing --title. "
fi

if [ -z "$OBJ_RISK" ]; then
  ERRORS="${ERRORS}Missing --risk. "
fi

if [ -n "$ERRORS" ]; then
  echo "ERROR: $ERRORS" >&2
  exit 1
fi

# Validate repo against allowlist
REPO_ALLOWED=false
for r in $ALLOWED_REPOS; do
  if [ "$OBJ_REPO" = "$r" ]; then
    REPO_ALLOWED=true
    break
  fi
done

if [ "$REPO_ALLOWED" = "false" ]; then
  echo "ERROR: Repository '$OBJ_REPO' is not in the allowlist. Allowed: $ALLOWED_REPOS" >&2
  exit 1
fi

# Validate risk tier
case "$OBJ_RISK" in
  low|medium|high) ;;
  *) echo "ERROR: Invalid risk tier '$OBJ_RISK'. Must be: low, medium, high" >&2; exit 1 ;;
esac

# Validate type
TYPE_VALID=false
for t in $ALLOWED_TYPES; do
  if [ "$OBJ_TYPE" = "$t" ]; then
    TYPE_VALID=true
    break
  fi
done

if [ "$TYPE_VALID" = "false" ]; then
  echo "ERROR: Invalid type '$OBJ_TYPE'. Allowed: $ALLOWED_TYPES" >&2
  exit 1
fi

# --- Generate objective ---
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OBJ_ID="obj-$(echo "$OBJ_TYPE" | tr '_' '-')-$(date -u +%s)"

# Sanitize title (remove any potential shell metacharacters)
SAFE_TITLE=$(echo "$OBJ_TITLE" | tr -cd '[:alnum:] [:space:]-_.,!?')

# Build JSON via python3 for safety (no shell interpolation in values)
OBJ_JSON=$(python3 -c "
import json, sys
obj = {
    'objective_id': '$OBJ_ID',
    'objective_type': '$OBJ_TYPE',
    'status': 'NEW',
    'risk': '$OBJ_RISK',
    'repo': '$OBJ_REPO',
    'description': sys.argv[1],
    'created_by': 'delivery_loop_v1',
    'created_at': '$TIMESTAMP',
    'manual_only': False
}
print(json.dumps(obj, indent=2))
" "$SAFE_TITLE" 2>/dev/null)

if [ -z "$OBJ_JSON" ]; then
  echo "ERROR: Failed to generate objective JSON" >&2
  exit 2
fi

# --- Idempotency check ---
if [ "$DRY_RUN" = "false" ]; then
  # Check for existing objective with same title hash
  TITLE_HASH=$(echo "$SAFE_TITLE" | md5sum 2>/dev/null | cut -d' ' -f1 || echo "nohash")
  for existing in "$OBJECTIVES_DIR"/*.json; do
    [ -f "$existing" ] || continue
    EXISTING_TITLE=$(python3 -c "import json; print(json.load(open('$existing')).get('description',''))" 2>/dev/null || echo "")
    EXISTING_HASH=$(echo "$EXISTING_TITLE" | md5sum 2>/dev/null | cut -d' ' -f1 || echo "other")
    if [ "$TITLE_HASH" = "$EXISTING_HASH" ]; then
      EXISTING_ID=$(python3 -c "import json; print(json.load(open('$existing')).get('objective_id',''))" 2>/dev/null)
      EXISTING_STATUS=$(python3 -c "import json; print(json.load(open('$existing')).get('status',''))" 2>/dev/null)
      if [ "$EXISTING_STATUS" != "COMPLETE" ] && [ "$EXISTING_STATUS" != "FAILED" ]; then
        echo "WARN: Duplicate objective detected: $EXISTING_ID (status=$EXISTING_STATUS). Returning existing." >&2
        cat "$existing"
        exit 0
      fi
    fi
  done
fi

# --- Output ---
if [ "$DRY_RUN" = "true" ]; then
  echo "$OBJ_JSON"
  exit 0
fi

# --- Write objective ---
mkdir -p "$OBJECTIVES_DIR" 2>/dev/null
OBJ_FILE="$OBJECTIVES_DIR/${OBJ_ID}.json"
TMP_FILE="${OBJ_FILE}.tmp"

echo "$OBJ_JSON" > "$TMP_FILE"
chmod 600 "$TMP_FILE"
mv "$TMP_FILE" "$OBJ_FILE"

# --- Emit event ---
REPO="$OBJ_REPO"
emit_event "DELIVERY_OBJECTIVE_CREATED" "objective_type=$OBJ_TYPE" "risk=$OBJ_RISK" "created_by=delivery_loop_v1"

# Print the created objective
echo "$OBJ_JSON"
