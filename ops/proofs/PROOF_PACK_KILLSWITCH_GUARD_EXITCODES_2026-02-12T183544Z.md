# Proof Pack: Kill Switch Guard Exit Codes

**Date:** 2026-02-12
**Auditor:** Claude Code (Opus 4.6)
**Repo:** openclaw-control, branch `feat/delivery-os-gates`, commit `878618b`
**Prior ports:** Port #16 (library), Port #17 (wiring contract), Port #18 (deployment)

---

## Mission

Fix kill switch semantics so bash entrypoints use a single unambiguous `guard` command with explicit exit codes:
- `0` = OK to run
- `10` = kill switch active
- `2` = fail-closed error

Replace all `status` calls in VPS entrypoints with `guard`.

---

## Phase Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Implement `guard` command + update tests | DONE |
| Phase 1 | Deploy updated killswitch.js to both VPSes | DONE |
| Phase 2 | Patch all 6 VPS entrypoints | DONE |
| Phase 3 | Live drill verification | DONE |
| Phase 4 | Proof pack | DONE |

---

## Files Modified (Repo)

### scripts/killswitch.js — Added `guard` command

```diff
+ case 'guard':
+   try {
+     const fs = require('fs');
+     const runtimeDir = runtime.RUNTIME_DIR;
+     if (fs.existsSync(runtimeDir)) {
+       try {
+         fs.accessSync(runtimeDir, fs.constants.R_OK);
+       } catch {
+         console.log('KILLSWITCH_FAILCLOSED');
+         process.exit(2);
+       }
+     }
+     if (runtime.isKillSwitchActive()) {
+       console.log('KILLSWITCH_ACTIVE');
+       process.exit(10);
+     } else {
+       console.log('KILLSWITCH_OK');
+       process.exit(0);
+     }
+   } catch (e) {
+     console.log('KILLSWITCH_FAILCLOSED');
+     process.exit(2);
+   }
+   break;
```

### scripts/autonomy_runtime.test.js — Added 3 tests (G5-G7)

| Test | Description | Result |
|------|-------------|--------|
| G5 | guard exits 0, prints KILLSWITCH_OK when inactive | PASS |
| G6 | guard exits 10, prints KILLSWITCH_ACTIVE when enabled | PASS |
| G7 | guard exits 2, prints KILLSWITCH_FAILCLOSED on unreadable dir | PASS (skipped on Windows) |

### scripts/wiring_contract.test.js — Updated W1-W4

| Test | Old | New | Result |
|------|-----|-----|--------|
| W1 | status exits 0 | guard exits 0 + KILLSWITCH_OK | PASS |
| W2 | status exits 1 | guard exits 10 + KILLSWITCH_ACTIVE | PASS |
| W3 | status exits 0 after disable | guard exits 0 + KILLSWITCH_OK after disable | PASS |
| W4 | status exits 1 (idempotent) | guard exits 10 (idempotent) | PASS |

---

## Test Results

```
Autonomy Runtime v1 Tests: 50 passed, 0 failed  (47 original + 3 new)
Wiring Contract Tests:     23 passed, 0 failed  (4 updated)
Coverage Report Tests:      8 passed, 0 failed  (regression)
────────────────────────────────────────────────
Total:                     81 passed, 0 failed
```

---

## Deployed CLI sha256

| Location | sha256 |
|----------|--------|
| Local `scripts/killswitch.js` | `e8dfa751619e6c3356e38adbe6ca596061d17c128940bc93f1973e3d8d09101e` |
| Dashboard `/opt/openclaw-runtime/killswitch.js` | `e8dfa751619e6c3356e38adbe6ca596061d17c128940bc93f1973e3d8d09101e` |
| Builder `/opt/openclaw-runtime/killswitch.js` | `e8dfa751619e6c3356e38adbe6ca596061d17c128940bc93f1973e3d8d09101e` |

**All 3 match.**

---

## VPS Entrypoints Patched (6 files)

### Builder VPS

| Entrypoint | Guard calls | Old `status` calls |
|------------|-------------|-------------------|
| `objective-autopilot.sh` | 1 | 0 |
| `cross-agent-smoke.sh` | 1 | 0 |
| `agent-exercise.sh` | 1 | 0 |
| `oc-dispatch.sh` | 5 (per write cmd) | 0 |

### Dashboard VPS

| Entrypoint | Guard calls | Old `status` calls |
|------------|-------------|-------------------|
| `dispatch-to-builder.sh` | 1 | 0 |
| `nightly-audit.sh` | 1 | 0 |

### New bash guard pattern (all entrypoints)

```bash
node "$RUNTIME_BIN/killswitch.js" guard >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 10 ] || [ "$rc" -eq 2 ]; then
  # kill switch active or fail-closed
  exit 0
elif [ "$rc" -ne 0 ]; then
  # unknown error — fail closed
  exit 0
fi
```

---

## Live Drill Results

### Builder VPS

| Drill | Output | Exit Code | Result |
|-------|--------|-----------|--------|
| Guard inactive | `KILLSWITCH_OK` | 0 | PASS |
| Enable → guard | `KILLSWITCH_ACTIVE` | 10 | PASS |
| Bash guard block blocks on rc=10 | `BLOCKED: killswitch active or fail-closed (rc=10)` | — | PASS |
| Disable → guard | `KILLSWITCH_OK` | 0 | PASS |
| Fail-closed (chmod 000) | `KILLSWITCH_FAILCLOSED` | 2 | PASS |

### Dashboard VPS

| Drill | Output | Exit Code | Result |
|-------|--------|-----------|--------|
| Guard inactive | `KILLSWITCH_OK` | 0 | PASS |
| Enable → guard | `KILLSWITCH_ACTIVE` | 10 | PASS |
| Disable → guard | `KILLSWITCH_OK` | 0 | PASS |

---

## Backup Files

### Builder VPS
| File | Backup |
|------|--------|
| objective-autopilot.sh | `*.backup-pre-killswitch-guardfix` |
| cross-agent-smoke.sh | `*.backup-pre-killswitch-guardfix` |
| agent-exercise.sh | `*.backup-pre-killswitch-guardfix` |
| oc-dispatch.sh | `*.backup-pre-killswitch-guardfix` |

### Dashboard VPS
| File | Backup |
|------|--------|
| dispatch-to-builder.sh | `*.backup-pre-killswitch-guardfix` |
| nightly-audit.sh | `*.backup-pre-killswitch-guardfix` |

---

## Rollback Procedure

### Restore entrypoints (Builder)
```bash
ssh root@srv853172.hstgr.cloud
ssh openclaw2@100.75.216.57

cd /home/openclaw2/.openclaw/tools
cp objective-autopilot.sh.backup-pre-killswitch-guardfix objective-autopilot.sh
cp cross-agent-smoke.sh.backup-pre-killswitch-guardfix cross-agent-smoke.sh
cp agent-exercise.sh.backup-pre-killswitch-guardfix agent-exercise.sh

cd /home/openclaw2/bin
cp oc-dispatch.sh.backup-pre-killswitch-guardfix oc-dispatch.sh
```

### Restore entrypoints (Dashboard)
```bash
ssh root@srv853172.hstgr.cloud

cp /root/bin/dispatch-to-builder.sh.backup-pre-killswitch-guardfix /root/bin/dispatch-to-builder.sh
cp /home/openclaw/bootstrap/nightly-audit.sh.backup-pre-killswitch-guardfix /home/openclaw/bootstrap/nightly-audit.sh
```

### Restore prior killswitch.js (if needed)
The Port #18 backup of killswitch.js is embedded in the `*.backup-pre-port18` entrypoint backups. To restore the prior killswitch.js CLI:
```bash
# On each VPS, restore from the Port #18 deployment
# Dashboard:
scp <local>/scripts/killswitch.js.pre-guard root@srv853172.hstgr.cloud:/opt/openclaw-runtime/killswitch.js
# Builder:
ssh root@srv853172.hstgr.cloud "scp /opt/openclaw-runtime/killswitch.js openclaw2@100.75.216.57:/opt/openclaw-runtime/killswitch.js"
```

---

## What Was NOT Changed

- Quarantine logic (unchanged)
- Spend/burn-rate logic (unchanged)
- Canonical artifact logic (unchanged)
- Watchdog/canary wiring (not touched)
- CI gates (additive only — no removals)
- `status` subcommand still works (backward compatible)

---

## Exit Code Contract (Final)

| Subcommand | Condition | Exit Code | Stdout |
|------------|-----------|-----------|--------|
| `guard` | Kill switch OFF | 0 | `KILLSWITCH_OK` |
| `guard` | Kill switch ON | 10 | `KILLSWITCH_ACTIVE` |
| `guard` | Runtime dir unreadable / I/O error | 2 | `KILLSWITCH_FAILCLOSED` |
| `status` | Kill switch OFF | 0 | (human-readable) |
| `status` | Kill switch ON | 1 | (human-readable) |

**Status: KILL SWITCH GUARD EXIT CODES — COMPLETE. All 6 entrypoints migrated.**
