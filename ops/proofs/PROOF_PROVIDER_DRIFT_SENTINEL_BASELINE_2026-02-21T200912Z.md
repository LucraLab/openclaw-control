# Proof: Provider Drift Sentinel — Baseline Capture

**Date:** 2026-02-21T200912Z
**Branch:** ops/builder1-tailscale-bind-dude-allowlist-smoke
**HEAD:** 0eb48ca

---

## Purpose

Capture known-good state before implementing the provider drift sentinel.
This baseline documents the fix state after the Builder1 MODEL_OK incident.

## Smoke Suite Baseline

**Command:**
```bash
bash /home/openclaw/staging/current/ops/scripts/routing_smoke_suite.sh
```

**Result:**
```
ROUTE_OK: 9 / 9
MODEL_OK: 9 / 9
Warnings: 0
Failures: 0
VERDICT: ALL_PASS
```

## Builder1 Provider Chain (redacted)

**Source:** `/home/openclaw/.openclaw/openclaw.json` on Builder VPS (187.77.6.191)

**Command:**
```bash
ssh openclaw@187.77.6.191 'cat /home/openclaw/.openclaw/openclaw.json' | python3 -c "import json,sys; d=json.load(sys.stdin)['agents']['defaults']['model']; print(json.dumps(d, indent=2))"
```

**Result:**
```json
{
  "primary": "moonshot/kimi-k2.5",
  "fallbacks": ["anthropic/claude-opus-4-6", "openai/gpt-4o"]
}
```

**Assessment:** openai/gpt-4o present as third fallback — fix from incident is in place.

## Builder1 Systemd Drop-ins (redacted)

**Source:** `/home/openclaw/.config/systemd/user/openclaw-gateway.service.d/` on Builder VPS

**Command:**
```bash
ssh openclaw@187.77.6.191 'ls /home/openclaw/.config/systemd/user/openclaw-gateway.service.d/'
ssh openclaw@187.77.6.191 'cat /home/openclaw/.config/systemd/user/openclaw-gateway.service.d/openai.conf'
```

**Files found:**
- ensure-dirs.conf
- moonshot.conf
- moonshot.conf.backup
- moonshot.conf.pre-fix-20260218T092100Z
- openai.conf

**openai.conf contents:**
```ini
[Service]
Environment=OPENAI_BASE_URL=https://api.openai.com/v1
```

**Assessment:** Overrides the broken `OPENAI_BASE_URL=http://127.0.0.1:4010/v1` from lucralab.env — fix is in place.

## Effective OPENAI_BASE_URL (runtime)

**Command:**
```bash
ssh openclaw@187.77.6.191 'systemctl --user show openclaw-gateway.service | grep OPENAI_BASE'
```

**Result:** `OPENAI_BASE_URL=https://api.openai.com/v1` (correct)

## Builder2 Configuration

**Systemd drop-ins:** None (no separate drop-in directory for gateway2)
**Service:** Single `openclaw-gateway.service` handles both Builder1 (port 8080) and Builder2 (port 8082)
**Provider chain:** Same as Builder1 (shared `openclaw.json`)

## Incident Reference

The prior incident (triage: `PROOF_BUILDER1_MODEL_OK_TRIAGE_BASELINE_2026-02-21T194309Z`) was:
- Moonshot billing exhausted + Anthropic usage limit reached
- No openai/gpt-4o in fallback chain
- OPENAI_BASE_URL pointed to loopback (127.0.0.1:4010) with nothing listening

This sentinel is designed to detect that exact failure pattern before it causes an outage.

---

**sha256:** c56ec7c78286434e38d03cbff9787328af3afae77eec928cabfe06f730cde672
