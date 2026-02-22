# Fixture: case_enrichment_missing_doc

## Scenario

CPA reviews a PORT3 package for `case_demo_package` and identifies two missing documents:

1. **2021 IRS Account Transcript** — The package only contains a 2022 transcript. The 2021 transcript is needed to verify prior year filing status and confirm no outstanding balance.
2. **2022 CP2000 Response Letter** — The package has the CP2000 notice but not the taxpayer's response. If a response was sent, it's needed for strategy planning.

## What This Proves

1. **MISSING_DOC** feedback type produces `ADD_DOC_REFERENCE` actions
2. Two missing docs generate two separate add-reference actions
3. Cascade: new documents require `REQUIRE_REEXPORT_BUNDLE` + `REQUIRE_REBUILD_PORT3`
4. `doc_id` in the target is the proposed filename the CPA expects
5. No numeric patches — this is purely a document enrichment flow
6. `package_manifest_sha256` ties the feedback to a specific package build

## Key Values

- Item 1: 2021 transcript (confidence: HIGH)
- Item 2: CP2000 response letter (confidence: MED)
- No old_value / new_value fields (not a correction)
- Both actions require human approval

## Determinism Check

Same input + same `--created-utc 20260222T150100Z` → identical changeset output.
