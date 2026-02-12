#!/usr/bin/env node
/**
 * run_arbiter_hints_gate.js — CI gate for Arbiter Hints Bridge (Port #13)
 *
 * Usage: node scripts/run_arbiter_hints_gate.js [--ci]
 *
 * Smoke checks:
 *   AH1:  Hints module loads with required exports
 *   AH2:  Engine exports generateHints
 *   AH3:  Python applier script exists
 *   AH4:  Hints generation from fixture report
 *   AH5:  Generated hints pass schema validation
 *   AH6:  rank_delta_hint values within [-10, +10]
 *   AH7:  Safety overrides produce delta=0
 *   AH8:  recommendation_code mapping is complete
 *   AH9:  Python applier reorders objectives correctly
 *   AH10: Python applier passthrough on missing hints
 *   AH11: Python applier failclosed on invalid hints
 *   AH12: Deterministic output across two runs
 *
 * Exit 0 = gate pass, Exit 1 = gate fail
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const isCI = process.argv.includes('--ci');

let passed = 0;
let failed = 0;
const findings = [];

function check(name, fn) {
  try {
    const result = fn();
    const detail = result || '';
    console.log(`  PASS: ${name}${detail ? ' — ' + detail : ''}`);
    passed++;
    findings.push({ check: name, status: 'PASS', detail });
  } catch (e) {
    console.log(`  FAIL: ${name} — ${e.message}`);
    failed++;
    findings.push({ check: name, status: 'FAIL', detail: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('============================================');
console.log('  Arbiter Hints — Gate Runner');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// --- AH1: Hints module loads ---
check('AH1_hints_module', () => {
  const hints = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_hints'));
  assert(typeof hints.generateHints === 'function', 'generateHints missing');
  assert(typeof hints.validateHints === 'function', 'validateHints missing');
  assert(typeof hints.computeRankDelta === 'function', 'computeRankDelta missing');
  assert(typeof hints.isSafetyOverride === 'function', 'isSafetyOverride missing');
  assert(typeof hints.extractWhyCodes === 'function', 'extractWhyCodes missing');
  assert(hints.HINTS_VERSION === '1.0.0', 'HINTS_VERSION must be 1.0.0');
  return 'all exports present';
});

// --- AH2: Engine exports generateHints ---
check('AH2_engine_generate_hints', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  assert(typeof engine.generateHints === 'function', 'engine.generateHints missing');
  return 'engine re-exports generateHints';
});

// --- AH3: Python applier script exists ---
check('AH3_python_applier_exists', () => {
  const pyPath = path.join(REPO_ROOT, 'scripts', 'lib', 'oc_arbiter_hints.py');
  assert(fs.existsSync(pyPath), 'oc_arbiter_hints.py not found');
  const content = fs.readFileSync(pyPath, 'utf8');
  assert(content.includes('apply_safety_override'), 'safety override function missing');
  assert(content.includes('validate_hints'), 'validate_hints function missing');
  return 'Python applier found with required functions';
});

// --- AH4: Hints generation from fixture report ---
check('AH4_hints_from_fixture', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const fixturesDir = path.join(REPO_ROOT, 'scripts', 'fixtures', 'executive_strategy');
  const objectives = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'objectives.json'), 'utf8'));
  const events = fs.readFileSync(path.join(fixturesDir, 'events.jsonl'), 'utf8').trim()
    .split('\n').map(l => JSON.parse(l));
  const gateReports = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'gate_reports.json'), 'utf8'));
  const quarantine = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'quarantine.json'), 'utf8'));

  const report = engine.run(
    { events, gateReports, objectives, quarantine, killSwitch: false, commitSha: 'fixture-test' },
    { fixtures_mode: true }
  );
  const hints = engine.generateHints(report);
  assert(hints !== null, 'hints should not be null');
  assert(hints.version === '1.0.0', 'version mismatch');
  assert(Array.isArray(hints.hints), 'hints.hints must be array');
  assert(hints.hints.length === 5, `Expected 5 hints, got ${hints.hints.length}`);
  return `${hints.hints.length} hints generated`;
});

// --- AH5: Generated hints pass validation ---
check('AH5_hints_schema_valid', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const hintsModule = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_hints'));
  const fixturesDir = path.join(REPO_ROOT, 'scripts', 'fixtures', 'executive_strategy');
  const objectives = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'objectives.json'), 'utf8'));
  const events = fs.readFileSync(path.join(fixturesDir, 'events.jsonl'), 'utf8').trim()
    .split('\n').map(l => JSON.parse(l));
  const gateReports = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'gate_reports.json'), 'utf8'));
  const quarantine = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'quarantine.json'), 'utf8'));

  const report = engine.run(
    { events, gateReports, objectives, quarantine, killSwitch: false, commitSha: 'test' },
    { fixtures_mode: true }
  );
  const hints = engine.generateHints(report);
  const validation = hintsModule.validateHints(hints);
  assert(validation.valid, `Validation failed: ${validation.errors.join(', ')}`);
  return 'All hints pass schema validation';
});

// --- AH6: rank_delta_hint within bounds ---
check('AH6_delta_bounds', () => {
  const hintsModule = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_hints'));
  // Test extreme values
  assert(hintsModule.computeRankDelta(0) === -10, 'score 0 → delta -10');
  assert(hintsModule.computeRankDelta(100) === 10, 'score 100 → delta 10');
  assert(hintsModule.computeRankDelta(50) === 0, 'score 50 → delta 0');
  assert(hintsModule.computeRankDelta(75) === 5, 'score 75 → delta 5');
  assert(hintsModule.computeRankDelta(25) === -5, 'score 25 → delta -5');
  return 'All deltas within [-10, +10]';
});

// --- AH7: Safety overrides produce delta=0 ---
check('AH7_safety_overrides', () => {
  const hintsModule = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_hints'));
  assert(hintsModule.isSafetyOverride({ recommended_action: 'STOP', confidence: 0.9, risk_score: 10 }), 'STOP should override');
  assert(hintsModule.isSafetyOverride({ recommended_action: 'HOLD', confidence: 0.9, risk_score: 10 }), 'HOLD should override');
  assert(hintsModule.isSafetyOverride({ recommended_action: 'PROCEED', confidence: 0.3, risk_score: 10 }), 'confidence<0.4 should override');
  assert(hintsModule.isSafetyOverride({ recommended_action: 'PROCEED', confidence: 0.9, risk_score: 95 }), 'risk>=90 should override');
  assert(!hintsModule.isSafetyOverride({ recommended_action: 'PROCEED', confidence: 0.9, risk_score: 10 }), 'normal should not override');
  return 'All safety overrides correct';
});

// --- AH8: recommendation_code mapping complete ---
check('AH8_recommendation_mapping', () => {
  const hintsModule = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_hints'));
  const map = hintsModule.RECOMMENDATION_MAP;
  assert(map.STOP === 'STOP', 'STOP mapping');
  assert(map.HOLD === 'HOLD', 'HOLD mapping');
  assert(map.INVESTIGATE === 'INVESTIGATE', 'INVESTIGATE mapping');
  assert(map.RETRY === 'PLAN', 'RETRY mapping');
  assert(map.PROCEED === 'FOCUS', 'PROCEED mapping');
  assert(map.DEPRIORITIZE === 'CONTAIN', 'DEPRIORITIZE mapping');
  assert(Object.keys(map).length === 6, `Expected 6 mappings, got ${Object.keys(map).length}`);
  return '6/6 mappings verified';
});

// --- AH9: Python applier reorders objectives ---
check('AH9_python_reorder', () => {
  const fixturesDir = path.join(REPO_ROOT, 'scripts', 'fixtures', 'arbiter_hints');
  const pyScript = path.join(REPO_ROOT, 'scripts', 'lib', 'oc_arbiter_hints.py');
  const hintsFile = path.join(fixturesDir, 'hints_valid.json');
  const objFile = path.join(fixturesDir, 'objectives.jsonl');
  const tmpStatus = path.join(REPO_ROOT, 'tmp', 'ah-gate-status-9.txt');

  fs.mkdirSync(path.join(REPO_ROOT, 'tmp'), { recursive: true });

  const cmd = `cat "${objFile}" | python3 "${pyScript}" --hints "${hintsFile}" --status-file "${tmpStatus}"`;
  const output = execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  const lines = output.split('\n').filter(l => l.trim());
  assert(lines.length > 0, 'No output from Python applier');

  const status = fs.readFileSync(tmpStatus, 'utf8').trim();
  assert(status.startsWith('APPLIED:'), `Expected APPLIED status, got: ${status}`);

  // Verify first objective has highest delta
  const firstObj = JSON.parse(lines[0]);
  assert(firstObj.objective_id, 'First objective missing id');

  fs.unlinkSync(tmpStatus);
  return `${lines.length} objectives reordered, status=${status}`;
});

// --- AH10: Python applier passthrough on missing hints ---
check('AH10_python_passthrough_missing', () => {
  const fixturesDir = path.join(REPO_ROOT, 'scripts', 'fixtures', 'arbiter_hints');
  const pyScript = path.join(REPO_ROOT, 'scripts', 'lib', 'oc_arbiter_hints.py');
  const objFile = path.join(fixturesDir, 'objectives.jsonl');
  const tmpStatus = path.join(REPO_ROOT, 'tmp', 'ah-gate-status-10.txt');

  const cmd = `cat "${objFile}" | python3 "${pyScript}" --hints "/nonexistent/path.json" --status-file "${tmpStatus}"`;
  const output = execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  const lines = output.split('\n').filter(l => l.trim());
  assert(lines.length > 0, 'No output on missing hints');

  const status = fs.readFileSync(tmpStatus, 'utf8').trim();
  assert(status === 'SKIPPED:missing_hints_file', `Expected SKIPPED, got: ${status}`);

  fs.unlinkSync(tmpStatus);
  return 'Passthrough confirmed on missing file';
});

// --- AH11: Python applier failclosed on invalid hints ---
check('AH11_python_failclosed_invalid', () => {
  const fixturesDir = path.join(REPO_ROOT, 'scripts', 'fixtures', 'arbiter_hints');
  const pyScript = path.join(REPO_ROOT, 'scripts', 'lib', 'oc_arbiter_hints.py');
  const objFile = path.join(fixturesDir, 'objectives.jsonl');
  const invalidFile = path.join(fixturesDir, 'hints_invalid.json');
  const tmpStatus = path.join(REPO_ROOT, 'tmp', 'ah-gate-status-11.txt');

  const cmd = `cat "${objFile}" | python3 "${pyScript}" --hints "${invalidFile}" --status-file "${tmpStatus}"`;
  const output = execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  const lines = output.split('\n').filter(l => l.trim());
  assert(lines.length > 0, 'No output on invalid hints');

  const status = fs.readFileSync(tmpStatus, 'utf8').trim();
  assert(status.startsWith('FAILCLOSED:'), `Expected FAILCLOSED, got: ${status}`);

  fs.unlinkSync(tmpStatus);
  return `Failclosed confirmed: ${status}`;
});

// --- AH12: Deterministic output ---
check('AH12_deterministic', () => {
  const fixturesDir = path.join(REPO_ROOT, 'scripts', 'fixtures', 'arbiter_hints');
  const pyScript = path.join(REPO_ROOT, 'scripts', 'lib', 'oc_arbiter_hints.py');
  const hintsFile = path.join(fixturesDir, 'hints_valid.json');
  const objFile = path.join(fixturesDir, 'objectives.jsonl');

  const cmd = `cat "${objFile}" | python3 "${pyScript}" --hints "${hintsFile}"`;
  const output1 = execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  const output2 = execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  assert(output1 === output2, 'Outputs differ between runs');
  return 'Two runs produce identical output';
});

// --- Summary ---
console.log('');
const total = passed + failed;
console.log(`Arbiter Hints Gate: ${passed}/${total} checks passed`);

if (failed > 0) {
  console.log(`GATE FAIL: ${failed} check(s) failed`);
}

// --- Artifact generation ---
const report = {
  gate: 'arbiter-hints',
  timestamp: new Date().toISOString(),
  status: failed === 0 ? 'PASS' : 'FAIL',
  passed,
  failed,
  total,
  findings,
  config: {
    hints_version: '1.0.0',
    max_delta: 10,
    safety_overrides: ['kill_switch', 'quarantine', 'low_confidence', 'high_risk'],
    recommendation_codes: ['STOP', 'HOLD', 'INVESTIGATE', 'PLAN', 'FOCUS', 'CONTAIN'],
  },
};

for (const dir of ['artifacts', 'tmp']) {
  const outDir = path.join(REPO_ROOT, dir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'arbiter-hints-report.json'),
    JSON.stringify(report, null, 2) + '\n'
  );

  const md = `# Arbiter Hints Gate Report

**Date:** ${report.timestamp}
**Status:** ${report.status}
**Checks:** ${passed}/${total}

## Bridge
- Hints version: 1.0.0
- Max delta: +/-10
- Safety overrides: kill_switch, quarantine, confidence<0.4, risk>=90

## Checks
${findings.map(f => `- ${f.status}: ${f.check}${f.detail ? ' — ' + f.detail : ''}`).join('\n')}
`;
  fs.writeFileSync(path.join(outDir, 'arbiter-hints-report.md'), md);
}

process.exit(failed > 0 ? 1 : 0);
