#!/usr/bin/env node
/**
 * run_agent.js - Unified Tax Pod Agent Runner
 *
 * Usage:
 *   node tax/cli/run_agent.js --agent payment_plan_first --in <intake.json> --out <output_dir>
 *   node tax/cli/run_agent.js --agent irs_notice_triage --in <intake.json> --out <output_dir>
 *   node tax/cli/run_agent.js --agent cost_seg_support --in <intake.json> --out <output_dir>
 *
 * Outputs (deterministic, standardized):
 *   <output_dir>/<caseId>/response.md
 *   <output_dir>/<caseId>/evidence.json
 *   <output_dir>/<caseId>/artifacts/*.csv  (if applicable)
 *
 * Contract: tax/contracts/output_contract.md
 * Delivery Gate: tax/runtime/delivery_gate.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { analyzePaymentPlanFirst } = require('../runtime/payment_plan_first.js');
const { analyzeIrsNoticeTriage } = require('../runtime/irs_notice_triage.js');
const { analyzeCostSegSupport } = require('../runtime/cost_seg_support.js');
const { normalizeIntakeForId, safeId, stableJsonStringify } = require('../runtime/util.js');
const { loadVaultIndex } = require('../runtime/vault_reader.js');
const { validateDelivery } = require('../runtime/delivery_gate.js');
const { normalizeAgentOutputs } = require('../runtime/normalize_outputs.js');
const { buildRunEvent, appendEventLine } = require('../runtime/event_emitter.js');
const crypto = require('crypto');

// Agent registry
const AGENTS = {
  payment_plan_first: {
    analyzeFunc: analyzePaymentPlanFirst,
    agentId: 'payment-plan-agent',
    requiredFields: ['balance_estimate_range']
  },
  irs_notice_triage: {
    analyzeFunc: analyzeIrsNoticeTriage,
    agentId: 'irs-notice-triage-agent',
    requiredFields: [] // notice_code and notice_summary are optional (can have either)
  },
  cost_seg_support: {
    analyzeFunc: analyzeCostSegSupport,
    agentId: 'cost-seg-support-agent',
    requiredFields: [] // property_type OR purchase_price_range (validation done in runtime)
  }
};

// Parse CLI arguments
const args = process.argv.slice(2);
let agentKey = null;
let intakeFile = null;
let outputDir = null;
let nowUtcFlag = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--agent' && args[i + 1]) {
    agentKey = args[++i];
  } else if (args[i] === '--in' && args[i + 1]) {
    intakeFile = args[++i];
  } else if (args[i] === '--out' && args[i + 1]) {
    outputDir = args[++i];
  } else if (args[i] === '--now-utc' && args[i + 1]) {
    nowUtcFlag = args[++i];
  }
}

// Validate arguments
if (!agentKey || !intakeFile || !outputDir) {
  console.error('Usage: node tax/cli/run_agent.js --agent <agent_key> --in <intake.json> --out <output_dir>');
  console.error('');
  console.error('Available agents:');
  console.error('  - payment_plan_first');
  console.error('  - irs_notice_triage');
  console.error('  - cost_seg_support');
  process.exit(1);
}

if (!AGENTS[agentKey]) {
  console.error(`ERROR: Unknown agent: ${agentKey}`);
  console.error('');
  console.error('Available agents:');
  console.error('  - payment_plan_first');
  console.error('  - irs_notice_triage');
  console.error('  - cost_seg_support');
  process.exit(1);
}

const agent = AGENTS[agentKey];

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
const missingFields = agent.requiredFields.filter(field => {
  return !intake[field] && intake[field] !== false && intake[field] !== 0;
});

if (missingFields.length > 0) {
  console.error(`ERROR: Intake missing required fields: ${missingFields.join(', ')}`);
  process.exit(1);
}

// Generate deterministic case ID from normalized intake
const normalizedIntake = normalizeIntakeForId(intake);
const caseId = safeId(agentKey, normalizedIntake);

// Generate deterministic timestamp (use --now-utc flag if provided, else _fixture_timestamp, else current)
const nowUtc = nowUtcFlag || intake._fixture_timestamp || new Date().toISOString();

// Compute input hash for event emission
const inputHash = 'sha256:' + crypto.createHash('sha256').update(stableJsonStringify(normalizedIntake)).digest('hex');

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
console.log(`Running ${agentKey} for case: ${caseId}`);
console.log(`Intake file: ${intakeFile}`);
console.log(`Output directory: ${outputDir}`);

let result;
try {
  result = agent.analyzeFunc(intake, {
    nowUtc,
    caseId,
    agentId: agent.agentId,
    vaultIndex,
    repoRoot
  });
} catch (err) {
  console.error(`ERROR: Analysis failed: ${err.message}`);
  process.exit(1);
}

// Normalize outputs to contract
let normalized;
try {
  normalized = normalizeAgentOutputs(agentKey, result, vaultIndex);
} catch (err) {
  console.error(`ERROR: Output normalization failed: ${err.message}`);
  process.exit(1);
}

// Run delivery gate validation
const validation = validateDelivery({
  responseMarkdown: normalized.responseMarkdown,
  evidenceRecord: normalized.evidenceRecord,
  requiredSections: []
});

if (!validation.pass) {
  console.error('');
  console.error('DELIVERY_GATE: FAIL');
  console.error('');
  console.error('Validation failed with the following reasons:');
  validation.reasons.forEach((reason, idx) => {
    console.error(`  ${idx + 1}. ${reason}`);
  });
  console.error('');
  console.error('Outputs NOT written (fail-closed).');
  process.exit(1);
}

// Delivery gate passed — write outputs
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
  fs.writeFileSync(responsePath, normalized.responseMarkdown, 'utf8');
  console.log(`✓ Wrote response: ${responsePath}`);
} catch (err) {
  console.error(`ERROR: Failed to write response.md: ${err.message}`);
  process.exit(1);
}

// Write evidence.json (deterministic via stable stringify)
const evidencePath = path.join(caseDir, 'evidence.json');
try {
  const evidenceJson = stableJsonStringify(normalized.evidenceRecord);
  fs.writeFileSync(evidencePath, evidenceJson, 'utf8');
  console.log(`✓ Wrote evidence: ${evidencePath}`);
} catch (err) {
  console.error(`ERROR: Failed to write evidence.json: ${err.message}`);
  process.exit(1);
}

// Write artifacts (if any)
if (normalized.artifacts && normalized.artifacts.length > 0) {
  const artifactsDir = path.join(caseDir, 'artifacts');
  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
  } catch (err) {
    console.error(`ERROR: Failed to create artifacts directory: ${err.message}`);
    process.exit(1);
  }

  for (const artifact of normalized.artifacts) {
    const artifactPath = path.join(artifactsDir, artifact.path);
    try {
      fs.writeFileSync(artifactPath, artifact.bytes, 'utf8');
      console.log(`✓ Wrote artifact: ${artifactPath}`);
    } catch (err) {
      console.error(`ERROR: Failed to write artifact ${artifact.path}: ${err.message}`);
      process.exit(1);
    }
  }
}

// Emit audit event to events.jsonl
try {
  const repoRoot = path.resolve(__dirname, '../..');
  const eventsPath = path.join(repoRoot, 'tax', 'events', 'events.jsonl');

  const eventObject = buildRunEvent({
    nowUtc,
    caseId,
    agentKey,
    agentId: agent.agentId,
    inputHash,
    outDir: outputDir,
    outputs: normalized,
    evidenceRecord: normalized.evidenceRecord,
    deliveryGateVersion: '1.0'
  });

  appendEventLine({
    eventsPath,
    eventObject
  });

  console.log(`✓ Emitted event to: ${eventsPath}`);
} catch (err) {
  console.warn(`Warning: Failed to emit event: ${err.message}`);
  // Non-fatal: continue even if event emission fails
}

console.log('');
console.log('DELIVERY_GATE: PASS');
console.log(`Analysis complete for case: ${caseId}`);
console.log(`Output files:`);
console.log(`  - ${responsePath}`);
console.log(`  - ${evidencePath}`);
if (normalized.artifacts && normalized.artifacts.length > 0) {
  normalized.artifacts.forEach(art => {
    console.log(`  - ${path.join(caseDir, 'artifacts', art.path)}`);
  });
}

process.exit(0);
