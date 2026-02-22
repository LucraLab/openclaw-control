#!/usr/bin/env node
// render_financial_docs_needed_md.js — Deterministic financial docs checklist
// Reads financial intake JSON + payment plan model, produces markdown checklist.
// No network calls. No external deps beyond Node.js built-ins.
//
// Usage:
//   node render_financial_docs_needed_md.js \
//     --intake <PATH_TO_financial_intake.json> \
//     --model <PATH_TO_payment_plan_model.json> \
//     --out <OUTPUT_DIR> \
//     [--force]
//
// Exit codes: 0=success, 1=input error, 3=output exists

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--intake' && argv[i + 1]) { args.intakePath = argv[++i]; }
    else if (argv[i] === '--model' && argv[i + 1]) { args.modelPath = argv[++i]; }
    else if (argv[i] === '--out' && argv[i + 1]) { args.outDir = argv[++i]; }
    else if (argv[i] === '--force') { args.force = true; }
    else { console.error(`Unknown arg: ${argv[i]}`); process.exit(1); }
  }
  return args;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function die(msg, code) {
  console.error(`ERROR: ${msg}`);
  process.exit(code || 1);
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.intakePath) die('--intake required');
  if (!args.modelPath) die('--model required');
  if (!args.outDir) die('--out required');

  // ── Read inputs ──
  let intake, model;
  try {
    intake = JSON.parse(fs.readFileSync(args.intakePath, 'utf8'));
  } catch (e) {
    die(`Cannot read intake: ${args.intakePath}: ${e.message}`);
  }
  try {
    model = JSON.parse(fs.readFileSync(args.modelPath, 'utf8'));
  } catch (e) {
    die(`Cannot read model: ${args.modelPath}: ${e.message}`);
  }

  // ── Build checklist ──
  const sections = [];

  // 1. Income Verification
  const incomeItems = [];
  const sources = (intake.income && intake.income.sources) || [];
  for (const s of sources) {
    incomeItems.push(`Pay stubs or income verification for: ${s.description || s.type} ($${s.monthly_amount.toFixed(2)}/mo)`);
  }
  if (model.intake_summary && model.intake_summary.has_self_employment) {
    incomeItems.push('Business bank statements (most recent 3 months)');
    incomeItems.push('Profit & Loss (P&L) statement (current year)');
  }
  incomeItems.sort();
  sections.push({ title: 'Income Verification', items: incomeItems });

  // 2. Housing / Utilities
  const housingItems = [];
  const housing = (intake.expenses && intake.expenses.housing) || [];
  let hasMortgageOrRent = false;
  for (const h of housing) {
    const desc = (h.description || h.type || '').toLowerCase();
    if (desc.includes('mortgage') || desc.includes('rent')) {
      hasMortgageOrRent = true;
    }
  }
  if (hasMortgageOrRent) {
    housingItems.push('Current lease agreement or mortgage statement');
  }
  if (housing.length > 0) {
    housingItems.push('Most recent utility bills (electric, gas, water)');
  }
  housingItems.sort();
  sections.push({ title: 'Housing / Utilities', items: housingItems });

  // 3. Transportation
  const transItems = [];
  const transportation = (intake.expenses && intake.expenses.transportation) || [];
  if (transportation.length > 0) {
    transItems.push('Vehicle registration or title');
  }
  // Check debts for car payment
  const debts = intake.debts || [];
  let hasCarPayment = false;
  for (const d of debts) {
    const desc = (d.description || d.type || '').toLowerCase();
    if (desc.includes('car') || desc.includes('auto') || desc.includes('vehicle')) {
      hasCarPayment = true;
    }
  }
  if (hasCarPayment) {
    transItems.push('Auto loan statement (most recent)');
  }
  transItems.sort();
  sections.push({ title: 'Transportation', items: transItems });

  // 4. Insurance / Medical
  const insuranceItems = [];
  const insuranceMedical = (intake.expenses && intake.expenses.insurance_medical) || [];
  if (insuranceMedical.length > 0) {
    insuranceItems.push('Health insurance premium statement');
    insuranceItems.push('Summary of out-of-pocket medical expenses (if applicable)');
  }
  insuranceItems.sort();
  sections.push({ title: 'Insurance / Medical', items: insuranceItems });

  // 5. Debts
  const debtItems = [];
  if (debts.length > 0) {
    for (const d of debts) {
      debtItems.push(`Most recent statement for: ${d.description || d.type} (balance: $${d.balance.toFixed(2)})`);
    }
  }
  debtItems.sort();
  sections.push({ title: 'Debts', items: debtItems });

  // 6. Assets
  const assetItems = [];
  const assets = intake.assets || {};
  if ((assets.retirement || 0) > 0) {
    assetItems.push('Retirement account statement (most recent)');
  }
  if ((assets.home_equity || 0) > 0) {
    assetItems.push('Property tax statement or recent appraisal');
  }
  if ((assets.checking || 0) > 0 || (assets.savings || 0) > 0) {
    assetItems.push('Bank statements for checking/savings (most recent 3 months)');
  }
  if (assets.other_description && (assets.other_value || 0) > 0) {
    assetItems.push(`Documentation for: ${assets.other_description}`);
  }
  assetItems.sort();
  sections.push({ title: 'Assets', items: assetItems });

  // 7. Prior IRS Correspondence
  const irsItems = [];
  irsItems.push('All IRS notices received (CP2000, CP504, etc.)');
  irsItems.push('Most recent IRS account transcripts (if available)');
  irsItems.sort();
  sections.push({ title: 'Prior IRS Correspondence', items: irsItems });

  // 8. Dependents (conditional)
  if (intake.dependents > 0) {
    const depItems = [];
    depItems.push('Proof of dependents (birth certificates, SSN cards)');
    // Check if childcare expense exists
    const otherEssential = (intake.expenses && intake.expenses.other_essential) || [];
    let hasChildcare = false;
    for (const e of otherEssential) {
      const desc = (e.description || e.type || '').toLowerCase();
      if (desc.includes('childcare') || desc.includes('daycare') || desc.includes('child care')) {
        hasChildcare = true;
      }
    }
    if (hasChildcare) {
      depItems.push('Childcare receipts or provider statements');
    }
    depItems.sort();
    // Insert after Income Verification (position 1)
    sections.splice(1, 0, { title: 'Dependents', items: depItems });
  }

  // ── Render markdown ──
  const lines = [];
  lines.push('# Financial Documents Needed');
  lines.push('');

  for (const sec of sections) {
    if (sec.items.length === 0) continue;
    lines.push(`## ${sec.title}`);
    lines.push('');
    for (const item of sec.items) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated: ${model.as_of_utc} | Model: ${model.version} | Case: ${model.case_id}*`);
  lines.push('');

  const content = lines.join('\n');

  // ── Write atomically ──
  const outFile = path.join(args.outDir, 'financial_docs_needed.md');

  if (fs.existsSync(outFile) && !args.force) {
    die(`Output already exists: ${outFile}. Use --force to overwrite.`, 3);
  }

  const tmpFile = path.join(os.tmpdir(), `fdn_${model.case_id}_${process.pid}.md`);

  try {
    fs.mkdirSync(args.outDir, { recursive: true });
    fs.writeFileSync(tmpFile, content);
    fs.renameSync(tmpFile, outFile);
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    die(`Write failed: ${e.message}`);
  }

  const hash = sha256(Buffer.from(content));
  console.log(`DOCS_OK: ${outFile}`);
  console.log(`SHA256: ${hash}`);
}

main();
