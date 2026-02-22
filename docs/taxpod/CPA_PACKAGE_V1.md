# CPA Package V1 — Contract Specification

**Version:** 1.0.0
**Created:** 2026-02-22
**Status:** Active
**Depends on:** PaymentPlanBundleV1 (PORT0), PaymentPlanModelV1 (PORT1), StrategyRecommendationV1 (PORT2)

## Purpose
Assemble a deterministic CPA handoff package from frozen PORT0/PORT1/PORT2 outputs. The package is a self-contained folder that a CPA or Enrolled Agent can review without needing access to the tax vault or any other system.

## Output Layout

```
<out_root>/<CASE_ID>/<UTC>/cpa_package_v1/
├── 00_COVER_SHEET.md
├── 01_LIABILITY_SNAPSHOT.json
├── 02_PAYMENT_PLAN_MODEL.json
├── 03_STRATEGY_RECOMMENDATION.json
├── 03_STRATEGY_RECOMMENDATION.md
├── 04_TRANSCRIPTS/
│   └── <ID>__REFERENCE.json  (one per transcript entry)
├── 05_NOTICES/
│   └── <ID>__REFERENCE.json  (one per notice entry)
├── 06_DOCUMENT_CHECKLIST.md
├── 99_SUPPORTING_DOCS_INDEX.json
└── manifest.json
```

## Inputs

### Required
| Input | Source | Description |
|-------|--------|-------------|
| Bundle directory | PORT0 | Contains `liability_snapshot.json`, `transcripts_manifest.json`, `notices_manifest.json`, `supporting_docs_index.json` |
| Payment plan model | PORT1 | `payment_plan_model.json` |
| Financial docs checklist | PORT1 | `financial_docs_needed.md` |
| Strategy recommendation | PORT2 | `strategy_recommendation.json` |
| Strategy report | PORT2 | `payment_plan_recommendation.md` |

## File Descriptions

### 00_COVER_SHEET.md
Deterministic markdown cover page. Stable template with no variable wording.

Sections:
1. Title and case ID
2. Package metadata (UTC, version)
3. Strategy summary table (type, monthly payment, months, liability, capacity)
4. Escalation reasons (if CPA_ESCALATION_REQUIRED)
5. File inventory counts (transcripts, notices, supporting docs)
6. Disclaimer

### 01_LIABILITY_SNAPSHOT.json
Copied unchanged from bundle `liability_snapshot.json`.

### 02_PAYMENT_PLAN_MODEL.json
Copied unchanged from PORT1 `payment_plan_model.json`.

### 03_STRATEGY_RECOMMENDATION.json
Copied unchanged from PORT2 `strategy_recommendation.json`.

### 03_STRATEGY_RECOMMENDATION.md
Copied unchanged from PORT2 `payment_plan_recommendation.md`.

### 04_TRANSCRIPTS/
One reference stub per transcript entry from `transcripts_manifest.json`.

Filename: `<id>__REFERENCE.json`

Content:
```json
{
  "id": "<id>",
  "name": "<name>",
  "year_hint": "<year_hint>",
  "sha256": "<sha256>",
  "source_path": "<path>",
  "doc_type": "transcript",
  "notes": "Reference stub. Original document available in tax vault."
}
```

### 05_NOTICES/
Same policy as transcripts. One reference stub per notice entry.

Filename: `<id>__REFERENCE.json`

### 06_DOCUMENT_CHECKLIST.md
Copied unchanged from PORT1 `financial_docs_needed.md`.

### 99_SUPPORTING_DOCS_INDEX.json
Copied unchanged from bundle `supporting_docs_index.json`.

### manifest.json
```json
{
  "version": "CpaPackageV1",
  "case_id": "<CASE_ID>",
  "package_utc": "<UTC>",
  "source_bundle_path": "<BUNDLE_PATH>",
  "files": [
    {
      "path": "<relative_path>",
      "sha256": "<hash>"
    }
  ]
}
```
- Files listed in stable sorted order by path
- sha256 computed on final file content
- Generated last, after all other files are written

## Determinism Rules
- All JSON: `JSON.stringify(obj, null, 2) + '\n'`
- All file lists: sorted by `id` (transcripts/notices) or by `path` (manifest)
- Cover sheet: stable template, no variable wording, no timestamps beyond package_utc
- Reference stubs: sorted by id, deterministic JSON formatting

## Fail-closed Rules
- Missing any required input → exit 1
- Missing required JSON fields (e.g., `transcripts_manifest.json` missing `transcripts` array) → exit 1
- NaN or undefined in computed values → exit 2
- Output directory already exists → exit 3 (unless `--force`)
- Partial output on failure → cleaned up (atomic write via temp dir + rename)

## Exit Codes
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Input error (missing file, invalid schema) |
| 2 | Computation error |
| 3 | Output already exists |

## Reference Stub Policy
Source PDFs are never copied into the package or the git repo. Instead, each transcript and notice is represented by a deterministic JSON reference stub containing the original file's id, name, sha256, and source path. This keeps the package portable and avoids sensitive document proliferation.

## Disclaimer
All outputs include: "This package is for CPA/EA review only. Not legal advice. Confirm all figures before acting."
