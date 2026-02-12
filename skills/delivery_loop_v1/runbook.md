# delivery_loop_v1 — Runbook

## Quick Reference

| Action | Command |
|--------|---------|
| Create objective | `bash scripts/objective_create.sh --type <type> --repo LucraLab/openclaw-control --title "..." --risk low` |
| Run delivery loop | `bash scripts/delivery_loop.sh --objective <id> --task <key> --repo LucraLab/openclaw-control` |
| Dry-run delivery | `bash scripts/delivery_loop.sh --objective <id> --task <key> --repo LucraLab/openclaw-control --dry-run` |
| Sync PR state | `bash scripts/task_pr_sync.sh --objective <id> --tasks-file <path>` |
| Run staging smoke | `bash scripts/staging_smoke.sh --repo-dir <path>` |
| Run tests | `bash skills/delivery_loop_v1/tests/test_delivery_loop.sh` |

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`)
- `git` configured with push access to `LucraLab/openclaw-control`
- `python3` available
- `DELIVERY_OS_HOME` environment variable set (defaults to `~/.openclaw`)

## Normal Operation

### Step 1 — Create Objective

```bash
bash scripts/objective_create.sh \
  --type feature_small_cli \
  --repo LucraLab/openclaw-control \
  --title "Add docs_only_change template" \
  --risk low
```

This writes an objective JSON file to `$DELIVERY_OS_HOME/objectives/`.

### Step 2 — Autopilot Plans Tasks

The existing `objective-autopilot.sh` (runs every 10 minutes) detects the NEW objective and generates tasks from the template.

### Step 3 — Execute Delivery Loop

For each task, run:

```bash
bash scripts/delivery_loop.sh \
  --objective <objective-id> \
  --task implement \
  --repo LucraLab/openclaw-control
```

This creates a branch, applies changes, runs local checks, and opens a PR.

### Step 4 — Wait for CI + QA

Monitor PR status:

```bash
bash scripts/task_pr_sync.sh \
  --objective <objective-id> \
  --tasks-file $DELIVERY_OS_HOME/objectives/<id>-tasks.json
```

### Step 5 — Merge + Staging Smoke

After CI passes + QA label + CODEOWNERS approval:

```bash
bash scripts/staging_smoke.sh --repo-dir <path-to-clone>
```

### Step 6 — Close Objective

```bash
bash scripts/delivery_loop.sh \
  --objective <objective-id> \
  --close-check
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "repo not in allowlist" | Wrong repo specified | Use `LucraLab/openclaw-control` |
| "gh auth required" | Not logged in to GitHub | Run `gh auth login` |
| "CI gate failing" | Content fails scan | Check `scan-secrets` / `scan-public-safe` output |
| "QA label missing" | No `qa-approved` label | Have authorized user add label |
| "CODEOWNERS review needed" | No approving review | Request review from @mcdonjam82 |
| "staging smoke failed" | Tests or lint failing | Fix issues, re-run smoke |
| Task stuck in BLOCKED | CI or approval issue | Check PR status with `task_pr_sync.sh` |

## Rollback

### Quick: Revert a merged PR

```bash
# Create revert PR (safe — goes through same gates)
gh pr create \
  --repo LucraLab/openclaw-control \
  --title "Revert: <original PR title>" \
  --body "Reverting PR #<number> due to <reason>"
```

### Full: Remove skill from repo

```bash
# 1. Create branch
git checkout -b revert/remove-delivery-loop-v1

# 2. Remove skill files
git rm -r skills/delivery_loop_v1/
git rm scripts/objective_create.sh
git rm scripts/delivery_loop.sh
git rm scripts/task_pr_sync.sh
git rm scripts/staging_smoke.sh

# 3. Remove CI workflow if added
git rm .github/workflows/gate-skill-delivery-loop.yml 2>/dev/null || true

# 4. Commit and PR
git commit -m "revert: remove delivery_loop_v1 skill"
git push origin revert/remove-delivery-loop-v1
gh pr create --title "Revert: Remove delivery_loop_v1" --body "Clean removal of delivery loop skill"
```

### Rollback Delivery OS state

```bash
# Remove objectives created by delivery_loop_v1
find $DELIVERY_OS_HOME/objectives/ -name "*.json" \
  -exec grep -l '"created_by": "delivery_loop_v1"' {} \; \
  -exec rm -v {} \;
```

## Monitoring

### Events to watch

```bash
# Recent delivery events
grep "DELIVERY_" $DELIVERY_OS_HOME/_logs/agent-events.jsonl | tail -20
```

### Health checks

```bash
# Verify skill files exist
ls -la skills/delivery_loop_v1/SPEC.md
ls -la scripts/delivery_loop.sh

# Verify gh auth
gh auth status

# Run tests
bash skills/delivery_loop_v1/tests/test_delivery_loop.sh
```

## Limitations (v1)

- Single repo only (`LucraLab/openclaw-control`)
- No GitHub Issues ingestion (manual objective creation)
- Polling-based PR sync (no webhooks)
- No production deploy step
- No multi-repo orchestration
- No automatic rollback on smoke failure

## v2 Ideas

- GitHub Issues → Objective ingestion
- Webhook-based PR state sync
- Multi-repo support with per-repo allowlists
- Production deploy with canary + rollback
- Automatic rollback on staging smoke failure
- Slack notifications for delivery events
