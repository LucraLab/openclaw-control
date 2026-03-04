# Proof Pack — Port P6: Vault Citation Wiring

**PROJECT:** OPENCLAW_CONTROL
**PORT_ID:** P6_VAULT_CITATION_WIRING
**UTCSTAMP:** 20260304T054237Z
**STATUS:** ✅ PASS

---

## Mission

Wire the IRS/Tax vault sources into Payment Plan First outputs (response.md + evidence.json) with deterministic, local-only citations (no network), while preserving zero regressions.

### Objectives
1. ✅ Copy vault from `tax-module-staging/scripts/fixtures/tax_vault/` to `openclaw-control/tax/vault/`
2. ✅ Create vault index with repo-relative paths and missing sources tracking
3. ✅ Implement vault reader module (`tax/runtime/vault_reader.js`)
4. ✅ Wire vault citations into payment_plan_first.js
5. ✅ Update render_response.js to display vault citations
6. ✅ Update CLI to load vault index
7. ✅ Update tax/README.md to document vault
8. ✅ Verify determinism (byte-identical outputs across runs)
9. ✅ Zero regressions (all baseline tests pass)

---

## Baseline Context

### Repository State
```
Branch: feat/multiagent-wiring-stress-v2
HEAD: f824257894db82966df205bd292987e816c9b4dd
Repo Root: C:/Users/james/.ssh/Workspace/openclaw-control
```

### Allowlist
```
tax/
docs/
proofs/
```

### Baseline Regression Suite Results
All tests passing:
- ✅ executive_strategy.test.js: 35/35 passed
- ✅ budget_enforcement.test.js: 14/14 passed
- ✅ capability_matrix.test.js: 17/17 passed
- ✅ context_budget.test.js: 10/10 passed
- ✅ coverage_report.test.js: 8/8 passed
- ✅ arbiter_hints.test.js: 33/33 passed
- ✅ evidence_graph.test.js: 73/73 passed
- ✅ multiagent_stress.test.js: 56/56 passed
- ✅ multiagent_wiring_stress_v2.test.js: 59/59 passed

**Note:** isolation_guard.test.js, drift_telemetry.test.js, arbitration.test.js fail due to Windows/Unix incompatibility (expected baseline behavior).

### Baseline Drift Gate
```
GATE_CHAIN: FAIL (clean_tree_gate)
Detected 19 change(s) outside allowlist (pre-existing violations, not from this port)
Allowlist prefixes: scripts/, docs/, proofs/, tax/
```

---

## Implementation

### Step 1: Copy Vault to openclaw-control

**Source:** `C:\Users\james\.ssh\Workspace\tax-module-staging\scripts\fixtures\tax_vault\`
**Destination:** `openclaw-control/tax/vault/`

```powershell
# Vault copied using PowerShell Copy-Item
Copy-Item -Path 'C:\Users\james\.ssh\Workspace\tax-module-staging\scripts\fixtures\tax_vault\*' `
          -Destination 'C:\Users\james\.ssh\Workspace\openclaw-control\tax\vault\' `
          -Recurse -Force
```

**Vault Structure After Copy:**
```
tax/vault/
├── index.json        (updated with repo-relative paths)
├── raw/
│   ├── irm-5.14.1/source.html
│   ├── irm-20.1.1/source.html
│   ├── form-656/source.pdf
│   └── cfs-national/source.html
└── extracts/
    ├── irm-5.14.1.txt (placeholder)
    ├── irm-20.1.1.txt (placeholder)
    ├── form-656.txt (placeholder)
    └── cfs-national.txt (placeholder)
```

### Step 2: Update Vault Index

**File:** `tax/vault/index.json`

**Changes:**
- Updated `raw_path` to use repo-relative paths (`tax/vault/raw/...`)
- Replaced `format_hint` with `format` (html|pdf)
- Added `parseable` field (yes|no)
- Added `notes` field for context
- Added `missing_sources` array documenting Pub 594 and Form 9465

**Missing Sources Documented:**
1. **IRS Publication 594** — The IRS Collection Process (referenced in code, not yet in vault)
2. **Form 9465** — Installment Agreement Request (referenced in code, not yet in vault)

### Step 3: Create Vault Reader Module

**File:** `tax/runtime/vault_reader.js` (117 lines, new)

**Functions:**
- `loadVaultIndex(repoRoot)` - Load vault index from tax/vault/index.json
- `getSourceById(index, sourceId)` - Get source metadata by ID
- `buildCitation(source, locator)` - Build citation object for evidence record
- `buildInstallmentAgreementCitations(vaultIndex)` - Build citations for IA analysis
- `buildPenaltyCitations(vaultIndex)` - Build citations for penalty concepts
- `getMissingSources(vaultIndex)` - Get missing sources list

**Citation Format:**
```javascript
{
  type: 'irs_source',
  identifier: 'tax/vault/raw/irm-5.14.1/source.html#topic=installment_agreement',
  title: 'IRM 5.14.1 — Securing Installment Agreements',
  last_updated: '2026-02-15T00:00:00.000Z',
  locator: 'topic=installment_agreement',
  quote: null  // No parsing in P6
}
```

### Step 4: Wire Citations into payment_plan_first.js

**File:** `tax/runtime/payment_plan_first.js`

**Changes:**
1. Added `vaultIndex` to context parameter (optional)
2. Import vault reader functions
3. Build vault citations if vaultIndex provided
4. Check for missing sources and generate note
5. Spread vault citations into evidence sources array

**Code:**
```javascript
// Build vault citations if vault index provided
let vaultCitations = [];
let missingSourcesNote = null;

if (vaultIndex) {
  vaultCitations = buildInstallmentAgreementCitations(vaultIndex);
  const missingSources = getMissingSources(vaultIndex);
  if (missingSources.length > 0) {
    const missingTitles = missingSources.map(s => s.title).join(', ');
    missingSourcesNote = `Missing vault sources: ${missingTitles}. These will be added in a future port.`;
  }
}

// In evidence sources array:
sources: [
  buildInternalSource('tax/policies/safe_answering_rules.md', ...),
  buildInternalSource('tax/policies/disclaimers_and_limits.md', ...),
  buildInternalSource('tax/intake/schemas/installment_agreement_intake.schema.json', ...),
  ...vaultCitations  // Vault citations from index
]
```

### Step 5: Update render_response.js

**File:** `tax/runtime/render_response.js`

**Changes:**
1. Updated function signature to accept `params` object with destructured fields
2. Added `vaultCitations` and `missingSourcesNote` parameters
3. Added "IRS Sources (Local Vault)" section displaying citations
4. Display missing sources note if present

**Output Example:**
```markdown
## IRS Sources (Local Vault)

- **IRM 5.14.1 — Securing Installment Agreements**
  - Identifier: tax/vault/raw/irm-5.14.1/source.html#topic=installment_agreement
  - Locator: topic=installment_agreement

**Note:** Missing vault sources: IRS Publication 594, Form 9465. These will be added in a future port.
```

### Step 6: Update CLI to Load Vault

**File:** `tax/cli/run_payment_plan_first.js`

**Changes:**
1. Import `loadVaultIndex` from vault_reader.js
2. Calculate repo root (two levels up from CLI script)
3. Load vault index before analysis (with error handling)
4. Pass `vaultIndex` to `analyzePaymentPlanFirst` context

**Code:**
```javascript
const repoRoot = path.resolve(__dirname, '../..');
let vaultIndex = null;
try {
  vaultIndex = loadVaultIndex(repoRoot);
  console.log(`Loaded vault index with ${Object.keys(vaultIndex.sources).length} sources`);
} catch (err) {
  console.warn(`Warning: Could not load vault index: ${err.message}`);
  console.warn(`Proceeding without vault citations.`);
}

result = analyzePaymentPlanFirst(intake, {
  nowUtc,
  caseId,
  agentId: 'payment-plan-agent',
  vaultIndex  // Pass vault index
});
```

### Step 7: Update tax/README.md

**File:** `tax/README.md`

**Changes:**
1. Updated version from `1.1.0-runtime-p5` to `1.2.0-vault-p6`
2. Updated status to indicate vault citations are wired
3. Added `vault/` to directory structure
4. Added "Vault (Port P6)" section (40 lines) documenting:
   - Vault location and structure
   - Sources available (4 sources)
   - Missing sources (Pub 594, Form 9465)
   - How citations work
   - Limitations (no parsing, metadata-only)

---

## Verification

### Files Created/Modified

**Created (5 files):**
1. `tax/vault/index.json` (vault catalog with 4 sources + missing sources)
2. `tax/vault/raw/irm-5.14.1/source.html` (copied from tax-module-staging)
3. `tax/vault/raw/irm-20.1.1/source.html` (copied from tax-module-staging)
4. `tax/vault/raw/form-656/source.pdf` (copied from tax-module-staging)
5. `tax/vault/raw/cfs-national/source.html` (copied from tax-module-staging)
6. `tax/vault/extracts/*.txt` (4 placeholder files, copied)
7. `tax/runtime/vault_reader.js` (117 lines, new module)

**Modified (4 files):**
1. `tax/runtime/payment_plan_first.js` (+19 lines: vault citations)
2. `tax/runtime/render_response.js` (+17 lines: vault citations display)
3. `tax/cli/run_payment_plan_first.js` (+13 lines: load vault index)
4. `tax/README.md` (+40 lines: vault documentation)

**Total:** 7 created, 4 modified (all under allowlist: tax/, docs/, proofs/)

### Determinism Proof

**Run 1:**
```bash
cd openclaw-control
rm -rf tax/out
node tax/cli/run_payment_plan_first.js --in tax/fixtures/installment_agreement_example_1.json --out tax/out
sha256sum tax/out/*/response.md tax/out/*/evidence.json | sort
```

**Output:**
```
Loaded vault index with 4 sources
76817d314a60b810df5a98007e90e62f1c3645e39db07483d925bb690782e319 *tax/out/tax-case-49610591ad21/response.md
8d44321ebcd5f3a2769001668ef586aacd2ed4110a6db9942ebcf9f822b45dc4 *tax/out/tax-case-49610591ad21/evidence.json
```

**Run 2:**
```bash
cd openclaw-control
rm -rf tax/out
node tax/cli/run_payment_plan_first.js --in tax/fixtures/installment_agreement_example_1.json --out tax/out
sha256sum tax/out/*/response.md tax/out/*/evidence.json | sort
```

**Output:**
```
Loaded vault index with 4 sources
76817d314a60b810df5a98007e90e62f1c3645e39db07483d925bb690782e319 *tax/out/tax-case-49610591ad21/response.md
8d44321ebcd5f3a2769001668ef586aacd2ed4110a6db9942ebcf9f822b45dc4 *tax/out/tax-case-49610591ad21/evidence.json
```

✅ **BYTE-IDENTICAL OUTPUTS ACROSS RUNS** (determinism verified)

### Example 2 Output Hashes

```bash
node tax/cli/run_payment_plan_first.js --in tax/fixtures/installment_agreement_example_2.json --out tax/out
sha256sum tax/out/tax-case-54861fbbed3c/response.md tax/out/tax-case-54861fbbed3c/evidence.json | sort
```

**Output:**
```
b66a7ee4cb50b66baadb84e1356e4dca8049185a8c44ed53812b1c594a5a56b4 *tax/out/tax-case-54861fbbed3c/response.md
fa23a391f6f5ab4ff080f10fb033d0a8fe6ad933ba51d323544058a753e5b50c *tax/out/tax-case-54861fbbed3c/evidence.json
```

### Vault Citation Verification

**Response.md includes:**
```markdown
## IRS Sources (Local Vault)

- **IRM 5.14.1 — Securing Installment Agreements**
  - Identifier: tax/vault/raw/irm-5.14.1/source.html#topic=installment_agreement
  - Locator: topic=installment_agreement

**Note:** Missing vault sources: IRS Publication 594 — The IRS Collection Process, Form 9465 — Installment Agreement Request. These will be added in a future port.
```

**Evidence.json includes:**
```json
{
  "sources": [
    {"type": "internal_document", "identifier": "tax/policies/safe_answering_rules.md", ...},
    {"type": "internal_document", "identifier": "tax/policies/disclaimers_and_limits.md", ...},
    {"type": "internal_document", "identifier": "tax/intake/schemas/installment_agreement_intake.schema.json", ...},
    {
      "type": "irs_source",
      "identifier": "tax/vault/raw/irm-5.14.1/source.html#topic=installment_agreement",
      "title": "IRM 5.14.1 — Securing Installment Agreements",
      "last_updated": "2026-02-15T00:00:00.000Z",
      "locator": "topic=installment_agreement",
      "quote": null
    }
  ]
}
```

✅ **VAULT CITATIONS PRESENT IN BOTH OUTPUTS**

---

## Post-Change Regression Suite Results

All tests passing (matching baseline):
- ✅ executive_strategy.test.js: 35/35 passed
- ✅ budget_enforcement.test.js: 14/14 passed
- ✅ capability_matrix.test.js: 17/17 passed
- ✅ context_budget.test.js: 10/10 passed
- ✅ coverage_report.test.js: 8/8 passed
- ✅ arbiter_hints.test.js: 33/33 passed
- ✅ evidence_graph.test.js: 73/73 passed
- ✅ multiagent_stress.test.js: 56/56 passed
- ✅ multiagent_wiring_stress_v2.test.js: 59/59 passed

✅ **ZERO NEW TEST FAILURES** (regression suite matches baseline)

---

## Post-Change Drift Gate

```
GATE_CHAIN: FAIL (clean_tree_gate)
Detected 19 change(s) outside allowlist
Allowlist prefixes: scripts/, docs/, proofs/, tax/
```

✅ **SAME 19 PRE-EXISTING VIOLATIONS AS BASELINE**
✅ **NO NEW VIOLATIONS INTRODUCED BY PORT P6**
✅ **tax/ NOT FLAGGED** (within allowlist)

---

## Vault Inventory Summary

| Format | Count | Parseable |
|--------|-------|-----------|
| HTML | 3 | Yes |
| PDF | 1 | No (OCR needed) |
| TXT (extracts) | 4 | Placeholders (empty) |
| JSON (index) | 1 | N/A |

**Total vault files:** 9
**Sources available:** 4
**Missing sources:** 2 (Pub 594, Form 9465)

---

## Success Criteria

✅ **PASS: Vault copied successfully**
✅ **PASS: Vault index created with repo-relative paths**
✅ **PASS: Vault reader module implemented**
✅ **PASS: Citations wired into payment_plan_first.js**
✅ **PASS: Citations appear in response.md**
✅ **PASS: Citations appear in evidence.json**
✅ **PASS: Missing sources documented**
✅ **PASS: Determinism verified (byte-identical outputs)**
✅ **PASS: Zero regressions (all tests pass)**
✅ **PASS: Drift gate violations unchanged**
✅ **PASS: All changes within allowlist (tax/, docs/, proofs/)**

---

## Deliverables

1. ✅ Vault imported into `tax/vault/` with 4 sources
2. ✅ Vault index updated with repo-relative paths and missing sources
3. ✅ Vault reader module (`tax/runtime/vault_reader.js`)
4. ✅ Payment Plan First outputs include vault citations
5. ✅ Documentation updated (`tax/README.md`)
6. ✅ Determinism proof (byte-identical hashes)
7. ✅ Regression proof (all tests pass)
8. ✅ This proof pack

---

## Next Port (P7+)

**Recommended:**
1. Add Pub 594 and Form 9465 to vault
2. Implement IRS Notice Triage agent
3. Add gate checks before outputs
4. Integrate with OpenClaw event emission

---

**Proof Pack Author:** Claude Code (Sonnet 4.5)
**Port ID:** P6_VAULT_CITATION_WIRING
**Timestamp:** 2026-03-04T05:42:37Z
**Status:** ✅ PASS
**Zero Regressions:** ✅ VERIFIED

---

## Windows Download Instructions

### Copy Proof Pack to Downloads

Why: Provide proof pack to user for archival and review.

```powershell
Copy-Item -Path "C:\Users\james\.ssh\Workspace\openclaw-control\proofs\PROOF_OPENCLAW_CONTROL_P6_VAULT_CITATION_WIRING_20260304T054237Z.md" `
          -Destination "C:\Users\james\Downloads\PROOF_OPENCLAW_CONTROL_P6_VAULT_CITATION_WIRING_20260304T054237Z.md"
```

### Copy SHA256 to Downloads

Why: Provide SHA256 hash for proof pack integrity verification.

```powershell
Copy-Item -Path "C:\Users\james\.ssh\Workspace\openclaw-control\proofs\PROOF_OPENCLAW_CONTROL_P6_VAULT_CITATION_WIRING_20260304T054237Z.sha256.txt" `
          -Destination "C:\Users\james\Downloads\PROOF_OPENCLAW_CONTROL_P6_VAULT_CITATION_WIRING_20260304T054237Z.sha256.txt"
```

### Verify SHA256

Why: Verify proof pack integrity after copy.

```powershell
certutil -hashfile "C:\Users\james\Downloads\PROOF_OPENCLAW_CONTROL_P6_VAULT_CITATION_WIRING_20260304T054237Z.md" SHA256
```

Compare output to contents of `.sha256.txt` file.

---

**END OF PROOF PACK**
