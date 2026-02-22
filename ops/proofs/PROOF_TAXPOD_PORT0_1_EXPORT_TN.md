# PROOF: TaxPod PORT0.1 — TN Live Export
**Generated:** 2026-02-21T23:48:00Z
**Operator:** Claude (automated)

## Export Summary
- **Case:** mcdonald-family-tn
- **Export UTC:** 20260221T233958Z
- **Vault Version:** 13.2.0
- **Bundle Path:** `/home/openclaw/.openclaw/tax_inputs/bundles/mcdonald-family-tn/20260221T233958Z/payment_plan_bundle_v1`

## TN Coverage
| Category | Count |
|----------|-------|
| Transcripts | 1 |
| Notices | 1 |
| Supporting Docs | 1 |
| Tax Years | 1 |
| Ledger Lines | 1 |

## Input Files
- **Index:** `/tmp/TAXVAULT_INDEX_TN_SLICE_2026-02-21T233931Z.json` (3 active entries: 1 transcript, 1 notice, 1 W-2)
- **Ledger:** `/tmp/real_ledger.jsonl` (real production ledger from Builder2 VPS, 1 seed line)

## File Hashes (from bundle_manifest.json)
| File | SHA-256 |
|------|---------|
| citations.json | `8b2588211d9f1b606fe402e52c6307f970f0c67cbf94e49ec8e8b589eefb63aa` |
| liability_snapshot.json | `d994ffbf387a07cdfa63de9aadefd5db33a56bc89bd7f1883974dd281a05a469` |
| notices_manifest.json | `8eb9b0683575cf9cfcaab5ed5e02c331297c2c1340eb5d453aaad6b193eac74b` |
| supporting_docs_index.json | `83a12d372692f891f18e1bad1b084f45dfa6bb17bfaf8ccdbfd581b268bcff12` |
| transcripts_manifest.json | `002c3272c6cf734e68e090ed65ea1ad87a1755860ebf3b2228dbe56c68c7e772` |
| bundle_manifest.json | `5e6f327206a1d0ed219c90f83ba397d2f2834a1c70b0df09f71503cf154b1d0c` |

## Verification Results
- **Hash verification:** 5/5 PASS (all file sha256 match manifest)
- **Determinism:** PASS (two runs produce identical output)
- **TN coverage:** PASS (transcripts >= 1, notices >= 1)

## Transcript Detail
```json
{
  "id": "tn_transcript_2021",
  "name": "2021_IRS_Account_Transcript.pdf",
  "year_hint": "2021",
  "path": "/2021/2021_IRS_Account_Transcript.pdf",
  "doc_type": "transcript"
}
```

## Notice Detail
```json
{
  "id": "tn_notice_cp2000_2021",
  "name": "2021_IRS_Notice_CP2000.pdf",
  "year_hint": "2021",
  "path": "/2021/2021_IRS_Notice_CP2000.pdf",
  "doc_type": "notice"
}
```
