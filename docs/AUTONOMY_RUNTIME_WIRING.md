# Autonomy Runtime Wiring Guide

How the Port #16 runtime library connects to VPS entrypoints.

---

## Architecture Overview

```
openclaw-control repo (GitHub)
  └── scripts/
      ├── autonomy_runtime.js      ← Core library
      ├── killswitch.js            ← CLI: enable/disable/status
      ├── quarantine_agent.js      ← CLI: add/remove/list
      ├── spend_alert.js           ← CLI: evaluate/log/summary
      └── canonical_artifact.js    ← CLI: ops-pulse/daily-exec-brief
            │
            ▼ deployed to
    /opt/openclaw-runtime/  (on each VPS)
            │
            ▼ called by
    VPS bash entrypoints (cron, systemd, on-demand)
```

The runtime library and CLIs live in the `openclaw-control` Git repo. They are deployed to `/opt/openclaw-runtime/` on each VPS. Bash entrypoints call the CLIs via `node /opt/openclaw-runtime/<cli>.js`.

---

## Deployed Files

| File | Purpose | Calling Convention |
|------|---------|--------------------|
| `autonomy_runtime.js` | Core library (required by all CLIs) | Not called directly |
| `killswitch.js` | Kill switch management | `node killswitch.js <enable\|disable\|status>` |
| `quarantine_agent.js` | Agent quarantine management | `node quarantine_agent.js <add\|remove\|list> [agent_id]` |
| `spend_alert.js` | Spend monitoring | `node spend_alert.js <evaluate\|log\|summary>` |
| `canonical_artifact.js` | Artifact generation | `node canonical_artifact.js <ops-pulse\|daily-exec-brief> '<json>'` |

---

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENCLAW_RUNTIME_DIR` | YES (on VPS) | `.openclaw_runtime` (relative to repo root) | Directory for all runtime state files |
| `SPEND_CAP_USD` | No | `20` | Daily spend cap in USD |
| `SPEND_WARN_PCT` | No | `50` | Warning threshold (% of cap) |
| `SPEND_HIGH_PCT` | No | `80` | High threshold (% of cap) |
| `SPEND_CRIT_PCT` | No | `95` | Critical threshold (% of cap) |
| `SPEND_ALERT_AUTO_QUARANTINE` | No | `0` (off) | Auto-quarantine top spender at CRIT |
| `SPEND_ALERT_AUTO_KILLSWITCH` | No | `0` (off) | Auto-enable kill switch at CRIT |

### VPS-Specific Values

| VPS | `OPENCLAW_RUNTIME_DIR` | Owner |
|-----|------------------------|-------|
| Builder | `/home/openclaw2/.openclaw/_runtime` | `openclaw2` |
| Dashboard | `/home/openclaw/_runtime` | `root` |

---

## Runtime State Files

All state lives under `$OPENCLAW_RUNTIME_DIR`:

```
$OPENCLAW_RUNTIME_DIR/
  quarantine.json          # {"version":"v1","agents":["agent-id",...]}
  killswitch.enabled       # Presence = kill switch is ON
  spend-ledger.jsonl       # Append-only spend entries
  spend-alert-state.json   # Alert dedup (one alert per threshold per day)
  events.jsonl             # Event emission log
  artifacts/               # Generated ops-pulse and daily-exec-brief files
    ops-pulse-2026-02-12T170000Z.json
    ops-pulse-2026-02-12T170000Z.md
    daily-exec-brief-2026-02-12T040000Z.json
    daily-exec-brief-2026-02-12T040000Z.md
```

---

## Wired Entrypoints

### Kill Switch Guard

Blocks all autonomous operations when active. Monitoring (watchdog, canary) is NOT blocked.

| Entrypoint | Wired? | Behavior When Active |
|------------|--------|---------------------|
| `objective-autopilot.sh` | YES | Logs `KILLSWITCH_ACTIVE`, exits 0 |
| `oc-dispatch.sh` (write commands) | YES | Returns `KILLSWITCH_ACTIVE`, exits 0 |
| `oc-dispatch.sh` (read commands) | NO | Always allowed |
| `dispatch-to-builder.sh` | YES | Returns `KILLSWITCH_ACTIVE`, exits 0 |
| `nightly-audit.sh` | YES | Logs, exits 0 |
| `cross-agent-smoke.sh` | YES | Logs, exits 0 |
| `agent-exercise.sh` | YES | Logs, exits 0 |
| `openclaw-watchdog.sh` | NO | Always runs (monitoring) |
| `canary-check.sh` | NO | Always runs (monitoring) |

### Kill Switch Guard Pattern (bash)

```bash
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="<vps-specific-path>"

# killswitch.js status: exits 0 = inactive (safe), exits 1 = active (blocked)
if ! node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then
  log "KILLSWITCH_ACTIVE: aborting <entrypoint-name>"
  exit 0
fi
```

The `status` command exits with code 0 when the kill switch is **inactive** (safe to proceed) and code 1 when **active** (should abort). The `!` inverts this: if status exits non-zero (active), the block triggers.

### Quarantine Filter

Applied only to entrypoints that select agents.

| Entrypoint | Wired? | Behavior |
|------------|--------|----------|
| `objective-autopilot.sh` (`pick_agent_for_role`) | YES | Filters quarantined agents from candidates before python3 scoring |
| All others | NO | No agent selection occurs |

### Quarantine Filter Pattern (bash)

```bash
# Inside pick_agent_for_role(), before python3 scoring:
local filtered=""
for agent in $candidates; do
  if node "$RUNTIME_BIN/quarantine_agent.js" list 2>/dev/null | grep -qw "$agent"; then
    log "QUARANTINE_SKIP: agent=$agent role=$role"
    continue
  fi
  filtered="$filtered $agent"
done
candidates=$(echo "$filtered" | xargs)

if [ -z "$candidates" ]; then
  log "QUARANTINE_BLOCKED: all candidates quarantined for role=$role"
  echo ""
  return 1
fi
```

### Canonical Artifacts

| Artifact | Produced By | Schedule | Data Source |
|----------|-------------|----------|-------------|
| `ops-pulse` | `objective-autopilot.sh` | Every 10 min | Autopilot run stats |
| `daily-exec-brief` | `nightly-audit.sh` | Daily at 04:00 | Audit scorecard |

### Spend Telemetry

| Hook Point | Action | Data |
|------------|--------|------|
| End of `objective-autopilot.sh` | `spend_alert.js evaluate` | Reads ledger, fires threshold alerts |
| Gateway/LiteLLM (future) | `spend_alert.js log '{...}'` | Per-call cost entries |

---

## Operating Procedures

### Enable Kill Switch (emergency stop)

```bash
# On the VPS where you want to stop operations:
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"  # Builder
node /opt/openclaw-runtime/killswitch.js enable
```

All subsequent autopilot runs, dispatches, and exercises will exit immediately.

### Disable Kill Switch (resume operations)

```bash
node /opt/openclaw-runtime/killswitch.js disable
```

### Quarantine an Agent

```bash
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"
node /opt/openclaw-runtime/quarantine_agent.js add pa
node /opt/openclaw-runtime/quarantine_agent.js list
```

Agent `pa` will be skipped in all future `pick_agent_for_role` calls.

### Remove from Quarantine

```bash
node /opt/openclaw-runtime/quarantine_agent.js remove pa
```

### Check Spend Status

```bash
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"
node /opt/openclaw-runtime/spend_alert.js summary
node /opt/openclaw-runtime/spend_alert.js evaluate
```

---

## Deployment Steps

### Prerequisites

- Port #16 merged to `main` in `openclaw-control` repo
- SSH access to both VPSes

### Deploy Runtime Files

```bash
# From local machine (where openclaw-control is cloned):
REPO="c:/Users/james/.ssh/Workspace/openclaw-control"

# To Dashboard VPS:
scp $REPO/scripts/autonomy_runtime.js \
    $REPO/scripts/killswitch.js \
    $REPO/scripts/quarantine_agent.js \
    $REPO/scripts/spend_alert.js \
    $REPO/scripts/canonical_artifact.js \
    root@srv853172.hstgr.cloud:/opt/openclaw-runtime/

# To Builder VPS (via Dashboard jump):
ssh root@srv853172.hstgr.cloud "
  scp /opt/openclaw-runtime/*.js openclaw2@100.75.216.57:/opt/openclaw-runtime/
"
```

### Create Runtime State Dirs

```bash
# Dashboard:
ssh root@srv853172.hstgr.cloud "mkdir -p /home/openclaw/_runtime"

# Builder:
ssh root@srv853172.hstgr.cloud "
  ssh openclaw2@100.75.216.57 'mkdir -p /home/openclaw2/.openclaw/_runtime'
"
```

### Backup + Apply Entrypoint Changes

See `plans/obj-17/task-1.md` for exact insertion points and rollback commands.

---

## Rollback

### Full Rollback (both VPSes)

```bash
# Builder:
ssh root@srv853172.hstgr.cloud "ssh openclaw2@100.75.216.57 '
  for f in objective-autopilot.sh cross-agent-smoke.sh agent-exercise.sh; do
    cp /home/openclaw2/.openclaw/tools/\${f}.backup-pre-port17 \
       /home/openclaw2/.openclaw/tools/\$f 2>/dev/null
  done
  cp /home/openclaw2/bin/oc-dispatch.sh.backup-pre-port17 \
     /home/openclaw2/bin/oc-dispatch.sh 2>/dev/null
  rm -rf /opt/openclaw-runtime/
'"

# Dashboard:
ssh root@srv853172.hstgr.cloud "
  cp /home/openclaw/bootstrap/nightly-audit.sh.backup-pre-port17 \
     /home/openclaw/bootstrap/nightly-audit.sh 2>/dev/null
  cp /root/bin/dispatch-to-builder.sh.backup-pre-port17 \
     /root/bin/dispatch-to-builder.sh 2>/dev/null
  rm -rf /opt/openclaw-runtime/
"
```
