#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# run_port4_1_feedback_to_changeset.sh
#
# Wrapper that runs the PORT4.1 FeedbackV1 → ChangeSetV1 transformer
# and prints a summary line.
#
# Usage:
#   bash run_port4_1_feedback_to_changeset.sh \
#     --feedback <input_feedback.json> \
#     --out <out_dir> \
#     --created-utc <UTC>
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRANSFORMER="$SCRIPT_DIR/feedback_to_changeset_v1.js"

if [ ! -f "$TRANSFORMER" ]; then
  echo "ERROR: transformer not found at $TRANSFORMER" >&2
  exit 1
fi

# Pass all args through
OUTPUT=$(node "$TRANSFORMER" "$@" 2>&1) || {
  echo "$OUTPUT" >&2
  exit $?
}

# Parse summary from stdout
CASE_ID=$(echo "$OUTPUT" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).changeset_id.split('_cs_')[0]))")
CS_ID=$(echo "$OUTPUT" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).changeset_id))")
ACTIONS=$(echo "$OUTPUT" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).actions_count))")

echo "PORT4_1_OK case=$CASE_ID changeset_id=$CS_ID actions=$ACTIONS"
