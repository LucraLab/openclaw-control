#!/bin/bash
# install_dude_allowlist.sh — Atomic install of allowlist files to /root/bin
# Location: ops/dude/install_dude_allowlist.sh
#
# Installs:
#   agent-allowlist.json → /root/bin/agent-allowlist.json
#   agent-allowlist-check.py → /root/bin/agent-allowlist-check.py
#
# Safety:
#   - Atomic: copies to temp then moves (no partial state)
#   - Fails non-zero if any step fails
#   - Does not print secrets
#   - Idempotent: safe to re-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="/root/bin"

echo "=== Installing Dude Allowlist ==="
echo "Source: $SCRIPT_DIR"
echo "Target: $TARGET_DIR"

# Verify source files exist
for f in agent-allowlist.json agent-allowlist-check.py; do
  if [ ! -f "$SCRIPT_DIR/$f" ]; then
    echo "ERROR: source file missing: $SCRIPT_DIR/$f" >&2
    exit 1
  fi
done

# Verify target directory exists
if [ ! -d "$TARGET_DIR" ]; then
  echo "ERROR: target directory missing: $TARGET_DIR" >&2
  exit 1
fi

# Atomic install: copy to temp, then move
TMP_JSON=$(mktemp "$TARGET_DIR/agent-allowlist.json.XXXXXX")
TMP_PY=$(mktemp "$TARGET_DIR/agent-allowlist-check.py.XXXXXX")

cp "$SCRIPT_DIR/agent-allowlist.json" "$TMP_JSON"
cp "$SCRIPT_DIR/agent-allowlist-check.py" "$TMP_PY"

chmod 644 "$TMP_JSON"
chmod 755 "$TMP_PY"

mv "$TMP_JSON" "$TARGET_DIR/agent-allowlist.json"
mv "$TMP_PY" "$TARGET_DIR/agent-allowlist-check.py"

echo "Installed:"
ls -la "$TARGET_DIR/agent-allowlist.json" "$TARGET_DIR/agent-allowlist-check.py"

# Verify installed files are valid
python3 "$TARGET_DIR/agent-allowlist-check.py" builder1 main > /dev/null 2>&1
VERIFY_RC=$?
if [ "$VERIFY_RC" -ne 0 ]; then
  echo "WARNING: post-install verification failed (exit $VERIFY_RC)" >&2
  exit 1
fi

echo "Verification: OK (builder1/main allowed)"
echo "=== Install Complete ==="
