#!/usr/bin/env node
/**
 * run_payment_plan_first.js - CLI for Payment Plan First analysis
 *
 * Usage:
 *   node tax/cli/run_payment_plan_first.js --in <intake.json> --out <output_dir>
 *
 * Outputs (deterministic):
 *   <output_dir>/<caseId>/response.md
 *   <output_dir>/<caseId>/evidence.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { analyzePaymentPlanFirst } = require('../runtime/payment_plan_first.js');
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
  console.error('Usage: node tax/cli/run_payment_plan_first.js --in <intake.json> --out <output_dir>');
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
if (!intake.filer_type) {
  console.error('ERROR: Intake missing required field: filer_type');
  process.exit(1);
}

if (!intake.tax_years || !Array.isArray(intake.tax_years) || intake.tax_years.length === 0) {
  console.error('ERROR: Intake missing required field: tax_years (must be non-empty array)');
  process.exit(1);
}

// Generate deterministic case ID from normalized intake
const normalizedIntake = normalizeIntakeForId(intake);
const caseId = safeId('tax-case', normalizedIntake);

// Generate deterministic timestamp (use consistent format for determinism)
// In real deployment, this would be actual UTC time, but for fixture mode we use intake timestamp or fixed value
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
console.log(`Analyzing payment plan for case: ${caseId}`);
console.log(`Intake file: ${intakeFile}`);
console.log(`Output directory: ${outputDir}`);

let result;
try {
  result = analyzePaymentPlanFirst(intake, {
    nowUtc,
    caseId,
    agentId: 'payment-plan-agent',
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

// Write response.md (deterministic)
const responsePath = path.join(caseDir, 'response.md');
try {
  fs.writeFileSync(responsePath, result.responseMarkdown, 'utf8');
  console.log(`✓ Wrote response: ${responsePath}`);
} catch (err) {
  console.error(`ERROR: Failed to write response.md: ${err.message}`);
  process.exit(1);
}

// Write evidence.json (deterministic via stable stringify)
const evidencePath = path.join(caseDir, 'evidence.json');
try {
  // Use stable stringify for deterministic output
  const evidenceJson = stableJsonStringify(result.evidenceRecord);
  fs.writeFileSync(evidencePath, evidenceJson, 'utf8');
  console.log(`✓ Wrote evidence: ${evidencePath}`);
} catch (err) {
  console.error(`ERROR: Failed to write evidence.json: ${err.message}`);
  process.exit(1);
}

console.log(`\nPayment Plan First analysis complete for case: ${caseId}`);
console.log(`Output files:`);
console.log(`  - ${responsePath}`);
console.log(`  - ${evidencePath}`);

process.exit(0);
