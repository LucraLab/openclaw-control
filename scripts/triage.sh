#!/usr/bin/env bash
# triage.sh — Incident triage diagnostic script for Delivery OS (Port #11)
#
# Usage: bash scripts/triage.sh
#
# Prints:
#   - Current commit SHA (if in repo)
#   - Last 50 events from agent-events.jsonl
#   - Current locks under _locks/
#   - Kill switch status
#   - Current quarantines
#
# Security: Redacts token-like strings. Never prints secrets.
#
set -uo pipefail

DELIVERY_OS_HOME="${DELIVERY_OS_HOME:-$HOME/.openclaw}"
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Redaction ---
_redact() {
  sed -E \
    -e 's/(sk-)[a-zA-Z0-9]{10,}/\1[REDACTED]/g' \
    -e 's/(ghp_)[a-zA-Z0-9]{20,}/\1[REDACTED]/g' \
    -e 's/(pit-)[a-zA-Z0-9]{10,}/\1[REDACTED]/g' \
    -e 's/(AKIA)[A-Z0-9]{10,}/\1[REDACTED]/g' \
    -e 's/(eyJ)[a-zA-Z0-9._-]{20,}/\1[REDACTED]/g' \
    -e 's/(Bearer\s+)\S{10,}/\1[REDACTED]/g' \
    -e 's/(token=)[^\s&]{10,}/\1[REDACTED]/g' \
    -e 's/(key=)[^\s&]{10,}/\1[REDACTED]/g' \
    -e 's/(password=)[^\s&]+/\1[REDACTED]/g' \
    -e 's/(secret=)[^\s&]+/\1[REDACTED]/g' \
    -e 's/(API_KEY=)[^\s]+/\1[REDACTED]/g' \
    -e 's/(SECRET=)[^\s]+/\1[REDACTED]/g' \
    -e 's/(TOKEN=)[^\s]+/\1[REDACTED]/g'
}

echo "============================================"
echo "  Delivery OS — Incident Triage"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

# --- 1. Current commit SHA ---
echo "--- Commit SHA ---"
if git rev-parse --short HEAD 2>/dev/null; then
  :
else
  echo "(not in a git repo)"
fi
echo ""

# --- 2. Kill switch status ---
echo "--- Kill Switch ---"
if [ -f "${DELIVERY_OS_HOME}/_control/STOP" ]; then
  echo "ENGAGED: Kill switch is ON (${DELIVERY_OS_HOME}/_control/STOP exists)"
  echo "  To resume: rm ${DELIVERY_OS_HOME}/_control/STOP"
else
  echo "OFF: Kill switch is not engaged"
fi
echo ""

# --- 3. Current quarantines ---
echo "--- Quarantines ---"
QUARANTINE_FILE="${DELIVERY_OS_HOME}/_control/quarantine.json"
if [ -f "$QUARANTINE_FILE" ]; then
  python3 "${_SCRIPT_DIR}/lib/oc_quarantine.py" list "$QUARANTINE_FILE" 2>/dev/null | _redact
else
  echo "No quarantine file (none active)"
fi
echo ""

# --- 4. Current locks ---
echo "--- Locks ---"
LOCKS_DIR="${DELIVERY_OS_HOME}/_locks"
if [ -d "$LOCKS_DIR" ]; then
  LOCK_COUNT=$(find "$LOCKS_DIR" -name '*.lock.d' -type d 2>/dev/null | wc -l)
  echo "Active resource locks: $LOCK_COUNT"
  find "$LOCKS_DIR" -name '*.lock.d' -type d 2>/dev/null | while read -r ld; do
    META="${ld}/meta.json"
    if [ -f "$META" ]; then
      echo "  $(basename "$ld"):"
      python3 -c "
import json
with open('$META') as f:
    m = json.load(f)
print(f\"    agent={m.get('agent_id','?')} pid={m.get('pid','?')} since={m.get('start_ts_utc','?')}\")
" 2>/dev/null | _redact
    else
      echo "  $(basename "$ld"): (no metadata)"
    fi
  done
else
  echo "No locks directory"
fi

# Also check agent-scoped locks
for agent in builder executor auditor; do
  AGENT_OBJ_DIR="${DELIVERY_OS_HOME}/agents/${agent}/objectives"
  if [ -d "$AGENT_OBJ_DIR" ]; then
    AGENT_LOCKS=$(find "$AGENT_OBJ_DIR" -name '*.lock.d' -type d 2>/dev/null | wc -l)
    if [ "$AGENT_LOCKS" -gt 0 ]; then
      echo "  Agent '$agent' objective locks: $AGENT_LOCKS"
      find "$AGENT_OBJ_DIR" -name '*.lock.d' -type d 2>/dev/null | while read -r ld; do
        echo "    $(basename "$ld")"
      done
    fi
  fi
done
echo ""

# --- 5. Last 50 events ---
echo "--- Recent Events (last 50) ---"
EVENTS_LOG="${DELIVERY_OS_HOME}/_logs/agent-events.jsonl"
if [ -f "$EVENTS_LOG" ]; then
  tail -n 50 "$EVENTS_LOG" | _redact
else
  echo "No events log found"
fi
echo ""

echo "--- End Triage ---"
