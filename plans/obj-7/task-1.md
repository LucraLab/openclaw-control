# Task 1: Path Migration to Agent-Scoped Roots

## Scope

Migrate all production scripts from legacy shared paths to agent-scoped roots:

- `$DELIVERY_OS_HOME/objectives/` → `$OC_AGENT_ROOT/objectives/`
- `$DELIVERY_OS_HOME/workspaces/` → `$OC_AGENT_ROOT/workspaces/`

Add backward compatibility via safe one-time migration (Option A).

## Changes

### Modified (5)

1. `scripts/lib/oc_paths.sh` — Add `oc_require_agent_id()`, `oc_migrate_legacy_file()`
2. `scripts/delivery_loop.sh` — Agent-scoped OBJECTIVES_DIR + WORK_DIR + migration
3. `scripts/objective_create.sh` — Agent-scoped OBJECTIVES_DIR + migration
4. `scripts/staging_smoke.sh` — Agent-scoped objective paths + migration
5. `scripts/task_pr_sync.sh` — Require agent ID

### Updated (3)

1. `scripts/isolation_guard.test.js` — 25 → 42 tests (17 new)
2. `scripts/run_isolation_guard_gate.js` — 12 → 16 smoke checks (4 new)
3. `docs/ENVIRONMENT_ISOLATION.md` — Document agent-scoped paths + migration

### Added (1)

1. `plans/obj-7/task-1.md` — This plan

## Verification

- 42/42 isolation guard tests pass
- 16/16 gate runner smoke checks pass
- All existing CI gates pass
- All 4 production scripts call `oc_require_agent_id`
- OBJECTIVES_DIR uses `$OC_AGENT_ROOT` not `$DELIVERY_OS_HOME`
- WORK_DIR uses `$OC_AGENT_ROOT` not `$DELIVERY_OS_HOME`
- Migration: legacy file moves to agent-scoped path with PATH_MIGRATION event
- Migration: conflict (both exist) fails closed
- Static check: no production script writes to legacy shared paths

## Rollback

```bash
git revert <merge_commit_sha>
```

Scripts revert to legacy shared paths. Migration function remains harmless.
