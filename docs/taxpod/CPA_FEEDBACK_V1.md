# CPA Feedback V1 — Contract Specification

**Version:** 1.0.0
**Created:** 2026-02-22
**Status:** Draft (spec only — no runtime implementation yet)
**Depends on:** CpaPackageV1 (PORT3)
**Produces:** ChangeSetV1 (structured change request)

> **Disclaimer:** This system is a CPA review notes / planning tool. It does not provide legal or tax advice. All changes proposed by a ChangeSet must be reviewed and approved by a licensed CPA, Enrolled Agent, or tax attorney before application.

## Purpose

After PORT3 produces a CPA handoff package, a CPA or Enrolled Agent reviews it and provides feedback: corrections, missing documents, disputes, or notes. PORT4 ingests that feedback and converts it into a structured, auditable **ChangeSet** — a list of proposed changes that *could* be applied to upstream TaxPod artifacts in the future.

PORT4 **never writes to artifacts directly**. It only produces a ChangeSet document.

## Targeted Artifacts

PORT4 feedback can reference these upstream artifacts:

| Artifact | Source PORT | Key Fields |
|----------|------------|------------|
| `liability_snapshot.json` | PORT0 | `tax_years[].tax_owed`, `penalty`, `interest`, `total_liability`, `flags` |
| `payment_plan_model.json` | PORT1 | `monthly_capacity.*`, `risk_flags`, `assumptions` |
| `strategy_recommendation.json` | PORT2 | `strategy.type`, `strategy.recommended_monthly_payment`, `risk_flags` |
| CPA Package (manifest, cover sheet) | PORT3 | `manifest.json`, `00_COVER_SHEET.md` |

---

## Input Format: FeedbackV1

### Supported Input Modes

1. **Structured JSON** (preferred) — machine-parseable, validated against schema
2. **Human notes markdown** (allowed) — must be normalized to FeedbackV1 JSON before processing

The remainder of this spec defines the **Structured JSON** format. Markdown normalization is a future concern and is NOT in scope for V1.

### FeedbackV1 JSON Fields

```
{
  "version":                   "FeedbackV1" (const),
  "feedback_id":               "<case_id>_fb_<received_utc>" (deterministic),
  "case_id":                   string (required),
  "source":                    enum: CPA | EA | ATTORNEY | INTERNAL_REVIEW,
  "received_utc":              ISO-like UTC string (e.g., 20260222T120000Z),
  "package_manifest_sha256":   hex string — SHA-256 of the reviewed package's manifest.json,
  "items": [
    {
      "item_id":               string (unique within this feedback, e.g., "item_001"),
      "type":                  enum (see Feedback Item Types below),
      "target": {
        "artifact":            enum: LIABILITY_SNAPSHOT | PAYMENT_MODEL | STRATEGY | PACKAGE,
        "path":                JSONPath-like string (optional, e.g., "tax_years[year=2021].interest"),
        "year":                number (optional, for year-specific corrections),
        "doc_id":              string (optional, for document-specific feedback)
      },
      "proposed_change":       object (schema depends on type — see below),
      "evidence": {
        "notes":               string (CPA explanation),
        "attachments":         [string] (filenames or doc IDs — no raw blobs),
        "confidence":          enum: HIGH | MED | LOW
      },
      "requires_human_approval": boolean (default: true)
    }
  ]
}
```

### Feedback Item Types

| Type | When Used | Target Artifact |
|------|-----------|-----------------|
| `LIABILITY_CORRECTION` | CPA corrects a tax amount, penalty, or interest | `LIABILITY_SNAPSHOT` |
| `MISSING_DOC` | CPA identifies a document that should be in the package | `PACKAGE` |
| `DOC_CLASSIFICATION_FIX` | CPA says a doc is misclassified (e.g., notice vs transcript) | `PACKAGE` |
| `PAYMENT_CAPACITY_ASSUMPTION_FIX` | CPA adjusts income/expense assumptions | `PAYMENT_MODEL` |
| `STRATEGY_OVERRIDE_NOTE` | CPA recommends a different strategy or adds a caveat | `STRATEGY` |
| `DISPUTE_OR_UNCERTAIN` | CPA flags something as unverified or disputed | Any artifact |

### Proposed Change Schemas (by type)

**LIABILITY_CORRECTION:**
```
{
  "field":      "interest | penalty | tax_owed | total_liability | agi | wages | withholding",
  "old_value":  number (current value — for drift detection),
  "new_value":  number (corrected value)
}
```

**MISSING_DOC:**
```
{
  "doc_type":   "transcript | notice | supporting",
  "doc_name":   string (expected document name),
  "year_hint":  string (tax year),
  "reason":     string (why it is needed)
}
```

**DOC_CLASSIFICATION_FIX:**
```
{
  "doc_id":                   string (existing doc reference),
  "current_classification":   "transcript | notice | supporting",
  "correct_classification":   "transcript | notice | supporting"
}
```

**PAYMENT_CAPACITY_ASSUMPTION_FIX:**
```
{
  "field":      "net_income_monthly | essential_expenses_monthly | debt_payments_monthly",
  "old_value":  number,
  "new_value":  number,
  "reason":     string
}
```

**STRATEGY_OVERRIDE_NOTE:**
```
{
  "current_strategy":     string (current strategy type),
  "recommended_strategy": string | null (CPA recommended, or null if just a note),
  "note":                 string (CPA explanation)
}
```

**DISPUTE_OR_UNCERTAIN:**
```
{
  "flag":        "NEEDS_VERIFICATION | DISPUTED_AMOUNT | MISSING_FILING | POSSIBLE_ERROR",
  "description": string
}
```

---

## Output Format: ChangeSetV1

PORT4 converts FeedbackV1 items into a ChangeSet — a list of proposed actions against upstream artifacts.

### ChangeSetV1 JSON Fields

```
{
  "version":                   "ChangeSetV1" (const),
  "changeset_id":              "<case_id>_cs_<created_utc>" (deterministic),
  "case_id":                   string,
  "created_utc":               ISO-like UTC string,
  "source_feedback_id":        string (links back to the FeedbackV1),
  "package_manifest_sha256":   string (must match the feedback),
  "actions": [
    {
      "action_id":             string (unique within changeset, e.g., "act_001"),
      "source_item_id":        string (links back to feedback item_id),
      "action_type":           enum (see Action Types below),
      "target": {
        "artifact":            enum: LIABILITY_SNAPSHOT | PAYMENT_MODEL | STRATEGY | PACKAGE,
        "path":                RFC6902-style JSON pointer (required for PATCH_JSON),
        "year":                number (optional),
        "doc_id":              string (optional)
      },
      "patch": {
        "op":                  "replace | add | remove",
        "path":                RFC6902-style JSON pointer (e.g., "/tax_years/0/interest"),
        "value":               any (the new value),
        "old_value":           any (expected current value — for drift detection)
      },
      "reason":                string (human-readable explanation),
      "requires_human_approval": true
    }
  ],
  "derived_impacts": [
    "sorted list of: REQUIRE_REEXPORT_BUNDLE | REQUIRE_RERUN_PORT1 | REQUIRE_RERUN_PORT2 | REQUIRE_REBUILD_PORT3"
  ],
  "audit": {
    "input_feedback_sha256":   "SHA-256 of the FeedbackV1 JSON input (deterministic formatting)",
    "changeset_sha256":        "SHA-256 of this ChangeSet (computed with this field set to empty string)"
  }
}
```

### Action Types

| Action Type | Effect | Triggers |
|-------------|--------|----------|
| `PATCH_JSON` | Proposes a value change to a JSON field | Depends on target artifact |
| `ADD_FLAG` | Adds a risk or status flag to an artifact | Depends on target |
| `REMOVE_FLAG` | Removes a flag from an artifact | Depends on target |
| `ADD_DOC_REFERENCE` | Adds a new document reference to the bundle | `REQUIRE_REEXPORT_BUNDLE` |
| `RECLASSIFY_DOC` | Moves a doc between transcript/notice/supporting | `REQUIRE_REEXPORT_BUNDLE` |
| `REQUIRE_REEXPORT_BUNDLE` | Signals PORT0 bundle needs re-export | `REQUIRE_REBUILD_PORT3` |
| `REQUIRE_RERUN_PORT1` | Signals PORT1 model needs rerun | `REQUIRE_RERUN_PORT2`, `REQUIRE_REBUILD_PORT3` |
| `REQUIRE_RERUN_PORT2` | Signals PORT2 strategy needs rerun | `REQUIRE_REBUILD_PORT3` |
| `REQUIRE_REBUILD_PORT3` | Signals PORT3 package needs rebuild | — |

### Cascade Rules

Changes cascade downstream automatically. The `derived_impacts` array is computed by following these rules:

```
LIABILITY_SNAPSHOT change
  → REQUIRE_RERUN_PORT2 → REQUIRE_REBUILD_PORT3

PAYMENT_MODEL change
  → REQUIRE_RERUN_PORT2 → REQUIRE_REBUILD_PORT3

STRATEGY change
  → REQUIRE_REBUILD_PORT3

BUNDLE change (doc added/reclassified)
  → REQUIRE_REEXPORT_BUNDLE → REQUIRE_REBUILD_PORT3
```

If a `REQUIRE_RERUN_PORT1` is added (capacity assumption change), it also triggers:
```
REQUIRE_RERUN_PORT1 → REQUIRE_RERUN_PORT2 → REQUIRE_REBUILD_PORT3
```

---

## Fail-Closed Rules

PORT4 MUST reject feedback and produce **no ChangeSet** if:

1. `package_manifest_sha256` is missing or empty
2. `package_manifest_sha256` does not match any known package build for this case
3. `case_id` is missing or does not match any known case
4. Any feedback item references an unknown artifact type
5. Any `PATCH_JSON` action has an invalid or empty path
6. Any action would **delete data** (op=remove on a required field) without explicit `allow_destructive: true` AND `requires_human_approval: true`
7. Any `old_value` in a PATCH_JSON does not match the current artifact value (drift detection)
8. `items` array is empty (no-op feedback rejected)
9. Any `item_id` is duplicated within the feedback

On rejection, PORT4 MUST:
- Exit with non-zero code
- Emit a structured error to stderr with reason
- Create **no output files**
- Leave no partial state

---

## Determinism Rules

1. Feedback items sorted by `item_id` (lexicographic) before processing
2. ChangeSet actions sorted by `action_id` (lexicographic)
3. `derived_impacts` sorted alphabetically
4. All JSON output: `JSON.stringify(obj, null, 2) + "\n"` (consistent with PORT0-PORT3)
5. Notes whitespace normalized: trim leading/trailing, collapse multiple internal spaces to single space
6. Timestamps injected by caller via `--received-utc` and `--created-utc` CLI args — **never generated internally**
7. `feedback_id` = `<case_id>_fb_<received_utc>` (no random components)
8. `changeset_id` = `<case_id>_cs_<created_utc>` (no random components)
9. Same FeedbackV1 input + same CLI timestamps → identical ChangeSetV1 output, byte-for-byte

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | ChangeSet produced successfully |
| 1 | Input validation error (missing fields, bad schema) |
| 2 | Drift detection failure (old_value mismatch) |
| 3 | Output already exists (without --force) |
| 4 | Package manifest SHA mismatch |

---

## CLI Interface (future implementation)

```
node build_changeset_v1.js \
  --case <CASE_ID> \
  --feedback <PATH_TO_feedback.json> \
  --package-dir <PATH_TO_cpa_package_v1/> \
  --out-root <OUTPUT_ROOT> \
  --created-utc <UTC> \
  [--force]
```

Output path: `<out_root>/<CASE_ID>/<UTC>/changeset_v1/changeset.json`

---

## Security and Compliance Notes

- No PII in feedback IDs or changeset IDs
- Attachment references are filenames only — no raw file content embedded
- All actions default to `requires_human_approval: true`
- The ChangeSet is a **proposal**, not an execution — no artifact is modified by PORT4
- This system is a CPA review notes / planning tool, not legal advice
- All feedback and changeset documents are append-only audit artifacts

---

*Version: CPA_FEEDBACK_V1 | Status: Draft | Created: 2026-02-22*
