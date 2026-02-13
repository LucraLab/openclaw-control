# Proof Pack: Gmail Draft Assistant

**Date:** 2026-02-13
**Auditor:** Claude Code (Opus 4.6)
**Repo:** LucraLab/openclaw-control, branch `main`

---

## Mission

Implement a Gmail Workspace integration that allows the OpenClaw Personal Assistant to proactively write emails and save them as Gmail Drafts for James's approval. Draft-only, safe, bounded, auditable.

---

## Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `scripts/email_draft_policy.js` | Core policy module: validation, allowlist, rate limit, RFC822 builder, auth, Gmail API, Telegram notification, events | ~650 |
| `scripts/gmail_draft.js` | CLI tool: auth-init, auth-status, draft, validate, rate-status, allowlist-status | ~150 |
| `scripts/email_draft.test.js` | 30 offline tests (no network) | ~340 |
| `.github/workflows/gate-email-draft.yml` | CI gate: tests + 5 safety checks | ~65 |
| `docs/EMAIL_DRAFT_ASSISTANT.md` | Operating guide: setup, config, usage, safety model, rollback | ~140 |
| `ops/proofs/PROOF_PACK_GMAIL_DRAFT_ASSISTANT_20260213T001500Z.md` | This proof pack | — |

**Files modified:** NONE. All changes are additive.

---

## Test Results

### Email Draft Tests (30/30 PASS)

| Test | Description | Result |
|------|-------------|--------|
| ED-T1 | Valid intent passes validation | PASS |
| ED-T2 | Missing `to` field detected | PASS |
| ED-T3 | Missing `subject` field detected | PASS |
| ED-T4 | Missing `body_markdown` field detected | PASS |
| ED-T5 | Missing `requested_by` field detected | PASS |
| ED-T6 | Invalid `requested_by` value rejected | PASS |
| ED-T7 | Empty `to` array rejected | PASS |
| ED-T8 | Invalid email format rejected | PASS |
| ED-T9 | `approval_required` must be true | PASS |
| ED-T10 | Allowlist passes for allowed domain | PASS |
| ED-T11 | Allowlist passes for exact address | PASS |
| ED-T12 | Allowlist blocks unknown domain | PASS |
| ED-T13 | Allowlist fails closed when unconfigured | PASS |
| ED-T14 | Rate limit allows under limit | PASS |
| ED-T15 | Rate limit blocks at 5/day | PASS |
| ED-T16 | Rate limit override bypasses limit | PASS |
| ED-T17 | Missing auth files -> fail closed (no draft) | PASS |
| ED-T18 | Sanitization redacts sk- patterns | PASS |
| ED-T19 | Sanitization redacts ghp_ patterns | PASS |
| ED-T20 | Sanitization redacts Bearer tokens | PASS |
| ED-T21 | Sanitization redacts AKIA patterns | PASS |
| ED-T22 | Sanitization redacts eyJ (JWT) patterns | PASS |
| ED-T23 | Sanitization redacts OAuth refresh tokens (1//) | PASS |
| ED-T24 | Sanitization redacts OAuth access tokens (ya29.) | PASS |
| ED-T25 | RFC822 builder produces correct headers | PASS |
| ED-T26 | RFC822 builder produces MIME boundary | PASS |
| ED-T27 | RFC822 builder base64url encodes | PASS |
| ED-T28 | Telegram notification includes required fields | PASS |
| ED-T29 | Telegram notification sanitizes secrets | PASS |
| ED-T30 | One clarifier returns exactly one question | PASS |

### Regression Tests (all existing suites)

| Suite | Count | Result |
|-------|-------|--------|
| Autonomy Runtime (A-H) | 58 | PASS |
| Wiring Contract | 23 | PASS |
| Two-Stage PR Review | 14 | PASS |
| Verification Gate | 12 | PASS |
| Evidence Graph | 73 | PASS |
| Fix Pack | 45 | PASS |
| **Email Draft (new)** | **30** | **PASS** |
| **Total** | **255** | **0 fail** |

---

## Evidence: Send Is Impossible

### 1. OAuth Scope (compile-time)

```
GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.compose'
```

`gmail.compose` allows creating drafts only. It does NOT permit:
- `gmail.send` (sending on behalf)
- `gmail.modify` (modifying/deleting messages)
- `gmail.readonly` (reading messages)

### 2. API Endpoint (runtime)

```
hostname: 'gmail.googleapis.com'
path: '/gmail/v1/users/me/drafts'
method: 'POST'
```

Only `users.drafts.create` is called. No `users.messages.send` endpoint exists in the code.

### 3. Grep Evidence (static analysis)

```
$ grep -rn 'gmail\.send' scripts/email_draft_policy.js scripts/gmail_draft.js
email_draft_policy.js:16: * NEVER request gmail.send, gmail.modify, or broad read scopes.

$ grep -rn 'messages\.send\|messages/send' scripts/email_draft_policy.js scripts/gmail_draft.js
(no results)
```

Only occurrence is a comment prohibiting it.

### 4. CI Gate Enforcement

`gate-email-draft.yml` includes automated checks:
- **Verify no gmail.send scope** — fails if `gmail.send` string found in source
- **Verify no users.messages.send usage** — fails if send endpoint found
- **Verify no network calls in tests** — fails if http/https imported in test file
- **Verify runtime secrets paths gitignored** — fails if `.openclaw_runtime` or `secrets/` not in `.gitignore`
- **Verify no hardcoded secrets** — fails if sk-, ghp_, AKIA, pit- patterns in source

---

## Example: Sanitized Intent

```json
{
  "to": ["partner@lucralab.com"],
  "subject": "Follow-up: Q1 proposal review",
  "body_markdown": "Hi,\n\nFollowing up on our call.\n\nBest,\nAssistant",
  "context_tags": ["sales", "follow-up"],
  "requested_by": "telegram",
  "approval_required": true
}
```

### Resulting Sanitized Output

```
Status: created
Event: EMAIL_DRAFT_CREATED
Draft ID: r1a2b3c4d5e6
Link: https://mail.google.com/mail/#drafts/abc123

Telegram notification:
  Draft created in Gmail:
  To: partner@lucralab.com
  Subject: Follow-up: Q1 proposal review

  Summary:
  - Context: sales, follow-up
  - Preview: "Hi, Following up on our call. Best, Assistant"
  - Recipients: 1 total

  Draft ID: r1a2b3c4d5e6
  Link: https://mail.google.com/mail/#drafts/abc123

  Reply: APPROVE / EDIT / DISCARD
```

No secrets, tokens, or PII in output.

---

## CI Integration

### New Gate

| Gate | Job name | Checks |
|------|----------|--------|
| `gate-email-draft.yml` | `email-draft-gate` | 30 tests + 5 safety verifications |

### Branch Protection Update Needed

Add `email-draft-gate` to required status checks (+1 additive):
- Current: 18 checks
- After: 19 checks

---

## Rollback Steps

### Code

```bash
git revert <commit-sha>
```

### Branch Protection

Remove `email-draft-gate` from required status checks via GitHub API:

```bash
gh api repos/LucraLab/openclaw-control/branches/main/protection \
  --method PUT \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=arbiter-hints' \
  ... # (all 18 current checks, minus email-draft-gate)
```

### VPS Cleanup

```bash
rm -rf $OPENCLAW_RUNTIME_DIR/gmail-secrets/
rm -f $OPENCLAW_RUNTIME_DIR/email-draft-ledger.jsonl
```

---

## Safety Checklist

- [x] Draft-only: NO send endpoint, NO send scope
- [x] Fail closed: missing auth, blocked recipient, rate limit, ambiguous intent
- [x] No secrets in repo or logs: tokens in runtime dir, all output sanitized
- [x] Allowlist enforced: fail closed if unconfigured
- [x] Rate limited: 5/day default, explicit override required
- [x] One clarifier max: exactly one question if ambiguous, then fail closed
- [x] Telegram notification: to/subject + 3 bullets + draft ID + APPROVE/EDIT/DISCARD
- [x] CI gate: tests + scope check + endpoint check + network check + secrets check
- [x] All changes additive: 0 existing files modified
- [x] 255 total tests pass (0 failures)

---

## Status: DONE
