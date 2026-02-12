# Fixture Mode Rules

**Last Verified Commit:** `b298289` (main)

## Core Invariant

**All tests and gates run without network, without LLM, without live state.**
Every piece of external data comes from fixtures or is built in-memory.

## Fixture Bundles

### `scripts/fixtures/executive_strategy/` (4 files)

| File | Format | Purpose |
|------|--------|---------|
| `objectives.json` | JSON object | 5 keyed objectives (obj-42 to obj-46) |
| `events.jsonl` | JSONL | Event log entries (one JSON per line) |
| `gate_reports.json` | JSON array | Gate check results for scoring |
| `quarantine.json` | JSON object | Quarantine state for objective overrides |

Used by: `executive_strategy.test.js`, `run_executive_strategy_gate.js`, `arbiter_hints.test.js`, `run_arbiter_hints_gate.js`

### `scripts/fixtures/arbiter_hints/` (4 files)

| File | Format | Purpose |
|------|--------|---------|
| `hints_valid.json` | JSON (hints envelope) | 5 valid hints with varied rank_delta_hint (-4 to +6) |
| `hints_invalid.json` | JSON | Bad version (2.0.0), out-of-range delta (999), invalid code |
| `hints_safety.json` | JSON | Hints triggering safety overrides (high risk, low confidence, STOP, HOLD) |
| `objectives.jsonl` | JSONL | 5 objectives for Python applier input |

Used by: `arbiter_hints.test.js`, `run_arbiter_hints_gate.js`

### `scripts/fixtures/` (root level, 3 files)

| File | Purpose |
|------|---------|
| `branch_protection_ok.json` | 15 required check contexts (current correct state) |
| `branch_protection_missing.json` | 14 contexts (one removed — tests drift detection) |
| `branch_protection_extra.json` | 16 contexts (one added — tests extra detection) |
| `sample_events.jsonl` | Sample event log for drift/telemetry tests |

Used by: `drift_telemetry.test.js`, `run_drift_telemetry_gate.js`

## How Runners Select Fixtures

### Pattern 1: File-based loading

```javascript
const FIXTURES_DIR = path.join(REPO_ROOT, 'scripts', 'fixtures', 'arbiter_hints');
const data = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'hints_valid.json'), 'utf8'));
```

All paths are relative to `REPO_ROOT` (resolved from `__dirname/..`). No environment variables, no configuration files.

### Pattern 2: `fixtures_mode: true` flag

```javascript
const report = engine.run(context, { fixtures_mode: true });
```

Passed to `executive_strategy_engine.run()` as second argument. The engine records it in `report.config.fixtures_mode` for audit. Currently the engine does not change behavior based on this flag — it exists for traceability (so artifacts show they were produced from fixture data).

### Pattern 3: In-memory builders

```javascript
function makeObjResult(id, overrides) { /* ... */ }
function makeReport(objectives) { /* ... */ }
function makeHints(hints) { /* ... */ }
```

Used by `evidence_graph.test.js` and `run_evidence_graph_gate.js`. No disk fixtures needed — all data constructed programmatically with deterministic defaults.

### Pattern 4: JSONL line-by-line

```javascript
const entries = fs.readFileSync(filePath, 'utf8').trim()
  .split('\n').map(l => JSON.parse(l));
```

Used for event logs and objective lists where each line is an independent JSON object.

## What `fixtures_mode` Does NOT Do

- Does **not** disable network (there is no network code to disable)
- Does **not** mock modules (no mocking framework exists)
- Does **not** swap implementations (pure functions only)
- Is purely a **traceability marker** in the output artifact

## Determinism Rules

| Rule | Enforced By |
|------|-------------|
| Same inputs produce byte-identical JSON | `evidence_graph.test.js` EG-T10, `run_evidence_graph_gate.js` EG11 |
| Timestamp controlled by caller | `report.timestamp` from fixtures, `computed_at` from caller |
| No `Date.now()` in scoring logic | Code review — timestamps come from input data |
| No `Math.random()` anywhere | Code review — no random values |
| Stable sort (priority_score desc, objective_id asc) | `executive_strategy_engine.js` sort comparator |
| Key-order-independent hashing | `sortedStringify()` in evidence graph |

## Temp File Discipline

Gate runners and some tests write to `artifacts/` and `tmp/`:

- Both directories are `.gitignore`d
- Gate runners create directories with `fs.mkdirSync(dir, { recursive: true })`
- Python applier tests write temp JSONL files and `fs.unlinkSync()` after use
- No test depends on artifacts from a previous run

## Anti-Patterns

| Anti-Pattern | Why It Breaks | Correct Approach |
|--------------|---------------|------------------|
| `fetch()` or `http.get()` in tests | CI has no network access; non-deterministic | Use fixture files or in-memory builders |
| `new Date()` for scoring timestamps | Non-deterministic output | Use timestamp from fixture data |
| Reading from `artifacts/` as input | Depends on prior run state | Read from `scripts/fixtures/` |
| Sharing mutable state between tests | Order-dependent failures | Each test builds its own fixture data |
| Hardcoding absolute paths | Breaks on other machines | Use `path.join(REPO_ROOT, ...)` |
| Calling LLM APIs in tests | Slow, non-deterministic, costs money | Engine's `llm_enabled: false` default |
| Environment variables for fixture paths | Fragile, hard to reproduce | Hardcode relative to `REPO_ROOT` |

## Adding New Fixtures

When a new port needs fixture data:

1. Create a subdirectory: `scripts/fixtures/<port_name>/`
2. Use JSON for structured data, JSONL for line-oriented data
3. Keep fixtures minimal — only what tests need
4. Commit fixtures with the port PR (not separately)
5. Document the fixture bundle in this file

When a port uses in-memory builders instead:

1. Define `makeX()` helpers at the top of the test file
2. Use deterministic defaults (priority=50, risk=50, confidence=0.5)
3. Accept `overrides` parameter for test-specific values
4. No disk fixtures needed — document in this file as "in-memory"

## Bootstrap Fix Fixtures

Three branch protection fixture files must be updated when adding a new CI gate:

| File | Current Count | Update Rule |
|------|---------------|-------------|
| `branch_protection_ok.json` | 15 contexts | Add new gate check name |
| `branch_protection_missing.json` | 14 contexts | Add new gate check name (stays N-1) |
| `branch_protection_extra.json` | 16 contexts | Add new gate check name (stays N+1) |

These are updated in the bootstrap fix PR, not in the port PR itself.

## Assumptions / Invariants

- CI runners have no outbound network (GitHub Actions with no secrets or service containers)
- Python 3 is available (required by `arbiter_hints.test.js` for `oc_arbiter_hints.py`)
- Node.js 20+ is available (all test suites)
- No test framework dependencies (no jest, mocha, tap) — all custom
- `fs`, `path`, `child_process`, `crypto` are the only Node.js built-ins used

## How to Validate

```bash
# Verify all fixture files parse correctly
node -e "
  const fs = require('fs'), p = require('path');
  const root = p.resolve(__dirname);
  const files = [
    'scripts/fixtures/executive_strategy/objectives.json',
    'scripts/fixtures/executive_strategy/gate_reports.json',
    'scripts/fixtures/executive_strategy/quarantine.json',
    'scripts/fixtures/branch_protection_ok.json',
    'scripts/fixtures/branch_protection_missing.json',
    'scripts/fixtures/branch_protection_extra.json',
    'scripts/fixtures/arbiter_hints/hints_valid.json',
    'scripts/fixtures/arbiter_hints/hints_invalid.json',
    'scripts/fixtures/arbiter_hints/hints_safety.json',
  ];
  files.forEach(f => { JSON.parse(fs.readFileSync(p.join(root, f), 'utf8')); console.log('OK', f); });
  console.log('All fixture files parse successfully');
"
```
