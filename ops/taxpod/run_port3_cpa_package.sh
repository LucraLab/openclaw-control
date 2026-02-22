#!/bin/bash
# run_port3_cpa_package.sh — PORT3 Orchestration Wrapper
# Discovers newest bundle/model/strategy for a case (or takes explicit args).
# Location: ops/taxpod/run_port3_cpa_package.sh
#
# Usage:
#   bash run_port3_cpa_package.sh \
#     --case <CASE_ID> \
#     [--bundle <BUNDLE_DIR>] \
#     [--model <MODEL_PATH>] \
#     [--strategy <STRATEGY_PATH>] \
#     [--strategy-md <STRATEGY_MD_PATH>] \
#     [--docs-md <DOCS_MD_PATH>] \
#     [--out-root <OUTPUT_ROOT>] \
#     [--package-utc <UTC>] \
#     [--force]
#
# Exit codes: 0=success, 1+=error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILDER="${SCRIPT_DIR}/build_cpa_package_v1.js"

CASE_ID=""
BUNDLE_DIR=""
MODEL_PATH=""
STRATEGY_PATH=""
STRATEGY_MD_PATH=""
DOCS_MD_PATH=""
OUT_ROOT=""
PACKAGE_UTC=""
FORCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --case)        CASE_ID="$2"; shift 2 ;;
    --bundle)      BUNDLE_DIR="$2"; shift 2 ;;
    --model)       MODEL_PATH="$2"; shift 2 ;;
    --strategy)    STRATEGY_PATH="$2"; shift 2 ;;
    --strategy-md) STRATEGY_MD_PATH="$2"; shift 2 ;;
    --docs-md)     DOCS_MD_PATH="$2"; shift 2 ;;
    --out-root)    OUT_ROOT="$2"; shift 2 ;;
    --package-utc) PACKAGE_UTC="$2"; shift 2 ;;
    --force)       FORCE="--force"; shift ;;
    *) echo "ERROR: Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$CASE_ID" ]; then echo "ERROR: --case required" >&2; exit 1; fi

# ── Auto-discover paths if not provided ──
OPENCLAW_ROOT="/home/openclaw/.openclaw"

if [ -z "$BUNDLE_DIR" ]; then
  BUNDLES_BASE="${OPENCLAW_ROOT}/tax_inputs/bundles/${CASE_ID}"
  if [ -d "$BUNDLES_BASE" ]; then
    NEWEST_UTC=$(ls -1 "$BUNDLES_BASE" | sort | tail -1)
    BUNDLE_DIR="${BUNDLES_BASE}/${NEWEST_UTC}/payment_plan_bundle_v1"
  fi
fi

if [ -z "$MODEL_PATH" ]; then
  MODEL_PATH="${OPENCLAW_ROOT}/tax_work/${CASE_ID}/models/payment_plan_model.json"
fi

if [ -z "$DOCS_MD_PATH" ]; then
  DOCS_MD_PATH="${OPENCLAW_ROOT}/tax_work/${CASE_ID}/models/financial_docs_needed.md"
fi

if [ -z "$STRATEGY_PATH" ]; then
  STRATEGY_PATH="${OPENCLAW_ROOT}/tax_work/${CASE_ID}/strategy/strategy_recommendation.json"
fi

if [ -z "$STRATEGY_MD_PATH" ]; then
  STRATEGY_MD_PATH="${OPENCLAW_ROOT}/tax_work/${CASE_ID}/strategy/payment_plan_recommendation.md"
fi

# Validate discovered paths
for F in "$BUNDLE_DIR/liability_snapshot.json" "$MODEL_PATH" "$STRATEGY_PATH" "$STRATEGY_MD_PATH" "$DOCS_MD_PATH"; do
  if [ ! -f "$F" ]; then
    echo "ERROR: Required file not found: $F" >&2
    exit 1
  fi
done

# ── Build command args ──
BUILD_ARGS=(--case "$CASE_ID" --bundle "$BUNDLE_DIR" --model "$MODEL_PATH" --strategy "$STRATEGY_PATH" --strategy-md "$STRATEGY_MD_PATH" --docs-md "$DOCS_MD_PATH")

if [ -n "$OUT_ROOT" ]; then
  BUILD_ARGS+=(--out-root "$OUT_ROOT")
fi
if [ -n "$PACKAGE_UTC" ]; then
  BUILD_ARGS+=(--package-utc "$PACKAGE_UTC")
fi
if [ -n "$FORCE" ]; then
  BUILD_ARGS+=($FORCE)
fi

echo "=== PORT3: CPA Package Builder ==="
echo "Case: $CASE_ID"
echo "Bundle: $BUNDLE_DIR"
echo "Model: $MODEL_PATH"
echo "Strategy: $STRATEGY_PATH"
echo ""

node "$BUILDER" "${BUILD_ARGS[@]}"
