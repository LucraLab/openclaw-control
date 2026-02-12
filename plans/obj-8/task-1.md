# Task 1: Objective Locking

## Scope

Add single-writer locking to delivery_loop.sh using atomic `mkdir` as the
lock primitive. Crash-safe via trap. Stale detection via PID + TTL.

## Changes

### Added (2)

1. `scripts/lib/oc_lock.sh` — Lock library (acquire, release, stale, trap)
2. `scripts/objective_locking.test.js` — 17 lock tests

### Modified (1)

1. `scripts/delivery_loop.sh` — Source oc_lock.sh, lock at two chokepoints

### Updated (2)

1. `scripts/run_isolation_guard_gate.js` — 16 → 20 smoke checks (+4 new)
2. `docs/OBJECTIVE_LOCKING.md` — Lock behavior documentation

### Added (1)

1. `plans/obj-8/task-1.md` — This plan

## Verification

- 17/17 objective locking tests pass
- 20/20 gate runner smoke checks pass
- All existing CI gates pass (113+ pre-existing tests unchanged)
- delivery_loop.sh sources oc_lock.sh
- lock_acquire called at both chokepoints (main + close-check)
- lock_install_trap installed after each lock_acquire
- Lock path under $OC_AGENT_ROOT/objectives/ (agent-scoped)
- Stale lock recovered with LOCK_STALE_RECOVERED event
- Fail closed on ambiguous locks (corrupt metadata within TTL)

## Rollback

```bash
git revert <merge_commit_sha>
```

Lock library becomes unused. Leftover .lock.d dirs harmless.
