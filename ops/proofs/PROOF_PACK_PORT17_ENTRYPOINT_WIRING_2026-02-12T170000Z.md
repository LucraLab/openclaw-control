# Proof Pack: Port #17 — Entrypoint Wiring Pack

**Date:** 2026-02-12
**Auditor:** Claude Code (Opus 4.6)
**Repo:** openclaw-control
**Branch:** `feat/delivery-os-gates`
**Commit:** `878618b` (Port #16 base) + uncommitted Port #17 additions
**Prior:** Port #16 (Autonomy Runtime v1), `PORT16_WIRING_ENTRYPOINTS_EVIDENCE.md`

---

## Mission

Wire Port #16's kill switch, quarantine, spend alerts, and canonical artifacts into the real VPS runtime entrypoints (bash scripts). Wiring-only — no new library logic.

---

## Phase Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 0A | Confirm entrypoint paths on both VPSes | DONE |
| 0B | Confirm Node availability + repo presence | DONE |
| 1 | Choose wiring approach (Option A: bash calls CLIs) | DONE |
| 2 | Write wiring spec with exact edits | DONE |
| 3 | Add wiring contract tests (23) + CI gate | DONE |
| 4 | Proof pack + rollback | DONE |

---

## Recon Evidence

### Entrypoints Confirmed (Phase 0A)

| Entrypoint | VPS | Path | Size | Last Modified |
|------------|-----|------|------|---------------|
| `objective-autopilot.sh` | Builder | `/home/openclaw2/.openclaw/tools/objective-autopilot.sh` | 28030B (848 lines) | 2026-02-11 19:03 |
| `oc-dispatch.sh` | Builder | `/home/openclaw2/bin/oc-dispatch.sh` | 5035B | 2026-02-10 15:20 |
| `cross-agent-smoke.sh` | Builder | `/home/openclaw2/.openclaw/tools/cross-agent-smoke.sh` | 9614B | 2026-02-11 18:25 |
| `agent-exercise.sh` | Builder | `/home/openclaw2/.openclaw/tools/agent-exercise.sh` | 6669B | 2026-02-11 18:15 |
| `dispatch-to-builder.sh` | Dashboard | `/root/bin/dispatch-to-builder.sh` | 1356B | 2026-02-10 15:20 |
| `openclaw-watchdog.sh` | Dashboard | `/home/canary/openclaw-watchdog.sh` | 3150B | 2026-02-10 10:27 |
| `canary-check.sh` | Dashboard | `/home/canary/canary-check.sh` | 4523B | 2026-02-11 15:31 |
| `nightly-audit.sh` | Dashboard | `/home/openclaw/bootstrap/nightly-audit.sh` | 5965B | 2026-02-11 04:11 |

### Node Availability (Phase 0B)

| VPS | Node Path | Version |
|-----|-----------|---------|
| Dashboard | `/usr/bin/node` | v22.22.0 |
| Builder | `/usr/bin/node` | v22.22.0 |

### Repo Presence

| VPS | Repo Path | Branch | Has Port #16? |
|-----|-----------|--------|---------------|
| Dashboard | `/home/openclaw/staging/current/` | `main` | NO (only 3 scripts: build_bundles, coverage_report, coverage_report.test) |
| Builder | N/A | N/A | NO (repo not cloned) |

**Implication:** Port #16 CLIs must be deployed to `/opt/openclaw-runtime/` on each VPS before wiring.

---

## Decision: Option A (Bash Calls Port #16 CLIs)

**Why:**
1. No new code — reuses existing, tested CLIs (47 tests)
2. One-line rollback per file (restore from backup)
3. 5-10 lines of bash per guard block
4. Deployment is `scp` of 5 files
5. CLIs are standalone Node.js (no npm, no deps)

**Rejected:** Option B (single Node shim) — adds untested code, more moving pieces

---

## Files Created in This Repo

| File | Purpose | Tests |
|------|---------|-------|
| `plans/obj-17/task-1.md` | Wiring plan + architecture decisions | N/A |
| `docs/AUTONOMY_RUNTIME_WIRING.md` | How wiring works, env vars, operating procedures | W19-W23 |
| `scripts/wiring_contract.test.js` | 23 wiring contract tests | Self |
| `.github/workflows/gate-wiring-contract.yml` | CI gate for wiring tests | N/A |
| `ops/proofs/PROOF_PACK_PORT17_ENTRYPOINT_WIRING_2026-02-12T170000Z.md` | This file | N/A |

**No existing files modified.** Port #17 is additive only in this repo.

---

## Test Results

### Wiring Contract Tests (23/23)

```
Port #17 Wiring Contract Tests
===============================

A) Kill Switch Exit Code Contract
  PASS: W1: killswitch status exits 0 when inactive (no file)
  PASS: W2: killswitch status exits 1 when active (file present)
  PASS: W3: killswitch enable then disable then status exits 0
  PASS: W4: killswitch enable is idempotent

B) Quarantine List Output Contract
  PASS: W5: quarantine list with no agents prints no agent names
  PASS: W6: quarantine add + list shows agent name greppable
  PASS: W7: quarantine list output is grep -qw compatible for each agent
  PASS: W8: quarantine add then remove then list shows empty

C) Spend Alert Evaluate Contract
  PASS: W9: spend evaluate exits 0 with empty ledger
  PASS: W10: spend summary exits 0 with empty ledger
  PASS: W11: spend log accepts JSON entry

D) Canonical Artifact Contract
  PASS: W12: canonical ops-pulse creates JSON + MD files
  PASS: W13: canonical daily-exec-brief creates JSON + MD files
  PASS: W14: canonical artifact rejects invalid type

E) Runtime Dir Contract
  PASS: W15: all CLIs create state files in OPENCLAW_RUNTIME_DIR, not cwd
  PASS: W16: OPENCLAW_RUNTIME_DIR with spaces in path works

F) No Secrets in Outputs
  PASS: W17: spend log entry drops unknown fields (no secret leakage)
  PASS: W18: canonical artifact with Bearer token is sanitized

G) Wiring Docs Validation
  PASS: W19: AUTONOMY_RUNTIME_WIRING.md exists
  PASS: W20: wiring doc references OPENCLAW_RUNTIME_DIR
  PASS: W21: wiring doc references /opt/openclaw-runtime/
  PASS: W22: wiring doc references both VPS runtime dirs
  PASS: W23: wiring doc includes rollback section

Wiring Contract Tests: 23 passed, 0 failed
```

### Regression Tests (55/55)

```
Autonomy Runtime v1 Tests: 47 passed, 0 failed
Coverage Report Tests: 8 passed, 0 failed
```

### Total: 78 tests, 0 failures

---

## Wiring Spec: Exact Guard Blocks

### Kill Switch Guard Pattern

Every wired entrypoint gets this block after initial variable setup, before any work:

```bash
# --- Kill Switch Guard (Port #17) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="<vps-specific-path>"
if ! node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then
  log "KILLSWITCH_ACTIVE: aborting <entrypoint-name>"
  exit 0
fi
```

**Exit code contract:** `killswitch.js status` exits 0 = inactive (proceed), exits 1 = active (abort).

### Quarantine Filter Pattern

Only in `objective-autopilot.sh` `pick_agent_for_role()` (line 168), before python3 scoring:

```bash
# --- Quarantine filter (Port #17) ---
local filtered=""
for agent in $candidates; do
  if node "$RUNTIME_BIN/quarantine_agent.js" list 2>/dev/null | grep -qw "$agent"; then
    log "QUARANTINE_SKIP: agent=$agent role=$role"
    continue
  fi
  filtered="$filtered $agent"
done
filtered=$(echo "$filtered" | xargs)
if [ -z "$filtered" ]; then
  log "QUARANTINE_BLOCKED: all candidates quarantined for role=$role"
  state_emit_event "QUARANTINE_BLOCKED_ALL" "{\"role\":\"$role\"}"
  echo ""
  return 1
fi
candidates="$filtered"
```

### Canonical Artifact + Spend Evaluate

End of `objective-autopilot.sh` (before exit), and end of `nightly-audit.sh`:

```bash
# --- Spend + Artifact (Port #17) ---
node "$RUNTIME_BIN/spend_alert.js" evaluate 2>/dev/null || true
node "$RUNTIME_BIN/canonical_artifact.js" ops-pulse \
  "{\"objectives_scanned\":$OBJECTIVES_SCANNED,\"assigned\":$ASSIGNED_COUNT,\"stuck\":$STUCK_COUNT}" \
  2>/dev/null || true
```

---

## Entrypoint Wiring Summary

| Entrypoint | Kill Switch? | Quarantine? | Spend Eval? | Canonical Artifact? | Why |
|------------|-------------|-------------|-------------|---------------------|-----|
| `objective-autopilot.sh` | YES (top) | YES (`pick_agent_for_role`) | YES (end) | YES (`ops-pulse`, end) | Primary autonomy loop |
| `nightly-audit.sh` | YES (top) | NO (no agents) | NO | YES (`daily-exec-brief`, end) | Daily scorecard |
| `dispatch-to-builder.sh` | YES (top) | NO (pass-through) | NO | NO | Write dispatch gateway |
| `oc-dispatch.sh` | YES (write cmds only) | NO | NO | NO | Builder dispatch receiver |
| `cross-agent-smoke.sh` | YES (top) | NO | NO | NO | Synthetic test |
| `agent-exercise.sh` | YES (top) | NO | NO | NO | Synthetic exercise |
| `openclaw-watchdog.sh` | NO | NO | NO | NO | **Monitoring — always runs** |
| `canary-check.sh` | NO | NO | NO | NO | **Monitoring — always runs** |

---

## Deployment Sequence (for execution)

**Prerequisites:**
1. Port #16 merged to `main`
2. Port #17 files committed and merged

**Step 1: Deploy runtime files**
```bash
# Create dirs
ssh root@srv853172.hstgr.cloud "mkdir -p /opt/openclaw-runtime && mkdir -p /home/openclaw/_runtime"
ssh root@srv853172.hstgr.cloud "ssh openclaw2@100.75.216.57 'sudo mkdir -p /opt/openclaw-runtime && mkdir -p /home/openclaw2/.openclaw/_runtime'"

# SCP files to Dashboard
scp scripts/{autonomy_runtime,killswitch,quarantine_agent,spend_alert,canonical_artifact}.js \
    root@srv853172.hstgr.cloud:/opt/openclaw-runtime/

# Copy to Builder (via Dashboard jump)
ssh root@srv853172.hstgr.cloud "scp /opt/openclaw-runtime/*.js openclaw2@100.75.216.57:/tmp/ && \
  ssh openclaw2@100.75.216.57 'sudo cp /tmp/*.js /opt/openclaw-runtime/ && sudo chown openclaw2:openclaw2 /opt/openclaw-runtime/*.js'"
```

**Step 2: Backup entrypoints**
```bash
# Builder
ssh root@srv853172.hstgr.cloud "ssh openclaw2@100.75.216.57 '
  cp /home/openclaw2/.openclaw/tools/objective-autopilot.sh{,.backup-pre-port17}
  cp /home/openclaw2/.openclaw/tools/cross-agent-smoke.sh{,.backup-pre-port17}
  cp /home/openclaw2/.openclaw/tools/agent-exercise.sh{,.backup-pre-port17}
  cp /home/openclaw2/bin/oc-dispatch.sh{,.backup-pre-port17}
'"

# Dashboard
ssh root@srv853172.hstgr.cloud "
  cp /home/openclaw/bootstrap/nightly-audit.sh{,.backup-pre-port17}
  cp /root/bin/dispatch-to-builder.sh{,.backup-pre-port17}
"
```

**Step 3: Apply guard blocks** (write patch scripts locally, SCP to VPS, execute)

**Step 4: Verify**
- Run autopilot `--dry-run` with kill switch OFF → should proceed normally
- Enable kill switch → run autopilot `--dry-run` → should exit 0 immediately
- Disable kill switch → quarantine an agent → run autopilot `--dry-run` → agent should be skipped
- Remove quarantine → run autopilot `--dry-run` → all agents available

---

## Rollback Steps

### Builder VPS (one command)

```bash
ssh root@srv853172.hstgr.cloud "ssh openclaw2@100.75.216.57 '
  cp /home/openclaw2/.openclaw/tools/objective-autopilot.sh.backup-pre-port17 /home/openclaw2/.openclaw/tools/objective-autopilot.sh
  cp /home/openclaw2/.openclaw/tools/cross-agent-smoke.sh.backup-pre-port17 /home/openclaw2/.openclaw/tools/cross-agent-smoke.sh
  cp /home/openclaw2/.openclaw/tools/agent-exercise.sh.backup-pre-port17 /home/openclaw2/.openclaw/tools/agent-exercise.sh
  cp /home/openclaw2/bin/oc-dispatch.sh.backup-pre-port17 /home/openclaw2/bin/oc-dispatch.sh
  rm -rf /opt/openclaw-runtime/
'"
```

### Dashboard VPS (one command)

```bash
ssh root@srv853172.hstgr.cloud "
  cp /home/openclaw/bootstrap/nightly-audit.sh.backup-pre-port17 /home/openclaw/bootstrap/nightly-audit.sh
  cp /root/bin/dispatch-to-builder.sh.backup-pre-port17 /root/bin/dispatch-to-builder.sh
  rm -rf /opt/openclaw-runtime/
"
```

---

## Safety Invariants Preserved

| Invariant | Verified? |
|-----------|-----------|
| No secrets in repo or artifacts | YES (W17, W18) |
| Kill switch defaults to OFF (no behavior change until activated) | YES (W1) |
| Quarantine defaults to empty (no agents blocked) | YES (W5) |
| Guard failures cause graceful exit, not crash (`|| true`, `2>/dev/null`) | YES (by spec) |
| Monitoring scripts (watchdog, canary) NEVER blocked | YES (not wired) |
| All changes additive (no existing logic modified in repo) | YES |
| CI gates count: 7 → 8 (additive +1) | YES |
| Rollback is one command per VPS | YES |
| VPS bash scripts backed up before modification | YES (in deployment sequence) |
| No `npm install` or external deps required | YES (pure Node.js) |

---

## CI Integration

- **New check name:** `wiring-contract`
- **Job name:** `wiring-contract`
- **Trigger:** PRs touching wiring test, runtime scripts, wiring docs, or gate YAML
- **Gate count:** 7 → 8 (additive +1)

---

## What Remains for Execution

This proof pack covers the **plan, tests, and contract validation**. The actual VPS deployment (Step 1-4 above) is a separate execution task that requires:

1. Port #16 merged to `main` first
2. Explicit approval to modify VPS entrypoint scripts
3. A maintenance window (guard blocks add ~50ms Node startup per cron run)

**Status: PLAN + TESTS COMPLETE. VPS DEPLOYMENT PENDING APPROVAL.**
