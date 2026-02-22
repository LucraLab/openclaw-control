#!/usr/bin/env node
// render_payment_plan_recommendation_md.js — Deterministic strategy report
// Reads strategy_recommendation.json, produces payment_plan_recommendation.md.
// No network calls. No external deps beyond Node.js built-ins.
//
// Usage:
//   node render_payment_plan_recommendation_md.js \
//     --strategy <PATH_TO_strategy_recommendation.json> \
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
    if (argv[i] === '--strategy' && argv[i + 1]) { args.strategyPath = argv[++i]; }
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

function fmtDollars(v) {
  if (v === null || v === undefined) return 'N/A';
  return '$' + v.toFixed(2);
}

function fmtMonths(v) {
  if (v === null || v === undefined) return 'N/A';
  if (v === 0) return '0 months';
  if (v === 1) return '1 month';
  return `${v} months`;
}

function strategyLabel(type) {
  switch (type) {
    case 'SHORT_TERM_PAYMENT_PLAN': return 'Short-Term Payment Plan';
    case 'LONG_TERM_INSTALLMENT_AGREEMENT': return 'Long-Term Installment Agreement';
    case 'PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT': return 'Partial Payment Installment Agreement';
    case 'CPA_ESCALATION_REQUIRED': return 'CPA Escalation Required';
    default: return type;
  }
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.strategyPath) die('--strategy required');
  if (!args.outDir) die('--out required');

  // ── Read strategy recommendation ──
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(args.strategyPath, 'utf8'));
  } catch (e) {
    die(`Cannot read strategy: ${args.strategyPath}: ${e.message}`);
  }

  // ── Validate ──
  if (!rec.strategy) die('Strategy recommendation missing strategy field');
  if (!rec.version) die('Strategy recommendation missing version field');

  const strat = rec.strategy;
  const inputs = rec.inputs || {};
  const exec = rec.execution || {};
  const riskFlags = rec.risk_flags || [];
  const assumptions = rec.assumptions || [];
  const isEscalation = strat.type === 'CPA_ESCALATION_REQUIRED';

  // ── Build markdown ──
  const lines = [];

  // Title
  lines.push('# Payment Plan Recommendation');
  lines.push('');

  // Section 1: Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Case | ${rec.case_id} |`);
  lines.push(`| Strategy | **${strategyLabel(strat.type)}** |`);
  if (!isEscalation) {
    lines.push(`| Recommended Monthly Payment | ${fmtDollars(strat.recommended_monthly_payment)} |`);
    lines.push(`| Estimated Time to Payoff | ${fmtMonths(strat.estimated_months_to_payoff)} |`);
  }
  lines.push(`| Total Liability | ${fmtDollars(inputs.total_liability)} |`);
  lines.push(`| Monthly Capacity (likely) | ${fmtDollars(inputs.capacity_likely)} |`);
  lines.push(`| Risk Flags | ${riskFlags.length > 0 ? riskFlags.join(', ') : 'None'} |`);
  lines.push('');

  // Section 2: What this is based on
  lines.push('## What This Is Based On');
  lines.push('');
  lines.push(`- **Bundle path:** \`${inputs.bundle_path || 'N/A'}\``);
  lines.push(`- **Model path:** \`${inputs.model_path || 'N/A'}\``);
  lines.push(`- **Total liability:** ${fmtDollars(inputs.total_liability)}`);
  lines.push(`- **Monthly capacity (likely):** ${fmtDollars(inputs.capacity_likely)}`);
  lines.push(`- **As of:** ${rec.as_of_utc || 'N/A'}`);
  lines.push('');

  // Section 3: Why this recommendation
  lines.push('## Why This Recommendation');
  lines.push('');
  const whyThis = strat.why_this_strategy || [];
  if (whyThis.length === 0) {
    lines.push('No reasoning available.');
  } else {
    for (const reason of whyThis) {
      lines.push(`- ${reason}`);
    }
  }
  lines.push('');

  // Section 4: Why not the other options
  lines.push('## Why Not the Other Options');
  lines.push('');
  const whyNot = strat.why_not_others || [];
  if (whyNot.length === 0) {
    lines.push('No alternatives considered.');
  } else {
    for (const reason of whyNot) {
      lines.push(`- ${reason}`);
    }
  }
  lines.push('');

  // Section 5: Risks & Assumptions
  lines.push('## Risks & Assumptions');
  lines.push('');
  if (riskFlags.length > 0) {
    lines.push('### Risk Flags');
    lines.push('');
    for (const flag of riskFlags) {
      lines.push(`- **${flag}**`);
    }
    lines.push('');
  }
  lines.push('### Assumptions');
  lines.push('');
  if (assumptions.length === 0) {
    lines.push('No assumptions recorded.');
  } else {
    for (const a of assumptions) {
      lines.push(`- ${a}`);
    }
  }
  lines.push('');

  // Section 6: Next Steps Checklist
  lines.push('## Next Steps Checklist');
  lines.push('');

  if (isEscalation) {
    lines.push('- [ ] Schedule consultation with CPA or Enrolled Agent');
    lines.push('- [ ] Gather all available tax documents');
    lines.push('- [ ] Resolve incomplete tax data before proceeding');
    lines.push('- [ ] Re-run strategy recommendation after data is complete');
  } else {
    // Documents needed
    const docs = exec.documents_needed || [];
    if (docs.length > 0) {
      lines.push('### Documents to Gather');
      lines.push('');
      for (const doc of docs) {
        lines.push(`- [ ] ${doc}`);
      }
      lines.push('');
    }

    // Call script questions
    const questions = exec.call_script_questions || [];
    if (questions.length > 0) {
      lines.push('### Questions for IRS / CPA Call');
      lines.push('');
      for (const q of questions) {
        lines.push(`- [ ] ${q}`);
      }
      lines.push('');
    }

    lines.push('### Action Items');
    lines.push('');
    lines.push('- [ ] Review this recommendation with CPA or Enrolled Agent');
    lines.push('- [ ] Gather all documents listed above');
    if (strat.type === 'SHORT_TERM_PAYMENT_PLAN') {
      lines.push('- [ ] Contact IRS to set up short-term payment plan');
    } else if (strat.type === 'LONG_TERM_INSTALLMENT_AGREEMENT') {
      lines.push('- [ ] Contact IRS to request installment agreement');
    } else if (strat.type === 'PARTIAL_PAYMENT_INSTALLMENT_AGREEMENT') {
      lines.push('- [ ] Work with CPA/EA to prepare Collection Information Statement (Form 433-A)');
      lines.push('- [ ] Contact IRS to negotiate partial payment installment agreement');
    }
    lines.push('- [ ] Confirm no active liens or levies before proceeding');
  }
  lines.push('');

  // Footer
  lines.push('---');
  lines.push(`*Generated: ${rec.as_of_utc || 'N/A'} | Version: ${rec.version} | Case: ${rec.case_id}*`);
  lines.push('');
  lines.push('> **Disclaimer:** This is a planning estimate based on reported data. Confirm all figures and strategy with a licensed CPA or Enrolled Agent before contacting the IRS.');
  lines.push('');

  const content = lines.join('\n');

  // ── Write atomically ──
  const outFile = path.join(args.outDir, 'payment_plan_recommendation.md');

  if (fs.existsSync(outFile) && !args.force) {
    die(`Output already exists: ${outFile}. Use --force to overwrite.`, 3);
  }

  const tmpFile = path.join(os.tmpdir(), `ppr_${rec.case_id}_${process.pid}.md`);

  try {
    fs.mkdirSync(args.outDir, { recursive: true });
    fs.writeFileSync(tmpFile, content);
    fs.renameSync(tmpFile, outFile);
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    die(`Write failed: ${e.message}`);
  }

  const hash = sha256(Buffer.from(content));
  console.log(`REPORT_OK: ${outFile}`);
  console.log(`SHA256: ${hash}`);
}

main();
