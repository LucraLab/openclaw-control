#!/usr/bin/env node
// build_cpa_package_v1.js — Deterministic CPA handoff package builder
// Assembles PORT0 bundle + PORT1 model + PORT2 strategy into a single package.
// No network calls. No external deps beyond Node.js built-ins.
//
// Usage:
//   node build_cpa_package_v1.js \
//     --case <CASE_ID> \
//     --bundle <PATH_TO_payment_plan_bundle_v1> \
//     --model <PATH_TO_payment_plan_model.json> \
//     --strategy <PATH_TO_strategy_recommendation.json> \
//     --strategy-md <PATH_TO_payment_plan_recommendation.md> \
//     --docs-md <PATH_TO_financial_docs_needed.md> \
//     [--out-root <OUTPUT_ROOT>] \
//     [--package-utc <UTC>] \
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
    else if (argv[i] === '--model' && argv[i + 1]) { args.modelPath = argv[++i]; }
    else if (argv[i] === '--strategy' && argv[i + 1]) { args.strategyPath = argv[++i]; }
    else if (argv[i] === '--strategy-md' && argv[i + 1]) { args.strategyMdPath = argv[++i]; }
    else if (argv[i] === '--docs-md' && argv[i + 1]) { args.docsMdPath = argv[++i]; }
    else if (argv[i] === '--out-root' && argv[i + 1]) { args.outRoot = argv[++i]; }
    else if (argv[i] === '--package-utc' && argv[i + 1]) { args.packageUtc = argv[++i]; }
    else if (argv[i] === '--force') { args.force = true; }
    else { console.error(`Unknown arg: ${argv[i]}`); process.exit(1); }
  }
  return args;
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

function readJsonSafe(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    die(`Cannot read ${label}: ${filePath}: ${e.message}`);
  }
}

function readFileSafe(filePath, label) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    die(`Cannot read ${label}: ${filePath}: ${e.message}`);
  }
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

function fmtDollars(v) {
  if (v === null || v === undefined) return 'N/A';
  return '$' + v.toFixed(2);
}

function fmtMonths(v) {
  if (v === null || v === undefined) return 'N/A';
  if (v === 0) return '0 months';
  if (v === 1) return '1 month';
  return v + ' months';
}

// ── Main ──

function main() {
  const args = parseArgs(process.argv);

  // Validate required args
  if (!args.caseId) die('--case required');
  if (!args.bundlePath) die('--bundle required');
  if (!args.modelPath) die('--model required');
  if (!args.strategyPath) die('--strategy required');
  if (!args.strategyMdPath) die('--strategy-md required');
  if (!args.docsMdPath) die('--docs-md required');

  if (!args.outRoot) {
    args.outRoot = '/home/openclaw/.openclaw/tax_outputs/packages';
  }

  const packageUtc = args.packageUtc || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');

  // ── Read all inputs ──
  const liability = readJsonSafe(path.join(args.bundlePath, 'liability_snapshot.json'), 'liability_snapshot.json');
  const transcriptsManifest = readJsonSafe(path.join(args.bundlePath, 'transcripts_manifest.json'), 'transcripts_manifest.json');
  const noticesManifest = readJsonSafe(path.join(args.bundlePath, 'notices_manifest.json'), 'notices_manifest.json');
  const supportingDocs = readJsonSafe(path.join(args.bundlePath, 'supporting_docs_index.json'), 'supporting_docs_index.json');
  const model = readJsonSafe(args.modelPath, 'payment_plan_model.json');
  const strategy = readJsonSafe(args.strategyPath, 'strategy_recommendation.json');
  const strategyMd = readFileSafe(args.strategyMdPath, 'payment_plan_recommendation.md');
  const docsMd = readFileSafe(args.docsMdPath, 'financial_docs_needed.md');

  // ── Validate required fields ──
  if (!Array.isArray(transcriptsManifest.transcripts)) die('transcripts_manifest.json missing transcripts array');
  if (!Array.isArray(noticesManifest.notices)) die('notices_manifest.json missing notices array');
  if (!strategy.strategy) die('strategy_recommendation.json missing strategy field');
  if (!model.monthly_capacity) die('payment_plan_model.json missing monthly_capacity');

  // ── Determine output path ──
  const packageDir = path.join(args.outRoot, args.caseId, packageUtc, 'cpa_package_v1');

  if (fs.existsSync(packageDir) && !args.force) {
    die(`Output already exists: ${packageDir}. Use --force to overwrite.`, 3);
  }

  // ── Build package in temp dir ──
  const tmpDir = path.join(os.tmpdir(), `cpa_pkg_${args.caseId}_${process.pid}`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '04_TRANSCRIPTS'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '05_NOTICES'), { recursive: true });

    // ── 01: Liability snapshot (copy unchanged) ──
    const liabilityContent = deterministicJson(liability);
    fs.writeFileSync(path.join(tmpDir, '01_LIABILITY_SNAPSHOT.json'), liabilityContent);

    // ── 02: Payment plan model (copy unchanged) ──
    const modelContent = deterministicJson(model);
    fs.writeFileSync(path.join(tmpDir, '02_PAYMENT_PLAN_MODEL.json'), modelContent);

    // ── 03: Strategy recommendation JSON (copy unchanged) ──
    const strategyContent = deterministicJson(strategy);
    fs.writeFileSync(path.join(tmpDir, '03_STRATEGY_RECOMMENDATION.json'), strategyContent);

    // ── 03: Strategy recommendation MD (copy unchanged) ──
    fs.writeFileSync(path.join(tmpDir, '03_STRATEGY_RECOMMENDATION.md'), strategyMd);

    // ── 04: Transcript reference stubs ──
    const transcripts = transcriptsManifest.transcripts.slice().sort((a, b) => a.id.localeCompare(b.id));
    for (const t of transcripts) {
      const stub = {
        id: t.id,
        name: t.name,
        year_hint: t.year_hint,
        sha256: t.sha256,
        source_path: t.path,
        doc_type: 'transcript',
        notes: 'Reference stub. Original document available in tax vault.'
      };
      fs.writeFileSync(
        path.join(tmpDir, '04_TRANSCRIPTS', `${t.id}__REFERENCE.json`),
        deterministicJson(stub)
      );
    }

    // ── 05: Notice reference stubs ──
    const notices = noticesManifest.notices.slice().sort((a, b) => a.id.localeCompare(b.id));
    for (const n of notices) {
      const stub = {
        id: n.id,
        name: n.name,
        year_hint: n.year_hint,
        sha256: n.sha256,
        source_path: n.path,
        doc_type: 'notice',
        notes: 'Reference stub. Original document available in tax vault.'
      };
      fs.writeFileSync(
        path.join(tmpDir, '05_NOTICES', `${n.id}__REFERENCE.json`),
        deterministicJson(stub)
      );
    }

    // ── 06: Document checklist (copy unchanged) ──
    fs.writeFileSync(path.join(tmpDir, '06_DOCUMENT_CHECKLIST.md'), docsMd);

    // ── 99: Supporting docs index (copy unchanged) ──
    const supportingContent = deterministicJson(supportingDocs);
    fs.writeFileSync(path.join(tmpDir, '99_SUPPORTING_DOCS_INDEX.json'), supportingContent);

    // ── 00: Cover sheet (generated deterministically) ──
    const strat = strategy.strategy;
    const inputs = strategy.inputs || {};
    const isEscalation = strat.type === 'CPA_ESCALATION_REQUIRED';
    const riskFlags = strategy.risk_flags || [];
    const whyThis = strat.why_this_strategy || [];

    const coverLines = [];
    coverLines.push('# CPA Handoff Package');
    coverLines.push('');
    coverLines.push('## Package Information');
    coverLines.push('');
    coverLines.push('| Field | Value |');
    coverLines.push('|-------|-------|');
    coverLines.push(`| Case ID | ${args.caseId} |`);
    coverLines.push(`| Package UTC | ${packageUtc} |`);
    coverLines.push(`| Version | CpaPackageV1 |`);
    coverLines.push(`| Source Bundle | ${args.bundlePath} |`);
    coverLines.push('');
    coverLines.push('## Strategy Summary');
    coverLines.push('');
    coverLines.push('| Field | Value |');
    coverLines.push('|-------|-------|');
    coverLines.push(`| Strategy | **${strategyLabel(strat.type)}** |`);
    if (!isEscalation) {
      coverLines.push(`| Recommended Monthly Payment | ${fmtDollars(strat.recommended_monthly_payment)} |`);
      coverLines.push(`| Estimated Months to Payoff | ${fmtMonths(strat.estimated_months_to_payoff)} |`);
    }
    coverLines.push(`| Total Liability | ${fmtDollars(inputs.total_liability)} |`);
    coverLines.push(`| Monthly Capacity (likely) | ${fmtDollars(inputs.capacity_likely)} |`);
    coverLines.push(`| Risk Flags | ${riskFlags.length > 0 ? riskFlags.join(', ') : 'None'} |`);
    coverLines.push('');

    if (isEscalation) {
      coverLines.push('## Escalation Reasons');
      coverLines.push('');
      for (const reason of whyThis) {
        coverLines.push(`- ${reason}`);
      }
      coverLines.push('');
    }

    coverLines.push('## File Inventory');
    coverLines.push('');
    coverLines.push('| Category | Count |');
    coverLines.push('|----------|-------|');
    coverLines.push(`| Transcripts | ${transcripts.length} |`);
    coverLines.push(`| Notices | ${notices.length} |`);
    coverLines.push(`| Supporting Documents | ${(supportingDocs.documents || []).length} |`);
    coverLines.push('');
    coverLines.push('---');
    coverLines.push('');
    coverLines.push('> **Disclaimer:** This package is for CPA/EA review only. Not legal advice. Confirm all figures before acting.');
    coverLines.push('');

    const coverContent = coverLines.join('\n');
    fs.writeFileSync(path.join(tmpDir, '00_COVER_SHEET.md'), coverContent);

    // ── manifest.json (generated last) ──
    const manifestFiles = [];

    function addFileToManifest(relPath) {
      const fullPath = path.join(tmpDir, relPath);
      const content = fs.readFileSync(fullPath);
      manifestFiles.push({
        path: relPath,
        sha256: sha256(content)
      });
    }

    // Add all files in stable order
    addFileToManifest('00_COVER_SHEET.md');
    addFileToManifest('01_LIABILITY_SNAPSHOT.json');
    addFileToManifest('02_PAYMENT_PLAN_MODEL.json');
    addFileToManifest('03_STRATEGY_RECOMMENDATION.json');
    addFileToManifest('03_STRATEGY_RECOMMENDATION.md');

    // Transcript stubs (sorted by id)
    for (const t of transcripts) {
      addFileToManifest(`04_TRANSCRIPTS/${t.id}__REFERENCE.json`);
    }

    // Notice stubs (sorted by id)
    for (const n of notices) {
      addFileToManifest(`05_NOTICES/${n.id}__REFERENCE.json`);
    }

    addFileToManifest('06_DOCUMENT_CHECKLIST.md');
    addFileToManifest('99_SUPPORTING_DOCS_INDEX.json');

    const manifest = {
      version: 'CpaPackageV1',
      case_id: args.caseId,
      package_utc: packageUtc,
      source_bundle_path: args.bundlePath,
      files: manifestFiles
    };

    const manifestContent = deterministicJson(manifest);
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), manifestContent);

    // ── Atomic move into final location ──
    const parentDir = path.dirname(packageDir);
    fs.mkdirSync(parentDir, { recursive: true });

    if (fs.existsSync(packageDir) && args.force) {
      fs.rmSync(packageDir, { recursive: true, force: true });
    }

    fs.renameSync(tmpDir, packageDir);

  } catch (e) {
    // Clean up temp dir on failure
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    if (e.message && e.message.includes('Output already exists')) {
      process.exit(3);
    }
    die(`Package build failed: ${e.message}`, 2);
  }

  // ── Success output ──
  const fileCount = fs.readdirSync(packageDir, { recursive: true })
    .filter(f => {
      const full = path.join(packageDir, f);
      return fs.existsSync(full) && fs.statSync(full).isFile();
    }).length;

  const manifestHash = sha256(fs.readFileSync(path.join(packageDir, 'manifest.json')));
  const coverHash = sha256(fs.readFileSync(path.join(packageDir, '00_COVER_SHEET.md')));

  console.log(`PORT3_OK case=${args.caseId} out=${packageDir} files=${fileCount}`);
  console.log(`MANIFEST_SHA256: ${manifestHash}`);
  console.log(`COVER_SHA256: ${coverHash}`);
}

main();
