#!/usr/bin/env node
// build_payment_plan_model_v1.js — Deterministic PaymentPlanModelV1 builder
// Reads liability_snapshot.json from a frozen bundle + financial intake JSON.
// Produces payment_plan_model.json with stable key ordering.
// No network calls. No external deps beyond Node.js built-ins.
//
// Usage:
//   node build_payment_plan_model_v1.js \
//     --case <CASE_ID> \
//     --bundle <PATH_TO_payment_plan_bundle_v1_DIR> \
//     --intake <PATH_TO_financial_intake.json> \
//     --out <OUTPUT_DIR> \
//     [--as-of-utc <UTC>] \
//     [--force]
//
// Exit codes: 0=success, 1=input error, 2=computation error, 3=output exists

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ── Helpers ──

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--case' && argv[i + 1]) { args.caseId = argv[++i]; }
    else if (argv[i] === '--bundle' && argv[i + 1]) { args.bundlePath = argv[++i]; }
    else if (argv[i] === '--intake' && argv[i + 1]) { args.intakePath = argv[++i]; }
    else if (argv[i] === '--out' && argv[i + 1]) { args.outDir = argv[++i]; }
    else if (argv[i] === '--as-of-utc' && argv[i + 1]) { args.asOfUtc = argv[++i]; }
    else if (argv[i] === '--force') { args.force = true; }
    else { console.error(`Unknown arg: ${argv[i]}`); process.exit(1); }
  }
  return args;
}

function roundCents(v) {
  return Math.round(v * 100) / 100;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function deterministicJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

function die(msg, code) {
  console.error(`ERROR: ${msg}`);
  process.exit(code || 1);
}

// ── Validation ──

function validateIntake(intake) {
  const errors = [];

  if (!intake.case_id || typeof intake.case_id !== 'string') {
    errors.push('case_id is required (non-empty string)');
  }
  if (!intake.as_of_date || typeof intake.as_of_date !== 'string') {
    errors.push('as_of_date is required (non-empty string)');
  }
  if (!intake.income || !Array.isArray(intake.income.sources) || intake.income.sources.length === 0) {
    errors.push('income.sources must be a non-empty array');
  }

  // Validate income sources
  if (intake.income && Array.isArray(intake.income.sources)) {
    for (let i = 0; i < intake.income.sources.length; i++) {
      const s = intake.income.sources[i];
      if (typeof s.monthly_amount !== 'number' || s.monthly_amount < 0 || isNaN(s.monthly_amount)) {
        errors.push(`income.sources[${i}].monthly_amount must be a number >= 0`);
      }
    }
  }

  // Validate expense categories
  const expCats = ['housing', 'transportation', 'insurance_medical', 'other_essential'];
  if (!intake.expenses) {
    errors.push('expenses object is required');
  } else {
    for (const cat of expCats) {
      if (intake.expenses[cat] && Array.isArray(intake.expenses[cat])) {
        for (let i = 0; i < intake.expenses[cat].length; i++) {
          const e = intake.expenses[cat][i];
          if (typeof e.monthly_amount !== 'number' || e.monthly_amount < 0 || isNaN(e.monthly_amount)) {
            errors.push(`expenses.${cat}[${i}].monthly_amount must be a number >= 0`);
          }
        }
      }
    }
  }

  // Validate debts
  if (intake.debts && Array.isArray(intake.debts)) {
    for (let i = 0; i < intake.debts.length; i++) {
      const d = intake.debts[i];
      if (typeof d.monthly_payment !== 'number' || d.monthly_payment < 0 || isNaN(d.monthly_payment)) {
        errors.push(`debts[${i}].monthly_payment must be a number >= 0`);
      }
      if (typeof d.balance !== 'number' || d.balance < 0 || isNaN(d.balance)) {
        errors.push(`debts[${i}].balance must be a number >= 0`);
      }
    }
  }

  // Validate dependents
  if (typeof intake.dependents !== 'number' || intake.dependents < 0 || !Number.isInteger(intake.dependents)) {
    errors.push('dependents must be a non-negative integer');
  }

  // Validate assets
  if (!intake.assets || typeof intake.assets !== 'object') {
    errors.push('assets object is required');
  } else {
    const assetFields = ['checking', 'savings', 'retirement', 'home_equity', 'other_value'];
    for (const f of assetFields) {
      if (intake.assets[f] !== undefined) {
        if (typeof intake.assets[f] !== 'number' || intake.assets[f] < 0 || isNaN(intake.assets[f])) {
          errors.push(`assets.${f} must be a number >= 0`);
        }
      }
    }
  }

  return errors;
}

// ── Main ──

function main() {
  const args = parseArgs(process.argv);

  if (!args.caseId) die('--case required');
  if (!args.bundlePath) die('--bundle required');
  if (!args.intakePath) die('--intake required');
  if (!args.outDir) {
    args.outDir = `/home/openclaw/.openclaw/tax_work/${args.caseId}/models`;
  }

  const asOfUtc = args.asOfUtc || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');

  // ── Read liability snapshot ──
  const liabilityPath = path.join(args.bundlePath, 'liability_snapshot.json');
  let liability;
  try {
    liability = JSON.parse(fs.readFileSync(liabilityPath, 'utf8'));
  } catch (e) {
    die(`Cannot read liability_snapshot.json: ${liabilityPath}: ${e.message}`);
  }

  // ── Read intake ──
  let intake;
  try {
    intake = JSON.parse(fs.readFileSync(args.intakePath, 'utf8'));
  } catch (e) {
    die(`Cannot read intake: ${args.intakePath}: ${e.message}`);
  }

  // ── Validate intake ──
  const validationErrors = validateIntake(intake);
  if (validationErrors.length > 0) {
    console.error('VALIDATION ERRORS:');
    for (const err of validationErrors) {
      console.error(`  - ${err}`);
    }
    die(`Intake validation failed with ${validationErrors.length} error(s)`);
  }

  // ── Compute liability summary ──
  const taxYears = liability.tax_years || [];
  let totalTaxOwed = 0;
  let totalPenalty = 0;
  let totalInterest = 0;
  let totalLiability = 0;
  let hasIncompleteData = false;

  for (const yr of taxYears) {
    totalTaxOwed += (yr.tax_owed || 0);
    totalPenalty += (yr.penalty || 0);
    totalInterest += (yr.interest || 0);
    totalLiability += (yr.total_liability || 0);
    if (yr.flags && yr.flags.includes('incomplete_data')) {
      hasIncompleteData = true;
    }
  }

  totalTaxOwed = roundCents(totalTaxOwed);
  totalPenalty = roundCents(totalPenalty);
  totalInterest = roundCents(totalInterest);
  totalLiability = roundCents(totalLiability);

  // ── Compute income ──
  const incomeSources = intake.income.sources || [];
  let totalMonthlyIncome = 0;
  const incomeBreakdown = {};
  let hasSelfEmployment = false;

  for (const s of incomeSources) {
    totalMonthlyIncome += s.monthly_amount;
    const key = s.type || 'other';
    incomeBreakdown[key] = (incomeBreakdown[key] || 0) + s.monthly_amount;
    if (s.type === 'self_employment') {
      hasSelfEmployment = true;
    }
  }
  totalMonthlyIncome = roundCents(totalMonthlyIncome);

  // Round income breakdown values
  const sortedIncomeKeys = Object.keys(incomeBreakdown).sort();
  const roundedIncomeBreakdown = {};
  for (const k of sortedIncomeKeys) {
    roundedIncomeBreakdown[k] = roundCents(incomeBreakdown[k]);
  }

  // ── Compute expenses ──
  const expCats = ['housing', 'transportation', 'insurance_medical', 'other_essential'];
  const expenseBreakdown = {};
  let totalMonthlyExpenses = 0;

  for (const cat of expCats) {
    let catTotal = 0;
    const items = (intake.expenses && intake.expenses[cat]) || [];
    for (const e of items) {
      catTotal += e.monthly_amount;
    }
    expenseBreakdown[cat] = roundCents(catTotal);
    totalMonthlyExpenses += catTotal;
  }
  totalMonthlyExpenses = roundCents(totalMonthlyExpenses);

  // ── Compute debts ──
  const debts = intake.debts || [];
  let totalDebtPayments = 0;
  for (const d of debts) {
    totalDebtPayments += d.monthly_payment;
  }
  totalDebtPayments = roundCents(totalDebtPayments);

  // ── Compute assets ──
  const assets = intake.assets || {};
  const totalAssets = roundCents(
    (assets.checking || 0) +
    (assets.savings || 0) +
    (assets.retirement || 0) +
    (assets.home_equity || 0) +
    (assets.other_value || 0)
  );

  // ── Compute monthly capacity ──
  const disposable = roundCents(totalMonthlyIncome - totalMonthlyExpenses - totalDebtPayments);
  const capacityBest = roundCents(disposable * 1.10);
  const capacityLikely = disposable;
  const capacityWorst = roundCents(disposable * 0.90);

  // ── NaN guard ──
  const allValues = [totalMonthlyIncome, totalMonthlyExpenses, totalDebtPayments, disposable, capacityBest, capacityWorst, totalAssets, totalLiability];
  for (const v of allValues) {
    if (isNaN(v)) {
      die('Computation produced NaN — check intake values', 2);
    }
  }

  // ── Risk flags ──
  const riskFlags = [];
  if (disposable < 0) riskFlags.push('NEGATIVE_CASHFLOW');
  if (disposable < 200 && disposable >= 0) riskFlags.push('LOW_DISPOSABLE');
  if (totalLiability > 50000) riskFlags.push('HIGH_LIABILITY');
  if (hasSelfEmployment) riskFlags.push('SELF_EMPLOYMENT_COMPLEXITY');
  if (hasIncompleteData) riskFlags.push('INCOMPLETE_TAX_DATA');
  if (totalAssets < 1000) riskFlags.push('LOW_ASSETS');

  // ── Assumptions ──
  const assumptions = [
    'Income and expenses as reported by taxpayer on intake form',
    'Sensitivity range: best +10%, worst -10% of disposable',
    'No adjustment for seasonality or future income changes',
    'Liability totals from TaxVault as of bundle export date'
  ];

  // ── Build model ──
  const model = {
    version: 'PaymentPlanModelV1',
    case_id: args.caseId,
    as_of_utc: asOfUtc,
    liability_summary: {
      tax_years: taxYears,
      total_tax_owed: totalTaxOwed,
      total_penalty: totalPenalty,
      total_interest: totalInterest,
      total_liability: totalLiability
    },
    intake_summary: {
      total_monthly_income: totalMonthlyIncome,
      total_monthly_expenses: totalMonthlyExpenses,
      total_monthly_debt_payments: totalDebtPayments,
      dependents: intake.dependents,
      total_assets: totalAssets,
      income_source_count: incomeSources.length,
      has_self_employment: hasSelfEmployment
    },
    monthly_capacity: {
      net_income_monthly: totalMonthlyIncome,
      essential_expenses_monthly: totalMonthlyExpenses,
      debt_payments_monthly: totalDebtPayments,
      estimated_disposable_monthly: disposable,
      capacity_best: capacityBest,
      capacity_likely: capacityLikely,
      capacity_worst: capacityWorst
    },
    risk_flags: riskFlags,
    assumptions: assumptions,
    derived: {
      expense_breakdown: {
        housing: expenseBreakdown.housing,
        insurance_medical: expenseBreakdown.insurance_medical,
        other_essential: expenseBreakdown.other_essential,
        transportation: expenseBreakdown.transportation
      },
      income_breakdown: roundedIncomeBreakdown
    }
  };

  // ── Write atomically ──
  const outFile = path.join(args.outDir, 'payment_plan_model.json');

  if (fs.existsSync(outFile) && !args.force) {
    die(`Output already exists: ${outFile}. Use --force to overwrite.`, 3);
  }

  const content = deterministicJson(model);
  const tmpFile = path.join(os.tmpdir(), `ppm_v1_${args.caseId}_${process.pid}.json`);

  try {
    fs.mkdirSync(args.outDir, { recursive: true });
    fs.writeFileSync(tmpFile, content);
    fs.renameSync(tmpFile, outFile);
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    die(`Write failed: ${e.message}`);
  }

  const hash = sha256(Buffer.from(content));
  console.log(`MODEL_OK: ${outFile}`);
  console.log(`SHA256: ${hash}`);
  console.log(`DISPOSABLE: ${disposable}`);
  console.log(`FLAGS: ${riskFlags.length > 0 ? riskFlags.join(',') : 'none'}`);
}

main();
