# Task 1: Budget Enforcement Gate

## Scope

Add budget enforcement policy module to openclaw-control:
- Budget tracker with 4 limit types (tokens, steps, retries, wall clock)
- Model escalation guard (expensive model blocked unless final+reason)
- Proof artifact generation on breach
- CI gate workflow, 14 tests, docs

## Verification

- 14/14 unit tests pass (node scripts/budget_enforcement.test.js)
- Gate runner produces valid JSON + MD reports
- All existing CI gates pass (verification-gate, context-budget, etc.)
- 10/10 VG + 10/10 CB + 12/12 PR + 11/11 DL regression tests pass
- Zero false positives on repo content

## Rollback

- Revert merge commit: `git revert <merge-sha>`
- Or delete workflow: `rm .github/workflows/gate-budget-enforcement.yml`
- No branch protection changes to undo
- Existing 43 tests remain untouched
