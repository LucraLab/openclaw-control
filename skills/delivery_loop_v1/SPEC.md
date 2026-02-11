# delivery_loop_v1 — Specification

## Overview

A fail-closed, deterministic delivery loop that ships a change end-to-end:

**objective** → **tasks** → **branch/commits** → **PR** → **CI** → **QA gate** → **merge** → **staging smoke** → **objective complete** → **proof pack + retro**

## Version

- **Skill version:** 1.0.0
- **Target repo:** `LucraLab/openclaw-control` (ONLY — hard-coded allowlist)
- **Deployment scope:** Staging only. No production deploys.

## Contract

### Inputs

| Input | Source | Required |
|-------|--------|----------|
| Objective ID | Delivery OS store or CLI | Yes |
| Objective type | Template catalog | Yes |
| Target repo | Allowlist (v1: single repo) | Yes |
| Risk tier | `low` / `medium` / `high` | Yes |
| Task definitions | Generated from objective templates | Yes |

### Outputs

| Output | Destination | Format |
|--------|-------------|--------|
| Objective record | `$DELIVERY_OS_HOME/objectives/<id>.json` | JSON |
| Task records | `$DELIVERY_OS_HOME/objectives/<id>-tasks.json` | JSON array |
| PR | GitHub (target repo) | GitHub PR |
| Staging smoke result | Event log | JSONL event |
| Proof pack | Proof directory | Markdown |

### State Machine

```text
OBJECTIVE:  NEW → PLANNED → IN_PROGRESS → STAGING → COMPLETE | FAILED
TASK:       ASSIGNED → IN_PROGRESS → BLOCKED → IN_PROGRESS → DONE
PR:         DRAFT → OPEN → CHECKS_PASSING → APPROVED → MERGED
```

### Step-by-Step Contract

1. **Objective Intake** — Create objective record with type, repo, risk, title
2. **Task Generation** — Autopilot generates tasks from template (existing system)
3. **Branch Creation** — Create `obj-<id>/task-<key>-<slug>` branch
4. **Change Application** — Apply deterministic patch (docs, templates, scripts only in v1)
5. **Local Checks** — Run linting, schema validation, tests
6. **PR Creation** — Open PR via `gh` CLI with template body
7. **CI Gate Wait** — Poll until `scan-secrets`, `scan-public-safe`, `qa-gate` pass
8. **QA Label** — `qa-approved` label applied by authorized user/role
9. **CODEOWNERS Review** — At least 1 approving review from CODEOWNERS
10. **Merge** — PR merged to `main`
11. **Staging Smoke** — Run `npm test` + `markdownlint` + schema validation
12. **Objective Close** — Mark objective COMPLETE, emit events
13. **Proof Pack** — Generate proof pack with evidence

### Fail-Closed Rules

| Condition | Action |
|-----------|--------|
| Repo not in allowlist | REFUSE — exit 1 with message |
| `gh` auth missing | REFUSE — exit 1 with message |
| Risk=high, approvals missing | REFUSE — do not merge |
| Required CI gates unknown | REFUSE — do not proceed |
| Staging smoke fails | BLOCK — do not close objective |
| Script not idempotent | REFUSE — check for existing state |
| Secrets detected in diff | ABORT — do not commit |

## Constraints

### v1 Scope Limits

- Single repo only: `LucraLab/openclaw-control`
- No production deploys
- No outbound communications
- Changes limited to: docs, templates, scripts, schemas
- No binary files
- No dependency additions (no package.json changes)
- No workflow modifications (`.github/workflows/` changes require manual approval)

### Security

- Never print secrets (KEY, TOKEN, SECRET, PASS, PASSWORD, AUTH, BEARER patterns redacted)
- All content must pass `scan-public-safe` gate (no IPs, hostnames, paths)
- All content must pass `scan-secrets` gate (no credential patterns)
- Branch protection enforced (enforce_admins = true)
- CODEOWNERS review required
- QA label required from authorized user

### Interfaces

| Interface | Protocol | Notes |
|-----------|----------|-------|
| GitHub API | `gh` CLI | Authenticated via `gh auth` |
| Delivery OS | Filesystem (JSON/JSONL) | `$DELIVERY_OS_HOME` |
| Event log | JSONL append | `$DELIVERY_OS_HOME/_logs/agent-events.jsonl` |
| CI gates | GitHub Actions | Triggered on PR events |

## Dependencies

- `gh` CLI (authenticated)
- `git` CLI
- `python3` (for JSON manipulation)
- `bash` 4+
- Delivery OS (objective-autopilot.sh, state-lib.sh)
- GitHub Actions runners (for CI gates)
