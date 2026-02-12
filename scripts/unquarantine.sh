#!/usr/bin/env bash
# unquarantine.sh — Remove an objective from quarantine (Port #11)
#
# Usage: bash scripts/unquarantine.sh <obj_id>
#
# Removes the quarantine flag atomically. Preserves event history.
# Safe to run even if the objective is not quarantined.
#
set -uo pipefail

DELIVERY_OS_HOME="${DELIVERY_OS_HOME:-$HOME/.openclaw}"
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
_QUARANTINE_PY="${_SCRIPT_DIR}/lib/oc_quarantine.py"
_QUARANTINE_FILE="${DELIVERY_OS_HOME}/_control/quarantine.json"

if [ $# -lt 1 ]; then
  echo "Usage: unquarantine.sh <obj_id>" >&2
  echo "  Example: bash scripts/unquarantine.sh obj-42" >&2
  exit 1
fi

OBJ_ID="$1"

if [ ! -f "$_QUARANTINE_FILE" ]; then
  echo "No quarantine file exists — nothing to remove"
  exit 0
fi

python3 "$_QUARANTINE_PY" remove "$_QUARANTINE_FILE" "$OBJ_ID"
exit $?
