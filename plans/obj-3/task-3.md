# Task 3: Two-Stage PR Review Gate

## Scope

Add deterministic two-stage PR review gate to openclaw-control:
- Stage 1: spec compliance (objective, task, risk, DoD, plan)
- Stage 2: quality check (secrets, binaries, public-safe, forbidden paths)
- CI workflow, tests, docs, PR template

## Verification

- 12/12 unit tests pass (node scripts/two_stage_pr_review.test.js)
- All existing CI gates pass (verification-gate, context-budget, etc.)
- 10/10 VG + 10/10 CB + 11/11 DL regression tests pass
- Zero false positives on repo content

## Rollback

- Revert merge commit: `git revert <merge-sha>`
- Or delete workflow: `rm .github/workflows/gate-two-stage-pr-review.yml`
- No branch protection changes to undo
