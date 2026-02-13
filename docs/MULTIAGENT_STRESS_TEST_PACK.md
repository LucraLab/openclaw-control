# Multiagent Stress & Automation Test Pack

**Status:** Implemented (code + tests + CI gate)
**Objective:** obj-20
**Port:** N/A (testing infrastructure, not a port of existing functionality)

---

## Overview

Comprehensive stress and automation test suite covering cross-module safety guarantees: concurrency stability, kill switch enforcement, quarantine filtering, canonical artifact naming, secret sanitization, and LLM assist gating.

Two components:
1. **Offline test suite** (56 tests) — runs in CI with zero network calls
2. **Manual live stress runner** — runs on Dashboard VPS with bounded token burn

## Test Categories (56 Tests)

| Category | Tests | Description |
|----------|-------|-------------|
| A: Swarm Formatting Determinism | 4 | Verifies formatSwarmResponse and selectAgents produce identical output across 100 runs |
| B: Kill Switch Fail-Closed | 6 | Swarm + executive strategy blocked on killswitch active, check failure, null runtime |
| C: Quarantine Agent Removal | 5 | Quarantined agents removed from swarm roster, quarantine add/remove cycle, executive HOLD |
| D: Canonical Artifact Naming | 4 | ops-pulse-*, swarm-run-*, daily-exec-brief-* naming patterns verified on disk |
| E: Sanitization Redaction | 10 | sk-, ghp_, Bearer, AKIA, ya29., 1/, Telegram tokens, pit-, cross-module consistency |
| F: LLM Assist Gating | 10 | shouldTriggerLLM thresholds, stub injection, fail-closed on invalid JSON/exception, cap enforcement |
| G: Concurrency Stability | 5 | runWithConcurrency limit=1/3, mixed success/failure, empty task list, full swarm bounded concurrency |
| H: Cross-Module Determinism | 5 | Executive strategy identical on fixtures, quarantined obj → HOLD, schema validation, score clamping |
| I: Swarm Full Orchestration | 4 | executeSwarm null runtime, killswitch, no auth tokens, HTTP error handling |
| J: Event Emission | 3 | Runtime event writes, secret sanitization in events, swarm correlation_id propagation |

## Hard Constraints

- No `require('http')`, `require('https')`, `require('net')` in test file
- No LLM SDK imports (openai, @anthropic, axios, node-fetch, got)
- No secrets in source code
- LLM assist OFF by default — only activates via explicit config + env var
- Kill switch + quarantine + caps enforced in all paths
- Live runner bounded: max_tokens=64, temperature=0, max 5 agents

## Running Offline Tests

```bash
node scripts/multiagent_stress.test.js
```

Expected: 56 passed, 0 failed

## Running Live Stress (Dashboard VPS Only)

```bash
# Dry run (no HTTP calls)
bash scripts/multiagent_stress_runner.sh --dry-run

# Live run (requires BUILDER2_AUTH_TOKEN)
BUILDER2_AUTH_TOKEN=<token> bash scripts/multiagent_stress_runner.sh
```

### Live Runner Preflight Checks

1. Runtime dir exists and readable
2. Kill switch NOT active (refuses to run if active)
3. Auth token available (env var or gateway config)
4. Builder2 reachable at Tailscale IP
5. Quarantined agents filtered from roster

### Live Runner Safety Bounds

| Parameter | Value | Purpose |
|-----------|-------|---------|
| max_tokens | 64 | Minimal token burn per agent |
| temperature | 0 | Deterministic responses |
| Max agents | 5 | Cap roster selection |
| Per-agent timeout | 10s | Prevent hanging |
| Builder2 only | yes | Tailscale-reachable agents only |

## CI Gate

`.github/workflows/gate-multiagent-stress.yml`

Runs on every pull request:
1. Execute all offline tests (minimum 35 passing required)
2. Verify no network module imports
3. Verify no LLM SDK imports
4. Verify no secrets in source
5. Verify fail-closed safety patterns present
6. Verify stress runner has bounded token burn

## Files

| File | Purpose |
|------|---------|
| `scripts/multiagent_stress.test.js` | 56 offline tests |
| `scripts/multiagent_stress_runner.sh` | Manual live stress runner |
| `.github/workflows/gate-multiagent-stress.yml` | CI gate |
| `docs/MULTIAGENT_STRESS_TEST_PACK.md` | This documentation |

## No-Secrets Fixture Rules (Important)

The CI gate includes a "no secrets in source" check that scans for common credential prefixes above certain length thresholds. Test fixtures in Category E (sanitization tests) use token-like strings to verify that the redaction logic works. These fixtures must be carefully sized to avoid false positives.

### Rationale

- **Sanitization tests need real-looking tokens** to verify that `sanitizeOutput()`, `engine.sanitize()`, and `runtime.sanitize()` correctly redact secret patterns.
- **The CI gate scanner flags strings** matching `sk-` + 20 alphanumeric chars, `ghp_` + 20 chars, or `AKIA` + 16 uppercase/digit chars.
- **Fixture strings must live in the safe zone** between these two thresholds.

### Constraints

| Prefix | Sanitizer minimum (must be above) | CI gate threshold (must be below) | Safe fixture range |
|--------|-----------------------------------|-----------------------------------|--------------------|
| `sk-` | 8 chars after prefix | 20 chars after prefix | 9-19 chars |
| `ghp_` | 8 chars after prefix | 20 chars after prefix | 9-19 chars |
| `AKIA` | 8 chars after prefix | 16 UPPERCASE+digit chars after prefix | 9-15 chars, or use mixed case |
| `Bearer` | 10 chars after prefix | (not scanned) | 10+ chars |
| `eyJ` | 8 chars after prefix | (not scanned) | 8+ chars |
| `pit-` | 10 chars after prefix (engine only) | (not scanned) | 10+ chars |

### Examples

| Status | Example | Why |
|--------|---------|-----|
| BAD | `sk-test1234567890abcdef` (20 chars) | Matches CI gate regex (`sk-` + 20 alphanumeric) |
| BAD | `ghp_abc123456789012345678901` (25 chars) | Matches CI gate regex (`ghp_` + 20+) |
| BAD | `AKIAIOSFODNN7EXAMPLE` (16 uppercase) | Matches CI gate regex (`AKIA` + 16 uppercase) |
| GOOD | `sk-abc1234567890xyz` (15 chars) | Above sanitizer threshold, below CI gate |
| GOOD | `ghp_abcdef12345678` (14 chars) | Above sanitizer threshold, below CI gate |
| GOOD | `AKIAabcDEF12345678` (mixed case) | CI gate only matches uppercase, mixed case is safe |

### When Adding New Sanitization Tests

1. Choose a token prefix from the table above
2. Add enough characters after it to exceed the sanitizer minimum (8-10 chars)
3. Keep the total suffix length below the CI gate threshold
4. For `AKIA`, use mixed case to avoid the uppercase-only scanner
5. Run `grep -qE "(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16})" scripts/multiagent_stress.test.js` to verify no matches

## Modules Tested

| Module | Tests Cover |
|--------|------------|
| `war_room_swarm.js` | Formatting, selection, concurrency, safety gates, orchestration, sanitization |
| `executive_strategy_engine.js` | Scoring, determinism, killswitch STOP, quarantine HOLD, LLM gating |
| `executive_strategy_schema.js` | Validation, clamping, default results |
| `executive_llm_assist.js` | Assist gating, stub injection, fail-closed, suggestion cap |
| `autonomy_runtime.js` | Killswitch, quarantine, events, artifacts, sanitization |
