# Proof: Builder1 MODEL_OK Triage Baseline

**Date:** 2026-02-21T194309Z
**Investigator:** Claude Opus 4.6

---

## Symptom

Routing smoke suite shows Builder1 `ROUTE_OK=1` but `MODEL_OK=0`:

```
[PASS_ROUTE] B1 model:openclaw/developer (http=500, route=1, model=0, err=provider_billing)
```

## Provider Chain (Builder1)

| Priority | Provider | Status |
|----------|----------|--------|
| Primary | `moonshot/kimi-k2.5` | DEAD — account `org-14dfaf6ce6804ca99676d2a8c0a7d1de` suspended, insufficient balance |
| Fallback 1 | `anthropic/claude-opus-4-6` | DEAD — usage limit reached, resets 2026-03-01 |
| _(missing)_ | `openai/gpt-4o` | NOT configured (only Builder2 had this fallback) |

## Error Payload

```json
{
  "error": {
    "message": "Error: All models failed (2): moonshot/kimi-k2.5: API provider returned a billing error (rate_limit) | anthropic/claude-opus-4-6: LLM request rejected: You have reached your specified API usage limits. You will regain access on 2026-03-01 at 00:00 UTC. (rate_limit)",
    "type": "api_error"
  }
}
```

## Why Builder2 Works

Builder2 has `openai/gpt-4o` as a third fallback:
```json
{
  "primary": "moonshot/kimi-k2.5",
  "fallbacks": ["anthropic/claude-sonnet-4-5", "openai/gpt-4o"]
}
```

Moonshot is dead (same billing org), Anthropic is dead (same key), but OpenAI works (`...GJwA` key, tested directly: HTTP 200, valid completion).

## Additional Issue: OPENAI_BASE_URL Misconfigured

Builder1's `lucralab.env` sets:
```
OPENAI_BASE_URL=http://127.0.0.1:4010/v1
```

This points to a LiteLLM proxy that runs on the **Dashboard VPS**, not on the Builder VPS. Even if `openai/gpt-4o` were in the fallback chain, it would fail because `127.0.0.1:4010` doesn't exist on Builder1.

## Config Locations

| File | Path | Managed By |
|------|------|------------|
| OpenClaw config | `/home/openclaw/.openclaw/openclaw.json` | `chattr +i` (immutable) |
| Credentials env | `/home/openclaw/.openclaw/credentials/lucralab.env` | `EnvironmentFile=` in systemd |
| Moonshot override | `.config/systemd/user/openclaw-gateway.service.d/moonshot.conf` | systemd drop-in |
| Service unit | `.config/systemd/user/openclaw-gateway.service` | systemd user unit |

## Service Manager

- **Type:** systemd user unit (`openclaw-gateway.service`)
- **User:** `openclaw` (uid 1001)
- **Bind:** Tailscale only (`--bind tailnet`)
- **Port:** 8080

## Direct Provider Tests (from Dashboard VPS)

| Provider | Key | Direct API Test | Result |
|----------|-----|-----------------|--------|
| Moonshot | `...CR0S` | `api.moonshot.ai/v1` | 429 — account suspended |
| Anthropic | `...zQAA` | `api.anthropic.com/v1` | 400 — usage limit |
| OpenAI | `...GJwA` | `api.openai.com/v1` | 200 — valid completion ("Ping! How can I") |

## Recommended Fix

1. Add `openai/gpt-4o` to Builder1's fallback chain in `openclaw.json`
2. Create systemd drop-in `openai.conf` to override `OPENAI_BASE_URL=https://api.openai.com/v1`
3. Restart gateway
