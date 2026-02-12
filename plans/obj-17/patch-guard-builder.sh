#!/bin/bash
# patch-guard-builder.sh — Replace killswitch status/guard blocks with new guard semantics
# Run as openclaw2 on Builder VPS
set -uo pipefail

echo "=== Kill Switch Guard Fix — Builder VPS ==="
echo ""

TOOLS_DIR="/home/openclaw2/.openclaw/tools"
BIN_DIR="/home/openclaw2/bin"

# ─────────────────────────────────────────────
# 1. BACKUP ALL FILES
# ─────────────────────────────────────────────
echo "--- Backing up files ---"
for f in "$TOOLS_DIR/objective-autopilot.sh" "$TOOLS_DIR/cross-agent-smoke.sh" "$TOOLS_DIR/agent-exercise.sh" "$BIN_DIR/oc-dispatch.sh"; do
  if [ ! -f "$f" ]; then
    echo "ABORT: $f not found"
    exit 1
  fi
  cp -a "$f" "${f}.backup-pre-killswitch-guardfix"
  echo "  Backed up: $f"
done
echo ""

# ─────────────────────────────────────────────
# 2. OBJECTIVE-AUTOPILOT.SH
# ─────────────────────────────────────────────
echo "--- Patching objective-autopilot.sh ---"
AP="$TOOLS_DIR/objective-autopilot.sh"

if grep -q 'killswitch.js guard' "$AP"; then
  echo "  SKIP: already using guard"
else
  # Replace the Port #18 kill switch block (uses 'killswitch.js status')
  # The block is: lines starting with "# --- Kill Switch Guard (Port #18) ---"
  # through "# --- End Kill Switch Guard ---"
  python3 - "$AP" << 'PYEOF'
import sys
fpath = sys.argv[1]
with open(fpath, 'r') as f:
    content = f.read()

old_block_start = '# --- Kill Switch Guard (Port #18) ---'
old_block_end = '# --- End Kill Switch Guard ---'

start_idx = content.find(old_block_start)
end_idx = content.find(old_block_end)

if start_idx == -1 or end_idx == -1:
    print("ABORT: Could not find Kill Switch Guard block markers")
    sys.exit(1)

end_idx = end_idx + len(old_block_end)
# Include trailing newline
if end_idx < len(content) and content[end_idx] == '\n':
    end_idx += 1

new_block = '''# --- Kill Switch Guard (Port #18) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"
node "$RUNTIME_BIN/killswitch.js" guard >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 10 ] || [ "$rc" -eq 2 ]; then
  log "KILLSWITCH_ACTIVE: aborting autopilot run (rc=$rc)"
  if [ -f "$TOOLS_DIR/state-lib.sh" ]; then
    . "$TOOLS_DIR/state-lib.sh"
    state_emit_event "KILLSWITCH_BLOCKED" '{"entrypoint":"objective-autopilot"}'
  fi
  exit 0
elif [ "$rc" -ne 0 ]; then
  log "KILLSWITCH_UNKNOWN: fail-closed (rc=$rc)"
  exit 0
fi
# --- End Kill Switch Guard ---
'''

content = content[:start_idx] + new_block + content[end_idx:]
with open(fpath, 'w') as f:
    f.write(content)
print("  DONE: objective-autopilot.sh patched")
PYEOF
fi

# ─────────────────────────────────────────────
# 3. CROSS-AGENT-SMOKE.SH
# ─────────────────────────────────────────────
echo "--- Patching cross-agent-smoke.sh ---"
CS="$TOOLS_DIR/cross-agent-smoke.sh"

if grep -q 'killswitch.js guard' "$CS"; then
  echo "  SKIP: already using guard"
else
  python3 - "$CS" << 'PYEOF'
import sys
fpath = sys.argv[1]
with open(fpath, 'r') as f:
    content = f.read()

old_start = '# --- Kill Switch Guard (Port #18) ---'
old_end = '# --- End Kill Switch Guard ---'

si = content.find(old_start)
ei = content.find(old_end)
if si == -1 or ei == -1:
    print("ABORT: markers not found in cross-agent-smoke.sh")
    sys.exit(1)

ei = ei + len(old_end)
if ei < len(content) and content[ei] == '\n':
    ei += 1

new_block = '''# --- Kill Switch Guard (Port #18) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"
node "$RUNTIME_BIN/killswitch.js" guard >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 10 ] || [ "$rc" -eq 2 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] KILLSWITCH_ACTIVE: aborting cross-agent-smoke (rc=$rc)"
  exit 0
elif [ "$rc" -ne 0 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] KILLSWITCH_UNKNOWN: fail-closed (rc=$rc)"
  exit 0
fi
# --- End Kill Switch Guard ---
'''

content = content[:si] + new_block + content[ei:]
with open(fpath, 'w') as f:
    f.write(content)
print("  DONE: cross-agent-smoke.sh patched")
PYEOF
fi

# ─────────────────────────────────────────────
# 4. AGENT-EXERCISE.SH
# ─────────────────────────────────────────────
echo "--- Patching agent-exercise.sh ---"
AE="$TOOLS_DIR/agent-exercise.sh"

if grep -q 'killswitch.js guard' "$AE"; then
  echo "  SKIP: already using guard"
else
  python3 - "$AE" << 'PYEOF'
import sys
fpath = sys.argv[1]
with open(fpath, 'r') as f:
    content = f.read()

old_start = '# --- Kill Switch Guard (Port #18) ---'
old_end = '# --- End Kill Switch Guard ---'

si = content.find(old_start)
ei = content.find(old_end)
if si == -1 or ei == -1:
    print("ABORT: markers not found in agent-exercise.sh")
    sys.exit(1)

ei = ei + len(old_end)
if ei < len(content) and content[ei] == '\n':
    ei += 1

new_block = '''# --- Kill Switch Guard (Port #18) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"
node "$RUNTIME_BIN/killswitch.js" guard >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 10 ] || [ "$rc" -eq 2 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] KILLSWITCH_ACTIVE: aborting agent-exercise (rc=$rc)"
  exit 0
elif [ "$rc" -ne 0 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] KILLSWITCH_UNKNOWN: fail-closed (rc=$rc)"
  exit 0
fi
# --- End Kill Switch Guard ---
'''

content = content[:si] + new_block + content[ei:]
with open(fpath, 'w') as f:
    f.write(content)
print("  DONE: agent-exercise.sh patched")
PYEOF
fi

# ─────────────────────────────────────────────
# 5. OC-DISPATCH.SH (write commands only)
# ─────────────────────────────────────────────
echo "--- Patching oc-dispatch.sh ---"
OD="$BIN_DIR/oc-dispatch.sh"

if grep -q 'killswitch.js guard' "$OD"; then
  echo "  SKIP: already using guard"
else
  python3 - "$OD" << 'PYEOF'
import sys
fpath = sys.argv[1]
with open(fpath, 'r') as f:
    content = f.read()

# oc-dispatch.sh has the kill switch config block at the top
# and individual guards per write command. Replace the config block
# and all individual guard invocations.

# Replace config block
old_config_start = '# --- Kill Switch config (Port #18) ---'
old_config_end_marker = 'KILLSWITCH_CMD='
ci = content.find(old_config_start)
if ci != -1:
    # Find the KILLSWITCH_CMD= line and its end
    kcmd_idx = content.find(old_config_end_marker, ci)
    if kcmd_idx != -1:
        # Find end of that line
        line_end = content.find('\n', kcmd_idx)
        if line_end != -1:
            line_end += 1
        new_config = '''# --- Kill Switch config (Port #18) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"
'''
            content = content[:ci] + new_config + content[line_end:]

# Now replace each individual kill switch guard block
# Pattern: "# Kill switch guard (Port #18)" through the fi + next line
# Each one looks like:
#   # Kill switch guard (Port #18)
#   if ! node "$KILLSWITCH_CMD" status >/dev/null 2>&1; then
#       echo "KILLSWITCH_ACTIVE: write command '...' blocked"
#       log "KILLSWITCH_BLOCKED: ..."
#       return
#   fi
import re

# Replace all individual guard blocks
pattern = r'''# Kill switch guard \(Port #18\)\n\s+if ! node "\$KILLSWITCH_CMD" status >/dev/null 2>&1; then\n\s+echo "KILLSWITCH_ACTIVE: write command '([^']+)' blocked"\n\s+log "KILLSWITCH_BLOCKED: \1"\n\s+return\n\s+fi'''

def replacement(m):
    cmd_name = m.group(1)
    return f'''# Kill switch guard (Port #18)
            node "$RUNTIME_BIN/killswitch.js" guard >/dev/null 2>&1
            rc=$?
            if [ "$rc" -eq 10 ] || [ "$rc" -eq 2 ] || [ "$rc" -ne 0 ]; then
                echo "KILLSWITCH_ACTIVE: write command '{cmd_name}' blocked (rc=$rc)"
                log "KILLSWITCH_BLOCKED: {cmd_name} rc=$rc"
                return
            fi'''

content = re.sub(pattern, replacement, content)

with open(fpath, 'w') as f:
    f.write(content)
print("  DONE: oc-dispatch.sh patched")
PYEOF
fi

echo ""
echo "=== Builder VPS patching complete ==="

# Verify
echo ""
echo "--- Verification ---"
for f in "$TOOLS_DIR/objective-autopilot.sh" "$TOOLS_DIR/cross-agent-smoke.sh" "$TOOLS_DIR/agent-exercise.sh" "$BIN_DIR/oc-dispatch.sh"; do
  count=$(grep -c 'killswitch.js guard' "$f" 2>/dev/null || echo 0)
  old_count=$(grep -c 'killswitch.js status' "$f" 2>/dev/null || echo 0)
  echo "  $(basename $f): guard=$count, status=$old_count"
done
