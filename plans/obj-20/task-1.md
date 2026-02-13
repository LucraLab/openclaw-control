# Task 1: War Room Swarm Mode (B) Implementation

**Objective:** obj-20 — War Room Swarm Mode
**Status:** Complete
**Risk:** Low (additive only, no existing code modified)

## Scope

War Room Swarm orchestrator + Multiagent Wiring Stress Runner v2. Additive only — no existing files modified.

## Summary

Implement a sidecar swarm orchestrator that runs on the Dashboard VPS alongside the OpenClaw gateway. When James triggers `@team` or `/team` in a Telegram group, the orchestrator dispatches to Builder agents via HTTP and posts a consolidated response.

## Files Created

| File | Purpose |
|------|---------|
| `scripts/war_room_swarm.js` | Core orchestrator module |
| `scripts/war_room_swarm.test.js` | 68 tests (no network) |
| `.github/workflows/gate-war-room-swarm.yml` | CI gate |
| `docs/WAR_ROOM_SWARM_MODE.md` | Documentation |
| `plans/obj-20/task-1.md` | This plan |
| `ops/proofs/PROOF_PACK_WAR_ROOM_SWARM_MODE_B_*.md` | Proof pack |

## Files Modified

None. This is a purely additive change.

## Mental Regression Impact Analysis

### Touched Subsystems

1. **Telegram message parsing** — NEW code only. Does not modify OpenClaw's compiled gateway bundle. Parses `@team` / `/team` from message text and entities.

2. **HTTP dispatch to Builder gateways** — NEW code only. Uses standard HTTP POST to `/v1/chat/completions` endpoint that Builder gateways already expose. No changes to Builder config.

3. **Port #16 autonomy runtime** — READS ONLY. Calls `killSwitchGuard()`, `quarantineList()`, `emitEvent()`, `writeCanonicalArtifact()`. Does not modify runtime code.

4. **CI pipeline** — ADDITIVE. New required check `war-room-swarm`. Does not modify existing gates.

### Invariants Preserved

- OpenClaw gateway binary is NOT modified
- Kill switch remains fail-closed (blocks swarm if active or unreadable)
- Quarantine list is read-only (no agents added/removed by swarm code)
- Existing Telegram bot behavior unchanged (Dude still responds normally to DMs)
- No new network listeners (sidecar uses existing gateway ports)
- All secrets redacted before output or artifact storage
- No LiteLLM dependency

## Verification

- 59 offline tests pass (v2 wiring stress)
- 56 offline tests pass (v1 stress pack)
- All CI gate checks pass (8 per workflow)
- No network imports, no LLM SDK imports, no secrets in source
- Safety patterns present: killswitch, quarantine, sanitize, shouldTriggerLLM, writeCanonicalArtifact

## Rollback

1. Revert the PR (single commit revert)
2. Remove CI check from branch protection if needed
3. If deployed to VPS: `rm /opt/openclaw-runtime/war_room_swarm.js`
4. No gateway restarts needed
