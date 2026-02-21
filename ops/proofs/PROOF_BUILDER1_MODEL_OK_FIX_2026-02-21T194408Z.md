# Proof: Builder1 MODEL_OK Fix

**Date:** 2026-02-21T194408Z
**Branch:** ops/builder1-tailscale-bind-dude-allowlist-smoke

---

## Root Cause

Builder1's model provider chain had no working fallback:
- **Moonshot** (primary): billing account exhausted
- **Anthropic** (only fallback): API usage limit reached until 2026-03-01
- **OpenAI**: not in fallback chain, and `OPENAI_BASE_URL` pointed to non-existent local LiteLLM

## What Changed

### 1. Systemd drop-in: `openai.conf` (NEW)

Path: `/home/openclaw/.config/systemd/user/openclaw-gateway.service.d/openai.conf`
```ini
[Service]
Environment=OPENAI_BASE_URL=https://api.openai.com/v1
```

This overrides the broken `OPENAI_BASE_URL=http://127.0.0.1:4010/v1` from `lucralab.env`, directing OpenAI calls to the real API instead of a non-existent local proxy.

### 2. Fallback chain updated in `openclaw.json`

Before:
```json
{
  "primary": "moonshot/kimi-k2.5",
  "fallbacks": ["anthropic/claude-opus-4-6"]
}
```

After:
```json
{
  "primary": "moonshot/kimi-k2.5",
  "fallbacks": ["anthropic/claude-opus-4-6", "openai/gpt-4o"]
}
```

### 3. Gateway service restarted

```
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway.service
```

Backup: `/home/openclaw/.openclaw/openclaw.json.backup-pre-openai-fallback-20260221T194316Z`

## No Secrets in Git

- OpenAI API key (`...GJwA`) already present in Builder1's `lucralab.env` — no new secrets needed
- Systemd drop-in only sets `OPENAI_BASE_URL` (a public URL, not a secret)
- `openclaw.json` change is a model name string, not a credential

## Before / After

### Before (smoke suite 2026-02-21T192453Z)
```
ROUTE_OK: 9 / 9
MODEL_OK: 8 / 9    ← Builder1 FAIL
Warnings: 1
VERDICT: WARN_ROUTE_ONLY
```

### After (smoke suite 2026-02-21T194408Z)
```
ROUTE_OK: 9 / 9
MODEL_OK: 9 / 9    ← ALL PASS
Warnings: 0
VERDICT: ALL_PASS
```

### Builder1 test detail (after)
```
[PASS] B1 model:openclaw/developer (http=200, route=1, model=1, err=none)
```

### Provider sanity check (after)
```
PROVIDER_OK builder1 (agent=developer, http=200)
PROVIDER_OK builder2 (agent=sales, http=200)
RESULT: ALL PROVIDER_OK
```

## Full Smoke Suite Results (After Fix)

| # | Status | Test | HTTP | Route | Model | Error |
|---|--------|------|------|-------|-------|-------|
| 1 | PASS | B2 model:openclaw/sales | 200 | 1 | 1 | none |
| 2 | PASS | B2 model:agent:sales | 200 | 1 | 1 | none |
| 3 | PASS | B2 header:X-OpenClaw-Agent-Id=sales | 200 | 1 | 1 | none |
| 4 | PASS | B1 model:openclaw/developer | 200 | 1 | 1 | none |
| 5 | PASS | Dude REFUSE invalid (builder2) | n/a | 1 | 1 | none |
| 6 | PASS | Dude ALLOW valid (builder2/sales) | n/a | 1 | 1 | none |
| 7 | PASS | Dude ALLOW valid (builder1/developer) | n/a | 1 | 1 | none |
| 8 | PASS | Dude REFUSE invalid (builder1) | n/a | 1 | 1 | none |
| 9 | PASS | Dude dispatch REFUSE before SSH | n/a | 1 | 1 | none |

## New Script Added

`ops/scripts/provider-sanity-check.sh` — standalone provider health check:
- Tests one or both builders with a minimal completion request
- Returns `PROVIDER_OK` or `PROVIDER_FAIL:<class>` markers
- Exit 0 only when all tested builders pass

## Network Exposure

No new ports opened. No new services exposed. Builder1 remains Tailscale-only on port 8080.

## Reversibility

To reverse this fix:
1. Remove `/home/openclaw/.config/systemd/user/openclaw-gateway.service.d/openai.conf`
2. `sudo chattr -i ~/.openclaw/openclaw.json`
3. Restore backup: `cp ~/.openclaw/openclaw.json.backup-pre-openai-fallback-20260221T194316Z ~/.openclaw/openclaw.json`
4. `sudo chattr +i ~/.openclaw/openclaw.json`
5. `systemctl --user daemon-reload && systemctl --user restart openclaw-gateway.service`

## Remaining Provider Issues (informational, not blocking)

| Provider | Status | Action Needed |
|----------|--------|---------------|
| Moonshot | Account suspended | Top up balance on Moonshot dashboard |
| Anthropic | Usage limit until Mar 1 | Auto-resolves 2026-03-01 00:00 UTC |
| OpenAI | Working | No action needed |
