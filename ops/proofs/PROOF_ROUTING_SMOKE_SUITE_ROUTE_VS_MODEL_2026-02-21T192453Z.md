# Proof: Routing Smoke Suite (ROUTE_OK / MODEL_OK)

**Date:** 2026-02-21T192453Z
**Branch:** ops/builder1-tailscale-bind-dude-allowlist-smoke
**HEAD:** 11a8a63

---

## Verdict: WARN_ROUTE_ONLY

| Metric | Value |
|--------|-------|
| Total tests | 9 |
| ROUTE_OK | 9 / 9 |
| MODEL_OK | 8 / 9 |
| Warnings (route ok, model failed) | 1 |
| Failures (route failed) | 0 |

## Semantics

- **PASS** = ROUTE_OK + MODEL_OK (gateway accepted, LLM responded normally)
- **PASS_ROUTE** = ROUTE_OK only (gateway accepted, but LLM provider error e.g. billing)
- **FAIL** = ROUTE_OK failed (gateway unreachable, auth rejected, etc.)

## Test Results

| # | Status | Test | HTTP | Route | Model | Error |
|---|--------|------|------|-------|-------|-------|
| 1 | PASS | B2 model:openclaw/sales | 200 | 1 | 1 | none |
| 2 | PASS | B2 model:agent:sales | 200 | 1 | 1 | none |
| 3 | PASS | B2 header:X-OpenClaw-Agent-Id=sales | 200 | 1 | 1 | none |
| 4 | PASS_ROUTE | B1 model:openclaw/developer | 500 | 1 | 0 | provider_billing |
| 5 | PASS | Dude REFUSE invalid (builder2) | n/a | 1 | 1 | none |
| 6 | PASS | Dude ALLOW valid (builder2/sales) | n/a | 1 | 1 | none |
| 7 | PASS | Dude ALLOW valid (builder1/developer) | n/a | 1 | 1 | none |
| 8 | PASS | Dude REFUSE invalid (builder1) | n/a | 1 | 1 | none |
| 9 | PASS | Dude dispatch REFUSE before SSH | n/a | 1 | 1 | none |

## Infrastructure

- **Builder Tailscale IP:** 100.75.216.57
- **Builder1 port:** 8080 (`--bind tailnet`)
- **Builder2 port:** 8082 (`--bind tailnet`)
- **Auth:** Token-based (Bearer, [REDACTED])
- **Dude allowlist:** /root/bin/agent-allowlist.json (installed from ops/dude/)

## JSON Log

Location: `/tmp/routing-smoke-2026-02-21T192453Z.json`
