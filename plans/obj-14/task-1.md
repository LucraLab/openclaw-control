# Port #14: Evidence Graph v1 — Task Plan

## Objective

Deterministic evidence graph that explains why each objective was scored
the way it was, how hint deltas were derived, and arbiter reordering.

## Changes

### New files (7)

1. `scripts/executive_evidence_graph.js` — Core builder + schema + validation + markdown
2. `scripts/evidence_graph.test.js` — 33 tests
3. `scripts/run_evidence_graph_gate.js` — CI gate (12 checks)
4. `.github/workflows/gate-evidence-graph.yml` — CI workflow
5. `docs/EVIDENCE_GRAPH.md` — Feature documentation
6. `plans/obj-14/task-1.md` — This plan

### Modified files (1)

1. `scripts/executive_strategy_engine.js` — Re-export evidence graph builder

## Rollback

```bash
git revert <merge_commit_sha>
```

Remove `evidence-graph` from branch protection required checks.
