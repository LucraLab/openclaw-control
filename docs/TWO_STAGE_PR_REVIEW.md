# Two-Stage PR Review Gate

Deterministic two-stage review that enforces spec compliance and
quality checks on every pull request.

## Stage 1 — Spec Compliance (blocks PR)

Every PR must include in the body or commit messages:

| Requirement | Pattern | Example |
|-------------|---------|---------|
| Objective ID | `obj-NNN` | `Objective: obj-42` |
| Task ID | `task-NNN` | `Task: task-101` |
| Risk tier | `risk: low\|medium\|high` | `Risk: low` |
| Definition of Done | 2+ of: tests, lint, schema, gate, smoke | `DoD: tests + gate pass` |
| Plan file | `plans/<obj>/<task>.md` | `Plan: plans/obj-42/task-101.md` |

The plan file must exist and contain headings: **Scope**,
**Verification**, **Rollback**.

If risk is `high`, the PR must have the `risk-accepted` label.

## Stage 2 — Quality Check

**MUST findings (block PR):**
- Secret/API key patterns in changed files
- Binary or oversized files (>1MB) outside allowlist
- Public-safe violations (IPs, hostnames, SSH commands)
- Files under forbidden paths (proofs/, workspaces/)

**SHOULD findings (warn only):**
- Temporal verification claims without CI artifact reference
- Large code changes without test files
- Very large diffs (>25 files)

## How to run locally

```bash
# Run the 12 unit tests
node scripts/two_stage_pr_review.test.js

# Run the full review gate
node scripts/run_two_stage_pr_review.js
```

## CI behavior

The gate runs on every pull request via
`.github/workflows/gate-two-stage-pr-review.yml`. It:

1. Runs 12 unit tests against the policy module
2. Reads PR body, labels, and changed files
3. Runs Stage 1 (spec compliance) and Stage 2 (quality)
4. Produces `two-stage-pr-review.json` and `.md` as artifacts

The check name is `two-stage-pr-review`.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | No MUST failures |
| 20 | Stage 1 spec compliance failure |
| 21 | Stage 2 MUST quality failure |
| 2 | Internal error |
