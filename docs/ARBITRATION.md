# Objective Arbitration + Global Queue

Port #9 of Delivery OS. Prevents multiple agents from colliding on the
same repository/branch while autonomously selecting objectives.

## Overview

The arbiter (`scripts/arbiter.sh`) selects exactly **one objective per
tick per agent**. It enforces cross-resource locking so two agents
cannot work on the same repo+branch simultaneously.

## Components

### Resource Lock Library (`scripts/lib/oc_resource_lock.sh`)

Shared (cross-agent) locks stored at `$DELIVERY_OS_HOME/_locks/`.

**Lock ID format:** `repo_branch:<owner>/<name>@<branch>`

**Slug encoding:** `:` → `__`, `/` → `_`, `@` → `_at_`

Example: `repo_branch:LucraLab/openclaw-control@obj-obj-42/task-1`
becomes `repo_branch__LucraLab_openclaw-control_at_obj-obj-42_task-1.lock.d`

**Functions:**

| Function | Purpose |
|----------|---------|
| `resource_lock_acquire <lock_id> [ttl]` | Atomic mkdir, stale recovery |
| `resource_lock_release <lock_id>` | PID-checked release |
| `resource_lock_is_stale <lock_dir> [ttl]` | Dead PID + TTL check |
| `resource_lock_recover_stale <lock_dir>` | Move to `.stale.<ts>` |

**Stale detection** (same as objective locks):

1. PID check — if lock holder PID is dead (same host only), lock is stale
2. TTL check — if `start_ts_utc` exceeds `OC_RESOURCE_LOCK_TTL` (default 2h)
3. Fail closed — corrupt/missing metadata within TTL = NOT stale

### Arbiter (`scripts/arbiter.sh`)

Selects the next objective to run and outputs a **run token** (JSON).

**Algorithm:**

1. Enumerate objectives from `$OC_AGENT_ROOT/objectives/obj-*.json`
2. Filter: `status != COMPLETE/FAILED`, not `manual_only`, `risk != high`
3. Sort by `created_at` ascending (deterministic, stable)
4. For each candidate:
   - Find next task (`status != DONE` and `!= IN_PROGRESS`)
   - Compute branch: `obj-<obj_id>/task-<slug>`
   - Compute lock ID: `repo_branch:<repo>@<branch>`
   - Attempt `resource_lock_acquire`
   - If acquired → emit `ARBITRATION_SELECTED`, output run token, stop
   - If blocked → emit `ARBITRATION_BLOCKED`, try next candidate
5. If none selected → emit `ARBITRATION_SKIPPED`

**Run token format:**

```json
{
  "obj_id": "obj-42",
  "task_key": "task-1",
  "repo": "LucraLab/openclaw-control",
  "branch": "obj-obj-42/task-1",
  "resource_lock_ids": ["repo_branch:LucraLab/openclaw-control@obj-obj-42/task-1"],
  "agent_id": "builder",
  "issued_at": "2026-02-12T04:00:00Z",
  "arbiter_pid": 12345
}
```

### Delivery Loop Integration

`delivery_loop.sh` accepts `--run-token <path>` from the arbiter.

**Lock ordering:**

1. Acquire resource locks (from run token) — shared, cross-agent
2. Acquire objective lock (Port #8) — agent-scoped
3. On exit (trap): release objective lock first, then resource locks

This reverse-release ordering prevents deadlocks.

**Run token verification:**

- `obj_id` in token must match `$OBJ_ID` argument
- `repo` in token must match `$REPO` resolved from objective

Mismatch → fail with event emission, exit 1.

## Events

| Event | When |
|-------|------|
| `ARBITRATION_SELECTED` | Arbiter selected an objective |
| `ARBITRATION_SKIPPED` | No eligible candidate found |
| `ARBITRATION_BLOCKED` | Resource lock held by another agent |
| `ARBITRATION_STALE_RECOVERED` | Stale resource lock recovered |
| `ARBITRATION_RELEASED` | Resource lock released |
| `RESOURCE_LOCK_ACQUIRED` | Resource lock successfully acquired |

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `OC_RESOURCE_LOCK_TTL` | `7200` (2h) | Resource lock TTL in seconds |
| `DELIVERY_OS_HOME` | `~/.openclaw` | Delivery OS home directory |
| `OC_AGENT_ID` | (required) | Agent identity (builder/executor/auditor) |

## Relationship to Port #8

Port #8 introduced **objective locks** (agent-scoped, per-objective).
Port #9 adds **resource locks** (shared, per-repo-branch) that wrap
around objective locks with strict ordering.

```
arbiter.sh                     delivery_loop.sh
    |                               |
    +-- resource_lock_acquire       +-- resource_lock_acquire (from token)
    |                               +-- lock_acquire (objective, Port #8)
    +-- output run token            |
                                    +-- [execute delivery steps]
                                    |
                                    +-- trap: lock_release (objective)
                                    +-- trap: resource_lock_release
```
