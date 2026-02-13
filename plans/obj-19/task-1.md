# Task 1: Gmail Draft Assistant Implementation

## Scope
Implement a Gmail Workspace integration that allows the OpenClaw Personal Assistant to create email drafts (never send) in James's Gmail for review and approval. Includes policy module, CLI tool, 30 offline tests, CI gate, documentation, and proof pack.

## Verification
- Run email draft tests: `node scripts/email_draft.test.js` (30/30 pass)
- Run regression suite: all 225 existing tests pass (0 failures)
- Grep for send scope: no `gmail.send` or `users.messages.send` in source
- CI gate passes: `email-draft-gate` runs 30 tests + 5 safety checks
- Static analysis: no hardcoded secrets in source files

## Rollback
- Revert the merge commit: `git revert <merge-sha>`
- Remove `email-draft-gate` from branch protection required checks
- Delete VPS auth artifacts: `rm -rf $OPENCLAW_RUNTIME_DIR/gmail-secrets/`
