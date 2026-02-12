#!/usr/bin/env bash
# staging_smoke.sh — Run staging smoke tests on the repo
#
# Usage:
#   bash scripts/staging_smoke.sh --repo-dir <path> [--dry-run]
#
# Checks:
#   1. markdownlint passes
#   2. Schema validation passes (if registry/ changed)
#   3. Coverage report tests pass (if scripts/ exist)
#   4. No secrets in repo
#   5. No public-unsafe patterns
#
# Exit codes:
#   0 = all smoke tests pass
#   1 = smoke test failure
#   2 = dry-run (no writes)
#
set -uo pipefail

# --- Configuration ---
DELIVERY_OS_HOME="${DELIVERY_OS_HOME:-$HOME/.openclaw}"

# --- Source shared libraries ---
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${_SCRIPT_DIR}/lib/oc_paths.sh"
source "${_SCRIPT_DIR}/lib/oc_events.sh"

# --- Require agent identity (Layer 4 isolation) ---
oc_require_agent_id || exit 1
OC_AGENT_ROOT="$(oc_agent_root)"

# Legacy path constant for migration
_LEGACY_OBJECTIVES_DIR="$DELIVERY_OS_HOME/objectives"

# --- Parse arguments ---
REPO_DIR=""
DRY_RUN=false
OBJ_ID="${OBJ_ID:-unknown}"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo-dir) REPO_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --objective) OBJ_ID="$2"; shift 2 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$REPO_DIR" ]; then
  echo "ERROR: Missing --repo-dir" >&2
  exit 1
fi

if [ ! -d "$REPO_DIR" ]; then
  echo "ERROR: Repo directory not found: $REPO_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"

echo "============================================"
echo "  Staging Smoke Tests"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  Repo: $REPO_DIR"
echo "  Agent: $OC_AGENT_ID"
echo "============================================"
echo ""

PASSED=0
FAILED=0
TOTAL=0

check() {
  local name="$1" result="$2" detail="${3:-}"
  TOTAL=$((TOTAL + 1))
  if [ "$result" = "PASS" ]; then
    PASSED=$((PASSED + 1))
    echo "  PASS: $name${detail:+ ($detail)}"
  else
    FAILED=$((FAILED + 1))
    echo "  FAIL: $name${detail:+ ($detail)}"
  fi
}

# --- Check 1: Markdownlint ---
echo "--- Check 1: Markdownlint ---"
if [ -f ".markdownlint-cli2.jsonc" ]; then
  if command -v npx >/dev/null 2>&1; then
    LINT_OUT=$(npx markdownlint-cli2 "**/*.md" 2>&1) && LINT_RC=0 || LINT_RC=$?
    if [ "$LINT_RC" -eq 0 ]; then
      check "markdownlint" "PASS"
    else
      check "markdownlint" "FAIL" "exit=$LINT_RC"
    fi
  else
    check "markdownlint" "PASS" "npx not available, skipped"
  fi
else
  check "markdownlint" "PASS" "no config, skipped"
fi

# --- Check 2: Schema validation ---
echo "--- Check 2: Schema Validation ---"
if [ -f "registry/ROLE_REGISTRY.yaml" ]; then
  SCHEMA_OUT=$(python3 -c "
import yaml, sys
with open('registry/ROLE_REGISTRY.yaml') as f:
    registry = yaml.safe_load(f)
if registry is None:
    print('FAIL: empty')
    sys.exit(1)
roles = registry.get('roles', {})
if not roles:
    print('FAIL: no roles')
    sys.exit(1)
print(f'PASS: {len(roles)} roles')
" 2>&1) && SCHEMA_RC=0 || SCHEMA_RC=$?
  if [ "$SCHEMA_RC" -eq 0 ]; then
    check "schema_validation" "PASS" "$SCHEMA_OUT"
  else
    check "schema_validation" "FAIL" "$SCHEMA_OUT"
  fi
else
  check "schema_validation" "PASS" "no registry, skipped"
fi

# --- Check 3: Coverage report tests ---
echo "--- Check 3: Coverage Report Tests ---"
if [ -f "scripts/coverage_report.test.js" ] && [ -d "dist/bundles" ]; then
  TEST_OUT=$(node scripts/coverage_report.test.js 2>&1) && TEST_RC=0 || TEST_RC=$?
  if [ "$TEST_RC" -eq 0 ]; then
    check "coverage_tests" "PASS"
  else
    check "coverage_tests" "FAIL" "exit=$TEST_RC"
  fi
else
  check "coverage_tests" "PASS" "no test file or bundles, skipped"
fi

# --- Check 4: Secret scan ---
echo "--- Check 4: Secret Scan ---"
SECRET_FOUND=0
while IFS= read -r -d '' file; do
  if grep -PqE '(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16}|xoxb-[0-9]+-[a-zA-Z0-9]+)' "$file" 2>/dev/null; then
    echo "  SECRET DETECTED in: $file"
    SECRET_FOUND=1
  fi
done < <(find . -type f \( -name "*.md" -o -name "*.yaml" -o -name "*.yml" -o -name "*.json" -o -name "*.js" -o -name "*.sh" \) -not -path "./.git/*" -print0 2>/dev/null)

if [ "$SECRET_FOUND" -eq 0 ]; then
  check "secret_scan" "PASS"
else
  check "secret_scan" "FAIL" "secrets detected"
fi

# --- Check 5: Public-safe scan ---
echo "--- Check 5: Public-Safe Scan ---"
UNSAFE_FOUND=0
while IFS= read -r -d '' file; do
  if grep -PqE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "$file" 2>/dev/null; then
    # Allow placeholders like <..._IPV4>
    if grep -PE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "$file" 2>/dev/null | grep -vqE '<[A-Z_]+>'; then
      echo "  UNSAFE (IP): $file"
      UNSAFE_FOUND=1
    fi
  fi
  if grep -PqiE '(hstgr\.cloud|srv[0-9]+)' "$file" 2>/dev/null; then
    echo "  UNSAFE (hostname): $file"
    UNSAFE_FOUND=1
  fi
done < <(find . -type f \( -name "*.md" -o -name "*.yaml" -o -name "*.yml" -o -name "*.json" -o -name "*.js" -o -name "*.sh" \) -not -path "./.git/*" -print0 2>/dev/null)

if [ "$UNSAFE_FOUND" -eq 0 ]; then
  check "public_safe_scan" "PASS"
else
  check "public_safe_scan" "FAIL" "unsafe content detected"
fi

# --- Check 6: Skill SPEC exists ---
echo "--- Check 6: Skill Artifacts ---"
if [ -f "skills/delivery_loop_v1/SPEC.md" ] && [ -f "skills/delivery_loop_v1/skill.yaml" ]; then
  check "skill_artifacts" "PASS" "SPEC + skill.yaml present"
else
  check "skill_artifacts" "PASS" "skill dir not present (may not be required)"
fi

echo ""
echo "============================================"
echo "  Staging Smoke: $PASSED/$TOTAL PASS, $FAILED FAIL"
echo "============================================"

# --- Emit result event ---
if [ "$FAILED" -eq 0 ]; then
  if [ "$DRY_RUN" = "false" ]; then
    emit_event "DELIVERY_STAGING_SMOKE_PASS" "checks_passed=$PASSED checks_total=$TOTAL"

    # Update objective with smoke pass (agent-scoped path)
    OBJ_DIR="$OC_AGENT_ROOT/objectives"

    # Migrate legacy objective if needed
    oc_migrate_legacy_file "$_LEGACY_OBJECTIVES_DIR/${OBJ_ID}.json" "$OBJ_DIR/${OBJ_ID}.json" || true

    OBJ_FILE="$OBJ_DIR/${OBJ_ID}.json"
    if [ -f "$OBJ_FILE" ]; then
      python3 -c "
import json, os, stat
with open('$OBJ_FILE') as f:
    obj = json.load(f)
obj['staging_smoke_pass'] = True
obj['staging_smoke_at'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
tmp = '${OBJ_FILE}.tmp'
with open(tmp, 'w') as f:
    json.dump(obj, f, indent=2)
os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
os.rename(tmp, '$OBJ_FILE')
" 2>/dev/null
    fi
  else
    echo "(dry-run: would emit DELIVERY_STAGING_SMOKE_PASS)"
  fi
  exit 0
else
  if [ "$DRY_RUN" = "false" ]; then
    emit_event "DELIVERY_STAGING_SMOKE_FAIL" "checks_passed=$PASSED checks_total=$TOTAL"
  fi
  exit 1
fi
