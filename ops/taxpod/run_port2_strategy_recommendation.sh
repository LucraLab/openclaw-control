#!/bin/bash
# run_port2_strategy_recommendation.sh — PORT2 Orchestration Wrapper
# Runs strategy recommender + report renderer in sequence.
# Location: ops/taxpod/run_port2_strategy_recommendation.sh
#
# Usage:
#   bash run_port2_strategy_recommendation.sh \
#     --case <CASE_ID> \
#     --bundle <BUNDLE_DIR> \
#     --model <MODEL_PATH> \
#     [--out <OUT_DIR>] \
#     [--as-of-utc <UTC>] \
#     [--force]
#
# Exit codes: 0=success, 1+=error from sub-scripts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RECOMMENDER="${SCRIPT_DIR}/recommend_payment_strategy_v1.js"
RENDERER="${SCRIPT_DIR}/render_payment_plan_recommendation_md.js"

# ── Parse args (pass through) ──
CASE_ID=""
BUNDLE_DIR=""
MODEL_PATH=""
OUT_DIR=""
AS_OF_UTC=""
FORCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --case)    CASE_ID="$2"; shift 2 ;;
    --bundle)  BUNDLE_DIR="$2"; shift 2 ;;
    --model)   MODEL_PATH="$2"; shift 2 ;;
    --out)     OUT_DIR="$2"; shift 2 ;;
    --as-of-utc) AS_OF_UTC="$2"; shift 2 ;;
    --force)   FORCE="--force"; shift ;;
    *) echo "ERROR: Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$CASE_ID" ]; then echo "ERROR: --case required" >&2; exit 1; fi
if [ -z "$BUNDLE_DIR" ]; then echo "ERROR: --bundle required" >&2; exit 1; fi
if [ -z "$MODEL_PATH" ]; then echo "ERROR: --model required" >&2; exit 1; fi

if [ -z "$OUT_DIR" ]; then
  OUT_DIR="/home/openclaw/.openclaw/tax_work/${CASE_ID}/strategy"
fi

# ── Build command args ──
RECOMMEND_ARGS=(--case "$CASE_ID" --bundle "$BUNDLE_DIR" --model "$MODEL_PATH" --out "$OUT_DIR")
if [ -n "$AS_OF_UTC" ]; then
  RECOMMEND_ARGS+=(--as-of-utc "$AS_OF_UTC")
fi
if [ -n "$FORCE" ]; then
  RECOMMEND_ARGS+=($FORCE)
fi

# ── Step 1: Run recommender ──
echo "=== PORT2 Step 1: Strategy Recommender ==="
node "$RECOMMENDER" "${RECOMMEND_ARGS[@]}"
RECOMMEND_EXIT=$?
if [ $RECOMMEND_EXIT -ne 0 ]; then
  echo "ERROR: Recommender failed (exit $RECOMMEND_EXIT)" >&2
  exit $RECOMMEND_EXIT
fi

# ── Step 2: Run renderer ──
STRATEGY_FILE="${OUT_DIR}/strategy_recommendation.json"
echo ""
echo "=== PORT2 Step 2: Report Renderer ==="

RENDER_ARGS=(--strategy "$STRATEGY_FILE" --out "$OUT_DIR")
if [ -n "$FORCE" ]; then
  RENDER_ARGS+=($FORCE)
fi

node "$RENDERER" "${RENDER_ARGS[@]}"
RENDER_EXIT=$?
if [ $RENDER_EXIT -ne 0 ]; then
  echo "ERROR: Renderer failed (exit $RENDER_EXIT)" >&2
  exit $RENDER_EXIT
fi

# ── Summary ──
echo ""
echo "=== PORT2 Complete ==="
echo "PORT2_OK: ${OUT_DIR}"
echo "FILES:"
echo "  strategy_recommendation.json"
echo "  payment_plan_recommendation.md"
