# Evidence Graph v1

## Overview

The Evidence Graph explains **exactly why** the Executive Strategy Engine scored
each objective the way it did, how hint deltas were derived, and what the arbiter
reordering looks like.

**Receipts-first** — every derived change points to a rule that fired and a
supporting evidence source.

**Deterministic** — same inputs produce identical output.

## Architecture

```
  ┌─────────────────────┐
  │  Executive Strategy │
  │  Engine (report)    │
  └──────┬──────────────┘
         │
         ▼
  ┌─────────────────────┐     ┌──────────────────┐
  │  Evidence Graph     │◀────│  Hints Artifact   │
  │  Builder            │     │  (optional)       │
  └──────┬──────────────┘     └──────────────────┘
         │
         ▼
  ┌─────────────────────┐
  │  JSON + Markdown    │
  │  Artifacts          │
  └─────────────────────┘
```

## Artifacts

- `artifacts/executive-evidence-graph.json` — Machine-readable graph
- `artifacts/executive-evidence-graph.md` — Human-readable markdown

## JSON Schema

```json
{
  "version": "v1",
  "computed_at": "ISO-8601",
  "inputs": {
    "telemetry_bundle_hash": "sha256",
    "objectives_hash": "sha256",
    "hints_hash": "sha256 | none"
  },
  "objectives": [
    {
      "objective_id": "obj-42",
      "strategy": {
        "priority_score": 75,
        "risk_score": 30,
        "confidence": 0.85,
        "recommended_action": "PROCEED"
      },
      "hint": {
        "rank_delta_hint": 5,
        "forced_zero_reason": "NONE",
        "clamp_applied": false,
        "recommendation_code": "FOCUS"
      },
      "derivations": [
        {
          "kind": "BASE|DELTA|OVERRIDE|CLAMP",
          "target": "priority_score|risk_score|confidence|recommended_action|rank_delta_hint",
          "from": "<value_before>",
          "to": "<value_after>",
          "rule": "description of rule that fired",
          "evidence": [
            { "source": "drift|budget|arbitration|quarantine|kill_switch|event_log|hints", "ref": "description" }
          ]
        }
      ],
      "signals": [
        {
          "lens": "dev|ops|business",
          "severity": "low|med|high",
          "text": "signal text",
          "evidence_ref": "source classification"
        }
      ]
    }
  ],
  "arbiter_simulation": [
    {
      "objective_id": "obj-42",
      "original_position": 0,
      "rank_delta": 5,
      "final_position": 0
    }
  ],
  "summary": {
    "total_objectives": 5,
    "actions": { "PROCEED": 3, "HOLD": 1 },
    "forced_zero_count": 2,
    "mean_confidence": 0.72,
    "failclosed": false
  }
}
```

## Enums

| Enum | Values |
|------|--------|
| FORCED_ZERO_REASONS | NONE, KILL_SWITCH, QUARANTINE, LOW_CONFIDENCE, HIGH_RISK, SCHEMA_INVALID |
| DERIVATION_KINDS | BASE, DELTA, OVERRIDE, CLAMP |
| DERIVATION_TARGETS | priority_score, risk_score, confidence, recommended_action, rank_delta_hint |
| EVIDENCE_SOURCES | drift, budget, arbitration, quarantine, kill_switch, event_log, hints |
| SIGNAL_SEVERITIES | low, med, high |
| SIGNAL_LENSES | dev, ops, business |
| RECOMMENDATION_CODES | STOP, HOLD, INVESTIGATE, PLAN, FOCUS, CONTAIN |

## Bounds

| Limit | Value |
|-------|-------|
| max_objectives | 10,000 |
| max_derivations | 40 per objective |
| max_signals | 30 per objective |
| max_evidence_per_derivation | 10 |
| max_string_length | 500 chars |

## Derivation Chain

Each objective's derivations trace the complete scoring history:

1. **BASE** — Initial scores (priority=50, risk=50, confidence=0.5)
2. **DELTA** — Lens adjustments (dev, ops, business score/risk/confidence deltas)
3. **CLAMP** — Bounds enforcement (if raw values exceed 0-100 or 0-1)
4. **OVERRIDE** — Kill switch or quarantine forced action changes
5. **DELTA** — Hint rank_delta_hint computed from priority_score
6. **CLAMP** — Hint delta clamped to [-10, +10] (if needed)
7. **OVERRIDE** — Safety override zeros the hint delta

## Forced Zero Reasons

| Condition | Reason |
|-----------|--------|
| recommended_action = STOP | KILL_SWITCH |
| recommended_action = HOLD | QUARANTINE |
| confidence < 0.4 | LOW_CONFIDENCE |
| risk_score >= 90 | HIGH_RISK |
| Hints fail schema validation | SCHEMA_INVALID |
| None of the above | NONE |

## Arbiter Simulation

The evidence graph includes a JS simulation of the Python arbiter hints applier:
- Applies hint deltas with safety overrides
- Sorts by (-rank_delta, original_position)
- Shows original → final position for each objective

## Events

| Event | When |
|-------|------|
| EXEC_EVIDENCE_COMPUTED | Graph built successfully |
| EXEC_EVIDENCE_FAILCLOSED | Graph build failed, minimal safe graph returned |

## Fail-Closed Behavior

On any error (invalid report, missing objectives, exception), the builder returns
a minimal safe graph with `summary.failclosed = true` and emits
EXEC_EVIDENCE_FAILCLOSED. The failclosed graph is schema-valid.

## Security

- All strings sanitized via SECRET_PATTERN (sk-, ghp_, pit-, AKIA, eyJ, Bearer, private keys)
- No shared mutable state
- No network calls, no LLM, no shelling out
- Deterministic: caller controls `computed_at` via report timestamp

## CI Gate

The `evidence-graph` CI gate runs:
1. `node scripts/evidence_graph.test.js` — 33 tests
2. `node scripts/run_evidence_graph_gate.js --ci` — 12 checks

## Rollback

```bash
git revert <merge_commit_sha>
# Remove evidence-graph from branch protection required checks
```
