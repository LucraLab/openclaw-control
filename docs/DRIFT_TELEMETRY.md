# Drift + Spend Telemetry

Port #10 of Delivery OS. Detects configuration drift and budget
anomalies automatically. Fail-closed on critical invariant changes.

## Overview

The drift telemetry gate (`scripts/run_drift_telemetry_gate.js`) runs
on every PR to verify system invariants haven't drifted and to produce
spend metrics from event logs.

## Drift Detection

### D1: Branch Protection Contexts

Verifies exactly 10 required status checks:

```
arbitration
budget-enforcement
capability-matrix
context-budget
isolation-guard
lint-markdown
scan-public-safe
scan-secrets
two-stage-pr-review
verification-gate
```

**Fail-closed:** Missing or extra checks → FAIL.

### D2: Required Gate Workflows

Verifies all 10 gate workflow files exist under `.github/workflows/`:

| File | Job ID |
|------|--------|
| `gate-arbitration.yml` | `arbitration` |
| `gate-budget-enforcement.yml` | `budget-enforcement` |
| `gate-capability-matrix.yml` | `capability-matrix` |
| `gate-context-budget.yml` | `context-budget` |
| `gate-isolation-guard.yml` | `isolation-guard` |
| `gate-markdown.yml` | `lint-markdown` |
| `gate-publicsafe.yml` | `scan-public-safe` |
| `gate-secrets.yml` | `scan-secrets` |
| `gate-two-stage-pr-review.yml` | `two-stage-pr-review` |
| `gate-verification-fresh.yml` | `verification-gate` |

**Fail-closed:** Missing file or wrong job ID → FAIL.

### D3: Gate Workflow Job IDs

Verifies each gate workflow contains the expected job ID key.

### D4: Write-Surface Scan

Scans production scripts for forbidden direct filesystem writes.
Approved patterns (atomic JSON, event emit, known outputs) are
allowed. New direct writes → FAIL.

**Production scripts scanned:**
- `delivery_loop.sh`
- `staging_smoke.sh`
- `task_pr_sync.sh`
- `objective_create.sh`
- `arbiter.sh`

### D5: Cron/Systemd Drift

If cron/systemd config files exist in the repo, they are reported.
If none present, check is skipped.

## Spend Telemetry

Parsed from `$DELIVERY_OS_HOME/_logs/agent-events.jsonl` (or fixtures).

| Metric | Event Source |
|--------|-------------|
| Budget breaches | `BUDGET_BREACH` |
| Budget near-breaches | `BUDGET_NEAR_BREACH` |
| Model escalation attempts | `MODEL_ESCALATION_ATTEMPT` |
| Model escalation blocks | `MODEL_ESCALATION_BLOCKED` |
| Arbitration blocks | `ARBITRATION_BLOCKED` |
| Objective failures | `DELIVERY_FAILED` |
| Objective retries | `DELIVERY_RETRY` |

Top failing objectives are ranked by failure count.

## Artifacts

Generated on every run:

- `artifacts/drift-telemetry-report.json` — Machine-readable report
- `artifacts/drift-telemetry-report.md` — Human-readable summary

JSON report structure:

```json
{
  "gate": "drift-telemetry",
  "status": "PASS|FAIL",
  "drift": { "branch_protection": {}, "workflows": {}, ... },
  "telemetry": { "budget_breaches": 0, "arbitration_blocks": 0, ... },
  "findings": [{ "check": "D1_...", "status": "PASS", "detail": "..." }]
}
```

## CI Integration

The `drift-telemetry` gate runs on all PRs via
`.github/workflows/gate-drift-telemetry.yml` and is a required check
for merging to main.

## Fixtures

Test fixtures in `scripts/fixtures/`:

- `branch_protection_ok.json` — Correct 10 contexts
- `branch_protection_missing.json` — Missing arbitration
- `branch_protection_extra.json` — Extra unknown-check
- `sample_events.jsonl` — Sample events for telemetry parsing

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `--fixture-bp` | (auto) | Override branch protection fixture |
| `--fixture-events` | (auto) | Override events fixture |
| `--ci` | (flag) | CI mode: attempts gh api for live data |
