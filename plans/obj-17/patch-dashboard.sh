#!/bin/bash
# patch-dashboard.sh — Port #18 wiring patch for Dashboard VPS entrypoints
# Run as root on Dashboard VPS
# Patches: dispatch-to-builder.sh, nightly-audit.sh
set -uo pipefail

RUNTIME_BIN="/opt/openclaw-runtime"
RUNTIME_DIR="/home/openclaw/_runtime"

echo "=== Port #18 Dashboard VPS Patch ==="

# ─────────────────────────────────────────────
# 1. DISPATCH-TO-BUILDER.SH
# ─────────────────────────────────────────────
DTB="/root/bin/dispatch-to-builder.sh"
echo "Patching $DTB ..."

if grep -q 'KILLSWITCH_ACTIVE' "$DTB"; then
  echo "  SKIP: kill switch guard already present"
else
  sed -i '/^set -euo pipefail$/a\
\
# --- Kill Switch Guard (Port #18) ---\
RUNTIME_BIN="/opt/openclaw-runtime"\
export OPENCLAW_RUNTIME_DIR="/home/openclaw/_runtime"\
if ! node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then\
  echo "KILLSWITCH_ACTIVE: dispatch blocked"\
  exit 0\
fi\
# --- End Kill Switch Guard ---' "$DTB"
  echo "  DONE: kill switch guard inserted"
fi

# ─────────────────────────────────────────────
# 2. NIGHTLY-AUDIT.SH
# ─────────────────────────────────────────────
NA="/home/openclaw/bootstrap/nightly-audit.sh"
echo "Patching $NA ..."

if grep -q 'KILLSWITCH_ACTIVE' "$NA"; then
  echo "  SKIP: kill switch guard already present"
else
  # Insert after JSON_MODE line (line 19-20)
  sed -i '/^JSON_MODE="\${1:-}"$/a\
\
# --- Kill Switch Guard (Port #18) ---\
RUNTIME_BIN="/opt/openclaw-runtime"\
export OPENCLAW_RUNTIME_DIR="/home/openclaw/_runtime"\
if ! node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then\
  echo "[$TIMESTAMP] KILLSWITCH_ACTIVE: aborting nightly audit"\
  exit 0\
fi\
# --- End Kill Switch Guard ---' "$NA"
  echo "  DONE: kill switch guard inserted"
fi

# Add daily-exec-brief at end, before exit code section
if grep -q 'canonical_artifact.js' "$NA"; then
  echo "  SKIP: canonical artifact already present"
else
  sed -i '/^# Exit code$/i\
# --- Canonical daily-exec-brief (Port #18) ---\
node "$RUNTIME_BIN/canonical_artifact.js" daily-exec-brief \\\
  "{\\"total_checks\\":$((PASS+WARN+FAIL)),\\"pass_count\\":$PASS,\\"warn_count\\":$WARN,\\"fail_count\\":$FAIL}" \\\
  2>/dev/null || true\
# --- End Canonical Artifact ---\
' "$NA"
  echo "  DONE: canonical artifact inserted"
fi

echo ""
echo "=== Dashboard VPS patching complete ==="
