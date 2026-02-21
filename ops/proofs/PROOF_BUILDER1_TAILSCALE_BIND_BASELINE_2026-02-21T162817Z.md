# Proof: Builder1 Tailscale Bind — Baseline

**Date:** 2026-02-21T16:28:17Z
**Scope:** Read-only baseline capture — no changes made
**Investigator:** Claude Code (Dashboard VPS)

---

## Summary

Builder1 gateway is **already bound to Tailscale IP** (`100.75.216.57:8080`) as of this investigation.
No configuration changes are needed for Phase 1.

This was changed between 2026-02-13 (previous investigation showed localhost-only) and now.
The systemd unit uses `--bind tailnet` which auto-resolves to the Tailscale interface.

---

## Evidence

### 1. Gateway Listening Ports (ss -tlnp)

```
LISTEN 0  511  100.75.216.57:8080  0.0.0.0:*  users:(("openclaw-gatewa",pid=628085,fd=22))  ← Builder1
LISTEN 0  511  100.75.216.57:8082  0.0.0.0:*  users:(("openclaw-gatewa",pid=397933,fd=22))  ← Builder2
LISTEN 0  511      127.0.0.1:8083  0.0.0.0:*  users:(("openclaw-gatewa",pid=628085,fd=26))  ← Builder1 internal
LISTEN 0  511      127.0.0.1:8085  0.0.0.0:*  users:(("openclaw-gatewa",pid=397933,fd=26))  ← Builder2 internal
```

**Key:** Builder1 (pid 628085) on port 8080 bound to `100.75.216.57` (Tailscale), NOT `127.0.0.1` or `0.0.0.0`.

### 2. Tailscale Interface

```
$ tailscale ip -4
100.75.216.57

$ ip addr show tailscale0
    inet 100.75.216.57/32 scope global tailscale0
```

### 3. Tailscale Peer Table

```
100.75.216.57  openclaw-builder-new  james@  linux    -
100.83.32.96   openclaw-builder      james@  linux    active; direct
100.88.246.40  jamesrazer            james@  windows  -
100.80.230.50  iphone-14-pro         james@  iOS      -
```

### 4. Public IP (NOT bound)

```
$ ip addr show eth0
    inet 187.77.6.191/24 brd 187.77.6.255 scope global eth0
```

Port 8080 is NOT bound to `187.77.6.191`. Curl to public IP returns connection refused:
```
$ curl --connect-timeout 3 http://187.77.6.191:8080/v1/chat/completions
→ exit code 7 (connection refused)
```

### 5. Systemd Unit (Builder1)

```
# /home/openclaw/.config/systemd/user/openclaw-gateway.service
ExecStart=/usr/bin/node /home/openclaw/.openclaw/lib/node_modules/openclaw/dist/entry.js gateway --port 8080 --bind tailnet
```

The `--bind tailnet` flag auto-resolves to the Tailscale interface IP.

### 6. Connectivity from Dashboard VPS

```
$ curl -s -w '%{http_code}' -X POST http://100.75.216.57:8080/v1/chat/completions \
  -H "Authorization: Bearer [REDACTED]" \
  -H "Content-Type: application/json" \
  -d '{"model":"openclaw/developer","messages":[...],"max_tokens":10}'

→ 500 (billing/rate-limit on LLM providers — gateway itself accepted and processed request)
```

Gateway is reachable from Dashboard over Tailscale. The 500 is an LLM provider billing issue, not a connectivity failure.

### 7. Auth Config

Both Builders use gateway token auth:
```json
"gateway": {
  "mode": "local",
  "auth": { "mode": "token", "token": "[REDACTED-64-char-hex]" }
}
```

Builder1 token: `2b7526...` (first 6 chars shown)
Builder2 token: `d0ef20...` (first 6 chars shown)

---

## Agent Inventory

### Builder1 (openclaw) — 16 agents

| ID | Name | Emoji |
|----|------|-------|
| main | Builder | - |
| vault | Vault | - |
| finance | Finance | - |
| scrooge | Scrooge | - |
| ops-1 | Ops-1 | - |
| architect | Architect | - |
| developer | Developer | - |
| debugger | Debugger | - |
| quality-reviewer | Quality-Reviewer | - |
| technical-writer | Technical-Writer | - |
| crystal-pa | Crystal-PA | - |
| cs | CS | - |
| insights | Insights | - |
| pa | PA | - |
| rental | Rental | - |
| sales | Sales | - |

### Builder2 (openclaw2) — 8 agents

| ID | Name | Emoji |
|----|------|-------|
| main | (default) | - |
| pa | PA | - |
| sales | Sales | - |
| cs | CS | - |
| rental | Rental | - |
| insights | Insights | - |
| crystal-pa | Crystal-PA | - |
| ops-2 | Ops-2 | - |

---

## Current Dispatch Architecture (no allowlist)

```
Dude → dispatch-to-builder.sh → SSH → oc-dispatch.sh → agent validation → agent
```

Agent validation exists ONLY on the Builder side (oc-dispatch.sh lines 419-430).
Dashboard side (dispatch-to-builder.sh) passes agent IDs through WITHOUT validation.
HTTP API path (agent-task-web via capability gate) also has no agent allowlist.

**Gap:** If Dude calls `dispatch-to-builder.sh agent-task bogus-agent "msg"`, it will SSH to Builder, which will reject — but wastes a round trip and SSH connection. Defense-in-depth requires a Dashboard-side allowlist.

---

## Conclusion

- Phase 1 (Tailscale bind) is ALREADY COMPLETE — no changes needed
- Phase 2 (Dude allowlist) is the real deliverable
- No public exposure confirmed
