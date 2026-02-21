# Dude Agent Allowlist

Fail-closed agent routing guard for Dashboard → Builder dispatch.

## Files

| File | Purpose |
|------|---------|
| `agent-allowlist.json` | Per-builder agent allowlist (source of truth) |
| `agent-allowlist-check.py` | Fail-closed Python validator (exit 0/1/2) |
| `install_dude_allowlist.sh` | Atomic install to `/root/bin/` |
| `selftest_allowlist.sh` | Deterministic self-test (no network) |

## Install

```bash
# From repo root on Dashboard VPS:
sudo bash ops/dude/install_dude_allowlist.sh
```

This copies `agent-allowlist.json` and `agent-allowlist-check.py` to `/root/bin/` atomically.

## How it works

1. `dispatch-to-builder.sh` intercepts `agent-task`, `agent-task-b1`, and `agent-task-web` commands
2. Calls `agent-allowlist-check.py` with the target builder and agent ID
3. If agent is not in the allowlist → `AGENT_ROUTE_REFUSED`, exit 1 (no SSH attempted)
4. If allowlist file is missing/corrupt → fail-closed, exit 2

## Updating the allowlist

When agents are added/removed on a Builder:

1. Edit `ops/dude/agent-allowlist.json` in this repo
2. Run self-test: `bash ops/dude/selftest_allowlist.sh`
3. Install: `sudo bash ops/dude/install_dude_allowlist.sh`
4. Run smoke suite: `bash ops/scripts/routing_smoke_suite.sh`

## Validator resolution order

The validator checks for the allowlist file in this order:
1. `AGENT_ALLOWLIST_FILE` env var (explicit override)
2. `/root/bin/agent-allowlist.json` (runtime install path)
3. Same directory as the script (repo-relative, for dev/testing)
4. If none found → fail-closed (exit 2)
