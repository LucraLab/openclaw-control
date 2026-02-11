# Bootstrap Specification — Agent Onboarding Contract

## Version 1.0.0 | 2026-02-11

This document defines how agents are "born fully formed" on the OpenClaw platform. Every agent must complete this bootstrap sequence before it can operate.

## Bundle Source

Bundles are compiled from the `openclaw-control` governance repo and published as GitHub Release assets on version tags.

### Tag Format

- `registry@YYYY.MM.DD.N` — Registry version tags
- `bootstrap@YYYY.MM.DD.N` — Bootstrap version tags

### Bundle Asset Pattern

Assets are attached to the GitHub Release for each tag:

```
https://github.com/LucraLab/openclaw-control/releases/tag/<BUNDLE_TAG>
```

Download individual assets via the GitHub API or CLI:

```bash
gh release download <BUNDLE_TAG> --repo LucraLab/openclaw-control --dir ./bundles
```

### Bundle Contents

| File | Purpose |
|------|---------|
| `role_registry.json` | Compiled roles, tools, limits, agent assignments |
| `tools_catalog.json` | All tools with role mappings |
| `policy_bundle.json` | Forbidden capability combos, gating rules |
| `context_bundle.json` | Boot contract, glossary, platform metadata |
| `SHA256SUMS.txt` | Integrity checksums for verification |

## Required Boot Sequence

An agent MUST complete ALL of these steps in order. Failure at any step means the agent does NOT start (fail-closed).

### Step 1 — Download Bundles

```
Input: BUNDLE_TAG (e.g., registry@2026.02.11.2)
Action: Download all 5 bundle files from GitHub Release
Output: Local copies in /workspace/bundles/
```

### Step 2 — Verify Integrity

```
Action: Run sha256sum -c SHA256SUMS.txt
Pass: All checksums match
Fail: Exit non-zero, emit BOOTSTRAP_FAILED event
```

### Step 3 — Load Role Policy

```
Action: Parse role_registry.json
Confirm: AGENT_ROLE exists in roles object
Fail: Exit non-zero (role not found = misconfigured agent)
```

### Step 4 — Validate Capabilities

```
Action: Parse policy_bundle.json
Confirm: Agent's requested capabilities are allowed for its role
Confirm: No forbidden combinations violated
Fail: Exit non-zero, emit CAPABILITY_DENIED event
```

### Step 5 — Load Tools

```
Action: Parse tools_catalog.json
Filter: Only tools allowed for AGENT_ROLE
Output: Available tool set for this session
```

### Step 6 — Register in Ledger

```
Action: POST to ledger /agents endpoint
Body: { agent_name, role, gateway, capabilities, run_id }
Pass: 2xx response with agent_id
Fail: Retry once, then exit non-zero
```

### Step 7 — Subscribe to Events

```
Action: Subscribe to events defined in role's event_subscriptions
Pass: Subscription confirmed
Fail: Log warning (non-fatal, agent can still operate)
```

### Step 8 — Emit READY

```
Action: POST to event bus
Event: { type: "AGENT_READY", agent_name, role, bundle_tag, timestamp }
This signals to the platform that the agent is operational.
```

### Step 9 — Start Main Process

```
Action: Hand off to the agent's main application logic
The agent is now "born fully formed" with its role, tools, and context.
```

## Environment Variables

The orchestrator provides these to each agent container:

| Variable | Example | Required |
|----------|---------|----------|
| `AGENT_NAME` | `builder1_main` | Yes |
| `AGENT_ROLE` | `fullstack_builder` | Yes |
| `BUNDLE_TAG` | `registry@2026.02.11.2` | Yes |
| `WORKSPACE` | `/workspace` | Yes |
| `LEDGER_URL` | `http://ledger:9900` | Yes |
| `EVENT_BUS_URL` | `http://ledger:9900` | Yes |
| `RUN_ID` | `run-20260211-001` | Yes |

## Workspace Layout

Each agent gets an isolated workspace:

```
/workspace/
  bundles/       # Downloaded bundle files
  repo/          # Code checkout (if applicable)
  artifacts/     # Build outputs
  logs/          # Agent logs
  tmp/           # Temporary files
```

On the host, this maps to:

```
/home/openclaw/workspaces/<agent_name>/
  bundles/
  repo/
  artifacts/
  logs/
  tmp/
```

## Fail-Closed Guarantee

If ANY boot step fails, the agent MUST:
1. NOT start its main process
2. Exit with a non-zero code
3. Best-effort: emit a `BOOTSTRAP_FAILED` or `CAPABILITY_DENIED` event
4. Best-effort: log the failure reason (no secrets)

The orchestrator treats a non-zero exit as "agent not ready" and does not route work to it.
