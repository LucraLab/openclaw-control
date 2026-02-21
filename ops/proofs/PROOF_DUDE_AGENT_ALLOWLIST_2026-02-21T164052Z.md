# Proof: Dude Agent Allowlist (Fail-Closed)

**Date:** 2026-02-21T16:40:52Z
**Scope:** Dashboard-side agent validation — defense-in-depth before SSH dispatch

---

## Summary

Added a fail-closed agent allowlist to the Dude dispatch layer on Dashboard VPS.
Invalid agent IDs are now **REFUSED at the Dashboard** before any SSH connection to Builders.

---

## What Changed

### 1. New File: `/root/bin/agent-allowlist.json`

Explicit per-builder agent allowlist. Source of truth derived from `openclaw.json` on each Builder.

```json
{
  "builder1": {
    "agents": ["main", "vault", "finance", "scrooge", "ops-1", "architect",
               "developer", "debugger", "quality-reviewer", "technical-writer",
               "crystal-pa", "cs", "insights", "pa", "rental", "sales"]
  },
  "builder2": {
    "agents": ["main", "pa", "sales", "cs", "rental", "insights", "crystal-pa", "ops-2"]
  },
  "defaults": { "fallback_agent": "main", "refuse_unknown": true }
}
```

### 2. New File: `/root/bin/agent-allowlist-check.py`

Fail-closed Python validator. Exit codes:
- `0` — agent ALLOWED
- `1` — agent REFUSED (not in allowlist)
- `2` — config error (file missing, parse error) — fail-closed

Output includes `AGENT_ROUTE_REFUSED` marker for grep/parsing.

### 3. Patched: `/root/bin/dispatch-to-builder.sh`

Inserted `AGENT_ALLOWLIST_GUARD` block (lines 380-417) that runs BEFORE:
- `agent-task` (routes to current target builder)
- `agent-task-b1` (routes to builder1)
- `agent-task-web` (routes to current target builder)

Non-agent commands (`hello`, `status`, etc.) pass through unaffected.

---

## Test Results

| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Valid agent on builder2 (`sales`) | ALLOWED exit 0 | PASS |
| 2 | Invalid agent on builder2 (`definitely-not-real`) | REFUSED exit 1 | PASS |
| 3 | Valid agent on builder1 (`developer`) | ALLOWED exit 0 | PASS |
| 4 | Invalid agent on builder1 (`bogus-agent`) | REFUSED exit 1 | PASS |
| 5 | Unknown builder name (`builder99`) | REFUSED exit 1 | PASS |
| 6 | Non-agent command (`hello`) | Passes through | PASS |
| 7 | Integration: dispatch with invalid agent | REFUSED, no SSH attempted | PASS |
| 8 | Integration: dispatch with valid agent | ALLOWED, SSH dispatched | PASS |

### Test Evidence

**Invalid agent (fail-closed):**
```
$ python3 /root/bin/agent-allowlist-check.py builder2 definitely-not-real
AGENT_ROUTE_REFUSED: agent 'definitely-not-real' not in allowlist for builder2
Allowed agents: main, pa, sales, cs, rental, insights, crystal-pa, ops-2
Exit: 1
```

**Valid agent:**
```
$ python3 /root/bin/agent-allowlist-check.py builder1 developer
AGENT_ALLOWED: developer on builder1
Exit: 0
```

**Integration — invalid agent blocked before SSH:**
```
$ OPENCLAW_VIA_JOBMGR=1 /root/bin/dispatch-to-builder.sh agent-task definitely-not-real 'test'
AGENT_ROUTE_REFUSED: agent 'definitely-not-real' not in allowlist for builder2
Allowed agents: main, pa, sales, cs, rental, insights, crystal-pa, ops-2
Exit: 1
(No SSH connection attempted — blocked at Dashboard)
```

---

## Defense-in-Depth Architecture

```
Dude (Dashboard VPS)
  │
  ├── agent-allowlist.json ← NEW: explicit per-builder allowlist
  ├── agent-allowlist-check.py ← NEW: fail-closed validator
  ├── dispatch-to-builder.sh ← PATCHED: AGENT_ALLOWLIST_GUARD
  │     │
  │     ├── agent-task → allowlist check → SSH → oc-dispatch → agent validation → agent
  │     ├── agent-task-b1 → allowlist check → SSH → oc-dispatch → agent validation → agent
  │     └── agent-task-web → allowlist check → capability gate → SSH → dispatch
  │
  └── Non-agent commands (hello, status) → pass through → SSH → oc-dispatch
```

Two-layer validation:
1. **Dashboard (new):** Refuses unknown agents before SSH — saves a round trip
2. **Builder (existing):** `oc-dispatch.sh` validates against `openclaw.json` — final authority

---

## Backup

```
/root/bin/dispatch-to-builder.sh.backup-pre-allowlist-20260221T163019Z
```

---

## How to Update the Allowlist

When agents are added/removed on a Builder:
1. Update the corresponding section in `/root/bin/agent-allowlist.json`
2. Run smoke suite to verify: `bash /home/openclaw/staging/current/ops/scripts/routing_smoke_suite.sh`
