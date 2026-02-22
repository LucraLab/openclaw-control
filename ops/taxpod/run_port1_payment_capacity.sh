#!/bin/bash
# run_port1_payment_capacity.sh — Orchestrate PORT1: model build + docs render
# Location: ops/taxpod/run_port1_payment_capacity.sh
#
# Arguments:
#   --case <CASE_ID>   Required. Case identifier.
#   --bundle <PATH>    Required. Path to payment_plan_bundle_v1 directory.
#   --intake <PATH>    Required. Path to financial_intake.json.
#   --out <DIR>        Optional. Default: /home/openclaw/.openclaw/tax_work/<CASE_ID>/models/
#   --as-of-utc <UTC>  Optional. Fixed UTC timestamp for determinism.
#   --force            Optional. Overwrite existing outputs.
#
# Exit codes: 0=success, 1=input error

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL_BUILDER="${SCRIPT_DIR}/build_payment_plan_model_v1.js"
DOCS_RENDERER="${SCRIPT_DIR}/render_financial_docs_needed_md.js"

# ── Parse args ──
CASE_ID=""
BUNDLE_PATH=""
INTAKE_PATH=""
OUT_DIR=""
AS_OF_UTC=""
FORCE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --case) CASE_ID="$2"; shift 2 ;;
    --bundle) BUNDLE_PATH="$2"; shift 2 ;;
    --intake) INTAKE_PATH="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --as-of-utc) AS_OF_UTC="$2"; shift 2 ;;
    --force) FORCE="--force"; shift ;;
    *) echo "ERROR: Unknown arg: $1"; exit 1 ;;
  esac
done

if [ -z "$CASE_ID" ]; then
  echo "ERROR: --case <CASE_ID> required"
  exit 1
fi
if [ -z "$BUNDLE_PATH" ]; then
  echo "ERROR: --bundle <PATH> required"
  exit 1
fi
if [ -z "$INTAKE_PATH" ]; then
  echo "ERROR: --intake <PATH> required"
  exit 1
fi

if [ -z "$OUT_DIR" ]; then
  OUT_DIR="/home/openclaw/.openclaw/tax_work/${CASE_ID}/models"
fi

# ── Build extra args ──
EXTRA_ARGS=""
if [ -n "$AS_OF_UTC" ]; then
  EXTRA_ARGS="$EXTRA_ARGS --as-of-utc $AS_OF_UTC"
fi
if [ -n "$FORCE" ]; then
  EXTRA_ARGS="$EXTRA_ARGS --force"
fi

# ── Step 1: Build model ──
echo "=== PORT1 Step 1: Build payment plan model ==="
node "$MODEL_BUILDER" \
  --case "$CASE_ID" \
  --bundle "$BUNDLE_PATH" \
  --intake "$INTAKE_PATH" \
  --out "$OUT_DIR" \
  $EXTRA_ARGS
MODEL_EXIT=$?

if [ $MODEL_EXIT -ne 0 ]; then
  echo "ERROR: Model build failed (exit $MODEL_EXIT)"
  exit $MODEL_EXIT
fi

MODEL_FILE="${OUT_DIR}/payment_plan_model.json"

# ── Step 2: Render docs checklist ──
echo ""
echo "=== PORT1 Step 2: Render financial docs checklist ==="
node "$DOCS_RENDERER" \
  --intake "$INTAKE_PATH" \
  --model "$MODEL_FILE" \
  --out "$OUT_DIR" \
  $FORCE
DOCS_EXIT=$?

if [ $DOCS_EXIT -ne 0 ]; then
  echo "ERROR: Docs render failed (exit $DOCS_EXIT)"
  exit $DOCS_EXIT
fi

# ── Summary ──
echo ""
DISPOSABLE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${MODEL_FILE}','utf8')).monthly_capacity.estimated_disposable_monthly)")
LIKELY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${MODEL_FILE}','utf8')).monthly_capacity.capacity_likely)")
FLAGS=$(node -e "const f=JSON.parse(require('fs').readFileSync('${MODEL_FILE}','utf8')).risk_flags; console.log(f.length)")
echo "PORT1_OK case=${CASE_ID} disposable=${DISPOSABLE} likely=${LIKELY} flags=${FLAGS}"
