#!/usr/bin/env bash
# oc_resource_lock.sh — Cross-resource locking for Delivery OS (Port #9)
#
# Source this file from any Delivery OS shell script:
#   source "$(dirname "$0")/lib/oc_resource_lock.sh"
#
# Functions:
#   resource_lock_acquire "<lock_id>" [ttl_seconds]
#   resource_lock_release "<lock_id>"
#   resource_lock_is_stale "<lock_dir>"
#   resource_lock_recover_stale "<lock_dir>"
#
# Lock primitive: mkdir (POSIX atomic), same as oc_lock.sh
# Lock path:      $DELIVERY_OS_HOME/_locks/<slug>.lock.d/
# Metadata:       $DELIVERY_OS_HOME/_locks/<slug>.lock.d/meta.json
#
# Lock ID formats:
#   repo_branch:<owner>/<name>@<branch>
#   repo:<owner>/<name>
#
# Shared across all agents (NOT agent-scoped).
# Requires: DELIVERY_OS_HOME set, oc_events.sh sourced (for emit_event)
#

# Default resource lock TTL in seconds (2 hours)
OC_RESOURCE_LOCK_TTL="${OC_RESOURCE_LOCK_TTL:-7200}"

# Slugify a lock ID for safe filesystem path.
# Replaces : → __, / → _, @ → _at_
_resource_lock_slug() {
  local lock_id="$1"
  echo "$lock_id" | sed 's/:/__/g; s/\//_/g; s/@/_at_/g'
}

# Compute lock directory path from lock ID.
_resource_lock_dir() {
  local lock_id="$1"
  local slug
  slug=$(_resource_lock_slug "$lock_id")
  echo "${DELIVERY_OS_HOME}/_locks/${slug}.lock.d"
}

# Write lock metadata.
_resource_lock_write_meta() {
  local lock_dir="$1"
  local lock_id="$2"
  local meta_file="${lock_dir}/meta.json"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local sha
  sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  python3 -c "
import json, os, stat
meta = {
    'lock_id': '''${lock_id}''',
    'agent_id': '${OC_AGENT_ID:-unknown}',
    'pid': ${$},
    'hostname': '$(hostname -s 2>/dev/null || echo unknown)',
    'start_ts_utc': '${ts}',
    'obj_id': '${OBJ_ID:-unknown}',
    'repo_slug': '${REPO:-unknown}',
    'branch': '${BRANCH_NAME:-unknown}',
    'commit_sha': '${sha}'
}
tmp = '${meta_file}.tmp'
with open(tmp, 'w') as f:
    json.dump(meta, f, indent=2)
os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
os.rename(tmp, '${meta_file}')
" 2>/dev/null
}

# Read a field from lock metadata.
_resource_lock_read_field() {
  local meta_file="$1"
  local field="$2"
  python3 -c "
import json
try:
    with open('${meta_file}') as f:
        m = json.load(f)
    print(m.get('${field}', ''))
except:
    print('')
" 2>/dev/null
}

# Get age of a directory in seconds.
_resource_lock_age_seconds() {
  local dir="$1"
  local mtime
  mtime=$(stat -c %Y "$dir" 2>/dev/null || echo "0")
  local now
  now=$(date -u +%s)
  echo $(( now - mtime ))
}

# Check if a resource lock is stale.
# Returns 0 (stale) or 1 (not stale).
# Same logic as oc_lock.sh: PID check, TTL, fail-closed on corrupt.
resource_lock_is_stale() {
  local lock_dir="$1"
  local ttl="${2:-$OC_RESOURCE_LOCK_TTL}"
  local meta_file="${lock_dir}/meta.json"

  if [ ! -f "$meta_file" ]; then
    local dir_age
    dir_age=$(_resource_lock_age_seconds "$lock_dir")
    if [ "$dir_age" -ge "$ttl" ] 2>/dev/null; then
      return 0
    fi
    return 1  # fail closed
  fi

  local lock_pid
  lock_pid=$(_resource_lock_read_field "$meta_file" "pid")
  local lock_host
  lock_host=$(_resource_lock_read_field "$meta_file" "hostname")
  local lock_ts
  lock_ts=$(_resource_lock_read_field "$meta_file" "start_ts_utc")
  local this_host
  this_host=$(hostname -s 2>/dev/null || echo unknown)

  # PID check (same host only)
  if [ -n "$lock_pid" ] && [ "$lock_host" = "$this_host" ]; then
    if ! kill -0 "$lock_pid" 2>/dev/null; then
      return 0
    fi
  fi

  # TTL check
  if [ -n "$lock_ts" ]; then
    local lock_epoch
    lock_epoch=$(date -d "$lock_ts" +%s 2>/dev/null || echo "0")
    local now_epoch
    now_epoch=$(date -u +%s)
    local age=$(( now_epoch - lock_epoch ))
    if [ "$age" -ge "$ttl" ]; then
      return 0
    fi
  fi

  return 1
}

# Recover a stale resource lock.
resource_lock_recover_stale() {
  local lock_dir="$1"
  local ts
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  local stale_path="${lock_dir%.lock.d}.stale.${ts}"

  mv "$lock_dir" "$stale_path" 2>/dev/null || {
    echo "ERROR: Failed to move stale resource lock $lock_dir -> $stale_path" >&2
    return 1
  }

  if type emit_event >/dev/null 2>&1; then
    emit_event "ARBITRATION_STALE_RECOVERED" "stale_path=${stale_path##*/}" "lock_id=${1##*/}"
  fi
  return 0
}

# Acquire a resource lock.
# Returns 0 on success, 1 on blocked/failure.
resource_lock_acquire() {
  local lock_id="$1"
  local ttl="${2:-$OC_RESOURCE_LOCK_TTL}"
  local lock_dir
  lock_dir=$(_resource_lock_dir "$lock_id")

  # Validate lock_id is not empty
  if [ -z "$lock_id" ]; then
    echo "ERROR: Empty resource lock ID" >&2
    return 1
  fi

  mkdir -p "$(dirname "$lock_dir")" 2>/dev/null

  # Attempt atomic mkdir
  if mkdir "$lock_dir" 2>/dev/null; then
    _resource_lock_write_meta "$lock_dir" "$lock_id"
    if type emit_event >/dev/null 2>&1; then
      emit_event "RESOURCE_LOCK_ACQUIRED" "lock_id=$lock_id"
    fi
    return 0
  fi

  # Lock exists — check stale
  if [ -d "$lock_dir" ]; then
    if resource_lock_is_stale "$lock_dir" "$ttl"; then
      resource_lock_recover_stale "$lock_dir" || return 1
      if mkdir "$lock_dir" 2>/dev/null; then
        _resource_lock_write_meta "$lock_dir" "$lock_id"
        if type emit_event >/dev/null 2>&1; then
          emit_event "RESOURCE_LOCK_ACQUIRED" "lock_id=$lock_id"
        fi
        return 0
      fi
    fi

    # Blocked
    local holder_pid=""
    local holder_agent=""
    local holder_obj=""
    local meta_file="${lock_dir}/meta.json"
    if [ -f "$meta_file" ]; then
      holder_pid=$(_resource_lock_read_field "$meta_file" "pid")
      holder_agent=$(_resource_lock_read_field "$meta_file" "agent_id")
      holder_obj=$(_resource_lock_read_field "$meta_file" "obj_id")
    fi
    echo "BLOCKED: Resource $lock_id held by pid=${holder_pid:-?} agent=${holder_agent:-?} obj=${holder_obj:-?}" >&2
    if type emit_event >/dev/null 2>&1; then
      emit_event "ARBITRATION_BLOCKED" "lock_id=$lock_id" "holder_pid=${holder_pid:-unknown}" "holder_agent=${holder_agent:-unknown}" "holder_obj=${holder_obj:-unknown}"
    fi
    return 1
  fi

  echo "ERROR: Resource lock path exists but is not a directory: $lock_dir" >&2
  return 1
}

# Release a resource lock.
# PID ownership check before release.
resource_lock_release() {
  local lock_id="$1"
  local lock_dir
  lock_dir=$(_resource_lock_dir "$lock_id")

  if [ ! -d "$lock_dir" ]; then
    return 0
  fi

  local meta_file="${lock_dir}/meta.json"
  if [ -f "$meta_file" ]; then
    local lock_pid
    lock_pid=$(_resource_lock_read_field "$meta_file" "pid")
    if [ -n "$lock_pid" ] && [ "$lock_pid" != "$$" ]; then
      echo "WARN: Resource lock owned by pid=$lock_pid, not releasing (we are $$)" >&2
      return 1
    fi
  fi

  rm -rf "$lock_dir" 2>/dev/null || {
    echo "ERROR: Failed to remove resource lock: $lock_dir" >&2
    return 1
  }

  if type emit_event >/dev/null 2>&1; then
    emit_event "ARBITRATION_RELEASED" "lock_id=$lock_id"
  fi
  return 0
}
