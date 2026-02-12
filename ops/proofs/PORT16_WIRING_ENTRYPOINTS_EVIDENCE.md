# Port #16 Wiring Evidence: Kill Switch + Quarantine in Runtime Entrypoints

**Date:** 2026-02-12
**Auditor:** Claude Code (Opus 4.6)
**Repo:** openclaw-control
**Branch:** `feat/delivery-os-gates`
**Commit:** `878618b65a667d7e09fad1ff4db8527996cac4ea`

---

## 1. Entrypoints Identified

### In This Repo (`openclaw-control`)

The `openclaw-control` repo is a **governance/control-plane repo**. It contains:
- Registry definitions (`registry/ROLE_REGISTRY.yaml`)
- Bundle compilation (`scripts/build_bundles.js`)
- Coverage analysis (`scripts/coverage_report.js`)
- **Port #16 runtime library + CLIs** (`scripts/autonomy_runtime.js`, `scripts/killswitch.js`, `scripts/quarantine_agent.js`, `scripts/spend_alert.js`, `scripts/canonical_artifact.js`)

**No autopilot loop, dispatch wrapper, or scheduled runner exists in this repo.**

The actual runtime entrypoints live on the VPSes (confirmed by the existence audit):

| Entrypoint | Location | Schedule |
|------------|----------|----------|
| `objective-autopilot.sh` | Builder VPS: `/home/openclaw2/.openclaw/tools/objective-autopilot.sh` | `*/10 * * * *` (cron) |
| `openclaw-watchdog.sh` | Dashboard VPS: `/home/canary/openclaw-watchdog.sh` | `*/5 * * * *` (cron) |
| `canary-check.sh` | Dashboard VPS: `/home/canary/canary-check.sh` | `0 * * * *` (cron) |
| `nightly-audit.sh` | Dashboard VPS: `/home/openclaw/bootstrap/nightly-audit.sh` | `0 4 * * *` (cron) |
| `dispatch-to-builder.sh` | Dashboard VPS: `/root/bin/dispatch-to-builder.sh` | On-demand |
| `oc-dispatch.sh` | Builder VPS: `/home/openclaw2/bin/oc-dispatch.sh` | On-demand (via SSH) |
| `cross-agent-smoke.sh` | Builder VPS: `/home/openclaw2/.openclaw/tools/cross-agent-smoke.sh` | `0 6 * * *` (cron) |
| `agent-exercise.sh` | Builder VPS: `/home/openclaw2/.openclaw/tools/agent-exercise.sh` | `5 6 * * *` (cron) |

**These are all bash scripts on remote VPSes, not Node.js scripts in this repo.**

---

## 2. Scheduler/Trigger Evidence

All scheduling is external to this repo. Evidence from the existence audit (OPENCLAW_AUTONOMY_RUNTIME_EXISTENCE_AUDIT.md):

- **Builder VPS cron** (`crontab -l -u openclaw2`): `*/10 * * * *` runs `objective-autopilot.sh`
- **Dashboard VPS cron** (`crontab -l`): `*/5` watchdog, hourly canary, `04:00` nightly audit
- **Builder VPS systemd**: `openclaw-canary.timer` (hourly), `openclaw-weekly-audit.timer` (Sun 06:00)

**No cron, systemd, or timer configuration exists in this repo** — confirmed by:
```
rg -n "cron|crontab|systemd|timer" . → 0 matches in scripts/, only doc references
```

---

## 3. Kill Switch Wiring Evidence

### Library Implementation (EXISTS)

**File:** `scripts/autonomy_runtime.js`

```javascript
// Line 161
const KILLSWITCH_FILE = 'killswitch.enabled';

// Lines 163-169
function isKillSwitchActive() {
  // ... checks for presence of killswitch.enabled file
  // Fail-closed: on error, returns true (assumes active)
}

// Lines 195-201
function killSwitchGuard(entrypoint) {
  if (isKillSwitchActive()) {
    emitEvent('KILLSWITCH_ACTIVE', { entrypoint: entrypoint || 'unknown' });
    return true;
  }
  return false;
}
```

**Exported at line 448:** `killSwitchGuard`

### CLI Implementation (EXISTS)

**File:** `scripts/killswitch.js` — CLI with `enable`, `disable`, `status` commands.

### Wired Into VPS Entrypoints?

**NO.** Evidence:

```
rg -n "require.*autonomy_runtime" . → matches ONLY:
  - scripts/canonical_artifact.js:12
  - scripts/killswitch.js:13
  - scripts/quarantine_agent.js:13
  - scripts/spend_alert.js:13
  - scripts/autonomy_runtime.test.js:48
  - .github/workflows/gate-autonomy-runtime.yml:62,66
```

No VPS entrypoint script imports or calls `autonomy_runtime.js`. The VPS entrypoints (`objective-autopilot.sh`, `dispatch-to-builder.sh`, etc.) are **bash scripts** that do not call `node scripts/killswitch.js` or `node -e "require('./scripts/autonomy_runtime').killSwitchGuard()"`.

**Kill switch at top of autopilot entrypoint: NO**
**Kill switch at top of dispatch wrappers: NO**
**Kill switch at top of any scheduled runner: NO**

---

## 4. Quarantine Wiring Evidence

### Library Implementation (EXISTS)

**File:** `scripts/autonomy_runtime.js`

```javascript
// Lines 145-158
function pickAgentSkipQuarantine(candidates, context) {
  const quarantined = new Set(quarantineList());
  for (const agent of candidates) {
    if (!quarantined.has(agent)) {
      return agent;
    }
  }
  emitEvent('AGENT_QUARANTINE_BLOCKED_ASSIGNMENT', {
    candidates,
    all_quarantined: true,
    context: context || null
  });
  return null;
}
```

**Exported at line 441:** `pickAgentSkipQuarantine`

### CLI Implementation (EXISTS)

**File:** `scripts/quarantine_agent.js` — CLI with `add`, `remove`, `list` commands.

### Wired Into VPS Entrypoints?

**NO.** The `objective-autopilot.sh` on the Builder VPS has its own `ROLE_AGENTS` mapping and agent selection logic in bash. It does **not** call `pickAgentSkipQuarantine()` or read `quarantine.json`.

Evidence: No file outside the 4 Port #16 CLI scripts and the test file imports `autonomy_runtime`:

```
rg "require.*quarantine" . → 0 matches (outside CLI/test files)
rg "pickAgentSkipQuarantine" . → matches only in:
  - scripts/autonomy_runtime.js (definition + export)
  - scripts/autonomy_runtime.test.js (test cases)
```

**Quarantine consulted before agent selection: NO**
**Quarantine consulted before dispatch: NO**

---

## 5. OPENCLAW_RUNTIME_DIR Consistency

**File:** `scripts/autonomy_runtime.js:18`
```javascript
const RUNTIME_DIR = process.env.OPENCLAW_RUNTIME_DIR || path.join(REPO_ROOT, '.openclaw_runtime');
```

- Default: `<repo_root>/.openclaw_runtime`
- Override: `OPENCLAW_RUNTIME_DIR` env var
- Gitignored: `.openclaw_runtime/` in `.gitignore:32`
- CI uses temp dir: `OPENCLAW_RUNTIME_DIR: ${{ runner.temp }}/oc-runtime-test` (gate YAML line 26)
- All 4 CLIs inherit via `require('./autonomy_runtime')` which reads `RUNTIME_DIR` at module load

**Consistent within the library and CLIs: YES**
**Passed to or used by VPS entrypoints: NO** (they don't use the library)

---

## 6. Canonical Artifact Wiring Evidence

### Library Implementation (EXISTS)

**File:** `scripts/autonomy_runtime.js` — `writeCanonicalArtifact()` emits `OPS_PULSE_WRITTEN` and `DAILY_EXEC_BRIEF_WRITTEN` events.

### CLI Implementation (EXISTS)

**File:** `scripts/canonical_artifact.js` — accepts `ops-pulse` or `daily-exec-brief` + JSON data.

### Invoked By a Scheduled Loop?

**NO.**

```
rg "canonical_artifact" . → matches only in:
  - scripts/canonical_artifact.js (the script itself)
  - scripts/autonomy_runtime.test.js (test)
  - .github/workflows/gate-autonomy-runtime.yml (CI verification)
  - ops/proofs/PROOF_PACK_AUTONOMY_RUNTIME_V1_PORT16.md (doc)
```

No cron job, systemd timer, or scheduled script calls `node scripts/canonical_artifact.js`. The Dashboard VPS `nightly-audit.sh` produces its own scorecard format — it does not invoke the canonical artifact writer.

**Canonical artifact invoked by scheduled loop: NO**

---

## 7. Entrypoint Compliance Table

| Entrypoint | Location | Trigger | Kill Switch Guard at Top? | Quarantine Before Selection/Dispatch? | Canonical Artifact Invoked? | Evidence |
|------------|----------|---------|---------------------------|---------------------------------------|----------------------------|----------|
| `objective-autopilot.sh` | Builder VPS (bash) | `*/10` cron | **NO** | **NO** | **NO** | Not in repo; bash script doesn't call Node runtime |
| `openclaw-watchdog.sh` | Dashboard VPS (bash) | `*/5` cron | **NO** | N/A (no agent selection) | **NO** | Not in repo |
| `canary-check.sh` | Dashboard VPS (bash) | Hourly cron | **NO** | N/A | **NO** | Not in repo |
| `nightly-audit.sh` | Dashboard VPS (bash) | `04:00` cron | **NO** | N/A | **NO** | Not in repo |
| `dispatch-to-builder.sh` | Dashboard VPS (bash) | On-demand | **NO** | **NO** | N/A | Not in repo |
| `oc-dispatch.sh` | Builder VPS (bash) | On-demand (SSH) | **NO** | **NO** | N/A | Not in repo |
| `cross-agent-smoke.sh` | Builder VPS (bash) | `06:00` cron | **NO** | N/A | **NO** | Not in repo |
| `agent-exercise.sh` | Builder VPS (bash) | `06:05` cron | **NO** | N/A | **NO** | Not in repo |
| `scripts/killswitch.js` | This repo (Node CLI) | Manual | YES (is the guard) | N/A | N/A | `scripts/killswitch.js:13` |
| `scripts/quarantine_agent.js` | This repo (Node CLI) | Manual | N/A | YES (is the quarantine) | N/A | `scripts/quarantine_agent.js:13` |
| `scripts/canonical_artifact.js` | This repo (Node CLI) | Manual | N/A | N/A | YES (is the writer) | `scripts/canonical_artifact.js:12` |

---

## 8. Gaps / Risks

1. **CRITICAL: Kill switch is NOT wired into any VPS entrypoint.** The `killSwitchGuard()` function exists in the Node.js library but the real autopilot (`objective-autopilot.sh`) and dispatch scripts are bash and do not call it. Activating the kill switch via `node scripts/killswitch.js enable` creates a file that nothing reads during autonomous operation.

2. **CRITICAL: Quarantine is NOT consulted by the real agent dispatch.** The `objective-autopilot.sh` has its own `ROLE_AGENTS` mapping in bash. Adding an agent to quarantine via `node scripts/quarantine_agent.js add builder1_main` has no effect on the actual dispatch loop.

3. **MODERATE: Canonical artifact writer is never invoked by any scheduled loop.** The `nightly-audit.sh` and `cross-agent-smoke.sh` produce their own artifact formats. No script calls `node scripts/canonical_artifact.js`.

4. **MODERATE: Spend telemetry has no data source.** No VPS process calls `node scripts/spend_alert.js log` — the spend ledger will always be empty unless manually populated.

5. **ARCHITECTURAL: The control-plane repo (Node.js) and the runtime entrypoints (bash on VPSes) are disconnected.** Port #16 built a complete, tested library with CLIs, but integration requires either: (a) modifying the VPS bash scripts to call the Node CLIs, or (b) creating a Node.js wrapper/daemon on the VPSes that the bash scripts consult.

---

## 9. Commands Run

```bash
# A) Locate entrypoints and schedulers
rg -n "objective-autopilot|autopilot\.sh|ROLE_AGENTS|dispatch-to|cross-VPS|builder" -S .
rg -n "cron|crontab|systemd|timer|watchdog|canary|autopilot" -S .
rg -n "dispatch|entrypoint|main loop|scheduler|autopilot|runner" --glob "*.js" .

# B) Kill switch wiring
rg -n "killswitch\.enabled|KILLSWITCH_ACTIVE|isKillSwitch|kill.?switch" scripts/
rg -n "require.*autonomy_runtime|import.*autonomy_runtime" .

# C) Quarantine wiring
rg -n "quarantine\.json|pickAgentSkipQuarantine|AGENT_QUARANTINE_BLOCKED_ASSIGNMENT|quarantin" scripts/
rg -n "require.*killswitch|require.*quarantine|require.*spend_alert|require.*canonical_artifact" .

# D) Canonical artifact invocation
rg -n "canonical_artifact|ops-pulse-|daily-exec-brief-|OPS_PULSE_WRITTEN|DAILY_EXEC_BRIEF_WRITTEN" .

# E) Cross-reference with bootstrap/ops docs
rg -n "autonomy.runtime|killswitch|quarantine|kill.switch" bootstrap/
rg -n "autonomy.runtime|killswitch|quarantine|kill.switch" ops/
rg -n "objective.autopilot|dispatch.to.builder|oc.dispatch" .

# F) Repo state
git branch --show-current  → feat/delivery-os-gates
git rev-parse HEAD          → 878618b65a667d7e09fad1ff4db8527996cac4ea
git log --oneline -10       → 878618b feat: bundle coverage report tool + QA approval gate
ls scripts/*.js             → 9 JS files (build_bundles, coverage_report, coverage_report.test,
                               autonomy_runtime, quarantine_agent, killswitch, spend_alert,
                               canonical_artifact, autonomy_runtime.test)
```

---

## 10. Summary

**Port #16 built a complete, well-tested library and CLI toolkit** (47 tests, CI gate, fail-closed safety). The library's API (`killSwitchGuard`, `pickAgentSkipQuarantine`, `writeCanonicalArtifact`, `evaluateSpendAlerts`) is correctly designed for entrypoint integration.

**However, none of the real runtime entrypoints consume it.** The actual autonomy loop (`objective-autopilot.sh`), dispatch scripts, watchdog, canary, and nightly audit are all bash scripts on remote VPSes that do not import or call the Node.js runtime library.

**Status: Library COMPLETE. Entrypoint wiring NOT DONE.**

To close this gap, the VPS bash scripts need to be modified to call the Node CLIs (e.g., `node /path/to/killswitch.js status` at the top of `objective-autopilot.sh`), or the library needs to be deployed to the VPSes and integrated into the dispatch path.
