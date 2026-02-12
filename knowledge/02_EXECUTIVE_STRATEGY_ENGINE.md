# Executive Strategy Engine

**Last Verified Commit:** `b298289` (main)

## Purpose

The Executive Strategy Engine (`scripts/executive_strategy_engine.js`) is the
deterministic "executive brain" that ranks objectives and recommends actions.
It is hybrid: rules-first, with optional bounded LLM assist when uncertainty
triggers are met. Advisory only — produces JSON + MD artifacts, never mutates
objectives or repos.

## Scoring Model

### Default Scores (from `executive_strategy_schema.js:makeDefaultResult`)

| Field | Default | Range |
|-------|---------|-------|
| `priority_score` | 50 | 0–100 (integer) |
| `risk_score` | 50 | 0–100 (integer) |
| `confidence` | 0.5 | 0–1 (3 decimal places) |
| `recommended_action` | `PROCEED` | See actions below |

### Recommended Actions

Defined in `executive_strategy_schema.js:RECOMMENDED_ACTIONS`:

| Action | Meaning |
|--------|---------|
| `PROCEED` | Safe to continue delivery |
| `HOLD` | Quarantined or blocked — wait |
| `STOP` | Kill switch engaged — halt everything |
| `INVESTIGATE` | High risk or low confidence — needs human look |
| `RETRY` | Previous failure, conditions may have changed |
| `DEPRIORITIZE` | Low impact, defer |

### Action Determination Rules (priority order)

1. Kill switch → `STOP` (absolute override)
2. Quarantined → `HOLD`
3. Risk >= 70 AND confidence < 0.5 → `INVESTIGATE`
4. >= 3 failures → `RETRY` (if confidence >= 0.6) or `INVESTIGATE`
5. Priority < 45 AND risk <= 50 → `DEPRIORITIZE`
6. Default → `PROCEED`

### Clamping

- `clampScore(v)` → `Math.max(0, Math.min(100, Math.round(v)))`
- `clampConfidence(v)` → `Math.max(0, Math.min(1, parseFloat(v.toFixed(3))))`

## Three Intelligence Lenses

Each lens module lives in `scripts/modules/` and exports `analyze(objId, context)`:

| Lens | Module | Typical Signals |
|------|--------|-----------------|
| `dev` | `dev_intel.js` | CI gate results, build times, code churn, drift anomalies |
| `ops` | `ops_intel.js` | Infrastructure health, budget usage, lock contention |
| `business` | `business_intel.js` | ROI likelihood, deadline proximity, tags, SLA criticality |

Each returns: `{ score_delta, risk_delta, confidence_delta, signals[] }`

Deltas are summed across all three lenses, then scores are clamped.

## Engine Exports

```
module.exports = {
  run,                  // (context, config) → report
  scoreObjective,       // (objId, context, config) → scored result
  shouldTriggerLLM,     // (result, context) → reason|null
  sanitize,             // (str) → sanitized string
  ENGINE_VERSION,       // '1.0.0'
  generateHints,        // (report) → hints artifact|null (re-export from hints module)
  buildEvidenceGraph,   // (report, hints, context) → graph (re-export from evidence module)
}
```

## Artifact Outputs

| Artifact | Path | Format |
|----------|------|--------|
| Strategy Report | `artifacts/executive-strategy-report.json` | JSON |
| Strategy Report (readable) | `artifacts/executive-strategy-report.md` | Markdown |
| Strategy Hints | `artifacts/executive-strategy-hints.json` | JSON |
| Evidence Graph | `artifacts/executive-evidence-graph.json` | JSON |
| Evidence Graph (readable) | `artifacts/executive-evidence-graph.md` | Markdown |

## Events

| Event | When |
|-------|------|
| `EXEC_STRATEGY_COMPUTED` | Report generated successfully |
| `EXEC_STRATEGY_FAILCLOSED` | Invalid context → safe empty report |
| `EXEC_STRATEGY_LLM_USED` | LLM assist triggered and succeeded |
| `EXEC_STRATEGY_LLM_SKIPPED` | LLM disabled or no trigger condition met |

## LLM Assist Rules

- **Default**: `llm_enabled = false` — never enabled in CI.
- **Trigger conditions** (checked by `shouldTriggerLLM`):
  - Confidence < 0.65
  - Risk >= 70 with no tags and no due_date
  - >= 3 failures with >= 2 distinct failure reasons
- **Fail closed**: LLM exception → `{ failed: true, reason: 'exception' }`; rules-only scores stand.
- **Bounded**: LLM may adjust confidence (clamped) and append up to 3 suggestions.

## Secret Sanitization

Pattern: `SECRET_PATTERN` matches `sk-`, `ghp_`, `pit-`, `AKIA`, `eyJ`, `Bearer`, `token=`, `key=`, `password=`, `secret=`, and PEM private key blocks.

Applied via `sanitize()` and `sanitizeObj()` to all report output.

## How to Validate

```bash
node scripts/executive_strategy.test.js         # 35/35 tests
node scripts/run_executive_strategy_gate.js --ci # 12/12 checks
```

## Assumptions / Invariants

- `ENGINE_VERSION` is `'1.0.0'` and must match `HINTS_VERSION` in the hints module.
- Report sort order: `priority_score` descending, then `objective_id` ascending (stable).
- Context must have: `events[]`, `gateReports{}`, `objectives{}`, `quarantine{}`, `killSwitch`, `commitSha`.
