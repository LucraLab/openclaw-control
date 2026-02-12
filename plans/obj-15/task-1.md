# Port #15: Safe Autopilot Fix Pack v1 — Task Plan

## Objective

Deterministic, bounded, advisory-only fix pack that turns evidence graph
output into actionable remediation plans without executing anything.

## Changes

### New files (6)

1. `scripts/fix_pack.js` — Core builder + schema + validation + markdown + sanitization
2. `scripts/fix_pack.test.js` — 45 tests
3. `scripts/run_fix_pack_gate.js` — CI gate (12 checks)
4. `.github/workflows/gate-fix-pack.yml` — CI workflow
5. `docs/FIX_PACK.md` — Feature documentation
6. `plans/obj-15/task-1.md` — This plan

### Modified files (1)

1. `scripts/executive_strategy_engine.js` — Re-export fix pack builder

## Rollback

```bash
git revert <merge_commit_sha>
```

Remove `fix-pack` from branch protection required checks.
