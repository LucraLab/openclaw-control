# Environment Isolation Enforcement

Enforces agent identity, path containment, and centralized event emission
across all Delivery OS shell scripts.

## Shared Libraries

All libraries live in `scripts/lib/`.

| Library | Purpose |
|---------|---------|
| `oc_paths.sh` | Agent ID validation, objective ID validation, safe path join, repo allowlist, migration |
| `oc_events.sh` | Single `emit_event()` implementation (replaces 4 inline copies) |
| `oc_atomic_json.py` | Atomic JSON write with root containment check |

## Agent Identity

Scripts **require** `OC_AGENT_ID` via environment variable. All production
scripts call `oc_require_agent_id` and exit 1 if the variable is missing
or invalid.

| Value | Role |
|-------|------|
| `builder` | Creates branches, writes code, opens PRs |
| `executor` | Runs read-only checks, staging smoke |
| `auditor` | Observes events, generates reports |

When set, `agent_id` is included in every emitted event.

## Agent-Scoped Root (Layer 4 Isolation)

All objectives and workspaces are stored under the agent-scoped root:

```
$DELIVERY_OS_HOME/agents/$OC_AGENT_ID/
  objectives/       ← objective JSON files
  workspaces/        ← git clones
```

Resolved via `oc_agent_root`. Fails if `OC_AGENT_ID` is invalid.

### Path Layout

| Path | Purpose |
|------|---------|
| `$OC_AGENT_ROOT/objectives/` | Objective JSON and task files |
| `$OC_AGENT_ROOT/workspaces/` | Git clones for delivery branches |
| `$DELIVERY_OS_HOME/_logs/` | Shared event log (cross-agent) |

### Legacy Path Migration (Option A)

Prior to Port #7, objectives and workspaces were stored in shared paths:

- `$DELIVERY_OS_HOME/objectives/` (legacy)
- `$DELIVERY_OS_HOME/workspaces/` (legacy)

Production scripts now automatically migrate legacy files to agent-scoped
paths on first access via `oc_migrate_legacy_file`:

1. If agent-scoped file exists and legacy doesn't → no-op (already migrated)
2. If legacy exists and agent-scoped doesn't → `mv` to agent path + emit `PATH_MIGRATION` event
3. If both exist → **fail closed** (conflict; manual resolution required)
4. If neither exists → no-op (new file)

Legacy paths are **never written to** by production scripts.

## Path Validation

### Objective ID

`oc_validate_obj_id` requires:

- Starts with `obj-`
- Contains only `[a-zA-Z0-9_-]`
- No `..`, `/`, `\`, or control characters

### Safe Path Join

`oc_safe_path <root> <relative>` resolves the path and verifies it stays
within `<root>`. Rejects `../` traversal before and after resolution.

### Repository Allowlist

`oc_validate_repo` checks against a space-separated allowlist
(default: `LucraLab/openclaw-control`).

## Centralized Event Emission

All 4 shell scripts source `scripts/lib/oc_events.sh` instead of
defining their own `emit_event()`. The centralized version:

- Maintains monotonic `event_seq` via `_logs/event-seq.txt`
- Includes `agent_id` field (from `$OC_AGENT_ID`)
- Includes `objective_id`, `task_key`, `repo` from environment
- Supports extra `key=value` pairs as arguments
- Writes to `$DELIVERY_OS_HOME/_logs/agent-events.jsonl`

## Atomic JSON Writes

`oc_atomic_json.py` provides safe JSON file updates:

1. Validate target path is under `--root` (if specified)
2. Write to temp file in same directory
3. `chmod 600` (owner read/write only)
4. `rename()` to target (atomic on same filesystem)

Exit codes: 0=success, 1=path violation, 2=write error, 3=invalid JSON.

## How to run locally

```bash
# Run the 42 unit tests
node scripts/isolation_guard.test.js

# Run the gate (produces tmp/isolation-guard-report.json)
node scripts/run_isolation_guard_gate.js
```

## CI behavior

The gate runs on every pull request via
`.github/workflows/gate-isolation-guard.yml`. It:

1. Runs 42 unit + integration tests
2. Runs 16 smoke checks
3. Produces `isolation-guard-report.json` and `.md` as artifacts

The check name is `isolation-guard`.

## Rollback

Revert the merge commit to remove all Port #7 changes:

```bash
git revert <merge_commit_sha>
```

No existing test structure modified. Shell scripts revert to legacy shared
paths. Migration function remains harmless (no-op when legacy files don't
exist).

## Lock File Path (Future — Port #8)

With agent-scoped roots, the natural lock file location is:

```
$OC_AGENT_ROOT/objectives/${OBJ_ID}.lock
```

This sits alongside the objective JSON and is agent-specific, preventing
cross-agent lock contention.
