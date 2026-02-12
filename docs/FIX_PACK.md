# Safe Autopilot Fix Pack v1

## Overview

The Fix Pack turns evidence into an actionable remediation plan — without
executing anything. It answers:

- **What's wrong?** (diagnosis)
- **What should be done?** (proposed changes)
- **How to verify?** (commands + tests)
- **How to roll back?** (rollback steps)

**Advisory only** — never executes fixes, never writes patches, never modifies the repo.

**Deterministic** — same inputs produce identical output.

## Architecture

```
  ┌─────────────────────┐
  │  Evidence Graph      │
  │  (read-only input)   │
  └──────┬──────────────┘
         │
         ▼
  ┌─────────────────────┐     ┌──────────────────┐
  │  Fix Pack Builder   │◀────│  Context (flags)  │
  │  (rules-only)       │     │  killSwitch, etc. │
  └──────┬──────────────┘     └──────────────────┘
         │
         ▼
  ┌─────────────────────┐
  │  JSON + Markdown    │
  │  Artifacts          │
  └─────────────────────┘
```

## Artifacts

- `artifacts/fix-pack.json` — Machine-readable fix pack
- `artifacts/fix-pack.md` — Human-readable markdown

## JSON Schema

```json
{
  "version": "v1",
  "computed_at": "ISO-8601",
  "mode": "rules-only | hybrid",
  "selected": {
    "objective_id": "string",
    "reason_codes": ["string"]
  },
  "diagnosis": [
    {
      "code": "string",
      "severity": "low | med | high",
      "rule_code": "string",
      "evidence_refs": ["string"]
    }
  ],
  "proposed_changes": [
    {
      "change_id": "string",
      "intent": "string (max 256)",
      "target_files": ["string (max 10)"],
      "guardrails": ["string (max 8)"],
      "risk": "low | med | high"
    }
  ],
  "commands": [
    {
      "cmd": "string (max 256, allowlisted)",
      "why": "string (max 256)"
    }
  ],
  "tests_to_run": ["string (max 20)"],
  "stop_conditions": ["string (max 10)"],
  "rollback_steps": ["string (max 10)"],
  "summary": {
    "failclosed": false,
    "sanitized": true
  }
}
```

## Selection Logic

Picks ONE objective from the evidence graph:

1. **Kill switch** → select KILL_SWITCH objective, generate hold pack
2. **Quarantine** → select QUARANTINE objective, generate containment pack
3. **Default** → highest `risk_score`; tie-break by lowest `confidence`; tie-break by `objective_id`

Selection is deterministic.

## Diagnosis Codes

| Code | Severity | Trigger |
|------|----------|---------|
| FP-D-KILL_SWITCH | high | Kill switch active or STOP action |
| FP-D-QUARANTINE | high | Quarantine active or HOLD action |
| FP-D-HIGH_RISK | high | risk_score >= 90 |
| FP-D-ELEVATED_RISK | med | risk_score >= 70 |
| FP-D-LOW_CONFIDENCE | high | confidence < 0.4 |
| FP-D-FORCED_ZERO | high | Hint delta forced to zero |
| FP-D-DRIFT | varies | Drift signal detected |
| FP-D-BUDGET | varies | Budget signal detected |
| FP-D-OVERRIDE | med | Strategy override applied |
| FP-D-CLAMP | low | Value clamped to bounds |

## Command Allowlist

Allowed:
- `node scripts/<name>.test.js` — local test suites
- `node scripts/run_<name>_gate.js --ci` — local gates
- `git status`, `git diff`, `git log`, `git show` — read-only git
- `git revert --no-edit <sha>` — safe revert

Forbidden (always rejected):
- `curl`, `wget`, `ssh`, `scp` — network commands
- `npm publish`, `deploy` — release commands
- `rm -rf`, `rmdir`, `mkfs`, `dd`, `shutdown` — destructive ops
- Any URL (`http://`, `https://`)
- Pipe to bash, eval

## Bounds

| Limit | Value |
|-------|-------|
| max_reason_codes | 8 |
| max_diagnosis | 20 |
| max_evidence_refs | 10 per diagnosis |
| max_proposed_changes | 10 |
| max_target_files | 10 per change |
| max_guardrails | 8 per change |
| max_commands | 15 |
| max_tests_to_run | 20 |
| max_stop_conditions | 10 |
| max_rollback_steps | 10 |
| max_string_length | 256 chars |

## LLM Assist (OFF by default)

LLM can only run if ALL conditions met:
1. `config.llm_enabled === true`
2. `config.ci_mode !== true` (never in CI)
3. Trigger condition: confidence < 0.5 OR high severity + sparse evidence
4. Caller provides `config.llm_fn` function

Hard limits: 800 input tokens, 400 output tokens.

LLM may only refine: `intent`, `guardrails`, `stop_conditions`.
LLM must never change: commands, schema, selection, command allowlist.

Invalid LLM output → fallback to rules-only.

## Events

| Event | When |
|-------|------|
| FIXPACK_COMPUTED | Fix pack built successfully |
| FIXPACK_LLM_USED | LLM assist ran and was applied |
| FIXPACK_LLM_SKIPPED | LLM not used (disabled, CI, no trigger, error) |
| FIXPACK_FAILCLOSED | Fix pack generation failed, safe fallback returned |

## Fail-Closed Behavior

On any error (invalid graph, missing objectives, exception), the builder returns
a minimal safe pack with `summary.failclosed = true` and emits FIXPACK_FAILCLOSED.
The failclosed pack is schema-valid.

## Security

- All strings sanitized via SECRET_PATTERN (same as Evidence Graph)
- Commands strictly allowlisted (default deny)
- No shared mutable state
- No network calls, no LLM in CI, no shelling out
- Deterministic: caller controls `computed_at` via config

## CI Gate

The `fix-pack` CI gate runs:
1. `node scripts/fix_pack.test.js` — 45 tests
2. `node scripts/run_fix_pack_gate.js --ci` — 12 checks

## Rollback

```bash
git revert <merge_commit_sha>
# Remove fix-pack from branch protection required checks
```
