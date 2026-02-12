# Ops Hardening (Port #11)

## Overview

Port #11 adds operational safety mechanisms to the Delivery OS:

1. **Global Kill Switch** — Emergency stop for all agents
2. **Auto-Quarantine** — Automatic isolation of repeatedly failing objectives
3. **Notifications** — Pluggable alerting for critical events
4. **Incident Response** — Runbook and triage tooling

All mechanisms are fail-closed: if control data is missing or corrupt,
the system blocks rather than proceeds.

## Architecture

```
$DELIVERY_OS_HOME/
  _control/
    STOP                  ← kill switch flag file
    quarantine.json       ← auto-quarantine state
  _logs/
    agent-events.jsonl    ← event log
    notifications.log     ← notification sink (file mode)
  _locks/                 ← resource locks
```

## Kill Switch

**Path:** `$DELIVERY_OS_HOME/_control/STOP`

Creating this file immediately blocks:

- Arbiter selection (before any lock acquisition)
- Delivery loop execution (before any writes)

**Exit code:** 7 (distinct from 0/1/2)

**Event:** `KILL_SWITCH_ENGAGED` with agent_id and hostname

**Engage:** `touch $DELIVERY_OS_HOME/_control/STOP`

**Disengage:** `rm $DELIVERY_OS_HOME/_control/STOP`

## Auto-Quarantine

**Path:** `$DELIVERY_OS_HOME/_control/quarantine.json`

Objectives are automatically quarantined when they exceed failure
thresholds within a time window:

| Trigger | Count | Window |
|---------|-------|--------|
| Delivery failure | 3 | 24h |
| Budget breach | 2 | 24h |
| Arbitration block | 5 | 1h |

Quarantined objectives are skipped by the arbiter deterministically.

**Corrupt file:** Fail closed — arbiter blocks all selection.

**Manual override:** `bash scripts/unquarantine.sh <obj_id>`

**View status:** `bash scripts/quarantine_status.sh`

## Notifications

**Module:** `scripts/notify.js`

**Sink modes:**

| Mode | Behavior | Use Case |
|------|----------|----------|
| `noop` | No output | CI (default) |
| `stdout` | JSON to stdout | Local development |
| `file` | Append to notifications.log | Production |

**Triggered for:** KILL_SWITCH_ENGAGED, OBJECTIVE_QUARANTINED,
DRIFT_TELEMETRY_FAIL, BUDGET_BREACH, ARBITRATION_STALL

**Security:** Payloads sanitized (secrets redacted), truncated to 500 chars.

## Triage

**Script:** `bash scripts/triage.sh`

Prints: commit SHA, kill switch status, quarantines, locks,
last 50 events. All secrets automatically redacted.

## CI Gate

**Gate name:** `ops-hardening`

**Checks:** 10 smoke checks verifying kill switch, quarantine,
notifications, triage, and incident response documentation.

**Artifacts:** `artifacts/ops-hardening-report.{json,md}`
