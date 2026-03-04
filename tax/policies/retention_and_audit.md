# Retention and Audit Policy

Version: 1.0.0
Status: ENFORCED

## Purpose

Define evidence record retention, immutability requirements, and audit trail structure for Tax Pod operations.

## Evidence Record Pattern

The Tax Pod reuses OpenClaw's existing events.jsonl pattern for immutability:

**Structure:**
- One evidence record per case interaction (intake, triage, plan, output)
- Append-only (never edit or delete)
- Sanitized per redaction_rules.md before write
- Schema validation before commit

**Format:**
- JSON Lines (JSONL) for append-only operations
- Each line is a complete, valid JSON object
- event_seq for monotonic ordering
- correlation_id for case linkage

## Retention Periods

**Evidence Records:**
- Minimum: 7 years (IRS statute of limitations)
- Maximum: user-defined or regulatory requirement
- Deletion: only after retention period + legal hold release

**Audit Logs (events.jsonl):**
- Permanent retention (immutable)
- Includes: CASE_CREATED, TRIAGE_COMPLETED, PLAN_GENERATED, EVIDENCE_RECORDED
- Never contains PII (sanitized before emit)

**Proof Packs:**
- Permanent retention
- SHA256 integrity verification
- Stored in proofs/ directory per OpenClaw convention

## Immutability Enforcement

**Append-Only Pattern:**
```javascript
// From OpenClaw lib/oc_atomic_json.py pattern
// Evidence records are written atomically, never modified
fs.appendFileSync('evidence.jsonl', JSON.stringify(record) + '\n');
```

**Prohibited Operations:**
- Editing existing evidence records
- Deleting evidence before retention period
- Backdating timestamps
- Removing audit events

**Allowed Operations:**
- Appending new evidence records
- Marking records as superseded (new record references old)
- Adding annotations (separate JSONL entry, not edit)

## Audit Trail Requirements

Every Tax Pod operation must emit:
1. Event type (CASE_CREATED, TRIAGE_COMPLETED, etc.)
2. Timestamp (ISO 8601 UTC)
3. Case ID (correlation)
4. Agent ID (which component performed action)
5. Sanitized summary (no PII)

**Example Event:**
```json
{
  "event_type": "TAX_CASE_TRIAGE_COMPLETED",
  "timestamp": "2026-03-04T04:50:00Z",
  "case_id": "tax-case-abc123",
  "agent_id": "tax-triage-agent",
  "summary": "IRS notice CP2000 triaged, recommended payment plan route",
  "urgency": "high",
  "event_seq": 42
}
```

## Evidence Record Schema

Refer to `evidence/evidence_record.schema.json` for full schema.

**Required Fields:**
- case_id
- timestamp
- agent_id
- inputs_summary (sanitized)
- assumptions (explicit)
- sources (vault references, IRS pub citations)
- outputs_summary (sanitized)
- risks (identified)
- next_questions (for user/pro to verify)
- artifacts (proof pack references)

## Integration with OpenClaw Gates

**Drift Detection:**
- Evidence schema changes trigger drift alerts
- Policy updates require explicit approval
- Retention period changes audited

**Budget Enforcement:**
- Evidence record size limits (prevent bloat)
- Token usage tracked per case
- Computation caps enforced

## Access Controls

**Who Can Read:**
- Case owner (user)
- Licensed tax professional (with user authorization)
- Audit/compliance review (anonymized)

**Who Can Write:**
- Tax Pod agents (automated, validated)
- Never manual edits (prevents tampering)

**Who Can Delete:**
- Only after retention period + legal hold release
- Requires dual approval (user + compliance)
- Deletion logged in permanent audit trail

## Disaster Recovery

- Evidence records backed up daily
- Immutable storage (S3 versioning or equivalent)
- SHA256 checksums for integrity verification
- Recovery tested quarterly
