# Tax Pod Output Contract

**Version:** 1.0.0
**Effective:** Port P9 (Unified Runner)

## Purpose

This contract defines the standardized output format for all Tax Pod agents. All agents MUST conform to this contract to pass the delivery gate.

---

## Output Directory Layout

All Tax Pod outputs are written to a deterministic case-specific directory:

```
tax/out/<caseId>/
  response.md                   # Human-readable markdown response (REQUIRED)
  evidence.json                 # Evidence record (REQUIRED, schema-validated)
  artifacts/                    # Optional artifacts directory
    *.csv                       # CSV templates (e.g., cost seg asset inventory)
    *.pdf                       # Generated PDFs (future)
```

### Case ID Generation

Case IDs MUST be deterministic and generated from normalized intake hash + agent key:

```javascript
const normalizedIntake = normalizeIntakeForId(intake);
const caseId = safeId(agentKey, normalizedIntake);
```

Examples:
- `tax-case-49610591ad21` (payment plan first)
- `irs-notice-d20c15195ed8` (IRS notice triage)
- `cost-seg-039df013db26` (cost segregation support)

---

## Standard Response Format (response.md)

All `response.md` files MUST include the following sections in order:

### 1. Title (H1)

```markdown
# Tax Pod Response: <Agent Name>
```

### 2. Summary (H2)

```markdown
## Summary

<Go/No-Go recommendation OR urgency statement OR primary finding>
```

### 3. What You Told Me (H2)

```markdown
## What You Told Me

- <Key intake field 1>: <value>
- <Key intake field 2>: <value>
...
```

### 4. Analysis Sections (H2)

Agent-specific sections (e.g., "Immediate Next Steps", "Options to Consider", "Estimated Upside").

### 5. Assumptions

Assumptions are REQUIRED but MAY be embedded in agent-specific sections (e.g., "What I'm Assuming") or in the Evidence section. The delivery gate validates that `evidenceRecord.assumptions[]` is non-empty (schema requirement).

### 6. Sources (H2) — **REQUIRED**

```markdown
## Evidence

- Case ID: <caseId>
- Timestamp: <ISO 8601 UTC>
- Agent: <agentId>

**Sources (Internal - Tax Pod Policies):**
- tax/policies/safe_answering_rules.md
- tax/policies/disclaimers_and_limits.md
```

If vault sources available:

```markdown
## IRS Sources (Local Vault)

- **<Source Title>**
  - Identifier: <identifier>
  - Locator: <file path or section>
```

If vault sources missing:

```markdown
**Note:** Missing vault sources: <list>. <Explanation>.
```

**Delivery Gate:** Response MUST contain EITHER "## IRS Sources" OR "Missing vault sources" note.

### 7. Disclaimer (H2) — **REQUIRED**

```markdown
## Disclaimer

This is informational decision support only, not legal or tax advice. You are responsible for verifying all information with licensed tax professionals (EA, CPA, or tax attorney) before taking action. The Tax Pod does not guarantee accuracy, IRS acceptance, or outcomes. See tax/policies/disclaimers_and_limits.md for full disclaimers.
```

**Delivery Gate:** Response MUST contain "## Disclaimer" heading.

---

## Standard Evidence Format (evidence.json)

All `evidence.json` files MUST conform to [tax/evidence/evidence_record.schema.json](../evidence/evidence_record.schema.json).

### Required Fields

```json
{
  "case_id": "string (deterministic)",
  "timestamp": "string (ISO 8601 UTC)",
  "agent_id": "string (e.g., payment-plan-agent)",
  "inputs_summary": {
    "case_type": "enum",
    "tax_years": ["array of integers"],
    "urgency_level": "enum (low|medium|high|critical)",
    "amount_involved": "number (estimate)",
    "user_summary_sanitized": "string (PII redacted)",
    "prerequisites_provided": ["array of strings"]
  },
  "assumptions": ["array of strings (min 1)"],
  "sources": [
    {
      "type": "enum (internal_document | irs_source | ...)",
      "identifier": "string",
      "title": "string",
      "locator": "string (file path or section)"
    }
  ],
  "outputs_summary": {
    "recommendation": "string",
    "options_presented": ["array of strings"],
    "recommended_option": "string",
    "justification": "string",
    "professional_verification_required": "boolean",
    "urgency_flagged": "enum (low|medium|high|critical)"
  },
  "risks": ["array of strings (min 1)"],
  "next_questions": ["array of strings (min 1)"],
  "artifacts": [
    {
      "type": "enum (response_output | csv_template | ...)",
      "format": "string (markdown | json | csv)",
      "sanitized": "boolean"
    }
  ]
}
```

### Source Requirements

**Delivery Gate:** `sources[]` array MUST have length ≥ 2.

At minimum, all agents MUST include internal policy sources:

```json
{
  "type": "internal_document",
  "identifier": "tax/policies/safe_answering_rules.md",
  "title": "Tax Pod Safe Answering Rules",
  "locator": "tax/policies/safe_answering_rules.md"
}
```

```json
{
  "type": "internal_document",
  "identifier": "tax/policies/disclaimers_and_limits.md",
  "title": "Tax Pod Disclaimers and Limits",
  "locator": "tax/policies/disclaimers_and_limits.md"
}
```

---

## Artifacts

Agents MAY produce additional artifacts beyond `response.md` and `evidence.json`.

### CSV Templates

- MUST be written to `tax/out/<caseId>/artifacts/<filename>.csv`
- MUST be referenced in `evidence.json` artifacts array
- MUST be deterministic (same input → byte-identical CSV)

Example (cost seg support):

```
tax/out/cost-seg-039df013db26/artifacts/costseg_asset_inventory_template.csv
```

### Future Artifacts

- PDFs (future)
- Calculation worksheets (future)
- Form pre-fills (future)

---

## Determinism Requirements

All outputs MUST be deterministic:

1. **Same input fixture → byte-identical outputs**
   - No timestamps unless injected via `_fixture_timestamp` in intake
   - No random IDs or UUIDs
   - Stable JSON serialization (use `stableJsonStringify`)

2. **Case ID must be deterministic**
   - Generated from normalized intake hash
   - Same intake values → same case ID

3. **File paths must be deterministic**
   - Based on case ID, not system time or random values

---

## Delivery Gate Validation

The delivery gate validates outputs before writing to disk:

### Validation Rules (FAIL-CLOSED)

1. ✅ `responseMarkdown` contains "## Disclaimer" heading
2. ✅ `responseMarkdown` contains EITHER "## IRS Sources" OR "Missing vault sources" note
3. ✅ `evidenceRecord.case_id` is present and non-empty
4. ✅ `evidenceRecord.timestamp` is present and ISO 8601 UTC
5. ✅ `evidenceRecord.agent_id` is present and non-empty
6. ✅ `evidenceRecord.inputs_summary` is present
7. ✅ `evidenceRecord.assumptions` is array with length ≥ 1
8. ✅ `evidenceRecord.sources` is array with length ≥ 2
9. ✅ `evidenceRecord.outputs_summary` is present
10. ✅ `evidenceRecord.risks` is array with length ≥ 1
11. ✅ `evidenceRecord.next_questions` is array with length ≥ 1
12. ✅ `evidenceRecord.artifacts` is array

### On Failure

- Exit code 1
- Print "DELIVERY_GATE: FAIL" + reasons
- Do NOT write any output files

### On Pass

- Write standardized outputs to `tax/out/<caseId>/`
- Exit code 0
- Print success message

---

## Version History

- **1.0.0 (Port P9):** Initial contract definition

---

**END OF CONTRACT**
