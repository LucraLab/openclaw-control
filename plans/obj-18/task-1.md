# obj-18 / task-1: Closeout Ports 16-18 + Quarantine Lock

## Scope

Merge feature branch `feat/delivery-os-gates` to `main`, including:
- Port 16: Autonomy Runtime v1 library + CLIs + 58 tests
- Port 17: Wiring contract tests (23 tests) + entrypoint deployment
- Port 18: VPS deployment + killswitch guard patching
- Quarantine lock race fix (O_EXCL file lock around pickAgentSkipQuarantine)
- CI gate fixes (scan-secrets, lint-markdown, verification-gate, two-stage-pr-review)
- ops/ prefix allowlists for verification-gate and two-stage-pr-review policies

Post-merge: add `autonomy-runtime-v1` and `wiring-contract` to branch protection required checks.

## Verification

- All 231+ tests pass locally (autonomy-runtime, wiring-contract, coverage, verification-gate, two-stage-pr-review, evidence-graph, fix-pack)
- All CI gates green on PR #37 and PR #38
- VPS integrity snapshot: sha256 of runtime files on both VPSes
- Entrypoints reference killswitch.js guard (not status)
- Branch protection required checks count increased (not decreased)

## Rollback

- Revert merge commit on `main`: `git revert <merge-sha>`
- Branch protection: remove `autonomy-runtime-v1` and `wiring-contract` from required checks
- VPS: restore from backups at `/opt/openclaw-runtime/*.backup-*`
