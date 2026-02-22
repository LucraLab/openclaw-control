# PROOF: TaxPod PORT1 — Live Run
**Generated:** 2026-02-22T00:15:08Z
**Operator:** Claude (automated)

## Commands Run
```bash
# Create intake directory and upload financial intake
mkdir -p /home/openclaw/.openclaw/tax_work/mcdonald-family-tn/intake

# Run PORT1 wrapper
bash /tmp/oc-tn/ops/taxpod/run_port1_payment_capacity.sh \
  --case mcdonald-family-tn \
  --bundle /home/openclaw/.openclaw/tax_inputs/bundles/mcdonald-family-tn/20260221T233958Z/payment_plan_bundle_v1 \
  --intake /home/openclaw/.openclaw/tax_work/mcdonald-family-tn/intake/financial_intake.json \
  --force
```

## Output Paths
| File | Path |
|------|------|
| payment_plan_model.json | `/home/openclaw/.openclaw/tax_work/mcdonald-family-tn/models/payment_plan_model.json` |
| financial_docs_needed.md | `/home/openclaw/.openclaw/tax_work/mcdonald-family-tn/models/financial_docs_needed.md` |
| financial_intake.json | `/home/openclaw/.openclaw/tax_work/mcdonald-family-tn/intake/financial_intake.json` |

## SHA-256 Hashes
| File | Hash |
|------|------|
| payment_plan_model.json | `8821948d7666c8638738e629df7e396d99cc9e2c0b7e9a1277729a25e5014151` |
| financial_docs_needed.md | `5154dbd06717168e99476e611a8ae8d8cf76044b3a3d3e886098632c00fed55b` |

## Summary (non-sensitive)
| Metric | Value |
|--------|-------|
| Estimated disposable (monthly) | $1,260.00 |
| Capacity best (+10%) | $1,386.00 |
| Capacity likely | $1,260.00 |
| Capacity worst (-10%) | $1,134.00 |
| Risk flags | SELF_EMPLOYMENT_COMPLEXITY, INCOMPLETE_TAX_DATA |
| Flag count | 2 |

## Fixture Test Results
```
=== PORT1 PaymentPlanModelV1 Test Suite ===
Suite A: case_tight — 5/5 PASS
Suite B: case_stressed — 8/8 PASS
Suite C: Determinism — 2/2 PASS
Suite D: Fail-closed — 5/5 PASS
Suite E: Wrapper — 4/4 PASS
TESTS: 24 / 24 PASSED
```

## Bundle Input
- **Case:** mcdonald-family-tn
- **Bundle UTC:** 20260221T233958Z
- **Vault Version:** 13.2.0
- **Tax years:** 1 (2021, incomplete_data flag)
