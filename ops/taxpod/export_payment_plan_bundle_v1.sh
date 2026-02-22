#!/bin/bash
# export_payment_plan_bundle_v1.sh — Wrapper for PaymentPlanBundleV1 exporter
# Location: ops/taxpod/export_payment_plan_bundle_v1.sh
#
# Arguments:
#   --case <CASE_ID>     Required. Case identifier.
#   --out <OUTPUT_ROOT>  Optional. Default: /home/openclaw/.openclaw/tax_inputs/bundles
#
# Runs on Builder VPS. Locates the latest TaxVault index and facts ledger,
# then calls the Node.js exporter to produce a frozen bundle.
#
# Exit codes: 0=success, 1=input error, 2=hash failure, 3=output exists

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXPORTER="${SCRIPT_DIR}/export_payment_plan_bundle_v1.js"

# ── Parse args ──
CASE_ID=""
OUT_ROOT="/home/openclaw/.openclaw/tax_inputs/bundles"

while [ $# -gt 0 ]; do
  case "$1" in
    --case) CASE_ID="$2"; shift 2 ;;
    --out)  OUT_ROOT="$2"; shift 2 ;;
    *) echo "ERROR: Unknown arg: $1"; exit 1 ;;
  esac
done

if [ -z "$CASE_ID" ]; then
  echo "ERROR: --case <CASE_ID> required"
  exit 1
fi

# ── Locate latest index ──
INDEX_DIR="/home/openclaw2/.openclaw/_runtime/artifacts"
if [ ! -d "$INDEX_DIR" ]; then
  # Fallback for Dashboard-side execution with local fixtures
  INDEX_DIR="${SCRIPT_DIR}/fixtures/bundles"
fi

LATEST_INDEX=$(find "$INDEX_DIR" -maxdepth 1 -name "TAXVAULT_INDEX_*.json" -type f 2>/dev/null | sort | tail -1)

if [ -z "$LATEST_INDEX" ]; then
  echo "ERROR: No TAXVAULT_INDEX_*.json found in $INDEX_DIR"
  exit 1
fi
echo "INDEX: $LATEST_INDEX"

# ── Locate facts ledger ──
# Check common locations
LEDGER=""
for candidate in \
  "/home/openclaw2/.openclaw/_runtime/artifacts/facts_ledger.jsonl" \
  "/home/openclaw2/.openclaw/taxvault-tools/facts_ledger.jsonl" \
  "${SCRIPT_DIR}/fixtures/bundles/${CASE_ID}/source/facts_ledger.jsonl"; do
  if [ -f "$candidate" ]; then
    LEDGER="$candidate"
    break
  fi
done

# If no live ledger, use fixtures if available
if [ -z "$LEDGER" ]; then
  # Try fixture path
  FIXTURE_LEDGER="${SCRIPT_DIR}/fixtures/bundles/${CASE_ID}/source/facts_ledger.jsonl"
  if [ -f "$FIXTURE_LEDGER" ]; then
    LEDGER="$FIXTURE_LEDGER"
  else
    echo "WARN: No facts ledger found; exporting with index data only"
    # Create empty ledger for the exporter
    LEDGER="/tmp/empty_ledger_$$.jsonl"
    touch "$LEDGER"
  fi
fi
echo "LEDGER: $LEDGER"

# ── Read vault version from package.json ──
VAULT_VERSION="unknown"
PKG="/home/openclaw2/.openclaw/taxvault-tools/package.json"
if [ -f "$PKG" ]; then
  VAULT_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG','utf8')).version)" 2>/dev/null || echo "unknown")
fi

# ── Run exporter ──
exec node "$EXPORTER" \
  --case "$CASE_ID" \
  --index "$LATEST_INDEX" \
  --ledger "$LEDGER" \
  --out "$OUT_ROOT" \
  --vault-version "$VAULT_VERSION"
