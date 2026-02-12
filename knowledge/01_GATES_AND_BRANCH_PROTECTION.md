# Gates and Branch Protection

**Last Verified Commit:** `b298289` (main)

## Required Checks (15)

Source of truth: `scripts/fixtures/branch_protection_ok.json` (15 contexts)

| # | Context Name | Gate Runner | Workflow File | What It Verifies |
|---|-------------|-------------|---------------|-----------------|
| 1 | `arbiter-hints` | `run_arbiter_hints_gate.js` | `gate-arbiter-hints.yml` | Hints schema, delta bounds, safety overrides, Python applier behavior |
| 2 | `arbitration` | `run_arbitration_gate.js` | `gate-arbitration.yml` | Objective arbitration logic, priority ordering, block handling |
| 3 | `budget-enforcement` | `run_budget_enforcement_gate.js` | `gate-budget-enforcement.yml` | Budget policy enforcement, breach detection, limits |
| 4 | `capability-matrix` | `run_capability_matrix_gate.js` | `gate-capability-matrix.yml` | Capability declarations, matrix completeness |
| 5 | `context-budget` | N/A | `gate-context-budget.yml` | Context token budget limits for LLM calls |
| 6 | `drift-telemetry` | `run_drift_telemetry_gate.js` | `gate-drift-telemetry.yml` | Branch protection drift, workflow integrity, write-surface scan, spend telemetry |
| 7 | `evidence-graph` | `run_evidence_graph_gate.js` | `gate-evidence-graph.yml` | Evidence graph schema, determinism, sanitization, failclosed behavior |
| 8 | `executive-strategy` | `run_executive_strategy_gate.js` | `gate-executive-strategy.yml` | Strategy engine scoring, action determination, sanitization |
| 9 | `isolation-guard` | `run_isolation_guard_gate.js` | `gate-isolation-guard.yml` | Environment isolation, no cross-contamination, sandbox boundaries |
| 10 | `lint-markdown` | N/A | `gate-markdown.yml` | Markdown linting across docs/ |
| 11 | `ops-hardening` | `run_ops_hardening_gate.js` | `gate-ops-hardening.yml` | Operational scripts, triage, unquarantine, incident response |
| 12 | `scan-public-safe` | N/A | `gate-publicsafe.yml` | No accidental public exposure of internal assets |
| 13 | `scan-secrets` | N/A | `gate-secrets.yml` | No secrets committed to repo |
| 14 | `two-stage-pr-review` | N/A | `gate-two-stage-pr-review.yml` | PR review workflow compliance |
| 15 | `verification-gate` | `run_verification_gate.js` | `gate-verification-fresh.yml` | Verification completeness on fresh checkout |

## Gate Runner Summary

10 gate runners exist in `scripts/run_*_gate.js`. Each:
- Accepts `--ci` flag for CI mode
- Writes a JSON report to `tmp/`
- Exits non-zero on any failed check
- Is fixture-only (no network, no live state in CI)

### Gate Check Counts (at commit b298289)

| Gate | Checks |
|------|--------|
| arbiter-hints | 12 |
| arbitration | 10 |
| budget-enforcement | 9 |
| capability-matrix | 12 |
| drift-telemetry | 10 |
| evidence-graph | 12 |
| executive-strategy | 12 |
| isolation-guard | 20 |
| ops-hardening | 10 |
| verification | 3 |
| **Total** | **110** |

## Drift Telemetry Configuration

Source of truth: `scripts/run_drift_telemetry_gate.js`

- **EXPECTED_CONTEXTS**: 15 entries (must match `branch_protection_ok.json`)
- **REQUIRED_GATE_WORKFLOWS**: 14 entries mapping workflow filenames to job IDs

When adding a new gate:
1. Add context to `EXPECTED_CONTEXTS` array
2. Add workflow → job mapping to `REQUIRED_GATE_WORKFLOWS`
3. Update `scripts/drift_telemetry.test.js` DT-T5 (reordered contexts fixture)
4. Update all 3 branch protection fixtures: `ok` (+1), `missing` (+1), `extra` (+1)

## Branch Protection Fixtures

| Fixture | Contexts | Purpose |
|---------|----------|---------|
| `branch_protection_ok.json` | 15 | Exact match — gate passes |
| `branch_protection_missing.json` | 14 | One missing — gate detects drift |
| `branch_protection_extra.json` | 16 | One extra — gate detects drift |

## How to Validate

```bash
node scripts/run_drift_telemetry_gate.js --ci   # 10/10 checks
node scripts/drift_telemetry.test.js             # 25/25 tests
```

## Assumptions / Invariants

- Every new port that adds a CI workflow MUST update drift baselines (bootstrap fix pattern).
- Branch protection is temporarily removed for merge, then immediately restored with updated checks.
- The `enforce_admins` flag is `false` to allow bootstrap merges.
