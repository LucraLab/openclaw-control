# Payment Plan Recommendation

## Summary

| Field | Value |
|-------|-------|
| Case | case_demo_package |
| Strategy | **Long-Term Installment Agreement** |
| Recommended Monthly Payment | $900.00 |
| Estimated Time to Payoff | 7 months |
| Total Liability | $5650.00 |
| Monthly Capacity (likely) | $900.00 |
| Risk Flags | None |

## What This Is Based On

- **Bundle path:** `fixtures/port3/case_demo_package/bundle`
- **Model path:** `fixtures/port3/case_demo_package/model/payment_plan_model.json`
- **Total liability:** $5650.00
- **Monthly capacity (likely):** $900.00
- **As of:** 20260220T000000Z

## Why This Recommendation

- Total liability of $5650.00 can be paid in 7 months at $900.00/month
- Payoff exceeds 6 months but is within 72-month installment agreement window
- Standard installment agreement allows structured monthly payments to the IRS

## Why Not the Other Options

- Short-term plan not feasible (payoff requires 7 months, exceeds 6-month limit)
- Partial payment IA not needed (full payoff achievable within 72 months)

## Risks & Assumptions

### Assumptions

- This is a planning estimate based on reported data
- Confirm all figures and strategy with a licensed CPA or Enrolled Agent before contacting the IRS
- Liability totals from TaxVault bundle export; may not reflect recent payments or adjustments
- Monthly capacity from taxpayer-reported income and expenses
- Strategy thresholds: short-term <= 6 months, long-term <= 72 months, minimum payment $50

## Next Steps Checklist

### Documents to Gather

- [ ] Income verification documents
- [ ] Housing and utility documentation
- [ ] Debt statements
- [ ] Asset documentation
- [ ] Prior IRS correspondence

### Questions for IRS / CPA Call

- [ ] Confirm total balance due across all tax years
- [ ] Request current penalty and interest calculations
- [ ] Request installment agreement terms and setup fee
- [ ] Confirm no active liens or levies

### Action Items

- [ ] Review this recommendation with CPA or Enrolled Agent
- [ ] Gather all documents listed above
- [ ] Contact IRS to request installment agreement
- [ ] Confirm no active liens or levies before proceeding

---
*Generated: 20260220T000000Z | Version: StrategyRecommendationV1 | Case: case_demo_package*

> **Disclaimer:** This is a planning estimate based on reported data. Confirm all figures and strategy with a licensed CPA or Enrolled Agent before contacting the IRS.
