# Task 1: Capability Matrix Enforcement

## Scope

Add capability matrix enforcement to openclaw-control:
- Capability policy module with 3 chokepoint wrappers (model, tool, write)
- Agent profiles (builder, executor) with fail-closed defaults
- Side-effect class gating with approval tokens
- Model escalation guard (Port #4 compatible)
- Deny event logging with monotonic event_seq
- Proof artifact generation on denial
- CI gate workflow, 16 tests, docs

## Verification

- 16/16 unit + chokepoint integrity tests pass (node scripts/capability_matrix.test.js)
- Gate runner produces valid JSON + MD reports (12 smoke checks)
- All existing CI gates pass
- 10/10 VG + 10/10 CB + 12/12 PR + 14/14 BE + 11/11 DL regression tests pass
- Zero false positives on repo content

## Rollback

- Revert merge commit: `git revert <merge-sha>`
- Or delete workflow: `rm .github/workflows/gate-capability-matrix.yml`
- No branch protection changes to undo
- No existing files modified
