# Data Minimization Policy

Version: 1.0.0
Status: ENFORCED

## Principle

Collect only the minimum data necessary to provide decision support. Refuse to collect or store data beyond this scope.

## Data Collection Rules

### COLLECT (Required for Decision Support)

- Case classification (back taxes, notice type, payment plan, cost seg)
- Tax years involved
- Amount owed (estimates acceptable)
- Filing status (single, married, etc.)
- Monthly income/expenses (for payment plans only)
- Property details (for cost seg only: type, purchase price, date)
- User summary of situation (sanitized, no PII required)
- Last 4 digits of SSN (verification only, NOT full SSN)

### REFUSE TO COLLECT (Never Store)

- Full Social Security Numbers (SSN) - last 4 only
- Bank account numbers or routing numbers
- Credit card information
- Passwords or authentication credentials
- Exact property addresses (general location acceptable)
- Employer Identification Numbers (EIN) unless explicitly required
- Tax return contents (accept summaries only)
- IRS correspondence attachments containing full SSN

## Justification Requirement

For each data field collected, the intake schema must document:
1. Why it is necessary
2. How it will be used in decision support
3. How it will be redacted in logs/proofs

## Enforcement

- Intake schemas reject submissions with disallowed fields
- Runtime checks refuse to process full SSN, bank accounts, etc.
- Evidence records sanitize all PII per redaction_rules.md

## Audit Trail

All data collection decisions logged in evidence records with:
- What was requested
- What was collected
- What was refused
- Justification for collection
