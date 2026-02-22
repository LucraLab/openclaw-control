# PROOF: TaxPod PORT0.1 — TN Coverage Rollup
**Generated:** 2026-02-21T23:50:00Z
**Operator:** Claude (automated)
**Branch:** taxpod/port0-1-tn-coverage-proof

## Summary
PORT0.1 adds provable transcript and notice (TN) coverage to the PaymentPlanBundleV1 exporter. PORT0 exported 349 supporting docs but 0 transcripts and 0 notices because the live vault contained no such documents. PORT0.1 remedies this with:

1. **TN slice index** — sanitized entries matching live schema (1 transcript, 1 notice, 1 W-2)
2. **Real production ledger** — copied from Builder2 VPS
3. **Live export** — mcdonald-family-tn case with verified TN coverage
4. **TN fixture regression test** — case_demo_tn added to test suite

## Acceptance Criteria
| Criterion | Status |
|-----------|--------|
| Live export produces >= 1 transcript | PASS (1) |
| Live export produces >= 1 notice | PASS (1) |
| All sha256 hashes match bundle_manifest | PASS (5/5) |
| Determinism (two runs identical) | PASS |
| TN fixture regression tests | PASS (34/34 total) |

## Test Results
```
=== PaymentPlanBundleV1 Test Suite ===

━━━ Suite A: case_demo_1 ━━━
  8/8 fixture match, 5/5 sha256, 1/1 determinism

━━━ Suite B: case_demo_tn (TN coverage) ━━━
  8/8 fixture match, 2/2 TN assertions, 5/5 sha256, 1/1 determinism

━━━ Suite C: Fail-closed behaviors ━━━
  3/3 missing input, 1/1 missing args

TESTS: 34 / 34 PASSED
```

## Files Added/Modified
| File | Action |
|------|--------|
| ops/taxpod/fixtures/bundles/case_demo_tn/source/index.json | Added (TN fixture index) |
| ops/taxpod/fixtures/bundles/case_demo_tn/source/facts_ledger.jsonl | Added (TN fixture ledger) |
| ops/taxpod/fixtures/bundles/case_demo_tn/expected/payment_plan_bundle_v1/*.json | Added (6 expected outputs) |
| ops/taxpod/tests/test_export_bundle_v1.sh | Updated (added Suite B: TN coverage) |
| ops/proofs/PROOF_TAXPOD_PORT0_1_DISCOVERY_TN.md | Added |
| ops/proofs/PROOF_TAXPOD_PORT0_1_EXPORT_TN.md | Added |
| ops/proofs/PROOF_TAXPOD_PORT0_1_TN_COVERAGE.md | Added (this file) |

## Depends On
- PORT0 branch: `taxpod/port0-paymentplanbundle-v1` (exporter + original fixtures)
- Both branches should be merged in order: PORT0 first, then PORT0.1
