#!/usr/bin/env python3
"""Surgical patch for objective-autopilot.sh — Port #18 wiring"""
import sys

AP = "/home/openclaw2/.openclaw/tools/objective-autopilot.sh"

with open(AP, 'r') as f:
    lines = f.readlines()

original_count = len(lines)
print(f"Original: {original_count} lines")

# Verify we have the right file
assert 'AUTOPILOT_START' in lines[85], f"Line 86 mismatch: {lines[85].strip()}"
assert original_count == 848, f"Expected 848 lines, got {original_count}"

# --- 1. Kill switch guard after line 86 (index 85) ---
ks_guard = '''
# --- Kill Switch Guard (Port #18) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"
if node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then
  :  # kill switch is OFF, continue
else
  log "KILLSWITCH_ACTIVE: aborting autopilot run"
  if [ -f "$TOOLS_DIR/state-lib.sh" ]; then
    . "$TOOLS_DIR/state-lib.sh"
    state_emit_event "KILLSWITCH_BLOCKED" '{"entrypoint":"objective-autopilot"}'
  fi
  exit 0
fi
# --- End Kill Switch Guard ---
'''
ks_lines = [l + '\n' for l in ks_guard.strip().split('\n')]
ks_lines.insert(0, '\n')  # blank line before
ks_lines.append('\n')  # blank line after

# Insert after line 86 (index 85)
insert_pos_ks = 86
lines[insert_pos_ks:insert_pos_ks] = ks_lines
ks_added = len(ks_lines)
print(f"Kill switch guard: +{ks_added} lines after line 86")

# --- 2. Quarantine filter in pick_agent_for_role ---
# The python3 -c " line in pick_agent_for_role was at original line 178
# After KS insertion it's at 178 + ks_added
target_line_idx = 177 + ks_added  # 0-indexed for original line 178

# Verify
assert "python3 -c" in lines[target_line_idx], f"Line {target_line_idx+1} mismatch: {lines[target_line_idx].strip()}"
# Also verify we're in the right function (candidates line should be nearby)
assert "candidates = " in lines[target_line_idx + 4], f"Not in pick_agent_for_role context"

q_filter = '''  # --- Quarantine filter (Port #18) ---
  local filtered=""
  for agent in $candidates; do
    if node "$RUNTIME_BIN/quarantine_agent.js" list 2>/dev/null | grep -qw "$agent"; then
      log "QUARANTINE_SKIP: agent=$agent role=$role"
      continue
    fi
    filtered="$filtered $agent"
  done
  filtered=$(echo "$filtered" | xargs)
  if [ -z "$filtered" ]; then
    log "QUARANTINE_BLOCKED: all candidates quarantined for role=$role"
    echo ""
    return 1
  fi
  candidates="$filtered"
  # --- End quarantine filter ---
'''
q_lines = [l + '\n' for l in q_filter.strip().split('\n')]
q_lines.append('\n')  # blank line after

lines[target_line_idx:target_line_idx] = q_lines
q_added = len(q_lines)
print(f"Quarantine filter: +{q_added} lines before python3 scoring in pick_agent_for_role")

# --- 3. Spend evaluate + ops-pulse before DRY_RUN exit block ---
# Original line "if $DRY_RUN; then" was at 841 (0-indexed 840)
# After insertions: 840 + ks_added + q_added
target_dryrun_idx = 840 + ks_added + q_added

# Verify
assert '$DRY_RUN' in lines[target_dryrun_idx], f"DRY_RUN line mismatch at {target_dryrun_idx+1}: {lines[target_dryrun_idx].strip()}"

sa_block = '''# --- Spend + Artifact (Port #18) ---
node "$RUNTIME_BIN/spend_alert.js" evaluate 2>/dev/null || true
node "$RUNTIME_BIN/canonical_artifact.js" ops-pulse \\
  "{\\"objectives_scanned\\":$OBJECTIVES_SCANNED,\\"assigned\\":$ASSIGNED_COUNT,\\"stuck\\":$STUCK_COUNT}" \\
  2>/dev/null || true
# --- End Spend + Artifact ---
'''
sa_lines = [l + '\n' for l in sa_block.strip().split('\n')]
sa_lines.append('\n')

lines[target_dryrun_idx:target_dryrun_idx] = sa_lines
sa_added = len(sa_lines)
print(f"Spend+artifact: +{sa_added} lines before DRY_RUN block")

# Write back
with open(AP, 'w') as f:
    f.writelines(lines)

final_count = len(lines)
print(f"Final: {final_count} lines (was {original_count}, added {final_count - original_count})")
print("SUCCESS: objective-autopilot.sh patched")
