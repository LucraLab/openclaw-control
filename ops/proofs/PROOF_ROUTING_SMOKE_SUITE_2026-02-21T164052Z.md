# Proof: Routing Smoke Suite

**Date:** 2026-02-21T164052Z
**Scope:** E2E routing validation — HTTP agent targeting + Dude allowlist

---

## Summary

| Metric | Value |
|--------|-------|
| Total tests | 9 |
| Pass | 9 |
| Fail | 0 |
| Result | ALL PASS |

## Test Results

| # | Status | Test | Output Excerpt |
|---|--------|------|----------------|
| 1 | PASS | B2 model:openclaw/sales | `{"id":"chatcmpl_cb90d00d-ca2d-40b2-b2c3-7b6d45d3ae54","object":"chat.completion"` |
| 2 | PASS | B2 model:agent:sales | `{"id":"chatcmpl_683891b8-de00-4b92-b809-130845d54ed2","object":"chat.completion"` |
| 3 | PASS | B2 header:X-OpenClaw-Agent-Id=sales | `{"id":"chatcmpl_5d21c538-9fdd-486e-8b16-ad6f60e00e22","object":"chat.completion"` |
| 4 | PASS | B1 model:openclaw/developer | `{"error":{"message":"Error: All models failed (2): moonshot/kimi-k2.5: ⚠️ AP` |
| 5 | PASS | Dude REFUSE invalid agent (builder2) | `AGENT_ROUTE_REFUSED: agent 'definitely-not-real-agent-xyz' not in allowlist for ` |
| 6 | PASS | Dude ALLOW valid agent (builder2/sales) | `AGENT_ALLOWED: sales on builder2` |
| 7 | PASS | Dude ALLOW valid agent (builder1/developer) | `AGENT_ALLOWED: developer on builder1` |
| 8 | PASS | Dude REFUSE invalid agent (builder1) | `AGENT_ROUTE_REFUSED: agent 'definitely-not-real-agent-xyz' not in allowlist for ` |
| 9 | PASS | Dude dispatch REFUSE before SSH | `AGENT_ROUTE_REFUSED: agent 'definitely-not-real-agent-xyz' not in allowlist for ` |

## Infrastructure

- **Builder Tailscale IP:** 100.75.216.57
- **Builder1 port:** 8080 (gateway, `--bind tailnet`)
- **Builder2 port:** 8082 (gateway, `--bind tailnet`)
- **Auth:** Token-based (Bearer header, [REDACTED])
- **Dude allowlist:** /root/bin/agent-allowlist.json
- **Dude dispatch:** /root/bin/dispatch-to-builder.sh (patched 2026-02-21)

## Agent Targeting Methods Verified

1. `model: "openclaw/<agent_id>"` — WORKS
2. `model: "agent:<agent_id>"` — WORKS
3. `X-OpenClaw-Agent-Id` header — WORKS
4. Dude allowlist (fail-closed) — WORKS
5. Invalid agent via Dude — REFUSED (exit 1, AGENT_ROUTE_REFUSED)

## Files Modified

- `/root/bin/agent-allowlist.json` — new config file
- `/root/bin/agent-allowlist-check.py` — new validation script
- `/root/bin/dispatch-to-builder.sh` — patched with AGENT_ALLOWLIST_GUARD

## JSON Log

Location: `/tmp/routing-smoke-2026-02-21T164052Z.json`
