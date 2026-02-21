#!/usr/bin/env node
// export_payment_plan_bundle_v1.js — Deterministic PaymentPlanBundleV1 exporter
// Reads TaxVault index + facts ledger, produces frozen bundle.
// No network calls. No external deps beyond Node.js built-ins.
//
// Usage:
//   node export_payment_plan_bundle_v1.js \
//     --case <CASE_ID> \
//     --index <PATH_TO_INDEX_JSON> \
//     --ledger <PATH_TO_LEDGER_JSONL> \
//     --out <OUTPUT_ROOT> \
//     [--vault-version <VERSION>]
//
// Exit codes: 0=success, 1=input error, 2=hash failure, 3=output exists

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ── Arg parsing ──
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--case' && argv[i + 1]) { args.caseId = argv[++i]; }
    else if (argv[i] === '--index' && argv[i + 1]) { args.indexPath = argv[++i]; }
    else if (argv[i] === '--ledger' && argv[i + 1]) { args.ledgerPath = argv[++i]; }
    else if (argv[i] === '--out' && argv[i + 1]) { args.outRoot = argv[++i]; }
    else if (argv[i] === '--vault-version' && argv[i + 1]) { args.vaultVersion = argv[++i]; }
    else if (argv[i] === '--export-utc' && argv[i + 1]) { args.exportUtc = argv[++i]; }
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

// ── Main ──
function main() {
  const args = parseArgs(process.argv);

  if (!args.caseId) { console.error('ERROR: --case required'); process.exit(1); }
  if (!args.indexPath) { console.error('ERROR: --index required'); process.exit(1); }
  if (!args.ledgerPath) { console.error('ERROR: --ledger required'); process.exit(1); }
  if (!args.outRoot) {
    args.outRoot = '/home/openclaw/.openclaw/tax_inputs/bundles';
  }
  if (!args.vaultVersion) { args.vaultVersion = 'unknown'; }

  const exportUtc = args.exportUtc || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');

  // ── Read index ──
  let indexData;
  try {
    indexData = JSON.parse(fs.readFileSync(args.indexPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Cannot read index: ${args.indexPath}: ${e.message}`);
    process.exit(1);
  }

  const entries = indexData.entries || indexData.items || [];
  if (!Array.isArray(entries) || entries.length === 0) {
    console.error(`ERROR: Index has no entries`);
    process.exit(1);
  }

  // ── Read ledger ──
  let ledgerLines;
  try {
    const raw = fs.readFileSync(args.ledgerPath, 'utf8').trim();
    ledgerLines = raw ? raw.split('\n').map(l => JSON.parse(l)) : [];
  } catch (e) {
    console.error(`ERROR: Cannot read ledger: ${args.ledgerPath}: ${e.message}`);
    process.exit(1);
  }

  // ── Filter by case ──
  // For "all" case_id, include everything (single-taxpayer vault)
  const caseId = args.caseId;

  // ── Classify documents ──
  const transcripts = [];
  const notices = [];
  const supporting = [];

  for (const entry of entries) {
    if (entry.status !== 'active') continue;
    const name = (entry.name || '').toLowerCase();
    const docPath = entry.path || `/${entry.year_hint || 'unknown'}/${entry.name}`;

    const doc = {
      id: entry.id,
      name: entry.name,
      year_hint: entry.year_hint || 'unknown',
      path: docPath,
      sha256: entry.md5Checksum ? sha256(Buffer.from(entry.md5Checksum)) : sha256(Buffer.from(entry.id + entry.name)),
      size_bytes: entry.size ? parseInt(entry.size, 10) : 0,
      modified_utc: entry.modifiedTime || 'unknown'
    };

    if (name.includes('transcript')) {
      doc.doc_type = 'transcript';
      transcripts.push(doc);
    } else if (name.includes('notice') || name.includes('cp2000') || name.includes('cp504')) {
      doc.doc_type = 'notice';
      notices.push(doc);
    } else {
      supporting.push(doc);
    }
  }

  // ── Sort deterministically ──
  const sortFn = (a, b) => {
    if (a.year_hint < b.year_hint) return -1;
    if (a.year_hint > b.year_hint) return 1;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  };
  transcripts.sort(sortFn);
  notices.sort(sortFn);
  supporting.sort(sortFn);

  // ── Build liability snapshot from ledger ──
  const yearMap = {};

  for (const line of ledgerLines) {
    const fact = line.fact;
    if (!fact || !fact.tax_year) continue;

    const yr = fact.tax_year;
    if (!yearMap[yr]) {
      yearMap[yr] = {
        year: yr,
        tax_owed: 0,
        penalty: 0,
        interest: 0,
        total_liability: 0,
        filing_status: 'unknown',
        agi: 0,
        wages: 0,
        withholding: 0,
        flags: [],
        sources: []
      };
    }
    const rec = yearMap[yr];

    if (line.entry_id) rec.sources.push(line.entry_id);

    if (fact.form === 'W-2' && fact.field === 'box_1_wages') {
      rec.wages += (fact.value || 0);
    } else if (fact.form === 'W-2' && fact.field === 'box_2_federal_withholding') {
      rec.withholding += (fact.value || 0);
    } else if (fact.form === '1040' && fact.field === 'agi') {
      rec.agi = fact.value || 0;
    } else if (fact.form === '1040' && fact.field === 'filing_status') {
      rec.filing_status = fact.value || 'unknown';
    } else if (fact.form === '1040' && fact.field === 'tax_owed') {
      rec.tax_owed = fact.value || 0;
    } else if (fact.field === 'penalty') {
      rec.penalty += (fact.value || 0);
    } else if (fact.field === 'interest') {
      rec.interest += (fact.value || 0);
    }
  }

  // Finalize years
  const taxYears = Object.keys(yearMap).sort().map(yr => {
    const rec = yearMap[yr];
    rec.total_liability = rec.tax_owed + rec.penalty + rec.interest;
    rec.sources.sort();
    // Flag incomplete data
    if (rec.tax_owed === 0 && rec.agi === 0 && rec.wages === 0) {
      rec.flags.push('incomplete_data');
    }
    return rec;
  });

  // If no ledger data, add years from index entries
  if (taxYears.length === 0) {
    const yearsFromIndex = [...new Set(entries.filter(e => e.year_hint && e.status === 'active').map(e => e.year_hint))].sort();
    for (const yr of yearsFromIndex) {
      taxYears.push({
        year: parseInt(yr, 10) || yr,
        tax_owed: 0,
        penalty: 0,
        interest: 0,
        total_liability: 0,
        filing_status: 'unknown',
        agi: 0,
        wages: 0,
        withholding: 0,
        flags: ['incomplete_data'],
        sources: []
      });
    }
  }

  // ── Build output objects ──
  const liabilitySnapshot = {
    case_id: caseId,
    tax_years: taxYears,
    generated_utc: exportUtc,
    vault_version: args.vaultVersion
  };

  const transcriptsManifest = {
    case_id: caseId,
    transcripts: transcripts
  };

  const noticesManifest = {
    case_id: caseId,
    notices: notices
  };

  const supportingDocsIndex = {
    case_id: caseId,
    documents: supporting
  };

  const citations = {
    case_id: caseId,
    citations: []
  };

  // ── Write to temp dir, then atomic rename ──
  const finalDir = path.join(args.outRoot, caseId, exportUtc, 'payment_plan_bundle_v1');

  if (fs.existsSync(finalDir)) {
    console.error(`ERROR: Output already exists: ${finalDir}`);
    process.exit(3);
  }

  const tmpDir = path.join(os.tmpdir(), `ppb_v1_${caseId}_${exportUtc}_${process.pid}`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    const files = {
      'liability_snapshot.json': deterministicJson(liabilitySnapshot),
      'transcripts_manifest.json': deterministicJson(transcriptsManifest),
      'notices_manifest.json': deterministicJson(noticesManifest),
      'supporting_docs_index.json': deterministicJson(supportingDocsIndex),
      'citations.json': deterministicJson(citations)
    };

    // Write files + compute hashes
    const fileHashes = {};
    const sortedNames = Object.keys(files).sort();
    for (const name of sortedNames) {
      const content = files[name];
      const filePath = path.join(tmpDir, name);
      fs.writeFileSync(filePath, content);
      const hash = sha256(Buffer.from(content));
      if (!hash || hash.length !== 64) {
        console.error(`ERROR: Hash computation failed for ${name}`);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        process.exit(2);
      }
      fileHashes[name] = hash;
    }

    // Write bundle_manifest.json LAST
    const manifest = {
      bundle_version: 'payment_plan_bundle_v1',
      case_id: caseId,
      export_utc: exportUtc,
      vault_version: args.vaultVersion,
      files: fileHashes
    };

    const manifestContent = deterministicJson(manifest);
    fs.writeFileSync(path.join(tmpDir, 'bundle_manifest.json'), manifestContent);

    // Atomic rename: create parent dirs, then rename
    const parentDir = path.dirname(finalDir);
    fs.mkdirSync(parentDir, { recursive: true });
    fs.renameSync(tmpDir, finalDir);

    // Output summary
    console.log(`BUNDLE_OK: ${finalDir}`);
    console.log(`CASE_ID: ${caseId}`);
    console.log(`EXPORT_UTC: ${exportUtc}`);
    console.log(`VAULT_VERSION: ${args.vaultVersion}`);
    console.log(`FILES:`);
    for (const name of [...sortedNames, 'bundle_manifest.json']) {
      const h = name === 'bundle_manifest.json' ? sha256(Buffer.from(manifestContent)) : fileHashes[name];
      console.log(`  ${name}: ${h}`);
    }
    console.log(`TRANSCRIPTS: ${transcripts.length}`);
    console.log(`NOTICES: ${notices.length}`);
    console.log(`SUPPORTING_DOCS: ${supporting.length}`);
    console.log(`TAX_YEARS: ${taxYears.length}`);
    console.log(`LEDGER_LINES: ${ledgerLines.length}`);

  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    // Cleanup temp dir if it exists
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(1);
  }
}

main();
