#!/usr/bin/env bash
# oc_events.sh — Centralized event emission for Delivery OS
#
# Source this file from any Delivery OS shell script:
#   source "$(dirname "$0")/lib/oc_events.sh"
#
# Usage:
#   emit_event "EVENT_NAME" "key1=val1" "key2=val2"
#
# Automatically includes these variables if set:
#   DELIVERY_OS_HOME, OBJ_ID, TASK_KEY, REPO, OC_AGENT_ID
#

# Central emit_event — replaces per-script copies
emit_event() {
  local event_name="$1"
  shift
  local extra_fields="$*"

  local home="${DELIVERY_OS_HOME:-$HOME/.openclaw}"
  local events_log="${home}/_logs/agent-events.jsonl"

  [ -d "$(dirname "$events_log")" ] || return 0

  local seq_file="${home}/_logs/event-seq.txt"
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
    'repo': '${REPO:-unknown}',
    'agent_id': '${OC_AGENT_ID:-unknown}'
}
for pair in '''$extra_fields'''.split():
    if '=' in pair:
        k, v = pair.split('=', 1)
        evt[k] = v
print(json.dumps(evt))
" >> "$events_log" 2>/dev/null
}
