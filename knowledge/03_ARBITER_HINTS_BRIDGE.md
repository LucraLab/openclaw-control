# Arbiter Hints Bridge

**Last Verified Commit:** `b298289` (main)

## Purpose

The Arbiter Hints Bridge (Port #13) connects the Executive Strategy Engine to
the Arbiter. It allows strategy recommendations to **optionally influence**
objective ranking — safely and bounded. Advisory only — hints never mutate
objectives, execute code, or override kill switch / quarantine.

## Hints Schema (v1)

Source of truth: `scripts/executive_strategy_hints.js`

Artifact path: `artifacts/executive-strategy-hints.json`

```json
{
  "version": "1.0.0",
  "computed_at": "ISO-8601",
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

### Recommendation Code Mapping

| Engine Action | Hint Code |
|--------------|-----------|
| STOP | STOP |
| HOLD | HOLD |
| INVESTIGATE | INVESTIGATE |
| RETRY | PLAN |
| PROCEED | FOCUS |
| DEPRIORITIZE | CONTAIN |

### rank_delta_hint Formula

```
clamp(round((priority_score - 50) / 5), -10, 10)
```

| Priority | Delta |
|----------|-------|
| 100 | +10 |
| 75 | +5 |
| 50 | 0 |
| 25 | -5 |
| 0 | -10 |

### why_codes (18 valid codes)

`high_risk`, `low_risk`, `high_impact`, `low_impact`, `ci_failures`,
`repeated_failures`, `budget_breach`, `budget_near_breach`, `quarantined`,
`kill_switch`, `overdue`, `approaching_deadline`, `low_confidence`,
`high_confidence`, `missing_metadata`, `model_escalation_blocked`,
`drift_failure`, `lock_contention`

Maximum 5 per hint. Deduplicated.

## Hard Safety Rules

These **cannot be bypassed**. When any condition is true, `rank_delta_hint` is forced to 0:

| Condition | Why |
|-----------|-----|
| `recommended_action = STOP` | Kill switch overrides all |
| `recommended_action = HOLD` | Quarantine overrides ranking |
| `confidence < 0.4` | Too uncertain to adjust |
| `risk_score >= 90` | Too risky to promote |

Source: `isSafetyOverride()` in `executive_strategy_hints.js`

## How the Arbiter Applies Hints

Integration point: `scripts/arbiter.sh` function `_apply_strategy_hints()`

Pipeline: `_enumerate_objectives | _apply_strategy_hints → main loop`

Steps:
1. Read hints file from `$DELIVERY_OS_HOME/artifacts/executive-strategy-hints.json`
2. If Python module (`scripts/lib/oc_arbiter_hints.py`) missing → passthrough, emit `ARBITER_HINTS_SKIPPED`
3. If hints file missing → passthrough, emit `ARBITER_HINTS_SKIPPED`
4. Validate schema (version, computed_at, hints array, recommendation codes)
5. If invalid → passthrough (fail closed), emit `ARBITER_HINTS_FAILCLOSED`
6. Apply bounded deltas with safety overrides
7. Re-sort by `(-rank_delta, original_position)` for stable tie-breaking
8. Output reordered objectives, emit `ARBITER_HINTS_APPLIED`

### Determinism / Tie-Breaking

Sort key: `(-rank_delta, original_position)`
- Higher delta = sorted first (promoted)
- Equal delta = original enumeration order preserved (stable)

### Passthrough Guarantee

On any error, all objectives are emitted unchanged. The arbiter never loses objectives.

## Events

| Event | When |
|-------|------|
| `ARBITER_HINTS_APPLIED` | Hints read and deltas applied successfully |
| `ARBITER_HINTS_SKIPPED` | Hints file missing, module not found, or unknown status |
| `ARBITER_HINTS_FAILCLOSED` | Hints file corrupt or invalid schema |

Events are written via `emit_event` from `scripts/lib/oc_events.sh` to
`$DELIVERY_OS_HOME/_logs/agent-events.jsonl`.

## Common Failure Modes

| Failure | Behavior |
|---------|----------|
| Hints file missing | Passthrough + SKIPPED event |
| Python module missing | Passthrough + SKIPPED event |
| Invalid hints version | Passthrough + FAILCLOSED event |
| Invalid recommendation_code | Passthrough + FAILCLOSED event |
| Malformed JSON | Passthrough + FAILCLOSED event |
| Python exception | Objectives still emitted (buffered read) + FAILCLOSED event |

## Key Files

| File | Role |
|------|------|
| `scripts/executive_strategy_hints.js` | Hint generation + schema validation (Node.js) |
| `scripts/lib/oc_arbiter_hints.py` | Hint applier (Python stdin filter) |
| `scripts/arbiter.sh` | Integration (`_apply_strategy_hints` function) |
| `scripts/arbiter_hints.test.js` | 33 tests |
| `scripts/run_arbiter_hints_gate.js` | 12 CI gate checks |
| `scripts/fixtures/arbiter_hints/` | Fixtures (objectives.jsonl, hints_valid/invalid/safety.json) |

## How to Validate

```bash
node scripts/arbiter_hints.test.js             # 33/33 tests
node scripts/run_arbiter_hints_gate.js --ci    # 12/12 checks
```

## Assumptions / Invariants

- `HINTS_VERSION` is `'1.0.0'` and must match `ENGINE_VERSION`.
- The Python applier reads ALL stdin before processing (buffered for fail-closed safety).
- Status communicated via `--status-file` sideband (not stdout).
- The arbiter.sh `_apply_strategy_hints` function handles cleanup of temp status files.
