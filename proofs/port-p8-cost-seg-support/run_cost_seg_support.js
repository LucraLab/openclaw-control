#!/usr/bin/env node
/**
 * run_cost_seg_support.js - CLI for Cost Segregation Support analysis
 *
 * Usage:
 *   node tax/cli/run_cost_seg_support.js --in <cost_seg_intake.json> --out <output_dir>
 *
 * Outputs (deterministic):
 *   <output_dir>/<caseId>/costseg_response.md
 *   <output_dir>/<caseId>/costseg_evidence.json
 *   <output_dir>/<caseId>/costseg_asset_inventory_template.csv
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { analyzeCostSegSupport } = require('../runtime/cost_seg_support.js');
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
  console.error('Usage: node tax/cli/run_cost_seg_support.js --in <cost_seg_intake.json> --out <output_dir>');
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
if (!intake.property_type && !intake.purchase_price_range) {
  console.error('ERROR: Intake missing property_type or purchase_price_range');
  process.exit(1);
}

// Generate deterministic case ID from normalized intake
const normalizedIntake = normalizeIntakeForId(intake);
const caseId = safeId('cost-seg', normalizedIntake);

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
console.log(`Analyzing cost segregation opportunity for case: ${caseId}`);
console.log(`Intake file: ${intakeFile}`);
console.log(`Output directory: ${outputDir}`);

let result;
try {
  result = analyzeCostSegSupport(intake, {
    nowUtc,
    caseId,
    agentId: 'cost-seg-support-agent',
    vaultIndex,
    repoRoot
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

// Write costseg_response.md (deterministic)
const responsePath = path.join(caseDir, 'costseg_response.md');
try {
  fs.writeFileSync(responsePath, result.responseMarkdown, 'utf8');
  console.log(`✓ Wrote response: ${responsePath}`);
} catch (err) {
  console.error(`ERROR: Failed to write costseg_response.md: ${err.message}`);
  process.exit(1);
}

// Write costseg_evidence.json (deterministic via stable stringify)
const evidencePath = path.join(caseDir, 'costseg_evidence.json');
try {
  const evidenceJson = stableJsonStringify(result.evidenceRecord);
  fs.writeFileSync(evidencePath, evidenceJson, 'utf8');
  console.log(`✓ Wrote evidence: ${evidencePath}`);
} catch (err) {
  console.error(`ERROR: Failed to write costseg_evidence.json: ${err.message}`);
  process.exit(1);
}

// Write costseg_asset_inventory_template.csv
const csvPath = path.join(caseDir, 'costseg_asset_inventory_template.csv');
try {
  fs.writeFileSync(csvPath, result.csvText, 'utf8');
  console.log(`✓ Wrote asset inventory template: ${csvPath}`);
} catch (err) {
  console.error(`ERROR: Failed to write costseg_asset_inventory_template.csv: ${err.message}`);
  process.exit(1);
}

console.log(`\nCost Segregation Support analysis complete for case: ${caseId}`);
console.log(`Output files:`);
console.log(`  - ${responsePath}`);
console.log(`  - ${evidencePath}`);
console.log(`  - ${csvPath}`);

process.exit(0);
