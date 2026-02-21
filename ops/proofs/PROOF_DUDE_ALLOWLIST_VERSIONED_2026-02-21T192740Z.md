# Proof: Dude Allowlist Versioned into Git

**Date:** 2026-02-21T192740Z
**Branch:** ops/builder1-tailscale-bind-dude-allowlist-smoke
**HEAD:** 11a8a63

---

## Summary

The Dude agent allowlist has been moved from a manually-managed file on the Dashboard VPS
(`/root/bin/agent-allowlist.json`) into the openclaw-control git repo at `ops/dude/`.
This eliminates configuration drift and provides deterministic install/test workflows.

## Files Added (`ops/dude/`)

| File | Purpose |
|------|---------|
| `agent-allowlist.json` | Per-builder agent allowlist (source of truth) |
| `agent-allowlist-check.py` | Fail-closed Python validator (exit 0/1/2) |
| `install_dude_allowlist.sh` | Atomic install to `/root/bin/` |
| `selftest_allowlist.sh` | Deterministic self-test (13 tests, no network) |
| `README.md` | Documentation |

## Validator Resolution Chain

The validator resolves the allowlist file in this order:
1. `AGENT_ALLOWLIST_FILE` env var (exclusive — no fallback when set)
2. `/root/bin/agent-allowlist.json` (runtime install path)
3. Same directory as script (repo-relative, for dev/testing)
4. None found → fail-closed (exit 2, AGENT_ROUTE_REFUSED)

## Dispatch Guard

`/root/bin/dispatch-to-builder.sh` has a fail-closed guard (lines 380-426) that:
1. Intercepts `agent-task`, `agent-task-b1`, `agent-task-web` commands
2. Calls `agent-allowlist-check.py` with target builder + agent ID
3. If refused → `AGENT_ROUTE_REFUSED`, exit 1 (no SSH attempted)
4. If validator missing → fail-closed, exit 2

Guard resolution chain:
- Prefer `/root/bin/agent-allowlist-check.py` (installed copy)
- Fallback `/home/openclaw/staging/current/ops/dude/agent-allowlist-check.py` (repo)
- Neither found → refuse (fail-closed)

## Self-Test Results (13/13 PASS)

```
--- Builder1 ---
  [PASS] builder1/main ALLOWED (exit=0)
  [PASS] builder1/developer ALLOWED (exit=0)
  [PASS] builder1/architect ALLOWED (exit=0)
  [PASS] builder1/bogus REFUSED (exit=1)
  [PASS] builder1/empty REFUSED (exit=1)

--- Builder2 ---
  [PASS] builder2/main ALLOWED (exit=0)
  [PASS] builder2/sales ALLOWED (exit=0)
  [PASS] builder2/ops-2 ALLOWED (exit=0)
  [PASS] builder2/bogus REFUSED (exit=1)
  [PASS] builder2/developer REFUSED (exit=1)

--- Error cases ---
  [PASS] unknown builder REFUSED (exit=1)
  [PASS] bad usage (missing args) (exit=2)

--- Config error (missing file) ---
  [PASS] missing allowlist file (exit=2)

SELFTEST_RESULT: ALL_PASS
```

## Install Verification

```
=== Installing Dude Allowlist ===
Source: /home/openclaw/staging/current/ops/dude
Target: /root/bin
Installed:
  /root/bin/agent-allowlist-check.py (755)
  /root/bin/agent-allowlist.json (644)
Verification: OK (builder1/main allowed)
=== Install Complete ===
```

## Agents in Allowlist

| Builder | Agents |
|---------|--------|
| builder1 | main, vault, finance, scrooge, ops-1, architect, developer, debugger, quality-reviewer, technical-writer, crystal-pa, cs, insights, pa, rental, sales (16) |
| builder2 | main, pa, sales, cs, rental, insights, crystal-pa, ops-2 (8) |

## Defense-in-Depth

1. **Dashboard-side (Dude):** Agent allowlist refuses unknown agents BEFORE SSH dispatch
2. **Builder-side:** Gateway validates agent exists in local `openclaw.json` config
3. **Git-versioned:** Allowlist is now source-controlled, auditable, and installable
