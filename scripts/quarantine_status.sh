#!/usr/bin/env bash
# quarantine_status.sh — List current quarantines (Port #11)
#
# Usage: bash scripts/quarantine_status.sh
#
# Shows all quarantined objectives with reason and timestamp.
#
set -uo pipefail

DELIVERY_OS_HOME="${DELIVERY_OS_HOME:-$HOME/.openclaw}"
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
_QUARANTINE_PY="${_SCRIPT_DIR}/lib/oc_quarantine.py"
_QUARANTINE_FILE="${DELIVERY_OS_HOME}/_control/quarantine.json"

echo "=== Quarantine Status ==="
echo "File: $_QUARANTINE_FILE"
echo ""

if [ ! -f "$_QUARANTINE_FILE" ]; then
  echo "No quarantine file — no objectives quarantined"
  exit 0
fi

python3 "$_QUARANTINE_PY" list "$_QUARANTINE_FILE"
exit $?
