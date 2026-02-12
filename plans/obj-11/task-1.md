# Port #11: Ops Hardening — Task Plan

## Objective

Add operational safety mechanisms: global kill switch, auto-quarantine,
notifications, and incident response tooling.

## Changes

### New files (12)

1. `scripts/lib/oc_control.sh` — Kill switch + quarantine shell helpers
2. `scripts/lib/oc_quarantine.py` — Quarantine management module
3. `scripts/notify.js` — Pluggable notification hook
4. `scripts/triage.sh` — Incident triage diagnostic
5. `scripts/unquarantine.sh` — Remove quarantine entry
6. `scripts/quarantine_status.sh` — List quarantines
7. `scripts/ops_hardening.test.js` — 27 tests
8. `scripts/run_ops_hardening_gate.js` — CI gate runner (10 checks)
9. `.github/workflows/gate-ops-hardening.yml` — CI workflow
10. `docs/INCIDENT_RESPONSE.md` — Incident response runbook
11. `docs/OPS_HARDENING.md` — Feature documentation
12. `plans/obj-11/task-1.md` — This plan

### Modified files (2)

1. `scripts/arbiter.sh` — Kill switch check + quarantine skip
2. `scripts/delivery_loop.sh` — Kill switch check before locks

## Rollback

```bash
git revert <merge_commit_sha>
```

Remove `ops-hardening` from branch protection required checks.
