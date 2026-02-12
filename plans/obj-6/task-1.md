# Task 1: Environment Isolation Enforcement

## Scope

Add environment isolation enforcement to openclaw-control:
- Shared path validation library (oc_paths.sh)
- Centralized event emission library (oc_events.sh)
- Atomic JSON write helper (oc_atomic_json.py)
- Agent identity (OC_AGENT_ID) support
- Path traversal protection for OBJ_ID and REPO
- Modify 4 shell scripts to use shared libs
- 25 tests, 12-check gate runner, CI workflow, docs

## Verification

- 25/25 isolation guard tests pass (node scripts/isolation_guard.test.js)
- Gate runner produces valid JSON + MD reports (12 smoke checks)
- All existing CI gates pass (74 pre-existing tests unchanged)
- All 4 modified shell scripts source shared libs
- No inline emit_event() definitions remain in modified scripts
- Zero path traversal possible via OBJ_ID or REPO

## Rollback

- Revert merge commit: `git revert <merge-sha>`
- Or delete workflow: `rm .github/workflows/gate-isolation-guard.yml`
- Shell script originals recoverable from git history
- No existing test files modified
