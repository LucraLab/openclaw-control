# Arbiter Hints Bridge v1

## Overview

The Arbiter Hints Bridge connects the Executive Strategy Engine (Port #12) to the
Arbiter (Port #9). It allows strategy recommendations to **optionally influence**
objective ranking — safely and bounded.

**Advisory only** — hints never mutate objectives, execute code, or override
kill switch / quarantine.

## Architecture

```
  ┌─────────────────────┐
  │  Executive Strategy │
  │       Engine        │
  └──────┬──────────────┘
         │ generateHints()
         ▼
  ┌─────────────────────┐
  │  Hints Artifact     │
  │  (JSON, max ±10)    │
  └──────┬──────────────┘
         │ read by arbiter
         ▼
  ┌─────────────────────┐
  │  oc_arbiter_hints   │
  │  (Python filter)    │
  └──────┬──────────────┘
         │ reordered objectives
         ▼
  ┌─────────────────────┐
  │  Arbiter Main Loop  │
  │  (arbiter.sh)       │
  └─────────────────────┘
```

## Hints Artifact Schema

`artifacts/executive-strategy-hints.json`:

```json
{
  "version": "1.0.0",
  "computed_at": "ISO-8601 timestamp",
  "source_engine_version": "1.0.0",
  "hints": [
    {
      "objective_id": "obj-42",
      "priority_score": 75,
      "risk_score": 30,
      "confidence": 0.85,
      "recommendation_code": "FOCUS",
      "rank_delta_hint": 5,
      "why_codes": ["high_impact", "low_risk"]
    }
  ]
}
```

### recommendation_code Enum

| Strategy Action | Hint Code     |
|----------------|---------------|
| STOP           | STOP          |
| HOLD           | HOLD          |
| INVESTIGATE    | INVESTIGATE   |
| RETRY          | PLAN          |
| PROCEED        | FOCUS         |
| DEPRIORITIZE   | CONTAIN       |

### rank_delta_hint

Formula: `clamp(round((priority_score - 50) / 5), -10, 10)`

| Priority Score | Delta |
|---------------|-------|
| 100           | +10   |
| 75            | +5    |
| 50            | 0     |
| 25            | -5    |
| 0             | -10   |

### Safety Overrides (force delta=0)

| Condition         | Why                     |
|-------------------|-------------------------|
| Kill switch       | STOP overrides all      |
| Quarantined       | HOLD overrides ranking  |
| Confidence < 0.4  | Too uncertain to adjust |
| Risk >= 90        | Too risky to promote    |

## Arbiter Integration

After `_enumerate_objectives()` sorts by `created_at`, the arbiter pipes
through `_apply_strategy_hints()`:

1. Read hints file (skip if missing → ARBITER_HINTS_SKIPPED)
2. Validate schema (skip + FAILCLOSED if invalid)
3. Apply bounded deltas (±10 max, safety overrides)
4. Re-sort: higher delta first, ties broken by original position
5. Output reordered objectives to main arbitration loop

## Events

| Event                    | When                           |
|--------------------------|--------------------------------|
| ARBITER_HINTS_APPLIED    | Hints read and deltas applied  |
| ARBITER_HINTS_SKIPPED    | Hints file missing or module not found |
| ARBITER_HINTS_FAILCLOSED | Hints file corrupt or invalid schema |

## CI Gate

The `arbiter-hints` CI gate runs:
1. `node scripts/arbiter_hints.test.js` — 33 tests
2. `node scripts/run_arbiter_hints_gate.js --ci` — 12 smoke checks

## Security

- rank_delta_hint hard-clamped to [-10, +10]
- Safety overrides cannot be bypassed
- No secrets in hints artifact (engine sanitizes all output)
- Python applier is read-only (never writes to objectives)
- Fail closed on any error

## Rollback

```bash
git revert <merge_commit_sha>
# Remove arbiter-hints from branch protection required checks
```
