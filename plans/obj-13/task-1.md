# Port #13: Strategy → Arbiter Input Bridge — Task Plan

## Objective

Connect Executive Strategy Engine output to arbiter objective ranking via
a bounded, advisory-only hints artifact.

## Changes

### New files (10)

1. `scripts/executive_strategy_hints.js` — Hints generation + schema validation
2. `scripts/lib/oc_arbiter_hints.py` — Python arbiter hints applier (stdin filter)
3. `scripts/arbiter_hints.test.js` — 33 tests
4. `scripts/run_arbiter_hints_gate.js` — CI gate runner (12 checks)
5. `.github/workflows/gate-arbiter-hints.yml` — CI workflow
6. `scripts/fixtures/arbiter_hints/objectives.jsonl` — Test objectives
7. `scripts/fixtures/arbiter_hints/hints_valid.json` — Valid hints fixture
8. `scripts/fixtures/arbiter_hints/hints_invalid.json` — Invalid hints fixture
9. `scripts/fixtures/arbiter_hints/hints_safety.json` — Safety override fixture
10. `docs/ARBITER_HINTS.md` — Feature documentation
11. `plans/obj-13/task-1.md` — This plan

### Modified files (2)

1. `scripts/executive_strategy_engine.js` — Re-export generateHints
2. `scripts/arbiter.sh` — Add _apply_strategy_hints() pipe

## Rollback

```bash
git revert <merge_commit_sha>
```

Remove `arbiter-hints` from branch protection required checks.
