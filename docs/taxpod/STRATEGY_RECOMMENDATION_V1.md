# StrategyRecommendationV1 — Contract Specification

**Version:** 1.0.0
**Created:** 2026-02-22
**Status:** Active
**Depends on:** PaymentPlanBundleV1 (PORT0), PaymentPlanModelV1 (PORT1)

## Purpose
Given a frozen bundle and a payment capacity model, produce a deterministic strategy recommendation. This is a **planning heuristic** — not legal advice. All outputs should be confirmed with a CPA or Enrolled Agent.

## Inputs

### 1. Bundle (from PORT0)
Path: `<BUNDLE_DIR>/liability_snapshot.json`

### 2. Payment Plan Model (from PORT1)
Path: `<MODEL_DIR>/payment_plan_model.json`

## Output: strategy_recommendation.json

```json
{
  "version": "StrategyRecommendationV1",
  "case_id": "<CASE_ID>",
  "as_of_utc": "<UTC>",
  "inputs": {
    "bundle_path": "<PATH>",
    "model_path": "<PATH>",
    "total_liability": 0.00,
    "capacity_likely": 0.00
  },
  "strategy": {
    "type": "<ENUM>",
    "recommended_monthly_payment": 0.00,
    "estimated_months_to_payoff": null,
    "why_this_strategy": [],
    "why_not_others": []
  },
  "execution": {
    "documents_needed": [],
    "call_script_questions": []
  },
  "risk_flags": [],
  "assumptions": [],
  "version": "StrategyRecommendationV1"
}
```

## Strategy Types (enum)
| Type | Description |
|------|-------------|
| `SHORT_TERM_PAYMENT_PLAN` | Full payoff in <= 6 months |
| `LONG_TERM_INSTALLMENT_AGREEMENT` | Full payoff in 7-72 months |
| `PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT` | Payoff exceeds 72 months; requires CPA negotiation |
| `CPA_ESCALATION_REQUIRED` | Cannot determine strategy; missing data or hard flags |

## Decision Constants
| Constant | Value | Description |
|----------|-------|-------------|
| `SHORT_TERM_MAX_MONTHS` | 6 | Max months for short-term plan |
| `LONG_TERM_MAX_MONTHS` | 72 | Max months for long-term IA |
| `MIN_PAYMENT_FLOOR` | 50 | Never recommend less than $50/mo |
| `ESCALATE_IF_FLAGS` | `["INCOMPLETE_TAX_DATA"]` | Hard escalation flags |

## Strategy Selection Rules

### Step 1: Check for Escalation
If any of these are true → `CPA_ESCALATION_REQUIRED`:
- Model contains any flag in `ESCALATE_IF_FLAGS`
- `capacity_likely` is null, undefined, or NaN
- `total_liability` is 0 and no tax years exist

### Step 2: Compute Months
```
effective_payment = max(capacity_likely, MIN_PAYMENT_FLOOR)
months = ceil(total_liability / effective_payment)
```
Special case: if `total_liability` is 0 → months = 0

### Step 3: Select Strategy
| Condition | Strategy |
|-----------|----------|
| months <= SHORT_TERM_MAX_MONTHS | `SHORT_TERM_PAYMENT_PLAN` |
| months <= LONG_TERM_MAX_MONTHS | `LONG_TERM_INSTALLMENT_AGREEMENT` |
| months > LONG_TERM_MAX_MONTHS | `PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT` |

### Step 4: Recommended Monthly Payment
- Use `capacity_likely` clamped to `MIN_PAYMENT_FLOOR` minimum
- For `CPA_ESCALATION_REQUIRED`: set to 0 (no recommendation)

## why_this_strategy / why_not_others Generation

Deterministic bullets generated from rule outcomes:
- "Total liability $X can be paid in Y months at $Z/month" (for non-escalation)
- "Capacity of $X/month exceeds minimum floor of $50" (if applicable)
- Short-term not chosen: "Payoff exceeds 6 months at current capacity"
- Long-term not chosen: "Payoff exceeds 72 months; partial payment IA required"
- Escalation: "Incomplete tax data prevents reliable strategy selection"

## Execution Fields

### documents_needed
High-level list referencing PORT1 checklist groups:
- "Income verification documents"
- "Housing and utility documentation"
- "Debt statements"
- "Asset documentation"
- "Prior IRS correspondence"

### call_script_questions
Deterministic prompts for IRS/CPA call:
- Always: "Confirm total balance due across all tax years"
- Always: "Request current penalty and interest calculations"
- If LONG_TERM or PARTIAL: "Request installment agreement terms and setup fee"
- If PARTIAL: "Discuss partial payment options and Collection Information Statement (Form 433-A)"
- Always: "Confirm no active liens or levies"

## Rounding Rules
Same as PORT1:
- All currency: `Math.round(value * 100) / 100`
- Months: `Math.ceil()` (always round up)

## Exit Codes
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Input error |
| 2 | Computation error (NaN) |
| 3 | Output already exists |

## Disclaimer
All outputs include: "This is a planning estimate based on reported data. Confirm all figures and strategy with a licensed CPA or Enrolled Agent before contacting the IRS."
