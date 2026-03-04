# Tax Pod — Decision Support for IRS Back Taxes and Tax Preparation

Version: 1.3.0-unified-runner-p9
Status: UNIFIED RUNNER + DELIVERY GATE (standardized outputs, fail-closed validation)

## Purpose

The Tax Pod provides **decision support** for:
- IRS back taxes and payment plan options
- Installment agreement guidance (Payment Plan First approach)
- Tax preparation handoff to licensed preparers
- Cost segregation study support for rental properties

## Critical Disclaimers

**NOT A CPA OR ATTORNEY**
- All outputs are for informational purposes only
- User must verify all recommendations with licensed tax professionals
- No filings or submissions to IRS will be made through this system
- Not legal or tax advice

**Payment Plan First Philosophy**
The pod prioritizes getting users into compliant payment arrangements quickly, avoiding penalties and interest accumulation while professional review occurs.

## Architecture

This pod reuses OpenClaw's existing audit/proof discipline:
- Evidence records for all interactions (intake → triage → plan → vet → output)
- Immutable event logs (events.jsonl pattern)
- Vault-based knowledge retrieval (IRS publications, tax code references)
- Gate-based verification before outputs

## Directory Structure

```
tax/
  intake/          - Intake schemas for different case types
  policies/        - Data handling, redaction, retention rules
  prompts/         - System prompts and response templates
  evidence/        - Evidence record schemas and examples
  contracts/       - Output contract (Port P9)
  runtime/         - Runtime logic + delivery gate (Port P5+)
  vault/           - Local IRS source vault (Port P6)
  cli/             - Command-line tools (unified runner)
  fixtures/        - Example intake files (no PII)
  out/             - Output directory (gitignored)
```

## Scope Boundaries

**IN SCOPE:**
- Triage IRS notices and recommend next steps
- Calculate installment agreement eligibility
- Identify cost segregation opportunities
- Generate structured prep handoff packages

**OUT OF SCOPE:**
- Filing tax returns or IRS forms
- Representing users before IRS
- Legal opinions or tax law interpretation
- Storing sensitive PII beyond evidence requirements

## Integration with OpenClaw Gates

The Tax Pod follows the same fail-closed patterns:
- Clean tree enforcement (tax/, docs/, proofs/ allowlist)
- Drift detection for policy/schema changes
- Budget enforcement for computation limits
- Capability matrix for tool/model restrictions
- **Delivery gate validation** (Port P9) - fail-closed output validation before writing

## Unified Runner (Port P9)

**The canonical way to run Tax Pod agents** is via the unified runner with standardized outputs and delivery gate validation.

### How to Run

```bash
# Payment Plan First
node tax/cli/run_agent.js --agent payment_plan_first --in tax/fixtures/installment_agreement_example_1.json --out tax/out

# IRS Notice Triage
node tax/cli/run_agent.js --agent irs_notice_triage --in tax/fixtures/irs_notice_example_1.json --out tax/out

# Cost Segregation Support
node tax/cli/run_agent.js --agent cost_seg_support --in tax/fixtures/cost_seg_example_1.json --out tax/out
```

### Standardized Output Contract

All agents produce outputs conforming to [tax/contracts/output_contract.md](contracts/output_contract.md):

```
tax/out/<caseId>/
  response.md       # Human-readable markdown (required sections: Summary, Assumptions, Disclaimer)
  evidence.json     # Evidence record (schema-validated)
  artifacts/        # Optional artifacts (e.g., CSV templates)
    *.csv
```

### Delivery Gate (Fail-Closed)

The unified runner validates outputs BEFORE writing to disk:

- ✅ Response includes "Assumptions" section
- ✅ Response includes "Disclaimer" section
- ✅ Response includes "IRS Sources" OR "Missing sources" note
- ✅ Evidence record conforms to schema (case_id, timestamp, agent_id, etc.)
- ✅ Evidence sources array has ≥ 2 sources (minimum: internal policies)
- ✅ Evidence assumptions, risks, next_questions are non-empty arrays

**On validation failure:** Exit code 1, outputs NOT written, reasons printed.

**On validation pass:** Outputs written to standardized paths, exit code 0.

### Legacy CLIs

The following CLIs remain available but are considered legacy:

- `tax/cli/run_payment_plan_first.js`
- `tax/cli/run_irs_notice_triage.js`
- `tax/cli/run_cost_seg_support.js`

**Recommendation:** Use the unified runner (`run_agent.js`) for all new work.

## Audit Events (Port P10)

**Every successful agent run emits an append-only audit event** to `tax/events/events.jsonl`.

### What's Recorded

Each event line contains:
- **Timestamp** (ISO 8601 UTC)
- **Case ID** (deterministic identifier)
- **Agent key** (payment_plan_first | irs_notice_triage | cost_seg_support)
- **Input hash** (SHA256 of normalized intake JSON)
- **Output hashes** (SHA256 of response.md, evidence.json, artifacts)
- **Sources count** (number of sources cited)
- **Delivery gate status** (pass/fail)

**NO PII:** Events contain only hashes, paths, and counts. No raw intake or response text.

### Deterministic Events (for testing/proofs)

Use `--now-utc` flag for reproducible timestamps:

```bash
node tax/cli/run_agent.js --agent payment_plan_first \
  --in tax/fixtures/installment_agreement_example_1.json \
  --out tax/out \
  --now-utc "2026-03-04T00:00:00Z"
```

Without `--now-utc`, the timestamp is set to current UTC time (non-deterministic).

### Querying Events

```bash
# Count total runs
wc -l tax/events/events.jsonl

# View recent runs
tail -10 tax/events/events.jsonl | jq .

# Filter by agent
grep '"agent_key":"payment_plan_first"' tax/events/events.jsonl | jq .
```

See [tax/events/README.md](events/README.md) for full documentation.

## Runtime (Port P5 — Fixture Mode)

**Payment Plan First** runtime is now available in fixture mode (no network, local vault only).

### How to Run

```bash
# Run Payment Plan First analysis
node tax/cli/run_payment_plan_first.js --in tax/fixtures/installment_agreement_example_1.json --out tax/out

# Output files (deterministic):
# tax/out/<caseId>/response.md    - Markdown response
# tax/out/<caseId>/evidence.json  - Evidence record
```

### Fixtures Available

- `tax/fixtures/installment_agreement_example_1.json` - Streamlined IA scenario (balance $25k-$50k)
- `tax/fixtures/installment_agreement_example_2.json` - Complex scenario (balance over $50k, hardship)

## Vault (Port P6)

The Tax Pod includes a local vault of IRS sources for citation and reference.

### Vault Location

`tax/vault/` - Local-only IRS source vault (no network access)

### Vault Structure

```
tax/vault/
  index.json        - Vault catalog with source metadata
  raw/              - Raw source documents (HTML, PDF)
    irm-5.14.1/     - IRM 5.14.1 (Installment Agreements)
    irm-20.1.1/     - IRM 20.1.1 (Penalty Relief)
    form-656/       - Form 656 (Offer in Compromise)
    cfs-national/   - Collection Financial Standards
  extracts/         - Text extracts (future)
```

### Sources Available

- **IRM 5.14.1** — Securing Installment Agreements (HTML)
- **IRM 20.1.1** — Introduction and Penalty Relief (HTML)
- **Form 656** — Offer in Compromise (PDF)
- **CFS National** — Collection Financial Standards (HTML)

### Missing Sources

The following sources are referenced in code but not yet in the vault:

- **IRS Pub 594** — The IRS Collection Process
- **Form 9465** — Installment Agreement Request

These will be added in a future port.

### How Citations Work

1. CLI loads `tax/vault/index.json` at runtime
2. Analysis functions build citations from vault metadata (no parsing)
3. Citations appear in:
   - `response.md` (IRS Sources section)
   - `evidence.json` (sources array with type `irs_source`)

### Limitations (Fixture Mode)

- **No network calls:** Pure deterministic functions, local vault only
- **No content parsing:** Citations are metadata-only (title + identifier + locator)
- **Fixture timestamps:** Uses `_fixture_timestamp` from intake for determinism

## IRS Notice Triage (Port P7)

**IRS Notice Triage** runtime is now available in fixture mode (local vault, no network).

### How to Run

```bash
# Run IRS Notice Triage analysis
node tax/cli/run_irs_notice_triage.js --in tax/fixtures/irs_notice_example_1.json --out tax/out

# Output files (deterministic):
# tax/out/<caseId>/notice_response.md   - Triage response
# tax/out/<caseId>/notice_evidence.json - Evidence record
```

### Fixtures Available

- `tax/fixtures/irs_notice_example_1.json` - CP14 balance due notice (deadline present)
- `tax/fixtures/irs_notice_example_2.json` - LT11 intent to levy (critical urgency)

### What It Analyzes

1. **Notice classification** (balance due, levy, lien, audit, etc.)
2. **Urgency level** (low/medium/high/critical based on keywords and deadline)
3. **Immediate next steps** (first 72 hours action checklist)
4. **Documents to gather** (for professional consultation)
5. **Options to consider** (payment plans, OIC, CNC, penalty abatement, CDP hearing)
6. **What NOT to do** (avoid common mistakes)
7. **Questions for professionals** (EA/CPA/tax attorney)
8. **Handoff pack checklist** (complete documentation for representation)

## Cost Seg Support (Port P8)

**Cost Segregation Support** runtime is now available in fixture mode (local vault, no network).

### How to Run

```bash
# Run Cost Seg Support analysis
node tax/cli/run_cost_seg_support.js --in tax/fixtures/cost_seg_example_1.json --out tax/out

# Output files (deterministic):
# tax/out/<caseId>/costseg_response.md                    - Analysis response
# tax/out/<caseId>/costseg_evidence.json                  - Evidence record
# tax/out/<caseId>/costseg_asset_inventory_template.csv   - CSV template for CPA/engineer
```

### Fixtures Available

- `tax/fixtures/cost_seg_example_1.json` - Short-term rental SFH with substantial rehab
- `tax/fixtures/cost_seg_example_2.json` - Large multi-unit with extensive improvements

### What It Analyzes

1. **Go/No-Go recommendation** (based on property value and characteristics)
2. **Eligibility flags** (placed in service year, business use, short-term rental status)
3. **Estimated upside** (rough first-year depreciation boost and tax savings, WITH WARNINGS)
4. **Documents to gather** (purchase agreement, invoices, contractor statements, appraisals)
5. **Asset inventory instructions** (how to use the CSV template for handoff)
6. **Questions for CPA** (bonus depreciation, timing, QIP reclassification, ROI)
7. **Risks and disclaimers** ("THIS IS NOT A COST SEGREGATION STUDY")

### Next Steps (Port P9+)

1. Add MACRS rules and Cost Seg ATG to vault
2. Add gate checks before outputs
3. Integrate with OpenClaw event emission
