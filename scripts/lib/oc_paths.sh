#!/usr/bin/env bash
# oc_paths.sh — Path validation and safe path helpers for Delivery OS
#
# Source this file from any Delivery OS shell script:
#   source "$(dirname "$0")/lib/oc_paths.sh"
#
# Functions:
#   oc_validate_agent_id <id>   — returns 0 if valid (builder|executor|auditor)
#   oc_agent_root [<id>]        — prints agent-scoped root, fails if invalid
#   oc_validate_obj_id <id>     — returns 0 if valid objective ID
#   oc_safe_path <root> <rel>   — prints resolved path, fails if traversal
#   oc_validate_repo <repo> [allowlist] — returns 0 if repo in allowlist
#

# Validate OC_AGENT_ID value
# Returns 0 if valid, 1 if not
oc_validate_agent_id() {
  local agent_id="${1:-}"
  case "$agent_id" in
    builder|executor|auditor) return 0 ;;
    *) return 1 ;;
  esac
}

# Resolve agent-scoped root directory
# Uses $1 or falls back to $OC_AGENT_ID
# Prints path to stdout; returns 1 on invalid agent
oc_agent_root() {
  local agent_id="${1:-${OC_AGENT_ID:-}}"
  if ! oc_validate_agent_id "$agent_id"; then
    echo "ERROR: Invalid agent ID: '${agent_id}'" >&2
    return 1
  fi
  echo "${DELIVERY_OS_HOME:-$HOME/.openclaw}/agents/${agent_id}"
}

# Validate objective ID
# Pattern: obj-<slug>-<digits> with no traversal characters
# Returns 0 if valid, 1 if not
oc_validate_obj_id() {
  local obj_id="${1:-}"
  [ -z "$obj_id" ] && return 1
  # Reject path separators, traversal, null bytes
  echo "$obj_id" | grep -qE '(\.\.|/|\\|[[:cntrl:]])' && return 1
  # Must match: obj- followed by alphanumeric, hyphens, underscores
  echo "$obj_id" | grep -qE '^obj-[a-zA-Z0-9_-]+$' && return 0
  return 1
}

# Safe path join with traversal protection
# Usage: oc_safe_path <root> <relative>
# Prints resolved path; returns 1 if path escapes root
oc_safe_path() {
  local root="$1"
  local rel="$2"

  # Reject obvious traversal patterns before resolving
  if echo "$rel" | grep -qE '(^|/)\.\.(/|$)'; then
    echo "ERROR: Path traversal detected in: $rel" >&2
    return 1
  fi

  local candidate="${root}/${rel}"

  # Resolve symlinks and relative components
  local resolved
  resolved=$(readlink -m "$candidate" 2>/dev/null || echo "$candidate")
  local root_resolved
  root_resolved=$(readlink -m "$root" 2>/dev/null || echo "$root")

  # Ensure resolved path is under root
  case "$resolved" in
    "${root_resolved}"|"${root_resolved}"/*) echo "$resolved"; return 0 ;;
    *) echo "ERROR: Path escapes root: $resolved (root: $root_resolved)" >&2; return 1 ;;
  esac
}

# Validate repository name against allowlist
# Usage: oc_validate_repo <repo> [space-separated-allowlist]
# Returns 0 if allowed, 1 if not
oc_validate_repo() {
  local repo="$1"
  local allowed="${2:-LucraLab/openclaw-control}"
  for r in $allowed; do
    [ "$repo" = "$r" ] && return 0
  done
  return 1
}
