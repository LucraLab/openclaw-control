# Email Draft Assistant

The Email Draft Assistant allows OpenClaw's Personal Assistant (Dude/Skippy) to proactively write emails and save them as Gmail Drafts for James's approval.

## Safety Model

| Property | Guarantee |
|----------|-----------|
| **Draft-only** | CANNOT send emails. No send scope, no send endpoint. |
| **Approval required** | Every draft requires James to APPROVE, EDIT, or DISCARD via Telegram. |
| **Fail closed** | Missing auth, blocked recipient, rate limit, ambiguous intent -> no draft created. |
| **Allowlist** | Only pre-approved domains and addresses can be drafted to. |
| **Rate limited** | Max 5 drafts/day (configurable). Override requires explicit "override" from James. |
| **Auditable** | All events logged to `events.jsonl`. Rate ledger is append-only. |
| **No secrets in repo** | OAuth tokens stored in runtime secrets dir on VPS, never in git. |

## OAuth Scope

```
https://www.googleapis.com/auth/gmail.compose
```

This scope allows creating drafts ONLY. It does NOT grant permission to send, read, or modify existing emails.

## Setup

### 1. Create Google Cloud OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) -> APIs & Services -> Credentials
2. Create an OAuth 2.0 Client ID (Desktop app type)
3. Download the JSON file

### 2. Place Credentials on VPS

```bash
# On VPS, create the secrets directory
mkdir -p $OPENCLAW_RUNTIME_DIR/gmail-secrets

# Copy the downloaded JSON (rename to client_credentials.json)
cp ~/Downloads/client_secret_*.json $OPENCLAW_RUNTIME_DIR/gmail-secrets/client_credentials.json
```

### 3. Run Auth Init

```bash
node scripts/gmail_draft.js auth-init
```

This will:
1. Print a Google consent URL
2. Ask you to paste the authorization code
3. Exchange the code for tokens
4. Store tokens in `$OPENCLAW_RUNTIME_DIR/gmail-secrets/tokens.json`

### 4. Verify Auth

```bash
node scripts/gmail_draft.js auth-status
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_RUNTIME_DIR` | `.openclaw_runtime` | Runtime state directory |
| `OPENCLAW_EMAIL_ALLOW_DOMAINS` | (none) | Comma-separated allowed domains |
| `OPENCLAW_EMAIL_ALLOW_EXACT` | (none) | Comma-separated allowed exact addresses |
| `OPENCLAW_EMAIL_RATE_LIMIT` | `5` | Max drafts per day |
| `OPENCLAW_EMAIL_FROM` | `OpenClaw Assistant <assistant@openclaw.local>` | From address |
| `OPENCLAW_EMAIL_DEBUG` | `false` | Show full allowlist in status |

### Allowlist

The allowlist controls who can be drafted to. Both must be configured (fail closed if empty).

```bash
# In .env on VPS
OPENCLAW_EMAIL_ALLOW_DOMAINS=lucralab.com,yourdomain.com
OPENCLAW_EMAIL_ALLOW_EXACT=james@gmail.com,specific@partner.com
```

## Usage

### Natural Telegram Flow

James chats normally. When the assistant infers an email is needed:

1. Assistant validates the intent
2. If something is unclear, asks ONE clarifying question max
3. Creates the draft in Gmail
4. Sends Telegram notification with:
   - To + Subject
   - 3-bullet summary
   - Draft ID + link
   - Options: APPROVE / EDIT / DISCARD

### CLI Commands

```bash
# Create a draft from intent JSON
node scripts/gmail_draft.js draft --intent intent.json

# Validate intent only (no draft created)
node scripts/gmail_draft.js validate --intent intent.json

# Check rate limit status
node scripts/gmail_draft.js rate-status

# Check allowlist configuration
node scripts/gmail_draft.js allowlist-status
```

### Intent JSON Schema

```json
{
  "to": ["recipient@domain.com"],
  "cc": ["optional@domain.com"],
  "bcc": ["optional@domain.com"],
  "subject": "Email subject line",
  "body_markdown": "Email body in markdown format",
  "context_tags": ["sales", "follow-up"],
  "requested_by": "telegram",
  "approval_required": true,
  "override_rate_limit": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string[]` | YES | Recipient emails |
| `cc` | `string[]` | no | CC recipients |
| `bcc` | `string[]` | no | BCC recipients |
| `subject` | `string` | YES | Subject line |
| `body_markdown` | `string` | YES | Body in markdown |
| `context_tags` | `string[]` | no | Context: sales, ops, personal, billing, support, follow-up, scheduling |
| `requested_by` | `string` | YES | One of: autopilot, telegram, workflow |
| `approval_required` | `boolean` | YES | Must be `true` |
| `override_rate_limit` | `boolean` | no | Default `false`. Set `true` only when James explicitly says "override" |

## Finding Drafts in Gmail

After a draft is created:
1. Open Gmail
2. Click "Drafts" in the left sidebar
3. Find the draft by subject line
4. Review, edit, and send (or discard) manually

The Telegram notification includes a direct link: `https://mail.google.com/mail/#drafts/<messageId>`

## Events

All events are logged to `$OPENCLAW_RUNTIME_DIR/events.jsonl`:

| Event | Meaning |
|-------|---------|
| `EMAIL_DRAFT_CREATED` | Draft successfully created in Gmail |
| `EMAIL_DRAFT_SKIPPED_NEEDS_CLARIFIER` | Missing info, one question asked |
| `EMAIL_DRAFT_BLOCKED_ALLOWLIST` | Recipient not in allowlist |
| `EMAIL_DRAFT_BLOCKED_RATELIMIT` | Daily rate limit reached |
| `EMAIL_DRAFT_FAILCLOSED` | Auth error, validation error, or other failure |

## Files

| File | Purpose |
|------|---------|
| `scripts/email_draft_policy.js` | Core policy module (validation, allowlist, rate limit, RFC822, auth, events) |
| `scripts/gmail_draft.js` | CLI tool |
| `scripts/email_draft.test.js` | 30 offline tests |
| `.github/workflows/gate-email-draft.yml` | CI gate (tests + safety checks) |
| `docs/EMAIL_DRAFT_ASSISTANT.md` | This file |

## Rollback

To remove the Email Draft Assistant:

1. Revert the commit that added it
2. Remove `email-draft-gate` from branch protection required checks
3. Delete `$OPENCLAW_RUNTIME_DIR/gmail-secrets/` on VPS
4. Delete `$OPENCLAW_RUNTIME_DIR/email-draft-ledger.jsonl` on VPS
