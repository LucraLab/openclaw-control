#!/usr/bin/env bash
# oc_control.sh — Kill switch + quarantine helpers for Delivery OS (Port #11)
#
# Source this file from any Delivery OS shell script:
#   source "$(dirname "$0")/lib/oc_control.sh"
#
# Functions:
#   oc_kill_switch_engaged       — returns 0 if kill switch is ON
#   oc_quarantine_is_valid       — returns 0 if quarantine.json is valid/absent
#   oc_quarantine_is_blocked     — returns 0 if obj_id is quarantined
#   oc_quarantine_record         — record event, may trigger quarantine
#
# Kill switch exit code: 7
#

DELIVERY_OS_HOME="${DELIVERY_OS_HOME:-$HOME/.openclaw}"
_OC_CONTROL_DIR="${DELIVERY_OS_HOME}/_control"

# Distinct exit code for kill switch engagement
OC_KILL_SWITCH_EXIT_CODE=7

# Path to quarantine Python module (relative to this lib dir)
_OC_QUARANTINE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oc_quarantine.py"
_OC_QUARANTINE_FILE="${_OC_CONTROL_DIR}/quarantine.json"

# --- Kill Switch ---

# Check if kill switch is engaged (STOP file exists).
# Returns 0 if engaged, 1 if not.
oc_kill_switch_engaged() {
  [ -f "${_OC_CONTROL_DIR}/STOP" ]
}

# --- Quarantine ---

# Check if quarantine.json is valid JSON (or absent).
# Returns 0 if valid/absent, 1 if corrupt.
oc_quarantine_is_valid() {
  python3 "$_OC_QUARANTINE_PY" valid "$_OC_QUARANTINE_FILE" >/dev/null 2>&1
}

# Check if an objective is quarantined.
# Returns 0 if quarantined (should skip), 1 if not.
# Returns 0 (fail closed) on corrupt file.
oc_quarantine_is_blocked() {
  local obj_id="$1"
  local rc
  python3 "$_OC_QUARANTINE_PY" check "$_OC_QUARANTINE_FILE" "$obj_id" >/dev/null 2>&1
  rc=$?
  # exit 0 = quarantined, 1 = not quarantined, 2 = corrupt (fail closed → blocked)
  if [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ]; then
    return 0  # blocked
  fi
  return 1  # not blocked
}

# Record an event for an objective, potentially triggering quarantine.
# Usage: oc_quarantine_record <obj_id> <event_type> [detail]
# Event types: failure | breach | arb_block
# Prints QUARANTINED or RECORDED to stdout.
oc_quarantine_record() {
  local obj_id="$1"
  local event_type="$2"
  local detail="${3:-}"
  mkdir -p "$_OC_CONTROL_DIR"
  python3 "$_OC_QUARANTINE_PY" record "$_OC_QUARANTINE_FILE" "$obj_id" "$event_type" "$detail" 2>/dev/null
}
