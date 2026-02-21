# PaymentPlanBundleV1 — Contract Specification

**Version:** 1.0.0
**Created:** 2026-02-21
**Status:** Active

## Purpose
Deterministic, frozen bundle of tax case data for IRS payment plan preparation. Produced from TaxVault index + facts ledger. No network calls, no external dependencies.

## Folder Layout
```
<OUT_ROOT>/<CASE_ID>/<EXPORT_UTC>/payment_plan_bundle_v1/
  ├── liability_snapshot.json
  ├── transcripts_manifest.json
  ├── notices_manifest.json
  ├── supporting_docs_index.json
  ├── citations.json
  └── bundle_manifest.json
```

## File Definitions

### liability_snapshot.json
Per-year tax liability data extracted from the facts ledger.
- `case_id` — case identifier
- `tax_years[]` — array of year records (year, tax_owed, penalty, interest, total_liability, filing_status, agi, wages, withholding, flags, sources)
- `generated_utc` — export timestamp
- `vault_version` — TaxVault-Tools version

### transcripts_manifest.json
IRS transcript documents found in the index.
- `case_id` — case identifier
- `transcripts[]` — array of doc objects (id, name, year_hint, path, sha256, size_bytes, modified_utc, doc_type)

### notices_manifest.json
IRS notice documents (CP2000, CP504, etc.) found in the index.
- `case_id` — case identifier
- `notices[]` — array of doc objects

### supporting_docs_index.json
All other active documents (W-2s, 1099s, receipts, etc.).
- `case_id` — case identifier
- `documents[]` — array of doc objects

### citations.json
Legal citations (reserved for future use).
- `case_id` — case identifier
- `citations[]` — empty array (placeholder)

### bundle_manifest.json
Integrity manifest written LAST. Contains sha256 hashes of all other files.
- `bundle_version` — "payment_plan_bundle_v1"
- `case_id` — case identifier
- `export_utc` — export timestamp
- `vault_version` — TaxVault-Tools version
- `files{}` — map of filename → sha256 hash

## Document Classification Rules
1. Name contains "transcript" → transcripts
2. Name contains "notice", "cp2000", or "cp504" → notices
3. All other active entries → supporting docs

## Determinism Rules
- JSON: `JSON.stringify(obj, null, 2) + "\n"`
- File write order: sorted alphabetically by filename
- Document sort: by year_hint ascending, then name ascending
- bundle_manifest.json written LAST (after all hashes computed)
- Atomic write: temp dir → rename to final path

## Fail-Closed Rules
- Missing index → exit 1
- Missing ledger → exit 1
- Hash computation failure → exit 2
- Output already exists → exit 3
- Missing --case → exit 1
- No partial bundles: cleanup temp dir on any failure

## Exit Codes
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Input error (missing files, missing args) |
| 2 | Hash computation failure |
| 3 | Output directory already exists |
