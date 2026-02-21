#!/bin/bash
# selftest_allowlist.sh — Deterministic self-test for agent allowlist
# Location: ops/dude/selftest_allowlist.sh
#
# Runs validator against known good/bad agents for each builder.
# Asserts exit codes: 0 (allowed), 1 (refused), 2 (config error).
# No external dependencies. No network calls.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VALIDATOR="$SCRIPT_DIR/agent-allowlist-check.py"
TOTAL=0
PASS=0
FAIL=0

assert_exit() {
  local name="$1" expected="$2"
  shift 2
  TOTAL=$((TOTAL + 1))

  local output exit_code
  output=$("$@" 2>&1) || true
  # Re-run to capture exact exit code
  "$@" > /dev/null 2>&1
  exit_code=$?

  if [ "$exit_code" -eq "$expected" ]; then
    PASS=$((PASS + 1))
    echo "  [PASS] $name (exit=$exit_code)"
  else
    FAIL=$((FAIL + 1))
    echo "  [FAIL] $name (expected exit=$expected, got exit=$exit_code)"
    echo "         output: $output"
  fi
}

echo "=== Dude Allowlist Self-Test ==="
echo "Validator: $VALIDATOR"
echo ""

# Verify validator exists
if [ ! -f "$VALIDATOR" ]; then
  echo "FATAL: validator not found at $VALIDATOR"
  exit 2
fi

echo "--- Builder1 ---"
assert_exit "builder1/main ALLOWED"        0 python3 "$VALIDATOR" builder1 main
assert_exit "builder1/developer ALLOWED"    0 python3 "$VALIDATOR" builder1 developer
assert_exit "builder1/architect ALLOWED"    0 python3 "$VALIDATOR" builder1 architect
assert_exit "builder1/bogus REFUSED"        1 python3 "$VALIDATOR" builder1 bogus-agent
assert_exit "builder1/empty REFUSED"        1 python3 "$VALIDATOR" builder1 ""

echo ""
echo "--- Builder2 ---"
assert_exit "builder2/main ALLOWED"         0 python3 "$VALIDATOR" builder2 main
assert_exit "builder2/sales ALLOWED"        0 python3 "$VALIDATOR" builder2 sales
assert_exit "builder2/ops-2 ALLOWED"        0 python3 "$VALIDATOR" builder2 ops-2
assert_exit "builder2/bogus REFUSED"        1 python3 "$VALIDATOR" builder2 bogus-agent
assert_exit "builder2/developer REFUSED"    1 python3 "$VALIDATOR" builder2 developer

echo ""
echo "--- Error cases ---"
assert_exit "unknown builder REFUSED"       1 python3 "$VALIDATOR" builder99 main
assert_exit "bad usage (missing args)"      2 python3 "$VALIDATOR" builder1

echo ""
echo "--- Config error (missing file) ---"
assert_exit "missing allowlist file"        2 env AGENT_ALLOWLIST_FILE=/nonexistent/file.json python3 "$VALIDATOR" builder1 main

echo ""
echo "=== SUMMARY ==="
echo "Total: $TOTAL  Pass: $PASS  Fail: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SELFTEST_RESULT: ALL_PASS"
  exit 0
else
  echo "SELFTEST_RESULT: ${FAIL}_FAILURES"
  exit 1
fi
