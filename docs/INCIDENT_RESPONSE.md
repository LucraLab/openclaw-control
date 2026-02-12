# Incident Response Runbook

## Quick Reference

| Action | Command |
|--------|---------|
| Stop the system | `touch $DELIVERY_OS_HOME/_control/STOP` |
| Resume the system | `rm $DELIVERY_OS_HOME/_control/STOP` |
| Check status | `bash scripts/triage.sh` |
| List quarantines | `bash scripts/quarantine_status.sh` |
| Unquarantine | `bash scripts/unquarantine.sh <obj_id>` |

## 1. How to Stop the System (Kill Switch)

Create the STOP file to engage the kill switch:

```bash
touch $DELIVERY_OS_HOME/_control/STOP
```

Both the arbiter and delivery loop check for this file before any
lock acquisition or state mutation. When engaged:

- Exit code 7 is returned
- `KILL_SWITCH_ENGAGED` event is emitted
- No locks are acquired, no repos cloned, no objectives mutated

## 2. How to Inspect Locks

Resource locks (cross-agent):

```bash
ls -la $DELIVERY_OS_HOME/_locks/
# Each *.lock.d/ directory contains meta.json with holder info
cat $DELIVERY_OS_HOME/_locks/*/meta.json
```

Objective locks (per-agent):

```bash
ls -la $DELIVERY_OS_HOME/agents/builder/objectives/*.lock.d/
```

## 3. How to Clear Stale Locks

If a lock holder has crashed (PID no longer running), the lock system
will auto-recover after TTL (default 2 hours). To clear immediately:

```bash
# Verify the PID is dead
cat $DELIVERY_OS_HOME/_locks/<lock_name>.lock.d/meta.json
# Check PID
kill -0 <pid> 2>/dev/null || echo "PID is dead — safe to clear"
# Remove the stale lock
rm -rf $DELIVERY_OS_HOME/_locks/<lock_name>.lock.d
```

## 4. How to Inspect the Quarantine List

```bash
bash scripts/quarantine_status.sh
# Or directly:
cat $DELIVERY_OS_HOME/_control/quarantine.json | python3 -m json.tool
```

## 5. How to Unquarantine an Objective

```bash
bash scripts/unquarantine.sh obj-42
```

This removes the quarantine flag atomically while preserving event history.

## 6. How to Resume After an Incident

1. Run triage to understand current state:

   ```bash
   bash scripts/triage.sh
   ```

2. Clear any stale locks (section 3 above)

3. Unquarantine objectives if appropriate (section 5 above)

4. Remove the kill switch:

   ```bash
   rm $DELIVERY_OS_HOME/_control/STOP
   ```

5. Verify the system resumes normally by running the arbiter:

   ```bash
   OC_AGENT_ID=builder bash scripts/arbiter.sh
   ```

## 7. Quarantine Thresholds

| Trigger | Default Count | Window |
|---------|--------------|--------|
| Objective failure | 3 | 24 hours |
| Budget breach | 2 | 24 hours |
| Arbitration blocked loop | 5 | 1 hour |

Override via environment variables:

- `OC_QUARANTINE_FAILURE_COUNT`, `OC_QUARANTINE_FAILURE_WINDOW_H`
- `OC_QUARANTINE_BREACH_COUNT`, `OC_QUARANTINE_BREACH_WINDOW_H`
- `OC_QUARANTINE_ARB_COUNT`, `OC_QUARANTINE_ARB_WINDOW_H`

## 8. Triage Script

The triage script prints a diagnostic summary without exposing secrets:

```bash
bash scripts/triage.sh
```

It reports: commit SHA, kill switch status, quarantines, locks, and
the last 50 events. All token-like strings are redacted automatically.
