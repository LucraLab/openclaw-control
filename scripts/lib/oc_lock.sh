#!/usr/bin/env bash
# oc_lock.sh — Objective locking for Delivery OS
#
# Source this file from any Delivery OS shell script:
#   source "$(dirname "$0")/lib/oc_lock.sh"
#
# Functions:
#   lock_acquire "$OBJ_ID"       — acquire lock, fail closed if held
#   lock_release "$OBJ_ID"       — release lock if owned by this process
#   lock_is_stale "$LOCK_DIR"    — returns 0 if lock is stale
#   lock_recover_stale "$LOCK_DIR" — move stale lock aside, emit event
#
# Lock primitive: mkdir (atomic on POSIX)
# Lock path:      $OC_AGENT_ROOT/objectives/${OBJ_ID}.lock.d/
# Metadata:       $OC_AGENT_ROOT/objectives/${OBJ_ID}.lock.d/meta.json
#
# Requires: OC_AGENT_ROOT set, oc_events.sh sourced (for emit_event)
#

# Default lock TTL in seconds (2 hours)
OC_LOCK_TTL="${OC_LOCK_TTL:-7200}"

# Internal: compute lock dir path
_oc_lock_dir() {
  local obj_id="$1"
  echo "${OC_AGENT_ROOT}/objectives/${obj_id}.lock.d"
}

# Write lock metadata into the lock dir.
# Called immediately after mkdir succeeds.
_oc_lock_write_meta() {
  local lock_dir="$1"
  local obj_id="$2"
  local meta_file="${lock_dir}/meta.json"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local sha
  sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  # Sanitize command line: remove env vars that might contain secrets
  local cmd_line
  cmd_line=$(echo "$0 $*" | sed -E "s/(KEY|TOKEN|SECRET|PASS)[^ ]*/[REDACTED]/gi" | head -c 200)
  python3 -c "
import json, os, stat
meta = {
    'obj_id': '${obj_id}',
    'agent_id': '${OC_AGENT_ID:-unknown}',
    'pid': ${$},
    'hostname': '$(hostname -s 2>/dev/null || echo unknown)',
    'start_ts_utc': '${ts}',
    'commit_sha': '${sha}',
    'command': '''${cmd_line}'''
}
tmp = '${meta_file}.tmp'
with open(tmp, 'w') as f:
    json.dump(meta, f, indent=2)
os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
os.rename(tmp, '${meta_file}')
" 2>/dev/null
}

# Read a field from lock metadata. Returns empty string on failure.
_oc_lock_read_field() {
  local meta_file="$1"
  local field="$2"
  python3 -c "
import json, sys
try:
    with open('${meta_file}') as f:
        m = json.load(f)
    print(m.get('${field}', ''))
except:
    print('')
" 2>/dev/null
}

# Check if a lock is stale.
# Returns 0 (stale) or 1 (not stale / cannot determine).
#
# Stale conditions (any one):
#   1. PID not running on this host
#   2. Lock age exceeds TTL
#   3. Metadata missing/corrupt AND TTL exceeded
#
# If metadata is corrupt and TTL NOT exceeded → not provably stale (fail closed).
lock_is_stale() {
  local lock_dir="$1"
  local meta_file="${lock_dir}/meta.json"

  # Check metadata exists and is readable
  if [ ! -f "$meta_file" ]; then
    # No metadata — check lock dir age via stat
    local dir_age
    dir_age=$(_oc_lock_age_seconds "$lock_dir")
    if [ "$dir_age" -ge "$OC_LOCK_TTL" ] 2>/dev/null; then
      return 0  # stale by TTL (no metadata, old dir)
    fi
    return 1  # corrupt/missing metadata, TTL not exceeded → fail closed
  fi

  # Read PID and timestamp from metadata
  local lock_pid
  lock_pid=$(_oc_lock_read_field "$meta_file" "pid")
  local lock_host
  lock_host=$(_oc_lock_read_field "$meta_file" "hostname")
  local lock_ts
  lock_ts=$(_oc_lock_read_field "$meta_file" "start_ts_utc")
  local this_host
  this_host=$(hostname -s 2>/dev/null || echo unknown)

  # Check PID (only meaningful on same host)
  if [ -n "$lock_pid" ] && [ "$lock_host" = "$this_host" ]; then
    if ! kill -0 "$lock_pid" 2>/dev/null; then
      return 0  # PID not running → stale
    fi
  fi

  # Check TTL
  if [ -n "$lock_ts" ]; then
    local lock_epoch
    lock_epoch=$(date -d "$lock_ts" +%s 2>/dev/null || echo "0")
    local now_epoch
    now_epoch=$(date -u +%s)
    local age=$(( now_epoch - lock_epoch ))
    if [ "$age" -ge "$OC_LOCK_TTL" ]; then
      return 0  # stale by TTL
    fi
  fi

  return 1  # lock is NOT stale
}

# Get age of a directory in seconds (via stat mtime).
_oc_lock_age_seconds() {
  local dir="$1"
  local mtime
  mtime=$(stat -c %Y "$dir" 2>/dev/null || echo "0")
  local now
  now=$(date -u +%s)
  echo $(( now - mtime ))
}

# Recover a stale lock: move aside and emit event.
lock_recover_stale() {
  local lock_dir="$1"
  local ts
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  local stale_path="${lock_dir%.lock.d}.stale.${ts}"

  mv "$lock_dir" "$stale_path" 2>/dev/null || {
    echo "ERROR: Failed to move stale lock $lock_dir -> $stale_path" >&2
    return 1
  }

  if type emit_event >/dev/null 2>&1; then
    emit_event "LOCK_STALE_RECOVERED" "stale_path=${stale_path##*/}"
  fi
  return 0
}

# Acquire lock for an objective.
# Returns 0 on success, 1 on blocked/failure.
#
# On success: lock dir created with metadata.
# On blocked: emits LOCK_BLOCKED and exits 1.
# On stale:   recovers stale lock, then acquires.
lock_acquire() {
  local obj_id="$1"
  local lock_dir
  lock_dir=$(_oc_lock_dir "$obj_id")

  # Ensure parent directory exists
  mkdir -p "$(dirname "$lock_dir")" 2>/dev/null

  # Attempt atomic mkdir
  if mkdir "$lock_dir" 2>/dev/null; then
    # Lock acquired — write metadata
    _oc_lock_write_meta "$lock_dir" "$obj_id"
    if type emit_event >/dev/null 2>&1; then
      emit_event "LOCK_ACQUIRED"
    fi
    return 0
  fi

  # Lock dir already exists — check if stale
  if [ -d "$lock_dir" ]; then
    if lock_is_stale "$lock_dir"; then
      # Recover stale lock
      lock_recover_stale "$lock_dir" || return 1
      # Retry acquisition
      if mkdir "$lock_dir" 2>/dev/null; then
        _oc_lock_write_meta "$lock_dir" "$obj_id"
        if type emit_event >/dev/null 2>&1; then
          emit_event "LOCK_ACQUIRED"
        fi
        return 0
      fi
    fi

    # Lock exists and is NOT stale — blocked
    local holder_pid=""
    local holder_agent=""
    local meta_file="${lock_dir}/meta.json"
    if [ -f "$meta_file" ]; then
      holder_pid=$(_oc_lock_read_field "$meta_file" "pid")
      holder_agent=$(_oc_lock_read_field "$meta_file" "agent_id")
    fi
    echo "BLOCKED: Objective $obj_id is locked by pid=${holder_pid:-?} agent=${holder_agent:-?}" >&2
    echo "  Lock path: $lock_dir" >&2
    echo "  If you believe this is stale, wait for TTL (${OC_LOCK_TTL}s) or remove manually." >&2
    if type emit_event >/dev/null 2>&1; then
      emit_event "LOCK_BLOCKED" "holder_pid=${holder_pid:-unknown}" "holder_agent=${holder_agent:-unknown}"
    fi
    return 1
  fi

  # Unexpected state (e.g., lock_dir is a file not a dir)
  echo "ERROR: Lock path exists but is not a directory: $lock_dir" >&2
  return 1
}

# Release lock for an objective.
# Only releases if this process owns the lock (PID check).
# Returns 0 on success, 1 on failure.
lock_release() {
  local obj_id="$1"
  local lock_dir
  lock_dir=$(_oc_lock_dir "$obj_id")

  if [ ! -d "$lock_dir" ]; then
    return 0  # No lock to release
  fi

  # Verify ownership: only release if our PID matches
  local meta_file="${lock_dir}/meta.json"
  if [ -f "$meta_file" ]; then
    local lock_pid
    lock_pid=$(_oc_lock_read_field "$meta_file" "pid")
    if [ -n "$lock_pid" ] && [ "$lock_pid" != "$$" ]; then
      echo "WARN: Lock owned by pid=$lock_pid, not releasing (we are $$)" >&2
      return 1
    fi
  fi

  # Remove lock directory
  rm -rf "$lock_dir" 2>/dev/null || {
    echo "ERROR: Failed to remove lock dir: $lock_dir" >&2
    return 1
  }

  if type emit_event >/dev/null 2>&1; then
    emit_event "LOCK_RELEASED"
  fi
  return 0
}

# Install trap to release lock on exit.
# Usage: lock_install_trap "$OBJ_ID"
lock_install_trap() {
  local obj_id="$1"
  # shellcheck disable=SC2064
  trap "lock_release '$obj_id'" EXIT INT TERM
}
