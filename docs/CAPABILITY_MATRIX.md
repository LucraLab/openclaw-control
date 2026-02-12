# Capability Matrix Enforcement

Enforces agent capability boundaries through single-chokepoint wrappers.
Every model call, tool call, and filesystem write routes through a capability
check that fails closed on missing or ambiguous profiles.

## Chokepoint Wrappers

| Wrapper | Enforces | On Deny |
|---------|----------|---------|
| `invokeModel()` | Model allowlist + escalation guard + budget | CAPABILITY_DENIED event + proof |
| `invokeTool()` | Tool allowlist + side-effect approval | CAPABILITY_DENIED event + proof |
| `safeWriteFile()` | Write path allow/deny scope | CAPABILITY_DENIED event + proof |

## Agent Profiles

Profiles live in `capabilities/agents/<agent>.json`.

| Profile | Models | Tools | Write Scope |
|---------|--------|-------|-------------|
| builder | sonnet, haiku | read, write, edit, glob, grep, bash | scripts/, docs/, plans/, tmp/ |
| executor | sonnet only | read, glob, grep, bash | tmp/, _logs/ only |

## Side-Effect Classes

Tools that produce external side effects require an approval token:

- `send` — outbound messages (SMS, email, API calls)
- `deploy` — deployment operations
- `delete` — destructive data operations
- `rotate` — credential rotation
- `firewall` — network rule changes

## Model Escalation Guard

Expensive models are blocked unless both conditions are met:
- `execution_mode === "final"`
- `escalation_reason` is provided (non-empty string)

Expensive models: claude-opus-4-6, claude-opus-4-5-20250514, gpt-4o, o1-preview, o1, o3

Compatible with Port #4 budget enforcement (same model list, same rules).

## Fail-Closed Design

- Missing profile → deny all
- Unknown model → deny
- Unknown tool → deny
- Unknown write path → deny
- Missing approval token for side-effect → deny

## Deny Behavior

On any capability denial:
1. CAPABILITY_DENIED event created (monotonic event_seq)
2. Proof artifact generated (MD + JSON, sanitized)
3. Exactly one event per denied action (dedup prevents spam)

Exit code: **17** (`CAPABILITY_DENIED`)

## How to run locally

```bash
# Run the 16 unit tests
node scripts/capability_matrix.test.js

# Run the gate (produces tmp/capability-matrix-report.json)
node scripts/run_capability_matrix_gate.js
```

## CI behavior

The gate runs on every pull request via
`.github/workflows/gate-capability-matrix.yml`. It:

1. Runs 16 unit + chokepoint integrity tests
2. Runs 12 smoke checks for all wrapper types + profiles
3. Produces `capability-matrix-report.json` and `.md` as artifacts

The check name is `capability-matrix`.

## Rollback

Revert the merge commit to remove all Port #5 changes:
```bash
git revert <merge_commit_sha>
```

No existing files modified. No existing gates changed.
