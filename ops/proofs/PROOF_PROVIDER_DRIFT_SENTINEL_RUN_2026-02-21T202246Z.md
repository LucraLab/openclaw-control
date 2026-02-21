# Proof: Provider Drift Sentinel Run

**Date:** 2026-02-21T202246Z
**Branch:** ops/builder1-tailscale-bind-dude-allowlist-smoke
**HEAD:** 0eb48ca

---

## Verdict: OK (exit 0)




## Exit Code Policy

| Code | Meaning | Action |
|------|---------|--------|
| 0 | OK | All builders have working chains + MODEL_OK |
| 1 | WARN | Config OK but upstream provider issue (MODEL_OK=0) |
| 2 | FAIL | Drift detected — chain missing fallback or bad base URL |

## Configuration (redacted)

| Setting | Value |
|---------|-------|
| Primary | `moonshot/kimi-k2.5` |
| Fallbacks | `["anthropic/claude-opus-4-6", "openai/gpt-4o"]` |
| OPENAI_BASE_URL | `https://api.openai.com/v1` (source: systemd-runtime) |

## Drift Checks

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 1 | config_read | OK | primary=moonshot/kimi-k2.5 fallbacks=["anthropic/claude-opus-4-6", "openai/gpt-4o"] |
| 2 | chain_has_openai_gpt-4o | OK | Found in fallbacks |
| 3 | chain_diversity | OK | Multiple provider families present |
| 4 | openai_baseurl | OK | https://api.openai.com/v1 |
| 5 | live_b1 | OK | http=200 route=1 model=1 |
| 6 | live_b2 | OK | http=200 route=1 model=1 |

## Live Check Results

| Builder | HTTP | ROUTE_OK | MODEL_OK | Error Class |
|---------|------|----------|----------|-------------|
| Builder1 | 200 | 1 | 1 | none |
| Builder2 | 200 | 1 | 1 | none |

## JSON Log

Location: `/tmp/provider-drift-sentinel-2026-02-21T202246Z.json`

---

**sha256:** 4430c88730b09632afbcdc6f0b702dceb285ce48460251174d8d06f75e5d0cb2
