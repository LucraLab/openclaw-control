# Tax Pod Overview

Version: 1.0.0-skeleton
Status: SKELETON ONLY (no runtime wiring)
Date: 2026-03-04

## Purpose

The Tax Pod provides **decision support** for IRS back taxes, payment plans, tax preparation handoff, and cost segregation studies. It is NOT a CPA, enrolled agent, or attorney. All outputs are informational only and must be verified by licensed tax professionals.

## Scope

**IN SCOPE:**
- Triage IRS notices (CP series, levy notices, etc.)
- Calculate installment agreement eligibility
- Identify cost segregation study opportunities for rental properties
- Generate structured handoff packages for tax preparers
- Provide educational information on IRS procedures

**OUT OF SCOPE:**
- Filing tax returns or IRS forms
- Representing users before the IRS
- Providing legal advice or tax law interpretation
- Storing full SSN, bank accounts, or unnecessary PII
- Guaranteeing IRS acceptance or outcomes

## Workflow

```
1. INTAKE
   - User provides case details via intake schemas
   - PII minimized and redacted per policies
   - Case classified by type and urgency

2. TRIAGE
   - Agent analyzes case using vault knowledge sources
   - Cites IRS publications and tax code
   - States assumptions explicitly
   - Identifies risks and limitations

3. PLAN
   - Present 2-4 options with pros/cons
   - Recommend next step with justification
   - Calculate estimates (payment plans, cost seg benefits)
   - Disclose what professional must verify

4. VET
   - User reviews vetting checklist
   - Professional validates recommendations
   - Confirms assumptions and calculations
   - Approves or modifies plan

5. OUTPUT
   - Generate evidence record (immutable)
   - Provide structured response per template
   - Store sanitized proof pack
   - User proceeds with professional guidance
```

## Payment Plan First Philosophy

The Tax Pod prioritizes getting users into IRS-compliant payment arrangements quickly to:
- Stop penalties and interest accumulation
- Prevent collection actions (levy, lien)
- Buy time for professional review and optimization

This does NOT mean payment plans are always optimal or that professional consultation can be skipped.

## Integration with OpenClaw

The Tax Pod reuses existing OpenClaw audit and proof discipline:

**Evidence Records:**
- Follow events.jsonl append-only immutability pattern
- Sanitized per redaction_rules.md before write
- Schema validation before commit
- 7-year minimum retention

**Gate Enforcement:**
- Clean tree enforcement (tax/, docs/, proofs/ allowlist)
- Drift detection for policy/schema changes
- Budget enforcement for computation limits
- Capability matrix for tool/model restrictions

**Proof Packs:**
- Comprehensive verification documents
- SHA256 integrity checks
- Stored in proofs/ directory
- Permanent retention

## Key Policies

**Data Minimization:**
- Collect only minimum data for decision support
- Refuse full SSN (last 4 only), bank accounts, credit cards
- See policies/data_minimization.md

**Redaction:**
- All PII redacted in logs and proofs
- Names, addresses, phone, email sanitized
- See policies/redaction_rules.md

**Safe Answering:**
- Every output includes assumptions, sources, risks, "verify with pro"
- Refusal rules for legal advice, dangerous scenarios, prohibited data
- See policies/safe_answering_rules.md

**Retention:**
- Evidence records: 7 years minimum
- Audit logs: permanent
- Append-only, never edit or delete
- See policies/retention_and_audit.md

## Agents

**Tax Triage Agent** (`tax-triage-agent`)
- General tax case triage
- Classifies case type and urgency
- Routes to specialized agents

**IRS Notice Triage Agent** (`irs-notice-triage-agent`)
- Specialized for IRS notices (CP series, levy notices)
- Deadline tracking and urgency escalation
- Notice-specific guidance

**Payment Plan Agent** (`payment-plan-agent`)
- Installment agreement guidance
- Eligibility calculation
- Payment Plan First approach

**Cost Seg Support Agent** (`cost-seg-support-agent`)
- Cost segregation study feasibility
- Benefit estimation
- Professional study referral

All agents enforce safe_answering_rules.md and output evidence records.

## Directory Structure

```
tax/
  README.md              - Purpose and architecture
  VERSION                - Skeleton version

  intake/
    schemas/             - JSON Schema for intake types
      tax_case_intake.schema.json
      irs_notice_intake.schema.json
      installment_agreement_intake.schema.json
      cost_segregation_intake.schema.json

  policies/
    data_minimization.md - What to collect vs refuse
    redaction_rules.md   - PII patterns and redaction
    retention_and_audit.md - Evidence retention and immutability
    disclaimers_and_limits.md - User-facing constraints
    safe_answering_rules.md - Output requirements

  prompts/
    system/              - System prompts for agents
      tax_triage_system.md
      irs_notice_triage_system.md
      payment_plan_first_system.md
      cost_seg_support_system.md
    templates/           - Response and evidence templates
      response_template.md
      evidence_template.md
      vetting_checklist.md

  evidence/
    evidence_record.schema.json
    example_evidence_record.json
```

## Runtime Wiring (Not in Skeleton)

This skeleton establishes structure only. Runtime wiring requires:

1. **Vault Integration:** Connect IRS publications, tax code, and knowledge sources
2. **Orchestration:** Wire intake → triage → plan → output flow
3. **Evidence Storage:** Implement append-only JSONL storage
4. **Gate Integration:** Add output gates before user-facing delivery
5. **Allowlist Expansion:** Update drift gate to include tax/ (separate port P4.1)

## Disclaimers

**NOT LEGAL OR TAX ADVICE**

The Tax Pod provides informational decision support only. Users are responsible for:
- Verifying all information with licensed tax professionals
- Meeting IRS deadlines
- Complying with tax law
- Understanding they assume all risk

See policies/disclaimers_and_limits.md for full disclaimers.

## Next Steps

**Port P4 (This Port):**
- Create skeleton structure ✓
- Define schemas and policies ✓
- Establish prompt stubs ✓
- Generate proof pack ✓

**Port P4.1 (Follow-Up):**
- Expand drift gate allowlist to include tax/
- Update run_drift_telemetry_gate.js
- Verify no regressions

**Port P5 (Runtime Wiring):**
- Connect vault knowledge sources
- Implement orchestration logic
- Add evidence record storage
- Wire output gates

**Port P6 (Testing):**
- Test with sample IRS notices
- Validate evidence records
- Verify sanitization
- Professional review

---

**END OF OVERVIEW**

This overview summarizes the Tax Pod skeleton created in Port P4. No runtime logic is included.
