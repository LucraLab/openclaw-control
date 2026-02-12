#!/bin/bash
# patch-builder.sh — Port #18 wiring patch for Builder VPS entrypoints
# Run as openclaw2 on Builder VPS
# Patches: objective-autopilot.sh, cross-agent-smoke.sh, agent-exercise.sh, oc-dispatch.sh
set -uo pipefail

TOOLS_DIR="/home/openclaw2/.openclaw/tools"
BIN_DIR="/home/openclaw2/bin"
RUNTIME_BIN="/opt/openclaw-runtime"
RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"

echo "=== Port #18 Builder VPS Patch ==="

# ─────────────────────────────────────────────
# 1. OBJECTIVE-AUTOPILOT.SH
# ─────────────────────────────────────────────
AP="$TOOLS_DIR/objective-autopilot.sh"
echo "Patching $AP ..."

# 1a. Kill switch guard after AUTOPILOT_START log (line 86)
if grep -q 'KILLSWITCH_ACTIVE' "$AP"; then
  echo "  SKIP: kill switch guard already present"
else
  sed -i '/^log "AUTOPILOT_START:/a\
\
# --- Kill Switch Guard (Port #18) ---\
RUNTIME_BIN="/opt/openclaw-runtime"\
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"\
if node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then\
  :  # kill switch is OFF, continue\
else\
  log "KILLSWITCH_ACTIVE: aborting autopilot run"\
  if [ -f "$TOOLS_DIR/state-lib.sh" ]; then\
    . "$TOOLS_DIR/state-lib.sh"\
    state_emit_event "KILLSWITCH_BLOCKED" '"'"'{"entrypoint":"objective-autopilot"}'"'"'\
  fi\
  exit 0\
fi\
# --- End Kill Switch Guard ---' "$AP"
  echo "  DONE: kill switch guard inserted"
fi

# 1b. Quarantine filter in pick_agent_for_role
# Insert after "if [ -z "$candidates" ]; then ... fi" block,
# before the python3 -c line
if grep -q 'QUARANTINE_SKIP' "$AP"; then
  echo "  SKIP: quarantine filter already present"
else
  # We insert quarantine filter right before the python3 scoring block
  sed -i '/^  python3 -c "/i\
  # --- Quarantine filter (Port #18) ---\
  local filtered=""\
  for agent in $candidates; do\
    if node "$RUNTIME_BIN/quarantine_agent.js" list 2>/dev/null | grep -qw "$agent"; then\
      log "QUARANTINE_SKIP: agent=$agent role=$role"\
      continue\
    fi\
    filtered="$filtered $agent"\
  done\
  filtered=$(echo "$filtered" | xargs)\
  if [ -z "$filtered" ]; then\
    log "QUARANTINE_BLOCKED: all candidates quarantined for role=$role"\
    echo ""\
    return 1\
  fi\
  candidates="$filtered"\
  # --- End quarantine filter ---\
' "$AP"
  echo "  DONE: quarantine filter inserted"
fi

# 1c. Spend evaluate + ops-pulse artifact at end (before exit lines)
if grep -q 'spend_alert.js evaluate' "$AP"; then
  echo "  SKIP: spend/artifact wiring already present"
else
  # Insert before the final "if $DRY_RUN; then" block
  sed -i '/^if \$DRY_RUN; then$/i\
# --- Spend + Artifact (Port #18) ---\
node "$RUNTIME_BIN/spend_alert.js" evaluate 2>/dev/null || true\
node "$RUNTIME_BIN/canonical_artifact.js" ops-pulse \\\
  "{\\"objectives_scanned\\":$OBJECTIVES_SCANNED,\\"assigned\\":$ASSIGNED_COUNT,\\"stuck\\":$STUCK_COUNT}" \\\
  2>/dev/null || true\
# --- End Spend + Artifact ---\
' "$AP"
  echo "  DONE: spend/artifact wiring inserted"
fi

echo "  objective-autopilot.sh patched"

# ─────────────────────────────────────────────
# 2. CROSS-AGENT-SMOKE.SH
# ─────────────────────────────────────────────
CS="$TOOLS_DIR/cross-agent-smoke.sh"
echo "Patching $CS ..."

if grep -q 'KILLSWITCH_ACTIVE' "$CS"; then
  echo "  SKIP: kill switch guard already present"
else
  # Insert after "set -uo pipefail" line
  sed -i '/^set -uo pipefail$/a\
\
# --- Kill Switch Guard (Port #18) ---\
RUNTIME_BIN="/opt/openclaw-runtime"\
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"\
if ! node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then\
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] KILLSWITCH_ACTIVE: aborting cross-agent-smoke"\
  exit 0\
fi\
# --- End Kill Switch Guard ---' "$CS"
  echo "  DONE: kill switch guard inserted"
fi

# ─────────────────────────────────────────────
# 3. AGENT-EXERCISE.SH
# ─────────────────────────────────────────────
AE="$TOOLS_DIR/agent-exercise.sh"
echo "Patching $AE ..."

if grep -q 'KILLSWITCH_ACTIVE' "$AE"; then
  echo "  SKIP: kill switch guard already present"
else
  sed -i '/^set -uo pipefail$/a\
\
# --- Kill Switch Guard (Port #18) ---\
RUNTIME_BIN="/opt/openclaw-runtime"\
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"\
if ! node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then\
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] KILLSWITCH_ACTIVE: aborting agent-exercise"\
  exit 0\
fi\
# --- End Kill Switch Guard ---' "$AE"
  echo "  DONE: kill switch guard inserted"
fi

# ─────────────────────────────────────────────
# 4. OC-DISPATCH.SH (write commands only)
# ─────────────────────────────────────────────
OD="$BIN_DIR/oc-dispatch.sh"
echo "Patching $OD ..."

if grep -q 'KILLSWITCH_ACTIVE' "$OD"; then
  echo "  SKIP: kill switch guard already present"
else
  # Add RUNTIME_BIN and OPENCLAW_RUNTIME_DIR after set -euo pipefail
  sed -i '/^set -euo pipefail$/a\
\
# --- Kill Switch config (Port #18) ---\
RUNTIME_BIN="/opt/openclaw-runtime"\
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"\
# --- End Kill Switch config ---' "$OD"

  # Add kill switch check before each restart-* block
  # Find "restart-builder1)" and insert guard before the approval check
  for cmd in restart-builder1 restart-builder2 restart-litellm git-pull run-tests; do
    if grep -q "    ${cmd})" "$OD" 2>/dev/null || grep -q "    ${cmd}\b" "$OD" 2>/dev/null; then
      # Insert killswitch check after the case match line
      sed -i "/    ${cmd})$/a\\
        # Kill switch guard (Port #18)\\
        if ! node \"\$RUNTIME_BIN/killswitch.js\" status >/dev/null 2>\&1; then\\
            echo \"KILLSWITCH_ACTIVE: write command '${cmd}' blocked\"\\
            log \"KILLSWITCH_BLOCKED: ${cmd}\"\\
            exit 0\\
        fi" "$OD"
    fi
  done
  echo "  DONE: kill switch guard for write commands inserted"
fi

echo ""
echo "=== Builder VPS patching complete ==="
echo "Verify with: head -40 $AP"
