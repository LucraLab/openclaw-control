#!/bin/bash
# provider-sanity-check.sh — Minimal completion test for Builder provider health
# Location: ops/scripts/provider-sanity-check.sh
#
# Usage:
#   bash provider-sanity-check.sh <builder> [agent]
#
# Examples:
#   bash provider-sanity-check.sh builder1
#   bash provider-sanity-check.sh builder2 sales
#   bash provider-sanity-check.sh both
#
# Output markers:
#   PROVIDER_OK           — valid completion returned
#   PROVIDER_FAIL:billing — billing/credits error (route works, provider dead)
#   PROVIDER_FAIL:auth    — authentication error (401)
#   PROVIDER_FAIL:route   — cannot reach gateway at all
#   PROVIDER_FAIL:unknown — unexpected error
#
# Exit codes:
#   0 — all tested builders return PROVIDER_OK
#   1 — at least one PROVIDER_FAIL

set -uo pipefail

BUILDER_TS_IP="100.75.216.57"
B1_PORT=8080
B2_PORT=8082
B1_TOKEN="2b7526a0647a3925a61cb113fe65a38e8bf749435f991276a85c6ab7182d9d6a"
B2_TOKEN="d0ef2036e033134523d2ecb0585902b10acd393962154cac67fe2802d7fc2827"
B1_DEFAULT_AGENT="developer"
B2_DEFAULT_AGENT="sales"

TARGET="${1:-both}"
CUSTOM_AGENT="${2:-}"

FAIL_COUNT=0

check_builder() {
  local name="$1" port="$2" token="$3" agent="$4"

  local output http_code
  output=$(curl -s -w '\n%{http_code}' -m 30 -X POST "http://${BUILDER_TS_IP}:${port}/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${token}" \
    -d "{\"model\":\"openclaw/${agent}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply pong\"}],\"max_tokens\":5}" 2>&1)

  http_code=$(echo "$output" | tail -1)
  local body
  body=$(echo "$output" | sed '$d')

  local status="PROVIDER_FAIL:unknown"

  case "$http_code" in
    200)
      if echo "$body" | grep -q '"choices"'; then
        if echo "$body" | grep -qiE 'billing|rate.limit|credits|balance|models failed'; then
          status="PROVIDER_FAIL:billing"
        else
          status="PROVIDER_OK"
        fi
      else
        status="PROVIDER_FAIL:unknown"
      fi
      ;;
    500)
      if echo "$body" | grep -qiE 'billing|rate.limit|credits|balance|models failed'; then
        status="PROVIDER_FAIL:billing"
      else
        status="PROVIDER_FAIL:unknown"
      fi
      ;;
    401) status="PROVIDER_FAIL:auth" ;;
    000) status="PROVIDER_FAIL:route" ;;
    *)   status="PROVIDER_FAIL:http_${http_code}" ;;
  esac

  echo "${status} ${name} (agent=${agent}, http=${http_code})"

  if [ "$status" != "PROVIDER_OK" ]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

echo "=== Provider Sanity Check ==="

case "$TARGET" in
  builder1|b1)
    check_builder "builder1" "$B1_PORT" "$B1_TOKEN" "${CUSTOM_AGENT:-$B1_DEFAULT_AGENT}"
    ;;
  builder2|b2)
    check_builder "builder2" "$B2_PORT" "$B2_TOKEN" "${CUSTOM_AGENT:-$B2_DEFAULT_AGENT}"
    ;;
  both|all)
    check_builder "builder1" "$B1_PORT" "$B1_TOKEN" "${CUSTOM_AGENT:-$B1_DEFAULT_AGENT}"
    check_builder "builder2" "$B2_PORT" "$B2_TOKEN" "${CUSTOM_AGENT:-$B2_DEFAULT_AGENT}"
    ;;
  *)
    echo "Usage: provider-sanity-check.sh <builder1|builder2|both> [agent]"
    exit 2
    ;;
esac

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "RESULT: ${FAIL_COUNT} PROVIDER_FAIL(s)"
  exit 1
else
  echo "RESULT: ALL PROVIDER_OK"
  exit 0
fi
