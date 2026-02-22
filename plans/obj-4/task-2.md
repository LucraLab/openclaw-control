# Task 2: Transformer Path Prefix Fix (ARTIFACT_JSON_ROOT)

## Scope

Fix feedback_to_changeset_v1.js transformer to prepend artifact-specific
JSON root prefixes so generated JSON pointers resolve correctly against
runtime artifact files.

- Add ARTIFACT_JSON_ROOT lookup table mapping artifact types to root prefixes
- Modify feedbackPathToJsonPointer() to accept artifact parameter and prepend root
- Update 3 call sites (LIABILITY_CORRECTION, STRATEGY_OVERRIDE_NOTE, PAYMENT_CAPACITY_ASSUMPTION_FIX)
- Update fixture expected_changeset.json for case_correction_liability

## Verification

- Fixture test passes with corrected paths (/liability_summary/tax_years/0/interest)
- E2E feedback→changeset→apply workflow succeeded during live run
- Apply Door accepted changesets with prefixed paths (no allowlist rejection)

## Rollback

- Revert merge commit: `git revert <merge-sha>`
- feedbackPathToJsonPointer() reverts to single-arg form without prefix
- No infrastructure or config changes to undo
