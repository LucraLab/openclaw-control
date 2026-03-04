# Redaction Rules

Version: 1.0.0
Status: ENFORCED

## Purpose

Define PII patterns and redaction requirements for all logs, proofs, and evidence records.

## Redaction Patterns

### ALWAYS REDACT (Never Store Categories)

**Full SSN:**
- Pattern: `\b\d{3}-\d{2}-\d{4}\b` or `\b\d{9}\b`
- Replacement: `[SSN-REDACTED]`
- Last 4 digits acceptable: `XXX-XX-1234`

**Bank Account/Routing:**
- Pattern: account numbers 8+ digits
- Replacement: `[ACCOUNT-REDACTED]`

**Credit Card:**
- Pattern: 16-digit sequences
- Replacement: `[CARD-REDACTED]`

**Full Addresses:**
- Pattern: street number + street name + city + state + zip
- Replacement: `[ADDRESS-REDACTED]` or general location only (e.g., "Los Angeles, CA")

### REDACT IN LOGS/PROOFS (But Store in Evidence)

**Full Legal Names:**
- Pattern: PII field `name_full`
- Log replacement: `[NAME-REDACTED]`
- Evidence: stored but not in audit proofs

**Dates of Birth:**
- Replacement: birth year only (e.g., `1985` instead of `1985-04-23`)

**Phone Numbers:**
- Pattern: `\b\d{3}[-.]?\d{3}[-.]?\d{4}\b`
- Replacement: `[PHONE-REDACTED]`

**Email Addresses:**
- Pattern: `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`
- Replacement: `[EMAIL-REDACTED]` or domain only (e.g., `***@gmail.com`)

## Redaction Examples

### Example 1: IRS Notice Intake

**Before:**
```
User John Smith (SSN 123-45-6789) received CP2000 notice for tax year 2022.
Amount claimed: $5,432. Contact at john.smith@example.com or 555-123-4567.
```

**After (Logs/Proofs):**
```
User [NAME-REDACTED] (SSN XXX-XX-6789) received CP2000 notice for tax year 2022.
Amount claimed: $5,432. Contact at [EMAIL-REDACTED] or [PHONE-REDACTED].
```

### Example 2: Cost Segregation Property

**Before:**
```
Property: 1234 Main Street, Los Angeles, CA 90001
Owner: Jane Doe
Purchase price: $850,000
```

**After (Logs/Proofs):**
```
Property: [ADDRESS-REDACTED], Los Angeles, CA
Owner: [NAME-REDACTED]
Purchase price: $850,000
```

## Implementation

All redaction enforced via:
1. Intake schema validation (reject disallowed data)
2. Evidence record sanitization (automatic replacement)
3. Proof pack generation (double-check before output)

## Never Store List

The following categories are REFUSED at intake (not just redacted):
- Full SSN (last 4 only)
- Bank account credentials
- Credit card numbers
- Tax return attachments (summaries only)
- IRS correspondence containing full SSN

Refer to `data_minimization.md` for collection boundaries.
