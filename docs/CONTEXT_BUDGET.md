# Context Budget Enforcement

Enforces deterministic chars/words/lines budgets on role definitions,
skill specs, and documentation to prevent context bloat in agent
dispatch.

## Default Budgets

| Artifact | Max Chars | Max Words | Max Lines | Severity |
|----------|-----------|-----------|-----------|----------|
| Role block (each) | 2,200 | 320 | 40 | FAIL |
| Skill SPEC.md | 6,000 | 900 | 160 | FAIL |
| Skill runbook.md | 7,000 | 1,100 | 180 | FAIL |
| CLAUDE.md | 1,200 | 220 | 60 | FAIL |
| Root README.md | 3,500 | 550 | 120 | WARN |

**FAIL** violations block the gate. **WARN** violations are reported
but do not block.

## Grandfathering

Existing content that exceeds budgets can be exempted via
`.context-budget-overrides.json` at the repo root. Overridden
items produce WARN instead of FAIL.

```json
{
  "roles": {
    "insights_analyst": {
      "chars": 6500,
      "words": 600,
      "lines": 210
    }
  }
}
```

Remove entries as content is trimmed to fit default budgets.

## How to run locally

```bash
# Run the 10 unit tests
node scripts/context_budget.test.js

# Run the full budget check (produces tmp/context-budget-report.json)
node scripts/run_context_budget.js
```

## CI behavior

The gate runs on every pull request via
`.github/workflows/gate-context-budget.yml`. It:

1. Runs 10 unit tests against the policy module
2. Checks all budget-tracked files in the repo
3. Produces `context-budget-report.json` as a GitHub Actions artifact

The check name is `context-budget`.
