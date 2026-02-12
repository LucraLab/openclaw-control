# Task 1: Objective Arbitration + Global Queue

## Scope

Add global queue and cross-resource locking to Delivery OS so multiple
agents can run autonomously without duplicate work or repo/branch
collisions.

## Changes

### Added (3)

1. `scripts/lib/oc_resource_lock.sh` — Shared resource lock library
2. `scripts/arbiter.sh` — Objective arbiter with deterministic selection
3. `scripts/arbitration.test.js` — 22+ arbitration tests

### Modified (1)

1. `scripts/delivery_loop.sh` — Run token support, lock ordering, dual trap

### Added (CI)

1. `scripts/run_arbitration_gate.js` — 10 arbitration smoke checks
2. `.github/workflows/gate-arbitration.yml` — CI gate workflow

### Added (Docs)

1. `docs/ARBITRATION.md` — Arbitration behavior documentation
2. `plans/obj-9/task-1.md` — This plan

## Verification

- 22/22 arbitration tests pass
- 10/10 arbitration gate smoke checks pass
- All existing CI gates pass (130+ pre-existing tests unchanged)
- delivery_loop.sh sources oc_resource_lock.sh
- delivery_loop.sh accepts --run-token argument
- Lock ordering enforced: resource_lock_acquire before lock_acquire
- Reverse release in trap: objective first, then resource
- Run token obj_id and repo verified (fail closed on mismatch)
- Resource locks at $DELIVERY_OS_HOME/_locks/ (shared, not agent-scoped)
- Stale resource locks recovered with ARBITRATION_STALE_RECOVERED event
- Fail closed on corrupt/missing metadata within TTL

## Rollback

```bash
git revert <merge_commit_sha>
```

Resource lock library becomes unused. Leftover `.lock.d` dirs in
`_locks/` are harmless and can be cleaned manually.
