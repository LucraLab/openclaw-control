# Proof: Provider Drift Sentinel — Selftest

**Date:** 2026-02-21T201937Z
**Branch:** ops/builder1-tailscale-bind-dude-allowlist-smoke
**HEAD:** 0eb48ca

---

## Purpose

Regression anchor: verifies the sentinel correctly detects the exact failure
pattern from the Builder1 MODEL_OK incident (2026-02-21T194309Z).

## Simulated Conditions

| Setting | Simulated Value | Why |
|---------|-----------------|-----|
| Primary | `moonshot/kimi-k2.5` | Dead (billing exhausted) |
| Fallbacks | `["anthropic/claude-opus-4-6"]` | Dead (usage limit) — no openai |
| OPENAI_BASE_URL | `http://127.0.0.1:4010/v1` | Loopback, no listener on Builder |
| Live checks | Skipped | Simulation mode |

## Expected vs Actual

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Exit code | 2 (FAIL) | 2 | PASS |
| FAIL_CHAIN marker | Present | Present | PASS |
| FAIL_OPENAI_BASEURL marker | Present | Present | PASS |
| JSON markers | Both present | Both present | PASS |

## Selftest Verdict: PASSED (4/4)

## Sentinel Output (simulation)

```
[SENTINEL] Simulation mode: baseline_dead_chain
=== Provider Drift Sentinel — 2026-02-21T201937Z ===

--- Phase A: Configuration Gathering ---
  [SIM] Chain: primary=moonshot/kimi-k2.5 fallbacks=["anthropic/claude-opus-4-6"]
  [SIM] OPENAI_BASE_URL=http://127.0.0.1:4010/v1

--- Phase B: Drift Detection ---
  [FAIL] Required fallback 'openai/gpt-4o' MISSING from chain
  [FAIL] Chain is moonshot+anthropic only — no OpenAI fallback (matches prior incident)
  [FAIL] OPENAI_BASE_URL points to loopback: http://127.0.0.1:4010/v1
  [SIM] Skipping loopback listener check (simulation mode)

--- Phase C: Live Checks ---
  [SIM/DRY] Skipping live HTTP checks

=========================================
  VERDICT: FAIL (exit 2)
  FAIL markers: ["FAIL_CHAIN","FAIL_CHAIN","FAIL_OPENAI_BASEURL"]
=========================================

JSON: /tmp/provider-drift-sentinel-2026-02-21T201937Z.json
Proof: /home/openclaw/staging/current/ops/proofs/PROOF_PROVIDER_DRIFT_SENTINEL_RUN_2026-02-21T201937Z.md
```

## JSON File

Location: `/tmp/provider-drift-sentinel-2026-02-21T201937Z.json`

```json
{
  "builder1": {
    "error_class": "simulated",
    "http_code": "SIM",
    "model_ok": 0,
    "route_ok": 0
  },
  "builder2": {
    "error_class": "simulated",
    "http_code": "SIM",
    "model_ok": 0,
    "route_ok": 0
  },
  "checks": [
    {"detail":"Not found in fallbacks: [\"anthropic/claude-opus-4-6\"]","name":"chain_has_openai_gpt-4o","status":"FAIL"},
    {"detail":"moonshot+anthropic only, no openai","name":"chain_diversity","status":"FAIL"},
    {"detail":"Loopback detected: http://127.0.0.1:4010/v1","name":"openai_baseurl","status":"FAIL"},
    {"detail":"Simulated: no listener on 127.0.0.1:4010","name":"loopback_listener","status":"FAIL"},
    {"detail":"Simulation/dry-run mode","name":"live_b1","status":"SKIP"},
    {"detail":"Simulation/dry-run mode","name":"live_b2","status":"SKIP"}
  ],
  "config": {
    "chain_fallbacks": ["anthropic/claude-opus-4-6"],
    "chain_primary": "moonshot/kimi-k2.5",
    "openai_baseurl": "http://127.0.0.1:4010/v1",
    "openai_baseurl_source": "simulation"
  },
  "exit_code": 2,
  "fail_markers": ["FAIL_CHAIN","FAIL_CHAIN","FAIL_OPENAI_BASEURL"],
  "timestamp": "2026-02-21T201937Z",
  "verdict": "FAIL",
  "warn_markers": []
}
```

---

**sha256:** 4e19c91e48171481df3a248ec56dbed7d4be30272462446c80a743a9e9b28d44
