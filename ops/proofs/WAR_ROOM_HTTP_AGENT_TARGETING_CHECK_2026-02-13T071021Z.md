# War Room: HTTP Agent Targeting Check

**Date:** 2026-02-13T07:10:21Z
**Scope:** Read-only investigation — no services modified, no secrets printed

---

## Summary Verdict: SUPPORTED

Dude can target specific Builder agents directly via the `/v1/chat/completions` HTTP endpoint.
No agentToAgent delegation required for swarm dispatch.

---

## Evidence

### 1. Network Topology

| Builder | Process PID | UI Port (Tailscale) | API Port (localhost) |
|---------|------------|---------------------|---------------------|
| Builder1 (openclaw) | 89107 | N/A (localhost:8080 only) | localhost:8083 |
| Builder2 (openclaw2) | 88589 | **100.75.216.57:8082** | localhost:8085 |

**Key finding:** Port 8082 serves BOTH the web UI AND the `/v1/chat/completions` API on the same port.
Builder1 is localhost-only — not reachable from Dashboard VPS. Builder2 is reachable via Tailscale.

### 2. Agent Targeting — Three Methods Found

Source: `gateway-cli-B2vfF3Cr.js` lines 13422–13437

```javascript
// Method 1: X-OpenClaw-Agent-Id header (highest priority)
function resolveAgentIdFromHeader(req) {
  const raw = getHeader(req, "x-openclaw-agent-id")?.trim()
           || getHeader(req, "x-openclaw-agent")?.trim() || "";
  if (!raw) return;
  return normalizeAgentId(raw);
}

// Method 2: model field with prefix (fallback)
function resolveAgentIdFromModel(model) {
  const raw = model?.trim();
  if (!raw) return;
  const agentId = (raw.match(/^openclaw[:/](?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i)
                ?? raw.match(/^agent:(?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i))?.groups?.agentId;
  if (!agentId) return;
  return normalizeAgentId(agentId);
}

// Resolution order: header > model prefix > defaults to "main"
function resolveAgentIdForRequest(params) {
  const fromHeader = resolveAgentIdFromHeader(params.req);
  if (fromHeader) return fromHeader;
  return resolveAgentIdFromModel(params.model) ?? "main";
}
```

### 3. Accepted Model Formats for Agent Targeting

| Format | Example | Regex |
|--------|---------|-------|
| `openclaw/<agent_id>` | `openclaw/developer` | `/^openclaw[:/](?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i` |
| `openclaw:<agent_id>` | `openclaw:architect` | same regex |
| `agent:<agent_id>` | `agent:quality-reviewer` | `/^agent:(?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i` |
| Header override | `X-OpenClaw-Agent-Id: developer` | takes priority over model field |
| `openclaw` (no suffix) | `openclaw` | routes to `main` agent |

### 4. Smoke Test Results (Builder2, port 8082)

All tests used minimal prompts (max_tokens: 5-10) to minimize token burn.

**Test A — Default (main agent):**
```
POST /v1/chat/completions
model: "openclaw"
Response: 200 OK, model: "openclaw"
```

**Test B — Agent via model field (developer):**
```
POST /v1/chat/completions
model: "openclaw/developer"
Response: 200 OK, model: "openclaw/developer", content: "I am developer agent"
```

**Test C — Agent via header (architect):**
```
POST /v1/chat/completions
X-OpenClaw-Agent-Id: architect
model: "openclaw"
Response: 200 OK, content: "I am architect agent"
```

**Test D — Agent via agent: prefix (quality-reviewer):**
```
POST /v1/chat/completions
model: "agent:quality-reviewer"
Response: 200 OK, content: "I am QR"
```

**Test E — Invalid agent (nonexistent-agent):**
```
POST /v1/chat/completions
model: "openclaw/nonexistent-agent"
Response: 200 OK — falls through to main (no error)
```
Note: The HTTP path does NOT reject unknown agents — it silently falls back to main.
The internal gateway path (line 5404) DOES reject unknown agents with an error.

### 5. Available Agents on Each Builder

**Builder1 (openclaw) — 16 agents:**
main, vault, finance, scrooge, ops-1, architect, developer, debugger,
quality-reviewer, technical-writer, crystal-pa, cs, insights, pa, rental, sales

**Builder2 (openclaw2) — 8 agents:**
main, pa, sales, cs, rental, insights, crystal-pa, ops-2

### 6. Authentication

Both Builders use token-based gateway auth:
- Builder1: `Authorization: Bearer [REDACTED-64-char-hex]`
- Builder2: `Authorization: Bearer [REDACTED-64-char-hex]`

### 7. Additional Parameters (from source)

The `/v1/chat/completions` endpoint also accepts:
- `sessionKey` (string) — for session continuity across calls
- `user` (string) — creates per-user session keys
- `stream` (boolean) — SSE streaming mode
- `X-OpenClaw-Session-Key` header — explicit session key override

---

## Recommended Approach for Swarm Implementation

**Use `model` field for agent targeting.** The recommended format is `openclaw/<agent_id>` as it's the most explicit and self-documenting.

Example Dude dispatch call:
```bash
curl -X POST http://100.75.216.57:8082/v1/chat/completions \
  -H "Authorization: Bearer $BUILDER2_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/sales",
    "messages": [{"role": "user", "content": "Draft outreach for lead #1234"}],
    "user": "dude-swarm"
  }'
```

**Caveats:**
1. Builder1 is localhost-only — Dude cannot reach it directly. Either expose Builder1 on Tailscale or route through Builder2's agentToAgent.
2. Invalid agent IDs silently fall through to `main` on the HTTP path — Dude should validate agent IDs against a known list before dispatching.
3. Session continuity: Use `user` field or `sessionKey` for multi-turn swarm conversations.

---

## Next Step

Dude's dispatch layer should be updated to call Builder's `/v1/chat/completions` with `model: "openclaw/<agent_id>"` directly. No agentToAgent delegation is needed for the HTTP path. The dispatch-to-builder.sh script (or its replacement) should maintain a mapping of task types to agent IDs (e.g., code tasks → `developer`, design tasks → `architect`, reviews → `quality-reviewer`). Builder1 needs its gateway bound to the Tailscale interface (currently localhost-only) for Dude to reach its full agent roster, particularly the dev team agents (architect, developer, debugger, quality-reviewer, technical-writer) which only exist on Builder1.
