# Proof Pack: TaxPod PORT4 Spec — CPA Feedback V1

**Created:** 2026-02-22T055533Z
**Author:** Claude Code (Opus 4.6)
**Branch:** `taxpod/port4-spec-cpa-feedback-v1`
**Base:** `main` at `c2ad3dc`
**Repo:** `LucraLab/openclaw-control`
**Type:** Spec/design only — no runtime code

---

## Deliverables

### Spec Documents (2)

| File | VPS Path | SHA-256 |
|------|----------|---------|
| CPA_FEEDBACK_V1.md | `docs/taxpod/CPA_FEEDBACK_V1.md` | `6512c8c6f8675b54833819b89016e52d71d06bfe722777a1a3f3aab1905890d0` |
| PORT4_PIPELINE.md | `docs/taxpod/PORT4_PIPELINE.md` | `d0ce19a4e4e066ece31b78700d45573eb05901b566cfeea407ffab002f98c941` |

### JSON Schemas (2)

| File | VPS Path | SHA-256 |
|------|----------|---------|
| feedback_v1.schema.json | `docs/taxpod/schemas/feedback_v1.schema.json` | `5b5fc3ee34939dcb2aa2d99441b5a061d1e16788baf47bbab16e86985b983017` |
| changeset_v1.schema.json | `docs/taxpod/schemas/changeset_v1.schema.json` | `ca65eaccdf6986735992b9eb0bdc24aa55a4a4ece1820db8bfb991b7f224f756` |

### Fixtures (3 cases × 3 files = 9 files)

#### A) case_correction_liability

| File | SHA-256 |
|------|---------|
| `input_feedback.json` | `19fd2b584a4e0943d147dcd7d24fa823cafe7f29c32a11fe72fc1945766be3b4` |
| `expected_changeset.json` | `143326654086e57736f6c41b2b52217cbc4c11cadc5dff090d448903c4edde9e` |
| `notes.md` | `09eb616d79b958a9a229c4cfd923bfae50670e554ab79e9fb08969b36606f19d` |

VPS path prefix: `ops/taxpod/fixtures/port4_feedback/case_correction_liability/`

**Scenario:** CPA corrects interest ($250 → $475) and total liability ($5,650 → $5,875) for TY2022.
**Actions:** 2× PATCH_JSON + REQUIRE_RERUN_PORT2 + REQUIRE_REBUILD_PORT3

#### B) case_enrichment_missing_doc

| File | SHA-256 |
|------|---------|
| `input_feedback.json` | `7bd592094a03a499fa18389109b7adc32c03c40d32b53581cf05d554d7825e0b` |
| `expected_changeset.json` | `15f9ebb65fb0b1b8e582f8a1855c0ed6a324afb83cf67a3dd35112723d40652e` |
| `notes.md` | `2c62ccdbaa1979fbe9ee56dc4d605cd46bd8bf9285128ddaf40a75ff1e4a2a84` |

VPS path prefix: `ops/taxpod/fixtures/port4_feedback/case_enrichment_missing_doc/`

**Scenario:** CPA requests 2021 IRS transcript and CP2000 response letter.
**Actions:** 2× ADD_DOC_REFERENCE + REQUIRE_REEXPORT_BUNDLE + REQUIRE_REBUILD_PORT3

#### C) case_dispute_uncertain

| File | SHA-256 |
|------|---------|
| `input_feedback.json` | `e48256f43bed5b10e1d45f5e933b46002ab785e3fed5e6ae828ce635d6156af7` |
| `expected_changeset.json` | `7dc0c1613bc2b8535a0f8ddef697cb0534ff9d5b256d2d955600ef74128dfca5` |
| `notes.md` | `52161d6e4914ebf0d79acf675f811fb480a62498b370961a6de01781e9e62771` |

VPS path prefix: `ops/taxpod/fixtures/port4_feedback/case_dispute_uncertain/`

**Scenario:** CPA flags uncertainty about 2020 filing status. Needs verification before strategy.
**Actions:** ADD_FLAG (NEEDS_VERIFICATION) + REQUIRE_REEXPORT_BUNDLE. No numeric patches.

---

## Spec Coverage Summary

### CPA_FEEDBACK_V1.md covers:

- **6 feedback item types:** LIABILITY_CORRECTION, MISSING_DOC, DOC_CLASSIFICATION_FIX, PAYMENT_CAPACITY_ASSUMPTION_FIX, STRATEGY_OVERRIDE_NOTE, DISPUTE_OR_UNCERTAIN
- **8 action types:** PATCH_JSON, ADD_FLAG, REMOVE_FLAG, ADD_DOC_REFERENCE, RECLASSIFY_DOC, REQUIRE_REEXPORT_BUNDLE, REQUIRE_RERUN_PORT1, REQUIRE_RERUN_PORT2, REQUIRE_REBUILD_PORT3
- **9 fail-closed conditions** (missing SHA, bad case_id, drift detection, etc.)
- **9 determinism rules** (sorted keys, stable IDs, injectable timestamps)
- **5 exit codes** (0-4)
- **Cascade rules** (LIABILITY → PORT2 → PORT3, BUNDLE → REEXPORT → PORT3)

### PORT4_PIPELINE.md covers:

- **8-stage pipeline:** Intake → Normalize → Validate → Transform → Human Gate → Apply → Regenerate → Audit
- **14 validation checks** (V1-V14)
- **Mapping table:** feedback type → generated action types
- **Integration points** with PORT0-PORT3
- **V1 scope limitations** (stops at changeset output, no apply/regenerate)

### Fixtures exercise 3 of 6 feedback types:

| Feedback Type | Fixture | Action Types Generated |
|---------------|---------|----------------------|
| LIABILITY_CORRECTION | case_correction_liability | PATCH_JSON, REQUIRE_RERUN_PORT2, REQUIRE_REBUILD_PORT3 |
| MISSING_DOC | case_enrichment_missing_doc | ADD_DOC_REFERENCE, REQUIRE_REEXPORT_BUNDLE, REQUIRE_REBUILD_PORT3 |
| DISPUTE_OR_UNCERTAIN | case_dispute_uncertain | ADD_FLAG, REQUIRE_REEXPORT_BUNDLE |

### JSON Schemas validate:

- FeedbackV1 envelope (all required fields, patterns, enums)
- ChangeSetV1 envelope (all required fields, patterns, enums)
- Action subtypes (Patch, Flag, Target)
- Audit block structure

---

## Pre-existing Tests (Regression)

PORT4 is spec-only, so no new test runner was created. Existing PORT0-PORT3 tests confirmed passing before branch creation:

```
PORT0 (bundle_export)    : 34/34 PASS
PORT1 (payment_model)    : 24/24 PASS
PORT2 (strategy)         : 40/40 PASS
PORT3 (cpa_package)      : 63/63 PASS
TOTAL                    : 161/161 PASS
```

---

## File Manifest

Total deliverables: **14 files** (2 spec docs + 2 schemas + 9 fixture files + 1 proof pack)

```
docs/taxpod/
├── CPA_FEEDBACK_V1.md
├── PORT4_PIPELINE.md
└── schemas/
    ├── feedback_v1.schema.json
    └── changeset_v1.schema.json

ops/taxpod/fixtures/port4_feedback/
├── case_correction_liability/
│   ├── input_feedback.json
│   ├── expected_changeset.json
│   └── notes.md
├── case_enrichment_missing_doc/
│   ├── input_feedback.json
│   ├── expected_changeset.json
│   └── notes.md
└── case_dispute_uncertain/
    ├── input_feedback.json
    ├── expected_changeset.json
    └── notes.md

proofs/taxpod/
└── PROOF_TAXPOD_PORT4_SPEC_2026-02-22T055533Z.md
```

---

## Verification Commands

### Verify SHA-256 on VPS after upload:

```bash
cd /home/openclaw/staging/current
sha256sum docs/taxpod/CPA_FEEDBACK_V1.md
# expect: 6512c8c6f8675b54833819b89016e52d71d06bfe722777a1a3f3aab1905890d0

sha256sum docs/taxpod/PORT4_PIPELINE.md
# expect: d0ce19a4e4e066ece31b78700d45573eb05901b566cfeea407ffab002f98c941

sha256sum docs/taxpod/schemas/feedback_v1.schema.json
# expect: 5b5fc3ee34939dcb2aa2d99441b5a061d1e16788baf47bbab16e86985b983017

sha256sum docs/taxpod/schemas/changeset_v1.schema.json
# expect: ca65eaccdf6986735992b9eb0bdc24aa55a4a4ece1820db8bfb991b7f224f756
```

### Verify fixtures JSON validity:

```bash
for f in ops/taxpod/fixtures/port4_feedback/*/input_feedback.json \
         ops/taxpod/fixtures/port4_feedback/*/expected_changeset.json; do
  python3 -c "import json; json.load(open('$f')); print('OK: $f')"
done
```

---

*Proof generated by Claude Code (Opus 4.6) | 2026-02-22T055533Z*
