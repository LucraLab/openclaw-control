# Tests and Proofs

**Last Verified Commit:** `b298289` (main)

## Test Suites (13 gated)

All test suites are in `scripts/` and run with `node scripts/<name>.test.js`.

| Suite | Tests | What It Covers |
|-------|-------|----------------|
| `isolation_guard.test.js` | 42 | Environment isolation, sandbox boundaries |
| `drift_telemetry.test.js` | 25 | Branch protection drift, workflow integrity, spend telemetry |
| `arbitration.test.js` | 22 | Objective arbitration, priority, blocks |
| `executive_strategy.test.js` | 35 | Engine scoring, actions, LLM assist, sanitization |
| `budget_enforcement.test.js` | 14 | Budget policy, breach detection |
| `capability_matrix.test.js` | 17 | Capability declarations, matrix completeness |
| `context_budget.test.js` | 10 | Context token budget limits |
| `ops_hardening.test.js` | 27 | Triage, unquarantine, incident response scripts |
| `objective_locking.test.js` | 17 | Objective file locking |
| `two_stage_pr_review.test.js` | 12 | PR review workflow compliance |
| `verification_gate.test.js` | 10 | Verification on fresh checkout |
| `arbiter_hints.test.js` | 33 | Hints schema, generation, safety, Python applier |
| `evidence_graph.test.js` | 73 | Evidence graph build, validate, markdown, determinism |
| **Total** | **337** | |

### Non-Gated Test File

`coverage_report.test.js` — exists but is not part of the gated regression suite.
Has known pre-existing failures. Not listed in branch protection contexts.

## Running Full Tests

```bash
# Run all 13 gated suites
for f in scripts/isolation_guard.test.js \
         scripts/drift_telemetry.test.js \
         scripts/arbitration.test.js \
         scripts/executive_strategy.test.js \
         scripts/budget_enforcement.test.js \
         scripts/capability_matrix.test.js \
         scripts/context_budget.test.js \
         scripts/ops_hardening.test.js \
         scripts/objective_locking.test.js \
         scripts/two_stage_pr_review.test.js \
         scripts/verification_gate.test.js \
         scripts/arbiter_hints.test.js \
         scripts/evidence_graph.test.js; do
  echo "--- $f ---"
  node "$f"
done
```

## Running All Gates

```bash
# Run all 10 gate runners
for f in $(ls scripts/run_*_gate.js | sort); do
  echo "--- $f ---"
  node "$f" --ci
done
```

Expected: 110/110 gate checks pass across 10 gates.

## Proof Pack Structure

Proof packs document the verified state after a port is merged. They live in `proofs/`.

### Contents of a Proof Pack

- **Commit**: Main branch SHA after merge + bootstrap fix
- **Branch Protection**: Confirmed check count
- **Test Results**: Table of all suite pass/fail counts
- **Gate Results**: Table of all gate pass/fail counts
- **New Files**: List of files added by the port
- **Modified Files**: List of files changed
- **Bootstrap Fix Files**: Drift baseline and fixture updates
- **Key Properties Verified**: Determinism, fail-closed, sanitization, bounds, etc.

### Naming Convention

`proofs/PROOF_PACK_PORT<N>_<NAME>_<TIMESTAMP>.md`

## Rollback Patterns

Every port's `docs/<NAME>.md` includes a rollback section. The pattern is:

```bash
git revert <merge_commit_sha>
# Remove <context-name> from branch protection required checks
```

Since each port is merged as a separate PR, rollback is a single `git revert`
of the merge commit. Bootstrap fix PRs are also separate, so rollback of both
the port and its baseline update is two reverts.

## "Definition of Done" for a New Port

A port is complete when ALL of the following are true:

1. **Code written**: Core module + test suite + gate runner + CI workflow + docs + plan
2. **Engine patched**: If the port produces an artifact, it is re-exported from the engine
3. **Tests pass**: All new tests pass AND all existing tests still pass (zero regressions)
4. **Gates pass**: All new gate checks pass AND all existing gates still pass
5. **PR merged**: Port PR merged to main
6. **Bootstrap fix merged**: Drift baselines updated (EXPECTED_CONTEXTS, REQUIRED_GATE_WORKFLOWS, branch protection fixtures, DT-T5)
7. **Branch protection restored**: Main requires N+1 checks (new gate added)
8. **Fresh clone verified**: All tests and gates pass on a clean `git clone`
9. **Proof pack written**: Documents the verified state

## How to Validate

```bash
# Full regression (tests + gates) on current checkout
node scripts/isolation_guard.test.js && \
node scripts/drift_telemetry.test.js && \
node scripts/arbitration.test.js && \
node scripts/executive_strategy.test.js && \
node scripts/budget_enforcement.test.js && \
node scripts/capability_matrix.test.js && \
node scripts/context_budget.test.js && \
node scripts/ops_hardening.test.js && \
node scripts/objective_locking.test.js && \
node scripts/two_stage_pr_review.test.js && \
node scripts/verification_gate.test.js && \
node scripts/arbiter_hints.test.js && \
node scripts/evidence_graph.test.js && \
echo "ALL TESTS PASS"

# All gates
for f in $(ls scripts/run_*_gate.js | sort); do node "$f" --ci || exit 1; done && echo "ALL GATES PASS"
```

## Assumptions / Invariants

- Tests use no network. All external data is from fixtures.
- Test frameworks are custom (no jest/mocha). Each test file is standalone.
- Gate runners write to `artifacts/` and `tmp/` directories (both gitignored in CI).
- Python 3 is required for `arbiter_hints.test.js` (shells out to `oc_arbiter_hints.py`).
