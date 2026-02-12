# Task 1: Drift + Spend Telemetry

## Scope

Add drift detection and spend telemetry to Delivery OS so
configuration drift and budget anomalies are caught automatically
on every PR. Fail-closed on critical invariant changes.

## Changes

### Added (4)

1. `scripts/run_drift_telemetry_gate.js` — Drift + telemetry gate runner
2. `scripts/drift_telemetry.test.js` — 25 drift telemetry tests
3. `.github/workflows/gate-drift-telemetry.yml` — CI gate workflow
4. `docs/DRIFT_TELEMETRY.md` — Drift telemetry documentation

### Added (Fixtures)

1. `scripts/fixtures/branch_protection_ok.json` — Correct contexts
2. `scripts/fixtures/branch_protection_missing.json` — Missing check
3. `scripts/fixtures/branch_protection_extra.json` — Extra check
4. `scripts/fixtures/sample_events.jsonl` — Sample spend events

### Added (Plan)

1. `plans/obj-10/task-1.md` — This plan

### Modified

None.

## Verification

- 25/25 drift telemetry tests pass
- 10/10 drift telemetry gate checks pass (6 drift + 4 spend)
- All existing CI gates pass (152+ pre-existing tests unchanged)
- Branch protection contexts verified (exact 10 match)
- Required gate workflows verified (existence + job IDs)
- Write-surface scan clean (no forbidden writes)
- Spend telemetry parses budget, escalation, contention, failure events
- Artifacts generated (JSON + MD reports)
- Fail-closed: missing check → FAIL, extra check → FAIL

## Rollback

```bash
git revert <merge_commit_sha>
```

Gate runner becomes unused. Fixtures harmless. Remove `drift-telemetry`
from branch protection required checks.
