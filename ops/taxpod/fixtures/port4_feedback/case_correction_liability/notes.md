# Fixture: case_correction_liability

## Scenario

CPA reviews a PORT3 package for `case_demo_package` and finds that the interest amount for TY2022 is wrong. The IRS transcript shows $475 in accrued interest, but the liability snapshot only shows $250. The CPA also corrects the total liability to reflect the updated interest.

## What This Proves

1. **LIABILITY_CORRECTION** feedback type produces `PATCH_JSON` actions
2. Two corrections (interest + total) generate two separate patch actions
3. `old_value` fields enable drift detection — if the artifact has changed since the CPA reviewed it, the changeset should be rejected
4. Cascade: liability change triggers `REQUIRE_RERUN_PORT2` + `REQUIRE_REBUILD_PORT3`
5. `package_manifest_sha256` ties the feedback to a specific package build

## Key Values

- Interest: $250 → $475 (delta: +$225)
- Total liability: $5,650 → $5,875 (delta: +$225)
- Strategy rerun required because total liability changed
- Package rebuild required because upstream changed

## Determinism Check

Same input + same `--created-utc 20260222T140100Z` → identical changeset output.
