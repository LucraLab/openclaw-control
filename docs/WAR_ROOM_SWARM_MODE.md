# War Room Swarm Mode (B)

**Status:** Implemented (code + tests + CI gate)
**Objective:** obj-20
**Port:** N/A (new feature, not a port of existing functionality)

---

## Overview

War Room Swarm Mode enables James to invoke the full specialist agent team via `@team` or `/team` in Telegram group chats. The Dashboard bot (Dude/Skippy) orchestrates the swarm: it dispatches the prompt to selected Builder agents via HTTP, collects responses, and posts a consolidated reply thread.

**Key design choice:** Dashboard-only orchestration. Builder bots never independently respond to `@team`. This ensures single-point cap enforcement, kill switch checking, and quarantine filtering.

## Trigger Phrases (Group Chat Only)

| Trigger | Example | Effect |
|---------|---------|--------|
| `@team <prompt>` | `@team review the deployment plan` | Dispatch to best 5 agents |
| `/team <prompt>` | `/team what's the status?` | Same as @team |
| `@team @developer @architect <prompt>` | `@team @developer @architect fix the CI` | Force-include specified agents |
| `/expand_squad` | `/expand_squad 15` | Raise cap to 10 for 15 min |
| Reply + `@team` | Reply to swarm result with `@team` | Re-run swarm on that thread |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Dashboard VPS                                          │
│                                                         │
│  ┌──────────────┐    ┌──────────────────────────────┐  │
│  │ OpenClaw GW   │    │ Swarm Orchestrator (sidecar)  │  │
│  │ (Dude bot)    │◄──►│ war_room_swarm.js             │  │
│  │ port 18789    │    │                                │  │
│  └──────────────┘    └──────────┬───────────────────┘  │
│                                  │ HTTP POST             │
│                                  ▼                       │
│                    ┌─────────────────────────┐          │
│                    │ Port #16 Runtime         │          │
│                    │ /opt/openclaw-runtime/   │          │
│                    │ killswitch + quarantine  │          │
│                    │ events + artifacts       │          │
│                    └─────────────────────────┘          │
└──────────────────────────┬──────────────────────────────┘
                           │ Tailscale
              ┌────────────┴────────────┐
              ▼                         ▼
┌──────────────────┐     ┌──────────────────┐
│ Builder1 (8080)   │     │ Builder2 (8082)   │
│ 16 agents         │     │ 8 agents          │
│ localhost-bound    │     │ Tailscale-bound   │
└──────────────────┘     └──────────────────┘
```

## Agent Roster

Default roster (16 agents across both Builders):

| Agent | Builder | Default Selection Priority |
|-------|---------|--------------------------|
| pa | Builder2 | 1 |
| developer | Builder1 | 2 |
| architect | Builder1 | 3 |
| debugger | Builder1 | 4 |
| ops-1 | Builder1 | 5 |
| ops-2 | Builder2 | 6 |
| finance | Builder1 | 7 |
| cs | Builder2 | 8 |
| sales | Builder2 | 9 |
| insights | Builder2 | 10 |
| technical-writer | Builder1 | 11 |
| vault | Builder1 | 12 |
| crystal-pa | Builder2 | 13 |
| quality-reviewer | Builder1 | 14 |
| scrooge | Builder1 | 15 |
| rental | Builder2 | 16 |

## Safety Rules (Fail-Closed)

| Check | Behavior When Triggered |
|-------|------------------------|
| Runtime dir missing/unreadable | Swarm blocked, emit `SWARM_FAILCLOSED` |
| Kill switch active | Swarm blocked, emit `SWARM_KILLSWITCH_BLOCKED` |
| Kill switch check throws | Swarm blocked (fail-closed) |
| All agents quarantined | Swarm blocked, emit `SWARM_FAILCLOSED` |
| No reachable Builder targets | Swarm blocked, emit `SWARM_FAILCLOSED` |
| Cap parse fails | Default to cap=5 |
| Individual agent fails | Continue with others; note failure in output |

## HTTP Dispatch Method

Agent targeting uses the `x-openclaw-agent-id` header (highest priority) with `model: "openclaw:<agent>"` as backup:

```
POST /v1/chat/completions
Authorization: Bearer <gateway_token>
x-openclaw-agent-id: developer
Content-Type: application/json

{
  "model": "openclaw:developer",
  "messages": [{"role": "user", "content": "..."}],
  "max_tokens": 1000
}
```

## Event Types

| Event | When |
|-------|------|
| `SWARM_REQUESTED` | @team trigger detected |
| `SWARM_DISPATCHED` | Agents selected, HTTP calls starting |
| `SWARM_AGENT_RESULT` | Per-agent response (includes latency_ms, status) |
| `SWARM_CAPPED` | Cap applied (requested > cap) |
| `SWARM_KILLSWITCH_BLOCKED` | Kill switch prevented swarm |
| `SWARM_QUARANTINE_SKIPS` | Agents skipped due to quarantine |
| `SWARM_FAILCLOSED` | Swarm blocked for safety |

## Canonical Artifacts

Type: `swarm-run`

Written to `$OPENCLAW_RUNTIME_DIR/artifacts/swarm-run-<timestamp>.{json,md}`

Contains: correlation_id, chat/message/sender IDs, prompt (sanitized), agent results, cap info, quarantine info.

## Output Format

```
Swarm (5 agents): review the deployment plan
(CAPPED: requested 16, ran 5)

pa: The deployment plan looks solid. Key observations...

developer: Code changes are well-structured. Consider...

architect: Architecture-wise, the service boundaries are...

[FAILED] debugger: Error: ECONNREFUSED

ops-1: Infrastructure is ready. DNS propagation...
```

## Deployment (Dashboard VPS Only)

### Prerequisites

1. Builder1 must be reachable (change bind to Tailscale IP or use SSH tunnel)
2. Builder1 agent workspace permissions must be fixed
3. Auth tokens for both Builder gateways required

### Deployment Steps

```bash
# 1. Copy swarm module to runtime location
scp scripts/war_room_swarm.js root@srv853172.hstgr.cloud:/opt/openclaw-runtime/

# 2. Set environment variables
# BUILDER1_AUTH_TOKEN=<token>
# BUILDER2_AUTH_TOKEN=<token>

# 3. Integration with Dashboard bot (TBD — requires hook or sidecar setup)
```

### Rollback

```bash
# Remove swarm module
rm /opt/openclaw-runtime/war_room_swarm.js
# No gateway changes to revert — swarm is a sidecar
```

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `OPENCLAW_RUNTIME_DIR` | `.openclaw_runtime` | Runtime state directory |
| `BUILDER1_AUTH_TOKEN` | (none) | Builder1 gateway auth token |
| `BUILDER2_AUTH_TOKEN` | (none) | Builder2 gateway auth token |

## Tests

68 tests covering:
- Mention parsing (entities + regex)
- Roster selection + cap enforcement
- Quarantine filtering
- Kill switch guard behaviors
- Dispatch request shaping (headers/models)
- Concurrency limiter
- Timeout handling
- Output sanitization + artifacts
- Event emission payload shape
- Fail-closed paths (runtime missing, corrupt config, invalid agent ID)

Run: `node scripts/war_room_swarm.test.js`

CI gate: `.github/workflows/gate-war-room-swarm.yml`
