# Port #17 — Entrypoint Wiring Plan

**Date:** 2026-02-12
**Author:** Claude Code (Opus 4.6)
**Depends on:** Port #16 (Autonomy Runtime v1 library + CLIs)
**Prior evidence:** `proofs/PORT16_WIRING_ENTRYPOINTS_EVIDENCE.md`

---

## Problem Statement

Port #16 delivered a complete Node.js library (`scripts/autonomy_runtime.js`) with CLIs for kill switch, quarantine, spend alerts, and canonical artifacts. However, no VPS entrypoint actually calls these. The kill switch file and quarantine list are never read during autonomous operation.

---

## Recon Findings

### VPS Entrypoints Confirmed

| Entrypoint | VPS | Path | Schedule | Agent Selection? |
|------------|-----|------|----------|------------------|
| `objective-autopilot.sh` | Builder | `/home/openclaw2/.openclaw/tools/objective-autopilot.sh` | `*/10` cron | YES (`pick_agent_for_role`) |
| `oc-dispatch.sh` | Builder | `/home/openclaw2/bin/oc-dispatch.sh` | On-demand SSH | NO (whitelisted commands) |
| `cross-agent-smoke.sh` | Builder | `/home/openclaw2/.openclaw/tools/cross-agent-smoke.sh` | `0 6 * * *` | Indirect |
| `agent-exercise.sh` | Builder | `/home/openclaw2/.openclaw/tools/agent-exercise.sh` | `5 6 * * *` | Indirect |
| `dispatch-to-builder.sh` | Dashboard | `/root/bin/dispatch-to-builder.sh` | On-demand | NO (passes through) |
| `openclaw-watchdog.sh` | Dashboard | `/home/canary/openclaw-watchdog.sh` | `*/5` cron | NO |
| `canary-check.sh` | Dashboard | `/home/canary/canary-check.sh` | Hourly cron | NO |
| `nightly-audit.sh` | Dashboard | `/home/openclaw/bootstrap/nightly-audit.sh` | `0 4 * * *` | NO |

### Node Availability

| VPS | Node Path | Version |
|-----|-----------|---------|
| Dashboard | `/usr/bin/node` | v22.22.0 |
| Builder | `/usr/bin/node` | v22.22.0 |

### Repo Presence

| VPS | Path | Branch | Has Port #16 Scripts? |
|-----|------|--------|----------------------|
| Dashboard | `/home/openclaw/staging/current/` | `main` | NO (only `build_bundles.js`, `coverage_report.js`) |
| Builder | N/A | N/A | NO (repo not cloned) |

### Key Architecture Facts

- `objective-autopilot.sh` is 848 lines of bash
- Agent selection uses `pick_agent_for_role()` which calls python3 to score candidates by heartbeat recency
- `ROLE_AGENTS` is a bash associative array at line 47
- Main logic starts at line 383 ("MAIN LOGIC" comment)
- `state-lib.sh` provides `state_emit_event` for structured event logging
- All scripts use `set -uo pipefail` (fail-closed)

---

## Decision: Option A vs Option B

### Option A: Bash Calls Port #16 CLIs

Deploy the 5 Port #16 Node.js files to VPSes. Each bash entrypoint calls `node killswitch.js status` at the top. The `pick_agent_for_role` function gets a quarantine check wrapper.

**Pros:**
- Each CLI is already tested (47 tests)
- Exit codes are well-defined (killswitch status exits 1 when active)
- Minimal new code — just 5-10 line bash guard blocks per entrypoint
- CLIs are standalone (no npm install, no deps)

**Cons:**
- Requires deploying 2 Node files to each VPS (`autonomy_runtime.js` + the CLI)
- Port #16 scripts assume `__dirname` relative paths — need `OPENCLAW_RUNTIME_DIR` env var
- Every guard spawns a new Node process (10-50ms overhead, acceptable for */10 cron)

### Option B: Deploy a Single Node Shim

Create one new file `runtime-guard.js` that combines kill switch check + quarantine check + spend log into a single CLI with subcommands.

**Pros:**
- Single file to deploy
- One Node process per guard check

**Cons:**
- New untested code (a shim wrapping tested code)
- Another file to maintain
- Duplicates what the CLIs already do

### Decision: Option A (bash calls CLIs)

**Rationale:**
1. **Smallest blast radius** — No new code. The CLIs already exist and have 47 tests.
2. **Easiest rollback** — Remove the guard block from bash scripts + delete deployed files. One sed command per file.
3. **Least moving pieces** — We deploy 2 files (`autonomy_runtime.js` + CLI), add 5 lines of bash.
4. **Works even if repo path differs** — `OPENCLAW_RUNTIME_DIR` env var controls state location. The script files can live anywhere.

We will deploy `autonomy_runtime.js` + `killswitch.js` + `quarantine_agent.js` + `spend_alert.js` + `canonical_artifact.js` to a dedicated directory on each VPS: `/opt/openclaw-runtime/`.

---

## Wiring Spec

### Deployment Directory

| VPS | Deploy Path | Owner | Permissions |
|-----|-------------|-------|-------------|
| Builder | `/opt/openclaw-runtime/` | `openclaw2:openclaw2` | `755` (dir), `644` (files) |
| Dashboard | `/opt/openclaw-runtime/` | `root:root` | `755` (dir), `644` (files) |

### Files to Deploy

```
/opt/openclaw-runtime/
  autonomy_runtime.js      # Core library (from scripts/)
  killswitch.js            # Kill switch CLI
  quarantine_agent.js      # Quarantine CLI
  spend_alert.js           # Spend alert CLI
  canonical_artifact.js    # Canonical artifact CLI
```

### Environment Variables

| Variable | Value (Builder) | Value (Dashboard) | Purpose |
|----------|-----------------|-------------------|---------|
| `OPENCLAW_RUNTIME_DIR` | `/home/openclaw2/.openclaw/_runtime` | `/home/openclaw/_runtime` | State files location |

State dir is separate from `_logs` to avoid cross-contamination. Gitignored by convention (not a repo on VPS).

### Entrypoint Wiring

#### 1. `objective-autopilot.sh` (Builder — PRIMARY)

**Kill switch guard** — Insert after `log "AUTOPILOT_START"` (line 86), before function definitions:

```bash
# --- Kill Switch Guard (Port #17) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"
if node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then
  # status exits 0 = inactive, exits 1 = active
  :  # kill switch is OFF, continue
else
  log "KILLSWITCH_ACTIVE: aborting autopilot run"
  state_emit_event "KILLSWITCH_BLOCKED" '{"entrypoint":"objective-autopilot"}'
  exit 0
fi
```

**Quarantine in pick_agent_for_role** — Wrap the python3 agent selection (line 168-219) with a quarantine pre-filter:

```bash
pick_agent_for_role() {
  local role="$1"
  local exclude="${2:-}"
  local candidates="${ROLE_AGENTS[$role]:-}"

  if [ -z "$candidates" ]; then
    echo ""
    return 1
  fi

  # --- Quarantine filter (Port #17) ---
  local filtered=""
  for agent in $candidates; do
    if node "$RUNTIME_BIN/quarantine_agent.js" list 2>/dev/null | grep -qw "$agent"; then
      log "QUARANTINE_SKIP: agent=$agent role=$role"
      continue
    fi
    filtered="$filtered $agent"
  done
  filtered=$(echo "$filtered" | xargs)  # trim whitespace

  if [ -z "$filtered" ]; then
    log "QUARANTINE_BLOCKED: all candidates quarantined for role=$role"
    state_emit_event "QUARANTINE_BLOCKED_ALL" "{\"role\":\"$role\",\"candidates\":\"$candidates\"}"
    echo ""
    return 1
  fi
  candidates="$filtered"
  # --- End quarantine filter ---

  # [existing python3 selection logic continues with $candidates]
  ...
}
```

**Spend logging** — After the AUTOPILOT_RUN event at end of script (line ~840):

```bash
# --- Spend telemetry (Port #17) ---
node "$RUNTIME_BIN/spend_alert.js" evaluate 2>/dev/null || true
```

**Canonical artifact** — After spend telemetry:

```bash
# --- Canonical artifact (Port #17) ---
node "$RUNTIME_BIN/canonical_artifact.js" ops-pulse \
  "{\"objectives_scanned\":$OBJECTIVES_SCANNED,\"assigned\":$ASSIGNED_COUNT,\"stuck\":$STUCK_COUNT}" \
  2>/dev/null || true
```

#### 2. `nightly-audit.sh` (Dashboard)

**Kill switch guard** — Insert after `TIMESTAMP=` line (line 20):

```bash
# --- Kill Switch Guard (Port #17) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw/_runtime"
if ! node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then
  echo "[$TIMESTAMP] KILLSWITCH_ACTIVE: aborting nightly audit"
  exit 0
fi
```

**Canonical artifact** — At end of script, after scorecard generation:

```bash
# --- Canonical daily-exec-brief (Port #17) ---
node "$RUNTIME_BIN/canonical_artifact.js" daily-exec-brief \
  "{\"objectives_scanned\":$TOTAL_CHECKS,\"pass_count\":$PASS_COUNT,\"fail_count\":$FAIL_COUNT}" \
  2>/dev/null || true
```

#### 3. `dispatch-to-builder.sh` (Dashboard)

**Kill switch guard** — Insert after `set -euo pipefail` (line 7):

```bash
# --- Kill Switch Guard (Port #17) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw/_runtime"
if ! node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then
  echo "KILLSWITCH_ACTIVE: dispatch blocked"
  exit 0
fi
```

#### 4. `openclaw-watchdog.sh` and `canary-check.sh` (Dashboard)

**NOT WIRED.** These are health-monitoring scripts that report problems. They should always run even when the kill switch is active — you want to know your systems are healthy even when autonomous operation is paused.

#### 5. `cross-agent-smoke.sh` and `agent-exercise.sh` (Builder)

**Kill switch guard only** (same pattern as autopilot). These run synthetic exercises that should be blocked when kill switch is active.

#### 6. `oc-dispatch.sh` (Builder)

**Kill switch guard** — Insert after `set -euo pipefail` (line 6). Write commands (`restart-*`, `git-pull`, `run-tests`) should be blocked when kill switch active. Read commands (`hello`, `status`, `logs`) should still work:

```bash
# --- Kill Switch Guard for write commands (Port #17) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="/home/openclaw2/.openclaw/_runtime"
```

Then in the `case "$COMMAND"` block, before each write command:

```bash
    restart-*)
        # Kill switch check for write commands
        if ! node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then
            echo "KILLSWITCH_ACTIVE: write command blocked"
            log "KILLSWITCH_BLOCKED: $COMMAND"
            exit 0
        fi
        # ... existing logic
        ;;
```

---

## Spend Telemetry Data Source

The spend ledger is populated by:
1. **Autopilot runs** — Each autopilot run calls `spend_alert.js evaluate` which reads the ledger and fires threshold alerts.
2. **Manual logging** — `node /opt/openclaw-runtime/spend_alert.js log '{...}'` can be called by any process that incurs LLM cost.
3. **Future: agent hooks** — When agents make LLM calls through the gateway, the gateway can emit spend entries.

For Port #17, we wire the `evaluate` call (check thresholds) into the autopilot. Actual spend entry logging requires integration with the OpenClaw gateway or LiteLLM proxy — that's a separate port.

---

## What This Port Does NOT Include

- No changes to `autonomy_runtime.js` or any Port #16 library code
- No changes to CI gates or branch protection
- No changes to the `openclaw-control` repo beyond plans/docs/proofs
- No gateway integration for real-time spend tracking (separate port)
- No modification to watchdog or canary (they're monitoring, not autonomous ops)

---

## Safety Invariants

1. All guard blocks use `|| true` or exit 0 — a guard failure (e.g., Node not found) causes a graceful skip, not a crash
2. Kill switch defaults to OFF — no behavior change until explicitly activated
3. Quarantine defaults to empty — no agents blocked until explicitly added
4. All VPS changes are additive (new lines, new files) — existing logic untouched
5. Every change has a one-command rollback
6. Read-only operations (watchdog, canary, status commands) are never blocked

---

## Rollback Steps

### Builder VPS

```bash
# 1. Remove deployed files
rm -rf /opt/openclaw-runtime/

# 2. Restore autopilot from backup
cp /home/openclaw2/.openclaw/tools/objective-autopilot.sh.backup-pre-port17 \
   /home/openclaw2/.openclaw/tools/objective-autopilot.sh

# 3. Restore other scripts from backups
for f in cross-agent-smoke.sh agent-exercise.sh; do
  cp "/home/openclaw2/.openclaw/tools/${f}.backup-pre-port17" \
     "/home/openclaw2/.openclaw/tools/$f"
done
cp /home/openclaw2/bin/oc-dispatch.sh.backup-pre-port17 \
   /home/openclaw2/bin/oc-dispatch.sh

# 4. Remove runtime state dir (optional — non-destructive to leave)
rm -rf /home/openclaw2/.openclaw/_runtime/
```

### Dashboard VPS

```bash
# 1. Remove deployed files
rm -rf /opt/openclaw-runtime/

# 2. Restore scripts from backups
cp /home/openclaw/bootstrap/nightly-audit.sh.backup-pre-port17 \
   /home/openclaw/bootstrap/nightly-audit.sh
cp /root/bin/dispatch-to-builder.sh.backup-pre-port17 \
   /root/bin/dispatch-to-builder.sh

# 3. Remove runtime state dir (optional)
rm -rf /home/openclaw/_runtime/
```

---

## Execution Sequence

1. Merge Port #16 to `main` (prerequisite — scripts must be in repo `main` branch)
2. Deploy runtime files to both VPSes (`/opt/openclaw-runtime/`)
3. Create runtime state dirs with correct ownership
4. Backup each entrypoint script
5. Apply guard blocks to each entrypoint (smallest change first, test each)
6. Dry-run verification on Builder: `objective-autopilot.sh --dry-run`
7. Dry-run verification with kill switch active
8. Dry-run verification with agent quarantined
9. Write proof pack
10. Unlock for next autopilot cycle (kill switch OFF, quarantine empty)
