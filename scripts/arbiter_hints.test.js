#!/usr/bin/env node
/**
 * arbiter_hints.test.js — Tests for Strategy → Arbiter Hints Bridge (Port #13)
 *
 * 33 tests covering:
 *   AH-T1  to AH-T5  : Schema validation
 *   AH-T6  to AH-T10 : Hints generation
 *   AH-T11 to AH-T15 : Safety overrides
 *   AH-T16 to AH-T20 : rank_delta computation + clamping
 *   AH-T21 to AH-T25 : Python applier behavior
 *   AH-T26 to AH-T30 : Determinism + tie stability
 *   AH-T31 to AH-T33 : Edge cases + integration
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('============================================');
console.log('  Arbiter Hints — Test Suite (33 tests)');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// --- Load modules ---
const hintsModule = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_hints'));
const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));

const FIXTURES_DIR = path.join(REPO_ROOT, 'scripts', 'fixtures', 'arbiter_hints');
const PY_SCRIPT = path.join(REPO_ROOT, 'scripts', 'lib', 'oc_arbiter_hints.py');

// Helper: run Python applier with given inputs
function runPythonApplier(objectivesJsonl, hintsFilePath, statusFilePath) {
  const tmpDir = path.join(REPO_ROOT, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  const tmpInput = path.join(tmpDir, `ah-test-input-${Date.now()}.jsonl`);
  fs.writeFileSync(tmpInput, objectivesJsonl);

  const statusArg = statusFilePath ? `--status-file "${statusFilePath}"` : '';
  const hintsArg = hintsFilePath ? `--hints "${hintsFilePath}"` : '--hints /nonexistent';
  const cmd = `cat "${tmpInput}" | python3 "${PY_SCRIPT}" ${hintsArg} ${statusArg}`;

  let output;
  try {
    output = execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  } catch (e) {
    output = e.stdout ? e.stdout.trim() : '';
  }

  fs.unlinkSync(tmpInput);
  return output;
}

// ===== Schema Validation (AH-T1 to AH-T5) =====

console.log('--- Schema Validation ---');

test('AH-T1: validateHints accepts valid hints', () => {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'hints_valid.json'), 'utf8'));
  const result = hintsModule.validateHints(data);
  assert(result.valid, `Should be valid: ${result.errors.join(', ')}`);
});

test('AH-T2: validateHints rejects missing version', () => {
  const result = hintsModule.validateHints({ computed_at: 'x', hints: [] });
  assert(!result.valid, 'Should reject missing version');
  assert(result.errors.some(e => e.includes('version')), 'Error should mention version');
});

test('AH-T3: validateHints rejects invalid recommendation_code', () => {
  const result = hintsModule.validateHints({
    version: '1.0.0',
    computed_at: '2025-01-01T00:00:00Z',
    hints: [{
      objective_id: 'obj-1',
      priority_score: 50,
      risk_score: 50,
      confidence: 0.5,
      recommendation_code: 'INVALID',
      rank_delta_hint: 0,
      why_codes: [],
    }],
  });
  assert(!result.valid, 'Should reject invalid recommendation_code');
  assert(result.errors.some(e => e.includes('recommendation_code')), 'Error should mention recommendation_code');
});

test('AH-T4: validateHints rejects rank_delta outside [-10, +10]', () => {
  const result = hintsModule.validateHints({
    version: '1.0.0',
    computed_at: '2025-01-01T00:00:00Z',
    hints: [{
      objective_id: 'obj-1',
      priority_score: 50,
      risk_score: 50,
      confidence: 0.5,
      recommendation_code: 'FOCUS',
      rank_delta_hint: 15,
      why_codes: [],
    }],
  });
  assert(!result.valid, 'Should reject delta > 10');
});

test('AH-T5: validateHints rejects why_codes > 5', () => {
  const result = hintsModule.validateHints({
    version: '1.0.0',
    computed_at: '2025-01-01T00:00:00Z',
    hints: [{
      objective_id: 'obj-1',
      priority_score: 50,
      risk_score: 50,
      confidence: 0.5,
      recommendation_code: 'FOCUS',
      rank_delta_hint: 0,
      why_codes: ['a', 'b', 'c', 'd', 'e', 'f'],
    }],
  });
  assert(!result.valid, 'Should reject > 5 why_codes');
});

// ===== Hints Generation (AH-T6 to AH-T10) =====

console.log('--- Hints Generation ---');

test('AH-T6: generateHints produces valid output from strategy report', () => {
  const report = engine.run(
    {
      events: [],
      gateReports: {},
      objectives: { 'obj-1': { objective_id: 'obj-1', tags: ['revenue'], roi_likelihood: 'high' } },
      quarantine: {},
      killSwitch: false,
      commitSha: 'test',
    },
    { fixtures_mode: true }
  );
  const hints = hintsModule.generateHints(report);
  assert(hints !== null, 'hints should not be null');
  assertEqual(hints.version, '1.0.0', 'version');
  assert(Array.isArray(hints.hints), 'hints.hints should be array');
  assertEqual(hints.hints.length, 1, 'should have 1 hint');
});

test('AH-T7: generateHints returns null on FAILCLOSED report', () => {
  const result = hintsModule.generateHints({ status: 'FAILCLOSED', objectives: [] });
  assert(result === null, 'Should return null on FAILCLOSED');
});

test('AH-T8: generateHints returns empty hints for empty objectives', () => {
  const report = { status: 'OK', objectives: [], engine_version: '1.0.0', timestamp: '2025-01-01T00:00:00Z' };
  const hints = hintsModule.generateHints(report);
  assert(hints !== null, 'Should not be null');
  assertEqual(hints.hints.length, 0, 'Should have 0 hints');
});

test('AH-T9: recommendation_code mapping STOP→STOP', () => {
  const report = engine.run(
    {
      events: [],
      gateReports: {},
      objectives: { 'obj-k': { objective_id: 'obj-k', tags: [] } },
      quarantine: {},
      killSwitch: true,
      commitSha: 'test',
    },
    { fixtures_mode: true }
  );
  const hints = hintsModule.generateHints(report);
  assert(hints !== null, 'hints not null');
  const h = hints.hints.find(x => x.objective_id === 'obj-k');
  assert(h, 'hint for obj-k missing');
  assertEqual(h.recommendation_code, 'STOP', 'STOP mapping');
});

test('AH-T10: recommendation_code mapping DEPRIORITIZE→CONTAIN', () => {
  assertEqual(hintsModule.RECOMMENDATION_MAP.DEPRIORITIZE, 'CONTAIN', 'mapping');
});

// ===== Safety Overrides (AH-T11 to AH-T15) =====

console.log('--- Safety Overrides ---');

test('AH-T11: isSafetyOverride returns true for kill switch (STOP)', () => {
  assert(hintsModule.isSafetyOverride({ recommended_action: 'STOP', confidence: 0.9, risk_score: 10 }));
});

test('AH-T12: isSafetyOverride returns true for quarantine (HOLD)', () => {
  assert(hintsModule.isSafetyOverride({ recommended_action: 'HOLD', confidence: 0.9, risk_score: 10 }));
});

test('AH-T13: isSafetyOverride returns true for confidence < 0.4', () => {
  assert(hintsModule.isSafetyOverride({ recommended_action: 'PROCEED', confidence: 0.35, risk_score: 10 }));
});

test('AH-T14: isSafetyOverride returns true for risk >= 90', () => {
  assert(hintsModule.isSafetyOverride({ recommended_action: 'PROCEED', confidence: 0.9, risk_score: 92 }));
});

test('AH-T15: generateHints produces delta=0 for safety-overridden objectives', () => {
  const report = engine.run(
    {
      events: [],
      gateReports: {},
      objectives: { 'obj-k': { objective_id: 'obj-k', tags: [] } },
      quarantine: {},
      killSwitch: true,
      commitSha: 'test',
    },
    { fixtures_mode: true }
  );
  const hints = hintsModule.generateHints(report);
  const h = hints.hints.find(x => x.objective_id === 'obj-k');
  assertEqual(h.rank_delta_hint, 0, 'delta should be 0 for kill switch');
});

// ===== rank_delta Computation + Clamping (AH-T16 to AH-T20) =====

console.log('--- rank_delta Computation ---');

test('AH-T16: computeRankDelta(50) = 0 (neutral)', () => {
  assertEqual(hintsModule.computeRankDelta(50), 0, 'delta');
});

test('AH-T17: computeRankDelta(75) = 5 (positive)', () => {
  assertEqual(hintsModule.computeRankDelta(75), 5, 'delta');
});

test('AH-T18: computeRankDelta(25) = -5 (negative)', () => {
  assertEqual(hintsModule.computeRankDelta(25), -5, 'delta');
});

test('AH-T19: computeRankDelta(100) = 10 (max clamp)', () => {
  assertEqual(hintsModule.computeRankDelta(100), 10, 'delta');
});

test('AH-T20: computeRankDelta(0) = -10 (min clamp)', () => {
  assertEqual(hintsModule.computeRankDelta(0), -10, 'delta');
});

// ===== Python Applier Behavior (AH-T21 to AH-T25) =====

console.log('--- Python Applier ---');

test('AH-T21: Python applier reorders with valid hints', () => {
  const objLines = fs.readFileSync(path.join(FIXTURES_DIR, 'objectives.jsonl'), 'utf8');
  const hintsFile = path.join(FIXTURES_DIR, 'hints_valid.json');
  const statusFile = path.join(REPO_ROOT, 'tmp', 'ah-t21-status.txt');

  const output = runPythonApplier(objLines, hintsFile, statusFile);
  const lines = output.split('\n').filter(l => l.trim());
  assertEqual(lines.length, 5, 'should output 5 objectives');

  // obj-44 has delta=6 (highest), should be first
  const first = JSON.parse(lines[0]);
  assertEqual(first.objective_id, 'obj-44', 'obj-44 should be first (highest delta)');

  // obj-42 has delta=5, should be second
  const second = JSON.parse(lines[1]);
  assertEqual(second.objective_id, 'obj-42', 'obj-42 should be second');

  const status = fs.readFileSync(statusFile, 'utf8').trim();
  assert(status.startsWith('APPLIED:'), `Expected APPLIED, got: ${status}`);
  fs.unlinkSync(statusFile);
});

test('AH-T22: Python applier passthrough on missing hints file', () => {
  const objLines = fs.readFileSync(path.join(FIXTURES_DIR, 'objectives.jsonl'), 'utf8');
  const statusFile = path.join(REPO_ROOT, 'tmp', 'ah-t22-status.txt');

  const output = runPythonApplier(objLines, '/nonexistent/path.json', statusFile);
  const lines = output.split('\n').filter(l => l.trim());
  assertEqual(lines.length, 5, 'should output 5 objectives unchanged');

  // Order should be preserved (passthrough)
  const first = JSON.parse(lines[0]);
  assertEqual(first.objective_id, 'obj-42', 'original order preserved');

  const status = fs.readFileSync(statusFile, 'utf8').trim();
  assertEqual(status, 'SKIPPED:missing_hints_file', 'status');
  fs.unlinkSync(statusFile);
});

test('AH-T23: Python applier failclosed on invalid hints', () => {
  const objLines = fs.readFileSync(path.join(FIXTURES_DIR, 'objectives.jsonl'), 'utf8');
  const hintsFile = path.join(FIXTURES_DIR, 'hints_invalid.json');
  const statusFile = path.join(REPO_ROOT, 'tmp', 'ah-t23-status.txt');

  const output = runPythonApplier(objLines, hintsFile, statusFile);
  const lines = output.split('\n').filter(l => l.trim());
  assertEqual(lines.length, 5, 'should output 5 objectives unchanged');

  const status = fs.readFileSync(statusFile, 'utf8').trim();
  assert(status.startsWith('FAILCLOSED:'), `Expected FAILCLOSED, got: ${status}`);
  fs.unlinkSync(statusFile);
});

test('AH-T24: Python applier zeroes delta on safety overrides', () => {
  const objLines = fs.readFileSync(path.join(FIXTURES_DIR, 'objectives.jsonl'), 'utf8');
  const hintsFile = path.join(FIXTURES_DIR, 'hints_safety.json');
  const statusFile = path.join(REPO_ROOT, 'tmp', 'ah-t24-status.txt');

  const output = runPythonApplier(objLines, hintsFile, statusFile);
  const lines = output.split('\n').filter(l => l.trim());
  assertEqual(lines.length, 5, 'should output 5 objectives');

  // hints_safety.json has:
  // obj-42: risk_score=95 (safety override) → delta=0
  // obj-43: confidence=0.3 (safety override) → delta=0
  // obj-44: recommendation_code=STOP (safety override) → delta=0
  // obj-45: recommendation_code=HOLD (safety override) → delta=0
  // obj-46: normal → delta=3 (only non-zero)

  // Only obj-46 should have non-zero delta, so it should be first
  const first = JSON.parse(lines[0]);
  assertEqual(first.objective_id, 'obj-46', 'obj-46 should be first (only non-zero delta)');

  const status = fs.readFileSync(statusFile, 'utf8').trim();
  assert(status.includes('count=1'), `Expected count=1, got: ${status}`);
  fs.unlinkSync(statusFile);
});

test('AH-T25: Python applier handles empty input', () => {
  const statusFile = path.join(REPO_ROOT, 'tmp', 'ah-t25-status.txt');
  const hintsFile = path.join(FIXTURES_DIR, 'hints_valid.json');

  const output = runPythonApplier('', hintsFile, statusFile);
  assertEqual(output, '', 'should produce no output for empty input');

  const status = fs.readFileSync(statusFile, 'utf8').trim();
  assert(status.startsWith('APPLIED:'), `Expected APPLIED, got: ${status}`);
  assert(status.includes('count=0'), `Expected count=0, got: ${status}`);
  fs.unlinkSync(statusFile);
});

// ===== Determinism + Tie Stability (AH-T26 to AH-T30) =====

console.log('--- Determinism + Tie Stability ---');

test('AH-T26: Same inputs produce identical hints across two runs', () => {
  const report = engine.run(
    {
      events: [],
      gateReports: {},
      objectives: {
        'obj-a': { objective_id: 'obj-a', tags: ['revenue'], roi_likelihood: 'high' },
        'obj-b': { objective_id: 'obj-b', tags: ['internal_tooling'], roi_likelihood: 'low' },
      },
      quarantine: {},
      killSwitch: false,
      commitSha: 'test',
    },
    { fixtures_mode: true }
  );

  const hints1 = hintsModule.generateHints(report);
  const hints2 = hintsModule.generateHints(report);

  // Compare without timestamps (they use report.timestamp which is stable)
  assertEqual(JSON.stringify(hints1.hints), JSON.stringify(hints2.hints), 'hints should be identical');
});

test('AH-T27: Python applier deterministic across runs', () => {
  const objLines = fs.readFileSync(path.join(FIXTURES_DIR, 'objectives.jsonl'), 'utf8');
  const hintsFile = path.join(FIXTURES_DIR, 'hints_valid.json');

  const output1 = runPythonApplier(objLines, hintsFile, null);
  const output2 = runPythonApplier(objLines, hintsFile, null);
  assertEqual(output1, output2, 'two runs should produce identical output');
});

test('AH-T28: Tie stability — same delta preserves original order', () => {
  // Create hints where two objectives have same delta
  const tmpHints = path.join(REPO_ROOT, 'tmp', 'ah-t28-hints.json');
  const tieHints = {
    version: '1.0.0',
    computed_at: '2025-01-15T12:00:00Z',
    source_engine_version: '1.0.0',
    hints: [
      { objective_id: 'obj-42', priority_score: 60, risk_score: 30, confidence: 0.8, recommendation_code: 'FOCUS', rank_delta_hint: 3, why_codes: [] },
      { objective_id: 'obj-43', priority_score: 60, risk_score: 30, confidence: 0.8, recommendation_code: 'FOCUS', rank_delta_hint: 3, why_codes: [] },
      { objective_id: 'obj-44', priority_score: 60, risk_score: 30, confidence: 0.8, recommendation_code: 'FOCUS', rank_delta_hint: 3, why_codes: [] },
      { objective_id: 'obj-45', priority_score: 60, risk_score: 30, confidence: 0.8, recommendation_code: 'FOCUS', rank_delta_hint: 3, why_codes: [] },
      { objective_id: 'obj-46', priority_score: 60, risk_score: 30, confidence: 0.8, recommendation_code: 'FOCUS', rank_delta_hint: 3, why_codes: [] },
    ],
  };
  fs.writeFileSync(tmpHints, JSON.stringify(tieHints));

  const objLines = fs.readFileSync(path.join(FIXTURES_DIR, 'objectives.jsonl'), 'utf8');
  const output = runPythonApplier(objLines, tmpHints, null);
  const lines = output.split('\n').filter(l => l.trim());

  // All have same delta → original order preserved
  const ids = lines.map(l => JSON.parse(l).objective_id);
  assertEqual(ids[0], 'obj-42', 'position 0');
  assertEqual(ids[1], 'obj-43', 'position 1');
  assertEqual(ids[2], 'obj-44', 'position 2');
  assertEqual(ids[3], 'obj-45', 'position 3');
  assertEqual(ids[4], 'obj-46', 'position 4');

  fs.unlinkSync(tmpHints);
});

test('AH-T29: All deltas = 0 preserves original order', () => {
  const tmpHints = path.join(REPO_ROOT, 'tmp', 'ah-t29-hints.json');
  const zeroHints = {
    version: '1.0.0',
    computed_at: '2025-01-15T12:00:00Z',
    source_engine_version: '1.0.0',
    hints: [
      { objective_id: 'obj-42', priority_score: 50, risk_score: 50, confidence: 0.5, recommendation_code: 'FOCUS', rank_delta_hint: 0, why_codes: [] },
      { objective_id: 'obj-43', priority_score: 50, risk_score: 50, confidence: 0.5, recommendation_code: 'FOCUS', rank_delta_hint: 0, why_codes: [] },
    ],
  };
  fs.writeFileSync(tmpHints, JSON.stringify(zeroHints));

  const objLines = fs.readFileSync(path.join(FIXTURES_DIR, 'objectives.jsonl'), 'utf8');
  const output = runPythonApplier(objLines, tmpHints, null);
  const lines = output.split('\n').filter(l => l.trim());
  const ids = lines.map(l => JSON.parse(l).objective_id);

  assertEqual(ids[0], 'obj-42', 'order preserved');
  assertEqual(ids[1], 'obj-43', 'order preserved');
  fs.unlinkSync(tmpHints);
});

test('AH-T30: Hints for unknown objectives are ignored', () => {
  const tmpHints = path.join(REPO_ROOT, 'tmp', 'ah-t30-hints.json');
  const unknownHints = {
    version: '1.0.0',
    computed_at: '2025-01-15T12:00:00Z',
    source_engine_version: '1.0.0',
    hints: [
      { objective_id: 'obj-UNKNOWN', priority_score: 90, risk_score: 10, confidence: 0.9, recommendation_code: 'FOCUS', rank_delta_hint: 8, why_codes: [] },
    ],
  };
  fs.writeFileSync(tmpHints, JSON.stringify(unknownHints));

  const objLines = fs.readFileSync(path.join(FIXTURES_DIR, 'objectives.jsonl'), 'utf8');
  const statusFile = path.join(REPO_ROOT, 'tmp', 'ah-t30-status.txt');
  const output = runPythonApplier(objLines, tmpHints, statusFile);
  const lines = output.split('\n').filter(l => l.trim());
  assertEqual(lines.length, 5, 'should output 5 objectives');

  // Order unchanged (no matching hints)
  const first = JSON.parse(lines[0]);
  assertEqual(first.objective_id, 'obj-42', 'original order');

  const status = fs.readFileSync(statusFile, 'utf8').trim();
  assert(status.includes('count=0'), `Expected count=0 (no matches), got: ${status}`);

  fs.unlinkSync(tmpHints);
  fs.unlinkSync(statusFile);
});

// ===== Edge Cases + Integration (AH-T31 to AH-T33) =====

console.log('--- Edge Cases + Integration ---');

test('AH-T31: extractWhyCodes capped at 5', () => {
  // Build a result with many signals
  const objResult = {
    priority_score: 85,
    risk_score: 75,
    confidence: 0.3,
    recommended_action: 'INVESTIGATE',
    lenses: {
      dev: { signals: ['CI failures detected', 'Retry churn observed', 'Model escalation blocked'] },
      ops: { signals: ['Drift failure detected', 'Lock contention observed', 'Budget breach detected'] },
      business: { signals: ['Overdue by 5 days', 'Missing business metadata'] },
    },
  };
  const codes = hintsModule.extractWhyCodes(objResult);
  assert(codes.length <= 5, `Expected max 5, got ${codes.length}`);
  assert(codes.length > 0, 'Should have at least 1 code');
});

test('AH-T32: Hints artifact sanitized (no secrets)', () => {
  const report = engine.run(
    {
      events: [{ event: 'TEST', objective_id: 'obj-s', token: 'sk-secret12345abc' }],
      gateReports: {},
      objectives: { 'obj-s': { objective_id: 'obj-s', tags: [] } },
      quarantine: {},
      killSwitch: false,
      commitSha: 'test',
    },
    { fixtures_mode: true }
  );
  const hints = hintsModule.generateHints(report);
  const str = JSON.stringify(hints);
  assert(!str.includes('sk-secret12345abc'), 'Secret should not appear in hints');
});

test('AH-T33: End-to-end: engine → hints → Python applier → reordered', () => {
  // Generate report from fixtures
  const esFixtures = path.join(REPO_ROOT, 'scripts', 'fixtures', 'executive_strategy');
  const objectives = JSON.parse(fs.readFileSync(path.join(esFixtures, 'objectives.json'), 'utf8'));
  const events = fs.readFileSync(path.join(esFixtures, 'events.jsonl'), 'utf8').trim()
    .split('\n').map(l => JSON.parse(l));
  const gateReports = JSON.parse(fs.readFileSync(path.join(esFixtures, 'gate_reports.json'), 'utf8'));
  const quarantine = JSON.parse(fs.readFileSync(path.join(esFixtures, 'quarantine.json'), 'utf8'));

  const report = engine.run(
    { events, gateReports, objectives, quarantine, killSwitch: false, commitSha: 'e2e-test' },
    { fixtures_mode: true }
  );

  // Generate hints
  const hints = hintsModule.generateHints(report);
  assert(hints !== null, 'hints should not be null');
  const validation = hintsModule.validateHints(hints);
  assert(validation.valid, `Hints invalid: ${validation.errors.join(', ')}`);

  // Write hints to temp file
  const tmpHints = path.join(REPO_ROOT, 'tmp', 'ah-t33-hints.json');
  fs.writeFileSync(tmpHints, JSON.stringify(hints));

  // Build objectives JSONL from the fixture objectives
  const objLines = Object.values(objectives).map(o => JSON.stringify(o)).join('\n') + '\n';

  // Run Python applier
  const statusFile = path.join(REPO_ROOT, 'tmp', 'ah-t33-status.txt');
  const output = runPythonApplier(objLines, tmpHints, statusFile);
  const lines = output.split('\n').filter(l => l.trim());

  assert(lines.length > 0, 'Python applier should produce output');
  assertEqual(lines.length, Object.keys(objectives).length, 'should output all objectives');

  const status = fs.readFileSync(statusFile, 'utf8').trim();
  assert(status.startsWith('APPLIED:'), `Expected APPLIED, got: ${status}`);

  fs.unlinkSync(tmpHints);
  fs.unlinkSync(statusFile);
});

// --- Summary ---
console.log('');
const total = passed + failed;
console.log(`Arbiter Hints Tests: ${passed}/${total} passed`);

if (failed > 0) {
  console.log(`TESTS FAIL: ${failed} test(s) failed`);
  process.exit(1);
}

process.exit(0);
