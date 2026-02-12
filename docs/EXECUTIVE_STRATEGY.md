# Executive Strategy Engine v1

## Overview

The Executive Strategy Engine is a proactive "executive brain" that ranks objectives
and recommends next actions. It is **advisory only** — it produces recommendations
but never mutates objectives or repos.

## Architecture

```
                ┌─────────────────────┐
                │  Executive Strategy │
                │       Engine        │
                └──────┬──────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ Dev Intel│  │ Ops Intel│  │ Biz Intel│
  └──────────┘  └──────────┘  └──────────┘
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                ┌──────────────┐
                │ LLM Assist   │ (optional, OFF by default)
                │ max 800/400  │
                └──────────────┘
                       ▼
                ┌──────────────┐
                │ JSON + MD    │
                │ Artifacts    │
                └──────────────┘
```

## How It Works

### 1. Deterministic Scoring (always runs)

For each candidate objective, the engine computes:

| Field | Range | Description |
|-------|-------|-------------|
| `priority_score` | 0–100 | Higher = more important |
| `risk_score` | 0–100 | Higher = more risky |
| `confidence` | 0–1 | Higher = more certain |
| `recommended_action` | enum | PROCEED, HOLD, STOP, INVESTIGATE, RETRY, DEPRIORITIZE |
| `why[]` | max 5 | Short explanation bullets |
| `next_steps[]` | max 3 | Recommended next actions |
| `blocks[]` | max 5 | Structured blocking reasons |

### 2. Three Lens Modules

Each lens analyzes different signals and returns deltas:

- **Dev Intel**: CI failures, retries, gate failures, model escalation blocks, age
- **Ops Intel**: Drift failures, lock contention, budget breaches, quarantine, kill switch
- **Business Intel**: Impact tags (revenue, customer_blocking, sla_critical), due dates, ROI

The engine merges deltas deterministically with stable ordering.

### 3. Action Rules

| Condition | Action |
|-----------|--------|
| Kill switch engaged | STOP |
| Quarantined | HOLD |
| High risk + low confidence | INVESTIGATE |
| 3+ failures | RETRY or INVESTIGATE |
| Low priority + low risk | DEPRIORITIZE |
| Default | PROCEED |

### 4. Optional LLM Assist

**OFF by default.** Only runs when ALL of:
- `EXEC_STRATEGY_LLM=1` is set
- Uncertainty trigger fires (confidence < 0.65, high risk + missing evidence, or varied failures)

Hard constraints:
- Max input: 800 tokens
- Max output: 400 tokens
- Must output valid JSON
- On failure: falls back to rules-only (no crash, no retry)

## Inputs

| Source | Path | What |
|--------|------|------|
| Objectives | `$AGENT_ROOT/objectives/obj-*.json` | Objective metadata |
| Events | `_logs/agent-events.jsonl` | Historical events |
| Gate reports | `artifacts/*-report.json` | CI gate results |
| Quarantine | `_control/quarantine.json` | Quarantine state |
| Kill switch | `_control/STOP` | Kill switch state |

In CI, all inputs come from fixtures under `scripts/fixtures/executive_strategy/`.

## Outputs

- `artifacts/executive-strategy-report.json` — Full structured report
- `artifacts/executive-strategy-report.md` — Human-readable summary

## Events

| Event | When |
|-------|------|
| `EXEC_STRATEGY_COMPUTED` | Every run |
| `EXEC_STRATEGY_LLM_USED` | LLM was called and succeeded |
| `EXEC_STRATEGY_LLM_SKIPPED` | LLM was not called (with reason) |
| `EXEC_STRATEGY_FAILCLOSED` | Corrupt/missing inputs |

## CI Gate

The `executive-strategy` CI gate runs:
1. `node scripts/executive_strategy.test.js` — 35 tests
2. `node scripts/run_executive_strategy_gate.js --ci` — 12 smoke checks

## Security

- All output is sanitized (secret patterns redacted)
- LLM assist never receives env vars or credentials
- Payloads are truncated
- No mutations to filesystem beyond artifacts

## Rollback

```bash
git revert <merge_commit_sha>
# Remove executive-strategy from branch protection required checks
```
