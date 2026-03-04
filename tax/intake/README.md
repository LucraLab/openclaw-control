# Intake Schemas

This directory contains JSON Schema definitions for different tax case intake types.

## Available Schemas

- `tax_case_intake.schema.json` - General tax case intake
- `irs_notice_intake.schema.json` - IRS notice triage
- `installment_agreement_intake.schema.json` - Payment plan requests
- `cost_segregation_intake.schema.json` - Cost seg study support

## Usage

All schemas enforce:
- Required fields marked explicitly
- PII fields documented for redaction
- Minimal data collection (data minimization policy)
- No optional bloat

Refer to `policies/data_minimization.md` and `policies/redaction_rules.md` for handling guidance.
