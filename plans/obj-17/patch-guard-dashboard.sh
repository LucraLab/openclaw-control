#!/bin/bash
# patch-guard-dashboard.sh — Replace killswitch status blocks with guard semantics
# Run as root on Dashboard VPS
set -uo pipefail

echo "=== Kill Switch Guard Fix — Dashboard VPS ==="
echo ""

# ─────────────────────────────────────────────
# 1. BACKUP
# ─────────────────────────────────────────────
echo "--- Backing up files ---"
DTB="/root/bin/dispatch-to-builder.sh"
NA="/home/openclaw/bootstrap/nightly-audit.sh"

for f in "$DTB" "$NA"; do
  if [ ! -f "$f" ]; then
    echo "ABORT: $f not found"
    exit 1
  fi
  cp -a "$f" "${f}.backup-pre-killswitch-guardfix"
  echo "  Backed up: $f"
done
echo ""

# ─────────────────────────────────────────────
# 2. DISPATCH-TO-BUILDER.SH
# ─────────────────────────────────────────────
echo "--- Patching dispatch-to-builder.sh ---"

if grep -q 'killswitch.js guard' "$DTB"; then
  echo "  SKIP: already using guard"
else
  python3 - "$DTB" << 'PYEOF'
import sys
fpath = sys.argv[1]
with open(fpath, 'r') as f:
    content = f.read()

old_start = '# --- Kill Switch Guard (Port #18) ---'
old_end = '# --- End Kill Switch Guard ---'

si = content.find(old_start)
ei = content.find(old_end)
if si == -1 or ei == -1:
    print("ABORT: markers not found in dispatch-to-builder.sh")
    sys.exit(1)

ei = ei + len(old_end)
if ei < len(content) and content[ei] == '\n':
    ei += 1

new_block = '''# --- Kill Switch Guard (Port #18) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw/_runtime"
node "$RUNTIME_BIN/killswitch.js" guard >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 10 ] || [ "$rc" -eq 2 ]; then
  echo "KILLSWITCH_ACTIVE: dispatch blocked (rc=$rc)"
  exit 0
elif [ "$rc" -ne 0 ]; then
  echo "KILLSWITCH_UNKNOWN: fail-closed (rc=$rc)"
  exit 0
fi
# --- End Kill Switch Guard ---
'''

content = content[:si] + new_block + content[ei:]
with open(fpath, 'w') as f:
    f.write(content)
print("  DONE: dispatch-to-builder.sh patched")
PYEOF
fi

# ─────────────────────────────────────────────
# 3. NIGHTLY-AUDIT.SH
# ─────────────────────────────────────────────
echo "--- Patching nightly-audit.sh ---"

if grep -q 'killswitch.js guard' "$NA"; then
  echo "  SKIP: already using guard"
else
  python3 - "$NA" << 'PYEOF'
import sys
fpath = sys.argv[1]
with open(fpath, 'r') as f:
    content = f.read()

old_start = '# --- Kill Switch Guard (Port #18) ---'
old_end = '# --- End Kill Switch Guard ---'

si = content.find(old_start)
ei = content.find(old_end)
if si == -1 or ei == -1:
    print("ABORT: markers not found in nightly-audit.sh")
    sys.exit(1)

ei = ei + len(old_end)
if ei < len(content) and content[ei] == '\n':
    ei += 1

new_block = '''# --- Kill Switch Guard (Port #18) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw/_runtime"
node "$RUNTIME_BIN/killswitch.js" guard >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 10 ] || [ "$rc" -eq 2 ]; then
  echo "[$TIMESTAMP] KILLSWITCH_ACTIVE: aborting nightly audit (rc=$rc)"
  exit 0
elif [ "$rc" -ne 0 ]; then
  echo "[$TIMESTAMP] KILLSWITCH_UNKNOWN: fail-closed (rc=$rc)"
  exit 0
fi
# --- End Kill Switch Guard ---
'''

content = content[:si] + new_block + content[ei:]
with open(fpath, 'w') as f:
    f.write(content)
print("  DONE: nightly-audit.sh patched")
PYEOF
fi

echo ""
echo "=== Dashboard VPS patching complete ==="

# Verify
echo ""
echo "--- Verification ---"
for f in "$DTB" "$NA"; do
  count=$(grep -c 'killswitch.js guard' "$f" 2>/dev/null || echo 0)
  old_count=$(grep -c 'killswitch.js status' "$f" 2>/dev/null || echo 0)
  echo "  $(basename $f): guard=$count, status=$old_count"
done
