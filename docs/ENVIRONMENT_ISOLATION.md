# Environment Isolation Enforcement

Enforces agent identity, path containment, and centralized event emission
across all Delivery OS shell scripts.

## Shared Libraries

All libraries live in `scripts/lib/`.

| Library | Purpose |
|---------|---------|
| `oc_paths.sh` | Agent ID validation, objective ID validation, safe path join, repo allowlist |
| `oc_events.sh` | Single `emit_event()` implementation (replaces 4 inline copies) |
| `oc_atomic_json.py` | Atomic JSON write with root containment check |

## Agent Identity

Scripts accept `OC_AGENT_ID` via environment variable.

| Value | Role |
|-------|------|
| `builder` | Creates branches, writes code, opens PRs |
| `executor` | Runs read-only checks, staging smoke |
| `auditor` | Observes events, generates reports |

When set, `agent_id` is included in every emitted event.
When unset, defaults to `unknown` (backward compatible with existing tests).

## Agent-Scoped Root

```
$DELIVERY_OS_HOME/agents/$OC_AGENT_ID/
```

Resolved via `oc_agent_root`. Fails if `OC_AGENT_ID` is invalid.

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

All 4 shell scripts now source `scripts/lib/oc_events.sh` instead of
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
# Run the 25 unit tests
node scripts/isolation_guard.test.js

# Run the gate (produces tmp/isolation-guard-report.json)
node scripts/run_isolation_guard_gate.js
```

## CI behavior

The gate runs on every pull request via
`.github/workflows/gate-isolation-guard.yml`. It:

1. Runs 25 unit + integration tests
2. Runs 12 smoke checks
3. Produces `isolation-guard-report.json` and `.md` as artifacts

The check name is `isolation-guard`.

## Rollback

Revert the merge commit to remove all Port #6 changes:
```bash
git revert <merge_commit_sha>
```

No existing test files modified. Shell script changes are minimal
(source lines added, inline emit_event removed).
