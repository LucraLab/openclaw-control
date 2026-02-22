# Apply Door V1 — Operator Runbook

**Version:** 1.0.0
**Created:** 2026-02-22
**Status:** Implementation
**Depends on:** ChangeSetV1 (PORT4 spec, PR #48)
**Script:** `ops/taxpod/apply/apply_changeset_v1.js`

> **This is the ONLY writer.** No other script is authorized to mutate runtime TaxPod artifacts. All writes go through this single entrypoint.

---

## Purpose

The Apply Door takes a validated ChangeSetV1 (produced by PORT4) and atomically applies the proposed changes to runtime artifacts. It enforces:

1. **Human approval gate** — every apply requires a signed approval proof
2. **Allowlist enforcement** — only permitted action types, artifacts, and paths
3. **Drift detection** — old_value must match current artifact value
4. **Atomic writes** — temp file then rename; no partial state on failure
5. **Audit trail** — every apply (or refusal) is logged

---

## CLI Interface

```bash
node ops/taxpod/apply/apply_changeset_v1.js \
  --changeset <path_to_changeset.json> \
  --case <CASE_ID> \
  --approve-proof <path_to_approval.md> \
  --approve-proof-sha256 <hex_digest> \
  --out <receipt_output_dir> \
  [--dry-run] \
  [--runtime-root <path>]
```

### Arguments

| Arg | Required | Default | Description |
|-----|----------|---------|-------------|
| `--changeset` | Yes | — | Path to ChangeSetV1 JSON file |
| `--case` | Yes | — | Case ID (must match changeset.case_id) |
| `--approve-proof` | Yes | — | Path to human approval proof file |
| `--approve-proof-sha256` | Yes | — | SHA-256 hex digest of approval proof |
| `--out` | No | `<runtime_root>/tax_work/<case>/audit/` | Where to write the apply receipt |
| `--dry-run` | No | false | If set: validate everything, produce receipt, but write no changes |
| `--runtime-root` | No | `/home/openclaw/.openclaw` | Override for testing |

---

## Gate Sequence (fail-closed)

The Apply Door processes gates in strict order. The first failure stops all processing.

### Gate 1: Schema Validation
- Parse changeset JSON
- Validate against `changeset_v1.schema.json` structure
- Verify `version === "ChangeSetV1"`
- **Fail → exit 2**

### Gate 2: Case ID Match
- Verify `changeset.case_id === --case`
- **Fail → exit 2**

### Gate 3: Approval Proof
- Verify `--approve-proof` file exists
- Compute SHA-256 of the file
- Verify it matches `--approve-proof-sha256`
- **Fail → exit 3**

### Gate 4: Human Approval Check
- Verify every action has `requires_human_approval: true`
- (V1 requires all actions to be human-approved)
- **Fail → exit 3**

### Gate 5: Action Allowlist
For each action in the changeset:
- Verify `action_type` is in `apply_allowlist.json` allowed list
- Verify target artifact is not refused (e.g., PACKAGE)
- For PATCH_JSON: verify `patch.op` is allowed (replace/add only)
- For PATCH_JSON: verify `target.path` matches at least one allowed prefix
- **Fail → exit 2**

### Gate 6: Destructive Op Check
- If any action has `patch.op === "remove"` → refuse
- **Fail → exit 2**

### Gate 7: Target Resolution + Drift Detection
For each PATCH_JSON action:
- Resolve target artifact to a file path under `<runtime_root>/tax_work/<case>/`
- Verify the file exists
- Read current value at the JSON pointer path
- Compare with `patch.old_value`
- If mismatch → drift detected
- **Fail → exit 2**

### Gate 8: Apply (or dry-run)
- For PATCH_JSON: set value at JSON pointer path
- For ADD_FLAG: append to risk_flags array (deduplicate)
- For REMOVE_FLAG: filter from risk_flags array
- For ADD_DOC_REFERENCE: write reference stub file
- For cascade markers: write `.needs_rerun_<port>` marker file
- All writes to temp files first, then atomic rename
- If `--dry-run`: skip actual writes, produce "would apply" receipt

### Gate 9: Audit
- Write `apply_receipt.json` to `--out` directory
- Append one JSONL line to `<runtime_root>/audit/taxpod_apply.jsonl`

---

## Exit Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | APPLIED | All actions applied successfully (or dry-run completed) |
| 2 | REFUSED_VALIDATION | Schema invalid, disallowed path/action, destructive op, or drift detected |
| 3 | REFUSED_APPROVAL | Missing/invalid approval proof, or missing human approval on actions |
| 4 | INTERNAL_ERROR | Unexpected failure. No partial writes occurred. |

---

## Allowed Artifacts + Paths (V1)

### PAYMENT_MODEL → `models/payment_plan_model.json`
- `/derived/*` — expense/income breakdowns
- `/intake_summary/*` — high-level category totals
- `/liability_summary/tax_years/*` — per-year numeric fields
- `/liability_summary/total_*` — aggregate totals
- `/monthly_capacity/*` — capacity figures
- `/risk_flags` — flag array

### STRATEGY → `strategy/strategy_recommendation.json`
- `/risk_flags` — flag array
- `/assumptions` — assumption list
- `/strategy/why_this_strategy` — strategy reasoning
- `/strategy/why_not_others` — alternatives reasoning
- `/execution/*` — execution details

### LIABILITY_SNAPSHOT → `models/payment_plan_model.json` (liability_summary section)
- `/liability_summary/tax_years/*` — per-year numeric fields
- `/liability_summary/total_*` — aggregate totals

### PACKAGE → **REFUSED**
Package is a PORT3 output. Do not patch — rebuild PORT3.

---

## Apply Receipt Format

```json
{
  "receipt_id": "<sha256 of changeset_id + approve_proof_sha256 + created_utc>",
  "case_id": "string",
  "created_utc": "20260222T120000Z",
  "changeset_id": "string",
  "changeset_sha256": "<sha256 of changeset file>",
  "package_manifest_sha256": "string",
  "approve_proof_sha256": "string",
  "dry_run": false,
  "result": "APPLIED | REFUSED",
  "refusal_reason": "string or null",
  "actions_applied": [
    {
      "action_id": "act_001",
      "action_type": "PATCH_JSON",
      "target_file": "models/payment_plan_model.json",
      "result": "APPLIED"
    }
  ],
  "files": [
    {
      "path": "models/payment_plan_model.json",
      "pre_sha256": "abc...",
      "post_sha256": "def..."
    }
  ]
}
```

---

## Audit JSONL Format

Each apply (success or refusal) appends one line to `taxpod_apply.jsonl`:

```json
{"event":"APPLY","utc":"20260222T120000Z","case_id":"...","changeset_id":"...","result":"APPLIED","receipt_id":"...","dry_run":false}
```

---

## Safety Guarantees

1. **Single writer** — this script is the only authorized mutator
2. **Atomic** — temp files + rename; crash leaves no partial state
3. **Bounded** — writes only under `tax_work/<case>/` and `audit/`
4. **Non-destructive** — V1 refuses all `remove` ops
5. **Auditable** — every apply produces a receipt + JSONL entry
6. **Deterministic** — same inputs → same receipt (modulo --out path)
7. **Approval-gated** — no applies without verified proof file

---

*Version: APPLY_DOOR_V1 | Status: Implementation | Created: 2026-02-22*
