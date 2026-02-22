#!/usr/bin/env node
// recommend_payment_strategy_v1.js — Deterministic strategy recommender
// Reads liability_snapshot.json (bundle) + payment_plan_model.json (PORT1).
// Produces strategy_recommendation.json with deterministic rule-based selection.
// No network calls. No external deps. Planning heuristic only — not legal advice.
//
// Exit codes: 0=success, 1=input error, 2=computation error, 3=output exists

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ── Decision constants (documented in STRATEGY_RECOMMENDATION_V1.md) ──
const SHORT_TERM_MAX_MONTHS = 6;
const LONG_TERM_MAX_MONTHS = 72;
const MIN_PAYMENT_FLOOR = 50;
const ESCALATE_IF_FLAGS = ['INCOMPLETE_TAX_DATA'];

// ── Helpers ──

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--case' && argv[i + 1]) { args.caseId = argv[++i]; }
    else if (argv[i] === '--bundle' && argv[i + 1]) { args.bundlePath = argv[++i]; }
    else if (argv[i] === '--model' && argv[i + 1]) { args.modelPath = argv[++i]; }
    else if (argv[i] === '--out' && argv[i + 1]) { args.outDir = argv[++i]; }
    else if (argv[i] === '--as-of-utc' && argv[i + 1]) { args.asOfUtc = argv[++i]; }
    else if (argv[i] === '--force') { args.force = true; }
    else { console.error(`Unknown arg: ${argv[i]}`); process.exit(1); }
  }
  return args;
}

function roundCents(v) { return Math.round(v * 100) / 100; }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function deterministicJson(obj) { return JSON.stringify(obj, null, 2) + '\n'; }
function die(msg, code) { console.error(`ERROR: ${msg}`); process.exit(code || 1); }

// ── Main ──

function main() {
  const args = parseArgs(process.argv);

  if (!args.caseId) die('--case required');
  if (!args.bundlePath) die('--bundle required');
  if (!args.modelPath) die('--model required');
  if (!args.outDir) {
    args.outDir = `/home/openclaw/.openclaw/tax_work/${args.caseId}/strategy`;
  }

  const asOfUtc = args.asOfUtc || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');

  // ── Load liability snapshot ──
  const liabilityPath = path.join(args.bundlePath, 'liability_snapshot.json');
  let liability;
  try {
    liability = JSON.parse(fs.readFileSync(liabilityPath, 'utf8'));
  } catch (e) {
    die(`Cannot read liability_snapshot.json: ${liabilityPath}: ${e.message}`);
  }

  // ── Load payment plan model ──
  let model;
  try {
    model = JSON.parse(fs.readFileSync(args.modelPath, 'utf8'));
  } catch (e) {
    die(`Cannot read model: ${args.modelPath}: ${e.message}`);
  }

  // ── Validate required fields ──
  if (!model.monthly_capacity) die('Model missing monthly_capacity');
  if (!liability.tax_years) die('Liability missing tax_years');

  // ── Compute totals ──
  const taxYears = liability.tax_years || [];
  let totalLiability = 0;
  for (const yr of taxYears) {
    totalLiability += (yr.total_liability || 0);
  }
  totalLiability = roundCents(totalLiability);

  const capacityLikely = model.monthly_capacity.capacity_likely;
  const riskFlags = (model.risk_flags || []).slice();

  // ── Step 1: Check escalation ──
  let mustEscalate = false;
  const escalationReasons = [];

  for (const flag of ESCALATE_IF_FLAGS) {
    if (riskFlags.includes(flag)) {
      mustEscalate = true;
      escalationReasons.push(`Risk flag present: ${flag}`);
    }
  }

  if (capacityLikely === null || capacityLikely === undefined || isNaN(capacityLikely)) {
    mustEscalate = true;
    escalationReasons.push('Capacity likely is null or unavailable');
  }

  if (totalLiability === 0 && taxYears.length === 0) {
    mustEscalate = true;
    escalationReasons.push('No tax year data and zero liability');
  }

  // ── Build strategy ──
  let strategyType;
  let recommendedPayment;
  let estimatedMonths;
  const whyThis = [];
  const whyNotOthers = [];

  if (mustEscalate) {
    strategyType = 'CPA_ESCALATION_REQUIRED';
    recommendedPayment = 0;
    estimatedMonths = null;
    for (const r of escalationReasons) {
      whyThis.push(r);
    }
    whyThis.push('Cannot determine reliable strategy with available data');
    whyThis.push('Recommend consultation with CPA or Enrolled Agent before proceeding');
    whyNotOthers.push('All payment plan options require complete and verified tax data');
  } else {
    // Step 2: Compute months
    const effectivePayment = Math.max(capacityLikely, MIN_PAYMENT_FLOOR);
    recommendedPayment = roundCents(effectivePayment);

    if (totalLiability === 0) {
      estimatedMonths = 0;
    } else {
      estimatedMonths = Math.ceil(totalLiability / effectivePayment);
    }

    // Step 3: Select strategy
    if (estimatedMonths <= SHORT_TERM_MAX_MONTHS) {
      strategyType = 'SHORT_TERM_PAYMENT_PLAN';
      whyThis.push(`Total liability of $${totalLiability.toFixed(2)} can be paid in ${estimatedMonths} month(s) at $${recommendedPayment.toFixed(2)}/month`);
      whyThis.push(`Payoff within ${SHORT_TERM_MAX_MONTHS} months qualifies for short-term payment plan`);
      whyThis.push('Short-term plans typically have lower setup fees and less paperwork');
      whyNotOthers.push(`Long-term installment agreement not needed (payoff is ${estimatedMonths} months, under ${SHORT_TERM_MAX_MONTHS}-month threshold)`);
      whyNotOthers.push('Partial payment IA not applicable (full payoff achievable in short term)');
    } else if (estimatedMonths <= LONG_TERM_MAX_MONTHS) {
      strategyType = 'LONG_TERM_INSTALLMENT_AGREEMENT';
      whyThis.push(`Total liability of $${totalLiability.toFixed(2)} can be paid in ${estimatedMonths} months at $${recommendedPayment.toFixed(2)}/month`);
      whyThis.push(`Payoff exceeds ${SHORT_TERM_MAX_MONTHS} months but is within ${LONG_TERM_MAX_MONTHS}-month installment agreement window`);
      whyThis.push('Standard installment agreement allows structured monthly payments to the IRS');
      whyNotOthers.push(`Short-term plan not feasible (payoff requires ${estimatedMonths} months, exceeds ${SHORT_TERM_MAX_MONTHS}-month limit)`);
      whyNotOthers.push('Partial payment IA not needed (full payoff achievable within 72 months)');
    } else {
      strategyType = 'PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT';
      whyThis.push(`Total liability of $${totalLiability.toFixed(2)} would take ${estimatedMonths} months at $${recommendedPayment.toFixed(2)}/month`);
      whyThis.push(`Payoff exceeds ${LONG_TERM_MAX_MONTHS}-month maximum for standard installment agreements`);
      whyThis.push('Partial payment installment agreement allows reduced monthly payments');
      whyThis.push('CPA/EA negotiation required to finalize terms with the IRS');
      whyNotOthers.push(`Short-term plan not feasible (payoff requires ${estimatedMonths} months, exceeds ${SHORT_TERM_MAX_MONTHS}-month limit)`);
      whyNotOthers.push(`Standard installment agreement not feasible (payoff requires ${estimatedMonths} months, exceeds ${LONG_TERM_MAX_MONTHS}-month limit)`);
    }

    if (capacityLikely < MIN_PAYMENT_FLOOR) {
      whyThis.push(`Capacity of $${capacityLikely.toFixed(2)}/month is below $${MIN_PAYMENT_FLOOR} floor; using minimum payment floor`);
    }
  }

  // ── NaN guard ──
  if (isNaN(totalLiability) || (recommendedPayment !== 0 && isNaN(recommendedPayment))) {
    die('Computation produced NaN', 2);
  }

  // ── Documents needed ──
  const documentsNeeded = [
    'Income verification documents',
    'Housing and utility documentation',
    'Debt statements',
    'Asset documentation',
    'Prior IRS correspondence'
  ];

  // ── Call script questions ──
  const callScriptQuestions = [
    'Confirm total balance due across all tax years',
    'Request current penalty and interest calculations'
  ];

  if (strategyType === 'LONG_TERM_INSTALLMENT_AGREEMENT' || strategyType === 'PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT') {
    callScriptQuestions.push('Request installment agreement terms and setup fee');
  }
  if (strategyType === 'PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT') {
    callScriptQuestions.push('Discuss partial payment options and Collection Information Statement (Form 433-A)');
  }
  callScriptQuestions.push('Confirm no active liens or levies');

  // ── Assumptions ──
  const assumptions = [
    'This is a planning estimate based on reported data',
    'Confirm all figures and strategy with a licensed CPA or Enrolled Agent before contacting the IRS',
    'Liability totals from TaxVault bundle export; may not reflect recent payments or adjustments',
    'Monthly capacity from taxpayer-reported income and expenses',
    `Strategy thresholds: short-term <= ${SHORT_TERM_MAX_MONTHS} months, long-term <= ${LONG_TERM_MAX_MONTHS} months, minimum payment $${MIN_PAYMENT_FLOOR}`
  ];

  // ── Build output ──
  const recommendation = {
    version: 'StrategyRecommendationV1',
    case_id: args.caseId,
    as_of_utc: asOfUtc,
    inputs: {
      bundle_path: args.bundlePath,
      model_path: args.modelPath,
      total_liability: totalLiability,
      capacity_likely: capacityLikely
    },
    strategy: {
      type: strategyType,
      recommended_monthly_payment: recommendedPayment,
      estimated_months_to_payoff: estimatedMonths,
      why_this_strategy: whyThis,
      why_not_others: whyNotOthers
    },
    execution: {
      documents_needed: documentsNeeded,
      call_script_questions: callScriptQuestions
    },
    risk_flags: riskFlags,
    assumptions: assumptions
  };

  // ── Write atomically ──
  const outFile = path.join(args.outDir, 'strategy_recommendation.json');

  if (fs.existsSync(outFile) && !args.force) {
    die(`Output already exists: ${outFile}. Use --force to overwrite.`, 3);
  }

  const content = deterministicJson(recommendation);
  const tmpFile = path.join(os.tmpdir(), `sr_v1_${args.caseId}_${process.pid}.json`);

  try {
    fs.mkdirSync(args.outDir, { recursive: true });
    fs.writeFileSync(tmpFile, content);
    fs.renameSync(tmpFile, outFile);
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    die(`Write failed: ${e.message}`);
  }

  const hash = sha256(Buffer.from(content));
  console.log(`STRATEGY_OK: ${outFile}`);
  console.log(`SHA256: ${hash}`);
  console.log(`TYPE: ${strategyType}`);
  console.log(`MONTHLY: ${recommendedPayment}`);
  console.log(`MONTHS: ${estimatedMonths === null ? 'null' : estimatedMonths}`);
  console.log(`FLAGS: ${riskFlags.length > 0 ? riskFlags.join(',') : 'none'}`);
}

main();
