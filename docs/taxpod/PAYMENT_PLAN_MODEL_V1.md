# PaymentPlanModelV1 — Contract Specification

**Version:** 1.0.0
**Created:** 2026-02-22
**Status:** Active
**Depends on:** PaymentPlanBundleV1 (PORT0)

## Purpose
Given a frozen `payment_plan_bundle_v1` and a user financial intake JSON, compute a deterministic payment capacity model. No strategy recommendations, no UI, no network calls.

## Inputs

### 1. Bundle (from PORT0)
Path: `<BUNDLE_DIR>/liability_snapshot.json`
- Provides per-year tax liability data (tax_owed, penalty, interest, totals)

### 2. Financial Intake JSON
Path: `tax_work/<CASE_ID>/intake/financial_intake.json`

Required fields:
| Field | Type | Description |
|-------|------|-------------|
| `case_id` | string | Must match bundle case_id |
| `as_of_date` | string | ISO date when intake was collected |
| `income.sources[]` | array | Each: `{ type, description, monthly_amount }` |
| `expenses.housing[]` | array | Each: `{ type, description, monthly_amount }` |
| `expenses.transportation[]` | array | Each: `{ type, description, monthly_amount }` |
| `expenses.insurance_medical[]` | array | Each: `{ type, description, monthly_amount }` |
| `expenses.other_essential[]` | array | Each: `{ type, description, monthly_amount }` |
| `debts[]` | array | Each: `{ type, description, monthly_payment, balance }` |
| `dependents` | number | Count of dependents (>= 0) |
| `assets` | object | `{ checking, savings, retirement, home_equity, other_description, other_value }` |

Allowed income types: `"employment"`, `"self_employment"`, `"social_security"`, `"pension"`, `"rental"`, `"other"`
Allowed expense types: Any string (descriptive). Categories are fixed by the array they belong to.
Allowed debt types: Any string (descriptive).

### Validation Rules (Fail-Closed)
- All `monthly_amount` and `monthly_payment` values must be numbers >= 0
- All `balance` values must be numbers >= 0
- `dependents` must be integer >= 0
- All asset values must be numbers >= 0
- `case_id` must be non-empty string
- `as_of_date` must be non-empty string
- `income.sources` must have at least 1 entry
- Missing any required top-level field → exit 1

## Output: payment_plan_model.json

```json
{
  "version": "PaymentPlanModelV1",
  "case_id": "<CASE_ID>",
  "as_of_utc": "<UTC timestamp>",
  "liability_summary": {
    "tax_years": [ /* imported from liability_snapshot */ ],
    "total_tax_owed": 0.00,
    "total_penalty": 0.00,
    "total_interest": 0.00,
    "total_liability": 0.00
  },
  "intake_summary": {
    "total_monthly_income": 0.00,
    "total_monthly_expenses": 0.00,
    "total_monthly_debt_payments": 0.00,
    "dependents": 0,
    "total_assets": 0.00,
    "income_source_count": 0,
    "has_self_employment": false
  },
  "monthly_capacity": {
    "net_income_monthly": 0.00,
    "essential_expenses_monthly": 0.00,
    "debt_payments_monthly": 0.00,
    "estimated_disposable_monthly": 0.00,
    "capacity_best": 0.00,
    "capacity_likely": 0.00,
    "capacity_worst": 0.00
  },
  "risk_flags": [],
  "assumptions": [],
  "derived": {
    "expense_breakdown": {
      "housing": 0.00,
      "transportation": 0.00,
      "insurance_medical": 0.00,
      "other_essential": 0.00
    },
    "income_breakdown": {}
  }
}
```

## Computation Rules

### Monthly Capacity
1. `net_income_monthly` = sum of all `income.sources[].monthly_amount`
2. `essential_expenses_monthly` = sum of all expense categories (housing + transportation + insurance_medical + other_essential)
3. `debt_payments_monthly` = sum of all `debts[].monthly_payment`
4. `estimated_disposable_monthly` = `net_income_monthly` - `essential_expenses_monthly` - `debt_payments_monthly`

### Sensitivity
- `capacity_best` = `estimated_disposable_monthly` * 1.10
- `capacity_likely` = `estimated_disposable_monthly`
- `capacity_worst` = `estimated_disposable_monthly` * 0.90

### Clamping
- If `estimated_disposable_monthly` < 0, keep the negative value but add risk flag `NEGATIVE_CASHFLOW`
- Sensitivity multipliers still apply to negative values

### Risk Flags (automatic)
| Condition | Flag |
|-----------|------|
| disposable < 0 | `NEGATIVE_CASHFLOW` |
| disposable < 200 | `LOW_DISPOSABLE` |
| total_liability > 50000 | `HIGH_LIABILITY` |
| has self_employment income | `SELF_EMPLOYMENT_COMPLEXITY` |
| any tax year has `incomplete_data` flag | `INCOMPLETE_TAX_DATA` |
| total_assets < 1000 | `LOW_ASSETS` |

### Assumptions (always included)
- `"Income and expenses as reported by taxpayer on intake form"`
- `"Sensitivity range: best +10%, worst -10% of disposable"`
- `"No adjustment for seasonality or future income changes"`
- `"Liability totals from TaxVault as of bundle export date"`

## Rounding Rules
- All currency values rounded to 2 decimal places (nearest cent)
- Rounding function: `Math.round(value * 100) / 100`
- Totals computed by summing individual items FIRST, then rounding the total
- This ensures: `round(sum(items))` not `sum(round(items))`

## Output: financial_docs_needed.md

Deterministic markdown checklist. Sections always in this order:
1. Income Verification
2. Housing / Utilities
3. Transportation
4. Insurance / Medical
5. Debts
6. Assets
7. Prior IRS Correspondence

### Checklist Rules
| Condition | Include |
|-----------|---------|
| Any income source | Pay stubs / income statements for each source |
| Self-employment income | Business bank statements (3 months), P&L statement |
| Mortgage or rent present | Lease agreement or mortgage statement |
| Car payment in debts | Auto loan statement |
| dependents > 0 | Proof of dependents; childcare receipts if childcare expense listed |
| Retirement assets > 0 | Retirement account statement |
| Home equity > 0 | Property tax statement or appraisal |
| Any debts | Most recent statement for each debt |
| Always | Most recent IRS notices and correspondence |

### Markdown Format
- Header: `# Financial Documents Needed`
- Sub-header per section: `## Section Name`
- Each item: `- [ ] Item description`
- Footer: generation timestamp and model version

## Exit Codes
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Input error (missing files, invalid fields, validation failure) |
| 2 | Computation error (NaN result) |
| 3 | Output already exists (unless --force) |

## Determinism Rules
- JSON: `JSON.stringify(obj, null, 2) + "\n"` (same as PORT0)
- Markdown: fixed section order, items sorted by description within section
- Atomic write: temp file → rename
- Stable key ordering in all objects
