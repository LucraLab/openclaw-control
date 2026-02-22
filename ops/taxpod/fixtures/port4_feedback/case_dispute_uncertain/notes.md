# Fixture: case_dispute_uncertain

## Scenario

CPA reviews a PORT3 package for `case_demo_package` and flags an uncertainty: they're not sure if the taxpayer's 2020 return was actually filed. The client believes it was filed but cannot locate confirmation, and no 2020 IRS account transcript exists in the current bundle.

This is NOT a correction (no numeric values to change) and NOT a missing doc request (the CPA isn't sure what doc to ask for — they need verification first).

## What This Proves

1. **DISPUTE_OR_UNCERTAIN** feedback type produces `ADD_FLAG` actions (not patches)
2. No numeric `old_value` / `new_value` — this is a qualitative flag, not a data correction
3. The `NEEDS_VERIFICATION` flag signals that downstream processing should pause for this year until the issue is resolved
4. Cascade: flag addition triggers `REQUIRE_REEXPORT_BUNDLE` (bundle metadata changed) but does NOT trigger `REQUIRE_RERUN_PORT2` or `REQUIRE_REBUILD_PORT3` — no upstream data actually changed yet
5. Confidence is LOW — the CPA is explicitly uncertain
6. Single feedback item generates exactly 2 actions (flag + re-export)

## Key Values

- Flag: NEEDS_VERIFICATION on filing_status for TY2020
- No patches (zero PATCH_JSON actions)
- No REQUIRE_RERUN_PORT2 (liability unchanged)
- No REQUIRE_REBUILD_PORT3 (strategy unchanged)
- Only REQUIRE_REEXPORT_BUNDLE (bundle metadata needs update)
- Confidence: LOW

## Determinism Check

Same input + same `--created-utc 20260222T160100Z` → identical changeset output.
