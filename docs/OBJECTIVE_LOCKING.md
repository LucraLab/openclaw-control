# Objective Locking

Prevents concurrent delivery loop runs from corrupting the same objective
state by enforcing single-writer semantics with crash-safe unlock.

## Lock Primitive

Lock uses `mkdir` (atomic on POSIX) to create a lock directory:

```
$OC_AGENT_ROOT/objectives/${OBJ_ID}.lock.d/
```

The lock sits adjacent to the objective JSON file and is agent-scoped,
preventing cross-agent lock contention.

## Lock Metadata

On acquire, a `meta.json` is written inside the lock dir:

```json
{
  "obj_id": "obj-42",
  "agent_id": "builder",
  "pid": 12345,
  "hostname": "vps1",
  "start_ts_utc": "2026-02-12T03:00:00Z",
  "commit_sha": "abc1234",
  "command": "delivery_loop.sh ..."
}
```

## Lock Lifecycle

### Acquire (`lock_acquire`)

1. `mkdir` the lock dir (atomic)
2. If succeeds → write `meta.json`, emit `LOCK_ACQUIRED`, return 0
3. If fails (dir exists) → check if stale
   - Stale → recover, retry acquire
   - Not stale → emit `LOCK_BLOCKED`, return 1

### Release (`lock_release`)

1. Verify PID ownership (only release if our PID matches meta)
2. `rm -rf` the lock dir
3. Emit `LOCK_RELEASED`

### Trap (`lock_install_trap`)

Installs `trap "lock_release '$OBJ_ID'" EXIT INT TERM` to ensure the lock
is released on normal exit, failure exit, or signal interruption.

## Stale Lock Detection (`lock_is_stale`)

A lock is stale if **any** of these are true:

| Condition | Result |
|-----------|--------|
| PID not running (same host) | Stale |
| Lock age exceeds TTL | Stale |
| No metadata + TTL exceeded | Stale |
| No metadata + TTL not exceeded | **Not stale** (fail closed) |
| Invalid JSON + TTL exceeded | Stale |
| Invalid JSON + TTL not exceeded | **Not stale** (fail closed) |

Default TTL: 7200 seconds (2 hours). Override via `OC_LOCK_TTL` env var.

## Stale Recovery (`lock_recover_stale`)

1. `mv` lock dir to `${OBJ_ID}.stale.<UTCSTAMP>` (preserves evidence)
2. Emit `LOCK_STALE_RECOVERED` event with `stale_path` field
3. Caller retries acquire

## Events

| Event | When |
|-------|------|
| `LOCK_ACQUIRED` | Lock successfully created |
| `LOCK_BLOCKED` | Another process holds the lock (with `holder_pid`, `holder_agent`) |
| `LOCK_RELEASED` | Lock removed on release or trap |
| `LOCK_STALE_RECOVERED` | Stale lock moved aside (with `stale_path`) |

## Chokepoint in delivery_loop.sh

Lock is acquired at two points:

1. **Main execution path** — after all validations, before first state write
   ("Execute delivery steps" section)
2. **Close-check mode** — after migration, before reading objective state

Both install trap immediately after acquire.

## Library

`scripts/lib/oc_lock.sh` — source after `oc_events.sh`.

Functions:
- `lock_acquire "$OBJ_ID"` — acquire lock, returns 0 or 1
- `lock_release "$OBJ_ID"` — release lock (PID ownership check)
- `lock_install_trap "$OBJ_ID"` — install EXIT/INT/TERM trap
- `lock_is_stale "$LOCK_DIR"` — check if lock is stale (0=stale, 1=not)
- `lock_recover_stale "$LOCK_DIR"` — move stale lock aside

## How to run locally

```bash
# Run the 17 lock tests
node scripts/objective_locking.test.js

# Run the gate (includes 4 lock smoke checks)
node scripts/run_isolation_guard_gate.js
```

## Rollback

```bash
git revert <merge_commit_sha>
```

Removes lock library and delivery_loop.sh changes. Any leftover `.lock.d`
directories are harmless and can be cleaned manually.
