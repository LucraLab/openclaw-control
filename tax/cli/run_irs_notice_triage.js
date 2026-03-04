#!/usr/bin/env node
/**
 * run_irs_notice_triage.js - CLI for IRS Notice Triage analysis
 *
 * Usage:
 *   node tax/cli/run_irs_notice_triage.js --in <notice_intake.json> --out <output_dir>
 *
 * Outputs (deterministic):
 *   <output_dir>/<caseId>/notice_response.md
 *   <output_dir>/<caseId>/notice_evidence.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { analyzeIrsNoticeTriage } = require('../runtime/irs_notice_triage.js');
const { normalizeIntakeForId, safeId, stableJsonStringify } = require('../runtime/util.js');
const { loadVaultIndex } = require('../runtime/vault_reader.js');

// Parse CLI arguments
const args = process.argv.slice(2);
let intakeFile = null;
let outputDir = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--in' && args[i + 1]) {
    intakeFile = args[++i];
  } else if (args[i] === '--out' && args[i + 1]) {
    outputDir = args[++i];
  }
}

if (!intakeFile || !outputDir) {
  console.error('Usage: node tax/cli/run_irs_notice_triage.js --in <notice_intake.json> --out <output_dir>');
  process.exit(1);
}

// Read intake file
let intake;
try {
  const intakeJson = fs.readFileSync(intakeFile, 'utf8');
  intake = JSON.parse(intakeJson);
} catch (err) {
  console.error(`ERROR: Failed to read intake file: ${err.message}`);
  process.exit(1);
}

// Validate minimal required fields
if (!intake.notice_code && !intake.notice_summary) {
  console.error('ERROR: Intake missing notice_code or notice_summary');
  process.exit(1);
}

// Generate deterministic case ID from normalized intake
const normalizedIntake = normalizeIntakeForId(intake);
const caseId = safeId('irs-notice', normalizedIntake);

// Generate deterministic timestamp
const nowUtc = intake._fixture_timestamp || new Date().toISOString();

// Load vault index (repo root is two levels up from this script)
const repoRoot = path.resolve(__dirname, '../..');
let vaultIndex = null;
try {
  vaultIndex = loadVaultIndex(repoRoot);
  console.log(`Loaded vault index with ${Object.keys(vaultIndex.sources).length} sources`);
} catch (err) {
  console.warn(`Warning: Could not load vault index: ${err.message}`);
  console.warn(`Proceeding without vault citations.`);
}

// Execute analysis
console.log(`Analyzing IRS notice for case: ${caseId}`);
console.log(`Intake file: ${intakeFile}`);
console.log(`Output directory: ${outputDir}`);

let result;
try {
  result = analyzeIrsNoticeTriage(intake, {
    nowUtc,
    caseId,
    agentId: 'irs-notice-triage-agent',
    vaultIndex
  });
} catch (err) {
  console.error(`ERROR: Analysis failed: ${err.message}`);
  process.exit(1);
}

// Create output directory structure
const caseDir = path.join(outputDir, caseId);
try {
  fs.mkdirSync(caseDir, { recursive: true });
} catch (err) {
  console.error(`ERROR: Failed to create output directory: ${err.message}`);
  process.exit(1);
}

// Write notice_response.md (deterministic)
const responsePath = path.join(caseDir, 'notice_response.md');
try {
  fs.writeFileSync(responsePath, result.responseMarkdown, 'utf8');
  console.log(`✓ Wrote response: ${responsePath}`);
} catch (err) {
  console.error(`ERROR: Failed to write notice_response.md: ${err.message}`);
  process.exit(1);
}

// Write notice_evidence.json (deterministic via stable stringify)
const evidencePath = path.join(caseDir, 'notice_evidence.json');
try {
  const evidenceJson = stableJsonStringify(result.evidenceRecord);
  fs.writeFileSync(evidencePath, evidenceJson, 'utf8');
  console.log(`✓ Wrote evidence: ${evidencePath}`);
} catch (err) {
  console.error(`ERROR: Failed to write notice_evidence.json: ${err.message}`);
  process.exit(1);
}

console.log(`\nIRS Notice Triage analysis complete for case: ${caseId}`);
console.log(`Output files:`);
console.log(`  - ${responsePath}`);
console.log(`  - ${evidencePath}`);

process.exit(0);
