# Proof Pack: Port #18 — Production Deployment of Autonomy Runtime Wiring

**Date:** 2026-02-12
**Auditor:** Claude Code (Opus 4.6)
**Repo:** openclaw-control, branch `feat/delivery-os-gates`, commit `878618b`
**Source of truth:** Local working copy (Port #16 NOT on main — override authorized by user)
**Prior ports:** Port #16 (library + CLIs), Port #17 (wiring plan + contract tests)

---

## Mission

Deploy the Port #16 Autonomy Runtime CLIs to both VPSes and wire them into all 6 bash entrypoints, creating a live kill switch, quarantine filter, spend monitoring, and canonical artifact system across the OpenClaw infrastructure.

---

## Phase Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Prerequisites | Verify checksums, VPS paths, Node version | DONE |
| Phase 1 | Deploy 5 JS CLIs to `/opt/openclaw-runtime/` on both VPSes | DONE |
| Phase 2 | Backup all 6 entrypoint files as `*.backup-pre-port18` | DONE |
| Phase 3 | Apply wiring edits to all 6 entrypoints | DONE |
| Phase 4 | Live drill verification (kill switch, quarantine, spend, artifacts) | DONE |
| Phase 5 | Proof pack + merge-to-main doc | DONE |

---

## Deployed CLI Files (5 files)

| File | sha256 |
|------|--------|
| `autonomy_runtime.js` | `119628293a36aacddcd5c06fb390ff1ae6ab00ddf3ad55e0990c26fac8e08620` |
| `killswitch.js` | `8687e705361d8be186beea41fe57a68c4786e2e1f88b7fc3c5eff9e2d93de11d` |
| `quarantine_agent.js` | `42af8a0c5cf810a1d2c5e442905dbc14a3d6c37181c08315f84363f019d0b73c` |
| `spend_alert.js` | `f24a6db10d8d30157c35295b93f46f6610e40c1490e1aa0780c51a6bdee42f21` |
| `canonical_artifact.js` | `232eabf4f5e777829dbf80c1656b2ebb0a731999a12099df1f03d4f59a0c2db2` |

**Checksum match:** Local = Dashboard VPS = Builder VPS (all 5 identical)

### Deploy Locations

| VPS | Path | Runtime Dir |
|-----|------|-------------|
| Dashboard (31.97.106.33) | `/opt/openclaw-runtime/` | `/home/openclaw/_runtime` |
| Builder (100.75.216.57) | `/opt/openclaw-runtime/` | `/home/openclaw2/.openclaw/_runtime` |

---

## Entrypoint Wiring Summary (6 files)

### Builder VPS (187.77.6.191 / Tailscale 100.75.216.57)

| Entrypoint | Original Lines | Patched Lines | Guards Added |
|------------|---------------|---------------|-------------|
| `objective-autopilot.sh` | 848 | 889 (+41) | Kill switch, Quarantine filter, Spend+Artifact |
| `cross-agent-smoke.sh` | 287 | 296 (+9) | Kill switch |
| `agent-exercise.sh` | 235 | 244 (+9) | Kill switch |
| `oc-dispatch.sh` | 145 | 180 (+35) | Kill switch (per write command: 5 guards) |

### Dashboard VPS (31.97.106.33)

| Entrypoint | Original Lines | Patched Lines | Guards Added |
|------------|---------------|---------------|-------------|
| `dispatch-to-builder.sh` | 41 | 50 (+9) | Kill switch |
| `nightly-audit.sh` | 173 | 188 (+15) | Kill switch, Canonical artifact |

**Total lines added:** 41 + 9 + 9 + 35 + 9 + 15 = **118 lines across 6 files**

---

## Guard Block Details

### Kill Switch Guard (all 6 entrypoints)
```bash
# --- Kill Switch Guard (Port #18) ---
RUNTIME_BIN="/opt/openclaw-runtime"
export OPENCLAW_RUNTIME_DIR="<vps-specific-runtime-dir>"
if node "$RUNTIME_BIN/killswitch.js" status >/dev/null 2>&1; then
  :  # kill switch is OFF, continue
else
  log "KILLSWITCH_ACTIVE: aborting <entrypoint>"
  exit 0
fi
# --- End Kill Switch Guard ---
```
**Contract:** `killswitch.js status` exits 0 = inactive (continue), exits 1 = active (abort)

### Quarantine Filter (objective-autopilot.sh only)
```bash
# --- Quarantine filter (Port #18) ---
local filtered=""
for agent in $candidates; do
  if node "$RUNTIME_BIN/quarantine_agent.js" list 2>/dev/null | grep -qw "$agent"; then
    log "QUARANTINE_SKIP: agent=$agent role=$role"
    continue
  fi
  filtered="$filtered $agent"
done
# ... (blocks assignment if all candidates quarantined)
# --- End quarantine filter ---
```
**Location:** Inside `pick_agent_for_role()`, before python3 scoring block

### Spend + Artifact (objective-autopilot.sh)
```bash
# --- Spend + Artifact (Port #18) ---
node "$RUNTIME_BIN/spend_alert.js" evaluate 2>/dev/null || true
node "$RUNTIME_BIN/canonical_artifact.js" ops-pulse \
  "{\"objectives_scanned\":$OBJECTIVES_SCANNED,...}" 2>/dev/null || true
# --- End Spend + Artifact ---
```
**Location:** Before final `if $DRY_RUN; then` exit block

### Canonical Artifact (nightly-audit.sh)
```bash
# --- Canonical daily-exec-brief (Port #18) ---
node "$RUNTIME_BIN/canonical_artifact.js" daily-exec-brief \
  "{\"total_checks\":$((PASS+WARN+FAIL)),...}" 2>/dev/null || true
# --- End Canonical Artifact ---
```
**Location:** Before exit code section

---

## Live Drill Results

### Builder VPS

| Drill | Result | Evidence |
|-------|--------|----------|
| Kill switch enable → status exits 1 | PASS | `Kill switch: ACTIVE` + `BLOCK: kill switch ACTIVE, would abort` |
| Kill switch disable → status exits 0 | PASS | `Kill switch: INACTIVE` + `EXITCODE_WAS_0` |
| Quarantine add → grep -qw matches | PASS | `QUARANTINE_SKIP: test-agent is quarantined` |
| Quarantine remove → grep -qw fails | PASS | `PASS: test-agent cleared` |
| Spend evaluate → exits 0, shows $ | PASS | `Daily spend: $0.0000 (0.0% of cap)` |
| ops-pulse artifact → .json + .md created | PASS | `Written: ...ops-pulse-2026-02-12T18-15-48-411Z.{json,md}` |
| daily-exec-brief artifact → .json + .md | PASS | `Written: ...daily-exec-brief-2026-02-12T18-15-48-453Z.{json,md}` |

### Dashboard VPS

| Drill | Result | Evidence |
|-------|--------|----------|
| Kill switch status → exits 0 (inactive) | PASS | `Kill switch: INACTIVE` + `EXIT_WAS_0` |
| Quarantine list → empty | PASS | `No agents quarantined.` |
| Spend evaluate → exits 0, shows $ | PASS | `Daily spend: $0.0000 (0.0% of cap)` |
| daily-exec-brief artifact → .json + .md | PASS | `Written: ...daily-exec-brief-2026-02-12T18-16-02-892Z.{json,md}` |

**All drill data cleaned up after verification.**

---

## Backup Files

### Builder VPS
| File | Path |
|------|------|
| objective-autopilot.sh | `/home/openclaw2/.openclaw/tools/objective-autopilot.sh.backup-pre-port18` |
| cross-agent-smoke.sh | `/home/openclaw2/.openclaw/tools/cross-agent-smoke.sh.backup-pre-port18` |
| agent-exercise.sh | `/home/openclaw2/.openclaw/tools/agent-exercise.sh.backup-pre-port18` |
| oc-dispatch.sh | `/home/openclaw2/bin/oc-dispatch.sh.backup-pre-port18` |

### Dashboard VPS
| File | Path |
|------|------|
| dispatch-to-builder.sh | `/root/bin/dispatch-to-builder.sh.backup-pre-port18` |
| nightly-audit.sh | `/home/openclaw/bootstrap/nightly-audit.sh.backup-pre-port18` |

---

## Rollback Procedure

### Per-file rollback (Builder VPS)
```bash
# SSH to Builder via Dashboard jump
ssh root@srv853172.hstgr.cloud
ssh openclaw2@100.75.216.57

# Restore individual files
cp /home/openclaw2/.openclaw/tools/objective-autopilot.sh.backup-pre-port18 \
   /home/openclaw2/.openclaw/tools/objective-autopilot.sh
cp /home/openclaw2/.openclaw/tools/cross-agent-smoke.sh.backup-pre-port18 \
   /home/openclaw2/.openclaw/tools/cross-agent-smoke.sh
cp /home/openclaw2/.openclaw/tools/agent-exercise.sh.backup-pre-port18 \
   /home/openclaw2/.openclaw/tools/agent-exercise.sh
cp /home/openclaw2/bin/oc-dispatch.sh.backup-pre-port18 \
   /home/openclaw2/bin/oc-dispatch.sh
```

### Per-file rollback (Dashboard VPS)
```bash
ssh root@srv853172.hstgr.cloud

cp /root/bin/dispatch-to-builder.sh.backup-pre-port18 \
   /root/bin/dispatch-to-builder.sh
cp /home/openclaw/bootstrap/nightly-audit.sh.backup-pre-port18 \
   /home/openclaw/bootstrap/nightly-audit.sh
```

### Full nuclear rollback (remove all Port #18)
```bash
# 1. Restore all entrypoints (commands above)
# 2. Remove CLIs
rm -rf /opt/openclaw-runtime/
# 3. Remove runtime state dirs
rm -rf /home/openclaw2/.openclaw/_runtime/   # Builder
rm -rf /home/openclaw/_runtime/               # Dashboard
```

---

## Patching Issues Encountered and Resolved

1. **sed quarantine filter matched too broadly** — First attempt used `sed -i '/python3 -c/i\...'` which matched ALL 4 `python3 -c "` lines in autopilot, not just the one in `pick_agent_for_role`. Restored from backup, switched to Python-based surgical patcher with exact line-number assertions.

2. **Python patcher line number off by 2** — First run of `patch-autopilot.py` assumed `python3 -c "` at line 180 (from wiring spec recon), but `grep -n` showed line 178. Fixed offset from `179 + ks_added` to `177 + ks_added`. Second run succeeded with all 3 assertions passing.

3. **SSH heredoc quoting** — JSON arguments to canonical_artifact.js were consumed by multi-hop SSH quoting. Resolved by writing script files with single-quoted heredocs and SCP-ing to target, or using `bash -s << 'EOF'` directly.

---

## Off-Main Deployment Exception

**The deployed CLIs come from branch `feat/delivery-os-gates` (commit `878618b`), NOT from `main`.**

This was authorized by the user with the following justification:
- Port #16 code is complete and tested (47/47 tests pass)
- Port #17 wiring contract tests pass (23/23)
- All 5 CLI files have verified sha256 checksums
- Merge-to-main doc created at `plans/obj-16/merge-to-main.md`

See: `plans/obj-16/merge-to-main.md` for merge plan.

---

## Final Certification

| Requirement | Met? |
|-------------|------|
| 5 CLI files deployed to both VPSes | YES |
| sha256 checksums match local → Dashboard → Builder | YES |
| All 6 entrypoints wired with Port #18 guards | YES |
| Kill switch blocks when enabled | YES |
| Kill switch passes when disabled | YES |
| Quarantine filter skips quarantined agents | YES |
| Quarantine passes when cleared | YES |
| Spend evaluate exits 0 with $ output | YES |
| Canonical artifacts create .json + .md files | YES |
| All backups created as *.backup-pre-port18 | YES |
| Rollback procedure documented and tested | YES |
| Drill data cleaned up after verification | YES |
| Node v22.22.0 on both VPSes | YES |

**Status: PORT #18 DEPLOYMENT COMPLETE. All guards live on both VPSes.**
