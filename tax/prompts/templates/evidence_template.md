# Evidence Record Template

Version: 1.0.0

This template matches evidence/evidence_record.schema.json structure.

---

## Evidence Record Structure

```json
{
  "case_id": "string (UUID or unique identifier)",
  "timestamp": "ISO 8601 UTC (e.g., 2026-03-04T04:50:00Z)",
  "agent_id": "string (e.g., tax-triage-agent)",

  "inputs_summary": {
    "case_type": "back_taxes_owed | irs_notice_response | installment_agreement | cost_segregation",
    "tax_years": [2022, 2023],
    "amount_involved": 15000,
    "urgency_level": "high",
    "user_summary_sanitized": "User received IRS notice requesting payment",
    "prerequisites_provided": ["returns_filed", "no_bankruptcy"]
  },

  "assumptions": [
    "User's stated amount owed is accurate per IRS records",
    "User has filed all required tax returns",
    "Standard IRS collection timeline applies",
    "User does not have outstanding IRS debts beyond stated amount"
  ],

  "sources": [
    {
      "type": "irs_publication",
      "identifier": "IRS Pub 594",
      "title": "The IRS Collection Process",
      "revision": "2025",
      "section": "Installment Agreements",
      "page": 12,
      "url": "https://www.irs.gov/pub/irs-pdf/p594.pdf",
      "last_updated": "2025-01-15"
    },
    {
      "type": "vault_document",
      "identifier": "irs-pub-594-2025.pdf",
      "last_updated": "2025-01-15"
    },
    {
      "type": "tax_code",
      "identifier": "IRC Section 6159",
      "title": "Agreements for Payment of Tax Liability in Installments"
    }
  ],

  "outputs_summary": {
    "recommendation": "Pursue streamlined installment agreement",
    "options_presented": ["streamlined_ia", "short_term_plan", "currently_not_collectible"],
    "recommended_option": "streamlined_ia",
    "justification": "Amount under $50k qualifies for streamlined with minimal paperwork",
    "professional_verification_required": true,
    "urgency_flagged": "high"
  },

  "risks": [
    "Penalties and interest continue during payment plan",
    "Missing a payment can default agreement and trigger levy",
    "Payment plan may not be optimal without professional analysis",
    "Alternative options (OIC, penalty abatement) not fully explored"
  ],

  "next_questions": [
    "Can you afford calculated monthly payment long-term?",
    "Do your actual expenses exceed IRS allowable standards?",
    "Should you pursue Offer in Compromise instead?",
    "Are penalties eligible for abatement to reduce total owed?"
  ],

  "artifacts": [
    {
      "type": "proof_pack",
      "path": "proofs/PROOF_TAX_CASE_abc123_20260304T045000Z.md",
      "sha256": "abcdef1234567890..."
    },
    {
      "type": "response_output",
      "format": "markdown",
      "sanitized": true
    }
  ]
}
```

---

## Field Descriptions

**case_id:** Unique identifier from intake schema

**timestamp:** ISO 8601 UTC when evidence was generated

**agent_id:** Which Tax Pod agent produced this evidence (tax-triage-agent, payment-plan-agent, etc.)

**inputs_summary:** Sanitized summary of user inputs (NO PII - names/SSN/addresses redacted)

**assumptions:** Array of explicit assumptions made during analysis

**sources:** Array of citation objects (IRS pubs, tax code, vault docs) with dates

**outputs_summary:** Sanitized summary of recommendations provided

**risks:** Array of risk statements disclosed to user

**next_questions:** What user and/or professional should verify

**artifacts:** References to proof packs, response outputs, or other related records

---

## Sanitization Rules

**BEFORE WRITING EVIDENCE RECORD:**

1. Redact all PII per policies/redaction_rules.md:
   - Full names → [NAME-REDACTED]
   - Full SSN → XXX-XX-[last 4]
   - Full addresses → [ADDRESS-REDACTED] or city/state only
   - Phone → [PHONE-REDACTED]
   - Email → [EMAIL-REDACTED]

2. Remove sensitive financial details:
   - Bank accounts → Not collected (schema rejects)
   - Credit cards → Not collected (schema rejects)
   - Exact income → Range or category (e.g., "$4k-$5k/month")

3. Validate against evidence_record.schema.json before commit

---

## Append-Only Pattern

Evidence records are NEVER edited or deleted. To update:

1. Write new evidence record referencing prior record
2. Mark as superseding: `"supersedes": "prior_case_id"`
3. Explain reason for update

**Example:**
```json
{
  "case_id": "tax-case-abc123-v2",
  "supersedes": "tax-case-abc123",
  "update_reason": "User provided corrected amount owed",
  ...
}
```

---

## Storage

**Append to JSONL file:**
```
evidence/tax_cases.jsonl
```

**One line per record:**
```
{"case_id":"abc123",...}
{"case_id":"def456",...}
{"case_id":"ghi789",...}
```

**Retention:** 7 years minimum per policies/retention_and_audit.md

---

**END OF TEMPLATE**
