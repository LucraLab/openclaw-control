# Budget Enforcement

Prevents runaway loops by enforcing hard limits on objective runs.
Every run has enforceable budgets that halt execution immediately
on breach (fail-closed).

## Budget Types

| Budget | Default | On Breach |
|--------|---------|-----------|
| max_tokens_total | 500,000 | Stop + BUDGET_EXCEEDED |
| max_steps | 50 | Stop + BUDGET_EXCEEDED |
| max_retries | 5 | Stop + BUDGET_EXCEEDED |
| max_wall_clock_ms | 600,000 (10 min) | Stop + BUDGET_EXCEEDED |

## Breach Behavior

On any limit breach:
1. Execution stops immediately (fail-closed)
2. Objective status transitions to `BUDGET_EXCEEDED`
3. Event appended to ledger (monotonic `event_seq` preserved)
4. Proof artifact written (MD + JSON, no secrets)
5. No further retries allowed for that objective instance

Exit code: **16** (`BUDGET_EXCEEDED`)

## Model Escalation Guard

Expensive models (Opus, GPT-4o, o1, o3) are blocked unless:
- `execution_mode === "final"` AND
- `escalation_reason` is provided (non-empty string)

Planning mode **never** silently escalates to expensive models.

## Custom Budgets

Pass overrides when creating a tracker:

```javascript
const tracker = createTracker({
  objective_id: 'obj-42',
  budgets: { max_steps: 10, max_retries: 2 }
});
```

Unspecified budgets use defaults.

## How to run locally

```bash
# Run the 14 unit tests
node scripts/budget_enforcement.test.js

# Run the gate (produces tmp/budget-enforcement-report.json)
node scripts/run_budget_enforcement_gate.js
```

## CI behavior

The gate runs on every pull request via
`.github/workflows/gate-budget-enforcement.yml`. It:

1. Runs 14 unit tests
2. Runs smoke checks for all budget types + model guard
3. Produces `budget-enforcement-report.json` and `.md` as artifacts

The check name is `budget-enforcement`.

## Rollback

Revert the merge commit to remove all Port #4 changes:
```bash
git revert <merge_commit_sha>
```

No branch protection changes to undo. No existing gates modified.
