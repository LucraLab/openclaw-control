# Proof Pack: Quarantine Lock Race Fix — Upstream to Repo

**Date:** 2026-02-12
**Auditor:** Claude Code (Opus 4.6)
**Repo:** openclaw-control, branch `fix/quarantine-lock-racefix-upstream`
**Commit:** `d0f4b4c560fe9f69f5ac6e80388d4e08a2105384`
**PR:** [#38](https://github.com/LucraLab/openclaw-control/pull/38)
**Target:** `feat/delivery-os-gates`
**Origin:** VPS hotpatch deployed 2026-02-12T213500Z (see `PROOF_PACK_QUARANTINE_RACEFIX_APPLIED_20260212T213500Z.md`)

---

## Mission

Upstream the production quarantine lock hotpatch into the repo with deterministic tests, passing all CI gates, and behavioral equivalence to prod.

---

## SHA256 Identity

| Artifact | SHA256 |
|----------|--------|
| Repo BEFORE (base branch) | `119628293a36aacddcd5c06fb390ff1ae6ab00ddf3ad55e0990c26fac8e08620` |
| Repo AFTER (this commit) | `03726dff6ac86f60e900981901471603e2e89d6ec3d7ab8856dcba936b459ea3` |
| Prod (Dashboard VPS) | `59276d3272279da17f69f15a6af07b0e5d73f688f18d3367a205155d42f15458` |
| Prod (Builder VPS) | `59276d3272279da17f69f15a6af07b0e5d73f688f18d3367a205155d42f15458` |

**Match status:** Repo and prod sha256 differ. The difference is whitespace-only — repo uses consistent 4-space indentation inside the try block; prod has inconsistent indentation from the automated patch script. Logic is identical.

---

## Diff Summary

2 files changed, +218 -10 lines.

### scripts/autonomy_runtime.js — Hunk 1: Lock utilities (+45 lines)

Added after `MAX_QUARANTINE_AGENTS`:

- Constants: `QUARANTINE_LOCK_FILE`, `LOCK_TIMEOUT_MS` (5000ms)
- `acquireLock()`: O_EXCL atomic file creation, 10ms retry loop, stale lock recovery (>5s), corrupt lock recovery
- `releaseLock()`: Safe unlink with error swallow

### scripts/autonomy_runtime.js — Hunk 2: pickAgentSkipQuarantine wrapping (+27 -10 lines)

Wrapped existing logic in lock/try/catch:

- Lock acquire at entry; fail-closed on timeout (return null + emit `AGENT_QUARANTINE_BLOCKED_ASSIGNMENT` with `reason: 'lock_timeout'`)
- Release on successful pick, on all-quarantined path, and in catch
- No change to selection algorithm or event payloads (except `reason` field added on timeout path)

### scripts/autonomy_runtime.js — Hunk 3: Exports (+4 lines)

Exported: `QUARANTINE_LOCK_FILE`, `LOCK_TIMEOUT_MS`, `acquireLock`, `releaseLock`

### scripts/autonomy_runtime.test.js — Section H: Lock tests (+140 lines, 8 tests)

| Test | Description |
|------|-------------|
| H1 | Lock acquired and released on successful pick |
| H2 | Lock cleanup on null return (all quarantined) |
| H3 | Stale lock (10s old timestamp) auto-recovered |
| H4 | Corrupt lock (invalid JSON) auto-recovered |
| H5 | 100-iteration rotation never leaks quarantined agent |
| H6 | 50-iteration rapid add/remove maintains JSON integrity |
| H7 | 5 child processes x 20 picks concurrent — never selects quarantined |
| H8 | Lock constants exported correctly |

---

## Regression Results

| Test Suite | Count | Result |
|-----------|-------|--------|
| Autonomy Runtime (A-H) | 58 | PASS |
| Wiring Contract | 23 | PASS |
| Coverage Report | 8 | PASS |
| Verification Gate (tests) | 12 | PASS |
| Two-Stage PR Review (tests) | 12 | PASS |
| Evidence Graph | 73 | PASS |
| Fix Pack | 45 | PASS |
| **Total** | **231** | **0 fail** |

### Gate-Specific Checks

| Gate | Local Result |
|------|-------------|
| scan-secrets | 0 matches in diff files |
| lint-markdown | 0 errors |
| verification-gate (CI runner) | 3/3 PASS |

---

## Behavioral Equivalence Statement

The repo implementation is **logically identical** to the production hotpatch:

1. Same O_EXCL lock mechanism with identical timeout (5000ms) and retry interval (10ms)
2. Same stale lock recovery (>5s) and corrupt lock recovery paths
3. Same fail-closed semantics on lock timeout (return null + event with `reason: 'lock_timeout'`)
4. Same lock release in all three exit paths (success, all-quarantined, exception)
5. Only difference: consistent 4-space indentation in repo vs mixed indentation in prod (whitespace-only)

---

## Rollback

```bash
git revert d0f4b4c560fe9f69f5ac6e80388d4e08a2105384
```

Or on VPS — restore from backups created during hotpatch deployment:
- Dashboard: `sudo cp /opt/openclaw-runtime/autonomy_runtime.js.backup-20260212T213202Z /opt/openclaw-runtime/autonomy_runtime.js`
- Builder: `sudo cp /opt/openclaw-runtime/autonomy_runtime.js.backup-20260212T213202Z /opt/openclaw-runtime/autonomy_runtime.js`

---

## What Was NOT Changed

- No detection thresholds weakened
- No CI workflow files modified
- No supply chain dependencies added
- No gates bypassed or disabled
- No existing test assertions modified
- Kill switch behavior unchanged
- Spend tracking unchanged
- Event emission format unchanged (except new `reason` field on timeout path only)

---

## Status: READY_FOR_REVIEW
