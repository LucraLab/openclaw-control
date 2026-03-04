# IRS Pod — Google Sheets Guardrails

Access controls for the `tax-vault-operator` and `irs-specialist` agents
when reading from or writing to Google Sheets.

## Architecture

All Sheets access routes through `SheetsGateway` (`scripts/sheets_gateway_policy.js`).
Direct Google API calls from agents are forbidden. The gateway enforces six gates
on every write attempt:

| # | Gate | On Violation |
|---|------|--------------|
| 1 | Sheet allowlist | blocked |
| 2 | Range allowlist | blocked |
| 3 | PII detection | failclosed |
| 4 | Write approval token + TTL | blocked |
| 5 | Payload integrity (SHA-256) | failclosed |
| 6 | Audit log + event emission | (always runs) |

Reads enforce gates 1 and 2 only.

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GOOGLE_SHEETS_ALLOWLIST` | Yes | (empty = deny all) | Comma-separated spreadsheet IDs that agents may access |
| `GOOGLE_SHEETS_RANGE_ALLOWLIST` | No | (empty = all ranges) | Comma-separated A1-notation ranges agents may access |
| `SHEETS_WRITE_APPROVAL_REQUIRED` | No | `true` | When `true`, writes require a valid approval token |
| `SHEETS_WRITE_APPROVAL_TTL_SECONDS` | No | `300` | Approval token lifetime in seconds |
| `SHEETS_AUDIT_LOG_PATH` | Yes | (empty = no logging) | Path to append-only JSONL audit log |

## Fail-Closed Design

- Missing `GOOGLE_SHEETS_ALLOWLIST` → deny all reads and writes
- Missing approval token when required → block write
- Unknown value type in PII scan → fail-closed (block)
- Payload hash mismatch → fail-closed (block)

## PII Detection

Every value payload is scanned before proposal and again before commit.
Detected patterns:

| Pattern | Example | Result |
|---------|---------|--------|
| Formatted SSN | `123-45-6789` | failclosed |
| 9 consecutive digits | `123456789` | failclosed |
| PII keywords | `social security`, `tax id`, `ein`, `itin`, `ssn` | failclosed |
| Unknown type | Symbol, function, etc. | failclosed |

**No raw tax documents are handled in this repo.**

## Write Flow

```
1. Agent calls proposeWrite(sheetId, range, values)
   → Allowlist check → PII scan → returns pendingChange + payload_sha256

2. Operator reviews pendingChange, provides approval token

3. Agent calls commitWrite(pendingChange, approvalToken)
   → Re-checks allowlists → Re-scans PII → Validates token + TTL
   → Verifies payload SHA-256 → Appends audit log → Emits event
   → Returns { ok, outcome, auditEntry, event }
```

## Audit Log Format (JSONL)

Each line is a JSON object:

```json
{
  "timestamp_utc": "2026-02-13T10:00:00.000Z",
  "agent_id": "tax-vault-operator",
  "request_id": "a1b2c3d4e5f6g7h8",
  "sheet_id": "abc123",
  "range": "Sheet1!A1:C10",
  "outcome": "ok",
  "reason": "All gates passed",
  "payload_sha256": "e3b0c44298fc..."
}
```

Outcomes: `ok` | `blocked` | `failclosed`

## Event Emission

Every write attempt emits a `SHEETS_WRITE_ATTEMPT` event:

```json
{
  "event_type": "SHEETS_WRITE_ATTEMPT",
  "timestamp_utc": "2026-02-13T10:00:00.000Z",
  "agent_id": "irs-specialist",
  "request_id": "req-abc123",
  "sheet_id": "abc123",
  "range": "Sheet1!A1:C10",
  "outcome": "ok",
  "reason": "All gates passed"
}
```

## Running Tests

```bash
# Unit tests (18 cases, zero network)
node scripts/sheets_gateway.test.js

# Gate runner (12 smoke checks, produces report)
node scripts/run_sheets_gateway_gate.js
```

## Files

| File | Purpose |
|------|---------|
| `scripts/sheets_gateway_policy.js` | Gateway policy module (all enforcement logic) |
| `scripts/sheets_gateway.test.js` | 18 fixture-only unit tests |
| `scripts/run_sheets_gateway_gate.js` | CI gate runner (12 smoke checks + report) |
| `docs/IRS_POD_SHEETS_GUARDRAILS.md` | This document |
