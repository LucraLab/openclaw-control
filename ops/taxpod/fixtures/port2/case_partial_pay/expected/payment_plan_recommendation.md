# Payment Plan Recommendation

## Summary

| Field | Value |
|-------|-------|
| Case | case_partial_pay |
| Strategy | **Partial Payment Installment Agreement** |
| Recommended Monthly Payment | $60.00 |
| Estimated Time to Payoff | 809 months |
| Total Liability | $48500.00 |
| Monthly Capacity (likely) | $60.00 |
| Risk Flags | LOW_DISPOSABLE |

## What This Is Based On

- **Bundle path:** `fixtures/port2/case_partial_pay/bundle`
- **Model path:** `fixtures/port2/case_partial_pay/model/payment_plan_model.json`
- **Total liability:** $48500.00
- **Monthly capacity (likely):** $60.00
- **As of:** 20260220T000000Z

## Why This Recommendation

- Total liability of $48500.00 would take 809 months at $60.00/month
- Payoff exceeds 72-month maximum for standard installment agreements
- Partial payment installment agreement allows reduced monthly payments
- CPA/EA negotiation required to finalize terms with the IRS

## Why Not the Other Options

- Short-term plan not feasible (payoff requires 809 months, exceeds 6-month limit)
- Standard installment agreement not feasible (payoff requires 809 months, exceeds 72-month limit)

## Risks & Assumptions

### Risk Flags

- **LOW_DISPOSABLE**

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
- [ ] Discuss partial payment options and Collection Information Statement (Form 433-A)
- [ ] Confirm no active liens or levies

### Action Items

- [ ] Review this recommendation with CPA or Enrolled Agent
- [ ] Gather all documents listed above
- [ ] Work with CPA/EA to prepare Collection Information Statement (Form 433-A)
- [ ] Contact IRS to negotiate partial payment installment agreement
- [ ] Confirm no active liens or levies before proceeding

---
*Generated: 20260220T000000Z | Version: StrategyRecommendationV1 | Case: case_partial_pay*

> **Disclaimer:** This is a planning estimate based on reported data. Confirm all figures and strategy with a licensed CPA or Enrolled Agent before contacting the IRS.
