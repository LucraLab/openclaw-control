# Knowledge Directory

**Generated At:** 2026-02-11
**Last Verified Commit:** `b298289` (main)

## What's Inside

Stable reference documents derived from the actual codebase. Each file covers one domain.

| File | Topic | Key Contents |
|------|-------|--------------|
| `00_PROJECT_OVERVIEW.md` | Repo purpose and layout | Safety posture, "never do" list, directory map |
| `01_GATES_AND_BRANCH_PROTECTION.md` | CI gates and branch protection | 15 required checks, 10 gate runners (110 checks), drift config, bootstrap fix procedure |
| `02_EXECUTIVE_STRATEGY_ENGINE.md` | Scoring engine | 6 actions, 3 lenses, scoring model, events, LLM rules, artifacts |
| `03_ARBITER_HINTS_BRIDGE.md` | Hints pipeline | Hints schema v1, safety rules, Python applier, events, failure modes |
| `04_TESTS_AND_PROOFS.md` | Testing and proofs | 13 suites (337 tests), proof pack structure, rollback patterns, definition of done |
| `05_FIXTURE_MODE_RULES.md` | Fixture-only testing | Fixture bundles, loading patterns, determinism rules, anti-patterns |

## Source of Truth

These files describe the codebase — they are **not** the source of truth. The source of truth is always the code itself:

- Gate check counts → `scripts/run_*_gate.js`
- Test counts → `scripts/*.test.js`
- Branch protection contexts → `scripts/fixtures/branch_protection_ok.json`
- Enums and limits → `scripts/executive_strategy_schema.js`, `scripts/executive_evidence_graph.js`
- Drift baselines → `scripts/run_drift_telemetry_gate.js` (EXPECTED_CONTEXTS, REQUIRED_GATE_WORKFLOWS)

## How to Update Safely

1. **When:** After any port is merged and bootstrap fix is complete
2. **What changes:** Update counts (tests, gates, checks), add new fixture bundles, add new gate entries
3. **Verify first:** Run full regression (`node scripts/*.test.js` all 13 suites + all 10 gates) before updating docs
4. **Update procedure:**
   - Edit the relevant knowledge file(s)
   - Update "Last Verified Commit" in each changed file
   - Update "Generated At" and "Last Verified Commit" in this README
   - Commit with the bootstrap fix PR or as a separate docs PR

## What NOT to Put Here

- Secrets, API keys, tokens, credentials
- Timestamps other than "Generated At" and "Last Verified Commit"
- External URLs or links to services
- Stack traces or error logs
- Speculative or planned features (document only what exists)
- Duplicate information already in `docs/*.md` (link instead)

## Validation

Every knowledge file includes a "How to Validate" section with runnable commands. To validate the full repo state:

```bash
# All 13 gated test suites (337 tests)
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

# All 10 gates (110 checks)
for f in $(ls scripts/run_*_gate.js | sort); do node "$f" --ci || exit 1; done && echo "ALL GATES PASS"
```
