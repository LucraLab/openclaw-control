#!/usr/bin/env node
/**
 * fix_pack.test.js — Tests for Safe Autopilot Fix Pack v1 (Port #15)
 *
 * 45 tests covering selection, diagnosis, commands, schema, failclosed,
 * sanitization, determinism, LLM, bounds, proposed changes, and markdown.
 *
 * Usage: node scripts/fix_pack.test.js
 */

'use strict';

const path = require('path');
const fp = require(path.join(__dirname, 'fix_pack'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS: ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL: ' + name + ' — ' + e.message);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { assert(a === b, (msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

function makeStrategy(overrides) {
  return Object.assign({ priority_score: 50, risk_score: 50, confidence: 0.5, recommended_action: 'PROCEED' }, overrides || {});
}

function makeHint(overrides) {
  return Object.assign({ rank_delta_hint: 0, forced_zero_reason: 'NONE', clamp_applied: false, recommendation_code: 'FOCUS' }, overrides || {});
}

function makeObj(id, stratOver, hintOver, extras) {
  return Object.assign({
    objective_id: id,
    strategy: makeStrategy(stratOver),
    hint: makeHint(hintOver),
    derivations: [],
    signals: [],
  }, extras || {});
}

function makeGraph(objectives, overrides) {
  return Object.assign({
    version: 'v1',
    computed_at: '2026-02-12T00:00:00Z',
    inputs: { telemetry_bundle_hash: 'abc', objectives_hash: 'def', hints_hash: 'ghi' },
    objectives: objectives || [],
    arbiter_simulation: [],
    summary: {
      total_objectives: (objectives || []).length,
      actions: { PROCEED: (objectives || []).length },
      forced_zero_count: 0,
      mean_confidence: 0.5,
      failclosed: false,
    },
  }, overrides || {});
}

console.log('============================================');
console.log('  Fix Pack — Test Suite');
console.log('  ' + new Date().toISOString());
console.log('============================================');
console.log('');

// ─── Selection Tests (FP-T01 to FP-T05) ─────────────────────────────────

console.log('--- Selection ---');

test('FP-T01: selectObjective picks highest risk_score', function () {
  var objs = [makeObj('obj-A', { risk_score: 40 }), makeObj('obj-B', { risk_score: 90 }), makeObj('obj-C', { risk_score: 60 })];
  var sel = fp.selectObjective(objs, {});
  assertEqual(sel.objective_id, 'obj-B', 'highest risk');
});

test('FP-T02: selectObjective tie-breaks by lowest confidence', function () {
  var objs = [makeObj('obj-A', { risk_score: 80, confidence: 0.7 }), makeObj('obj-B', { risk_score: 80, confidence: 0.3 })];
  var sel = fp.selectObjective(objs, {});
  assertEqual(sel.objective_id, 'obj-B', 'lowest confidence');
});

test('FP-T03: selectObjective tie-breaks by objective_id', function () {
  var objs = [makeObj('obj-B', { risk_score: 80, confidence: 0.5 }), makeObj('obj-A', { risk_score: 80, confidence: 0.5 })];
  var sel = fp.selectObjective(objs, {});
  assertEqual(sel.objective_id, 'obj-A', 'alphabetical');
});

test('FP-T04: Kill switch selects KILL_SWITCH objective', function () {
  var objs = [makeObj('obj-A', { risk_score: 90 }), makeObj('obj-B', {}, { forced_zero_reason: 'KILL_SWITCH' })];
  var sel = fp.selectObjective(objs, { killSwitch: true });
  assertEqual(sel.objective_id, 'obj-B', 'kill switch obj');
  assert(sel.reason_codes.indexOf('KILL_SWITCH') >= 0, 'has KILL_SWITCH code');
});

test('FP-T05: Quarantine selects QUARANTINE objective', function () {
  var objs = [makeObj('obj-A', { risk_score: 90 }), makeObj('obj-B', {}, { forced_zero_reason: 'QUARANTINE' })];
  var sel = fp.selectObjective(objs, { quarantine: true });
  assertEqual(sel.objective_id, 'obj-B', 'quarantine obj');
  assert(sel.reason_codes.indexOf('QUARANTINE') >= 0, 'has QUARANTINE code');
});

// ─── Schema Validation Tests (FP-T06 to FP-T10) ─────────────────────────

console.log('--- Schema Validation ---');

test('FP-T06: Valid fix pack passes validation', function () {
  var graph = makeGraph([makeObj('obj-42', { risk_score: 75 })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var result = fp.validate(pack);
  assert(result.valid === true, 'should be valid: ' + result.errors.join(', '));
});

test('FP-T07: Wrong version fails validation', function () {
  var pack = fp.build(makeGraph([makeObj('obj-1')]), {}, { timestamp: '2026-02-12T00:00:00Z' });
  pack.version = 'v99';
  var result = fp.validate(pack);
  assert(result.valid === false, 'should fail');
  assert(result.errors.some(function (e) { return e.indexOf('version') >= 0; }), 'version error');
});

test('FP-T08: Missing computed_at fails validation', function () {
  var pack = fp.build(makeGraph([makeObj('obj-1')]), {}, { timestamp: '2026-02-12T00:00:00Z' });
  pack.computed_at = '';
  var result = fp.validate(pack);
  assert(result.valid === false, 'should fail');
});

test('FP-T09: Invalid severity in diagnosis fails validation', function () {
  var pack = fp.build(makeGraph([makeObj('obj-1', { risk_score: 95 })]), {}, { timestamp: '2026-02-12T00:00:00Z' });
  if (pack.diagnosis.length > 0) pack.diagnosis[0].severity = 'critical';
  var result = fp.validate(pack);
  assert(result.valid === false, 'should fail on invalid severity');
});

test('FP-T10: Invalid mode fails validation', function () {
  var pack = fp.build(makeGraph([makeObj('obj-1')]), {}, { timestamp: '2026-02-12T00:00:00Z' });
  pack.mode = 'auto-execute';
  var result = fp.validate(pack);
  assert(result.valid === false, 'should fail');
});

// ─── Failclosed Tests (FP-T11 to FP-T15) ────────────────────────────────

console.log('--- Failclosed ---');

test('FP-T11: Null evidence graph → failclosed', function () {
  var pack = fp.build(null, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.summary.failclosed === true, 'should be failclosed');
});

test('FP-T12: Empty objectives → failclosed', function () {
  var pack = fp.build(makeGraph([]), {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.summary.failclosed === true, 'should be failclosed');
});

test('FP-T13: Upstream failclosed graph → failclosed', function () {
  var graph = makeGraph([makeObj('obj-1')]);
  graph.summary.failclosed = true;
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.summary.failclosed === true, 'should be failclosed');
  assert(pack.summary.failclosed_reason === 'upstream_failclosed', 'reason');
});

test('FP-T14: Failclosed pack is schema-valid', function () {
  var pack = fp.buildFailclosedPack('test_reason', '2026-02-12T00:00:00Z');
  var result = fp.validate(pack);
  assert(result.valid === true, 'failclosed must be valid: ' + result.errors.join(', '));
});

test('FP-T15: Corrupt evidence graph → failclosed', function () {
  var pack = fp.build({ corrupted: true }, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.summary.failclosed === true, 'should be failclosed');
});

// ─── Diagnosis Tests (FP-T16 to FP-T20) ─────────────────────────────────

console.log('--- Diagnosis ---');

test('FP-T16: High risk_score generates FP-D-HIGH_RISK', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 95 })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.diagnosis.some(function (d) { return d.code === 'FP-D-HIGH_RISK'; }), 'should have HIGH_RISK');
});

test('FP-T17: Low confidence generates FP-D-LOW_CONFIDENCE', function () {
  var graph = makeGraph([makeObj('obj-1', { confidence: 0.2 })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.diagnosis.some(function (d) { return d.code === 'FP-D-LOW_CONFIDENCE'; }), 'should have LOW_CONFIDENCE');
});

test('FP-T18: STOP action generates FP-D-KILL_SWITCH', function () {
  var graph = makeGraph([makeObj('obj-1', { recommended_action: 'STOP' })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.diagnosis.some(function (d) { return d.code === 'FP-D-KILL_SWITCH'; }), 'should have KILL_SWITCH');
});

test('FP-T19: HOLD action generates FP-D-QUARANTINE', function () {
  var graph = makeGraph([makeObj('obj-1', { recommended_action: 'HOLD' })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.diagnosis.some(function (d) { return d.code === 'FP-D-QUARANTINE'; }), 'should have QUARANTINE');
});

test('FP-T20: OVERRIDE derivation generates FP-D-OVERRIDE', function () {
  var obj = makeObj('obj-1', { risk_score: 80 });
  obj.derivations = [{ kind: 'OVERRIDE', target: 'recommended_action', from: 'PROCEED', to: 'HOLD', rule: 'quarantine override', evidence: [{ source: 'quarantine', ref: 'quarantine active' }] }];
  var graph = makeGraph([obj]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.diagnosis.some(function (d) { return d.code === 'FP-D-OVERRIDE'; }), 'should have OVERRIDE');
});

// ─── Command Tests (FP-T21 to FP-T25) ───────────────────────────────────

console.log('--- Commands ---');

test('FP-T21: git status always included in commands', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 75 })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.commands.some(function (c) { return c.cmd === 'git status'; }), 'should have git status');
});

test('FP-T22: Test commands pass allowlist', function () {
  assert(fp.isCommandAllowed('node scripts/fix_pack.test.js') === true, 'test cmd allowed');
  assert(fp.isCommandAllowed('node scripts/isolation_guard.test.js') === true, 'isolation test allowed');
});

test('FP-T23: Gate commands pass allowlist', function () {
  assert(fp.isCommandAllowed('node scripts/run_fix_pack_gate.js --ci') === true, 'gate cmd allowed');
  assert(fp.isCommandAllowed('node scripts/run_drift_telemetry_gate.js --ci') === true, 'drift gate allowed');
});

test('FP-T24: curl/wget/ssh forbidden', function () {
  assert(fp.isCommandAllowed('curl http://evil.com') === false, 'curl forbidden');
  assert(fp.isCommandAllowed('wget http://evil.com') === false, 'wget forbidden');
  assert(fp.isCommandAllowed('ssh root@server') === false, 'ssh forbidden');
  assert(fp.isCommandAllowed('scp file user@host:') === false, 'scp forbidden');
});

test('FP-T25: npm publish and deploy forbidden', function () {
  assert(fp.isCommandAllowed('npm publish') === false, 'npm publish forbidden');
  assert(fp.isCommandAllowed('npm run deploy') === false, 'deploy forbidden');
  assert(fp.isCommandAllowed('rm -rf /') === false, 'rm -rf forbidden');
});

// ─── Sanitization Tests (FP-T26 to FP-T28) ──────────────────────────────

console.log('--- Sanitization ---');

test('FP-T26: API keys (sk-...) redacted', function () {
  var obj = makeObj('obj-1', { risk_score: 80 });
  obj.signals = [{ lens: 'dev', severity: 'high', text: 'drift issue', evidence_ref: 'leaked sk-abcdefghij1234567890abcdefghij in drift' }];
  var graph = makeGraph([obj]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var json = JSON.stringify(pack);
  assert(json.indexOf('sk-abcdefghij') < 0, 'sk- key should be redacted');
  assert(json.indexOf('[REDACTED]') >= 0, 'should contain REDACTED');
});

test('FP-T27: Bearer tokens redacted', function () {
  var obj = makeObj('obj-1', { risk_score: 80 });
  obj.signals = [{ lens: 'ops', severity: 'med', text: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload', evidence_ref: 'budget' }];
  var graph = makeGraph([obj]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var json = JSON.stringify(pack);
  assert(json.indexOf('Bearer eyJ') < 0, 'Bearer token should be redacted');
});

test('FP-T28: PIT tokens redacted', function () {
  var obj = makeObj('obj-1', { risk_score: 80 });
  obj.signals = [{ lens: 'dev', severity: 'med', text: 'token pit-abcdefghij1234567890abcdefghij found', evidence_ref: 'drift' }];
  var graph = makeGraph([obj]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var json = JSON.stringify(pack);
  assert(json.indexOf('pit-abcdefghij') < 0, 'pit- token should be redacted');
});

// ─── Determinism Tests (FP-T29 to FP-T31) ───────────────────────────────

console.log('--- Determinism ---');

test('FP-T29: Two builds from same inputs are byte-identical', function () {
  var graph = makeGraph([
    makeObj('obj-A', { risk_score: 80, confidence: 0.6 }),
    makeObj('obj-B', { risk_score: 60, confidence: 0.8 }),
  ]);
  var cfg = { timestamp: '2026-02-12T00:00:00Z' };
  var p1 = fp.build(graph, {}, cfg);
  var p2 = fp.build(graph, {}, cfg);
  assertEqual(JSON.stringify(p1), JSON.stringify(p2), 'byte-identical');
});

test('FP-T30: Selection order is deterministic', function () {
  var objs = [makeObj('obj-C', { risk_score: 70 }), makeObj('obj-A', { risk_score: 70 }), makeObj('obj-B', { risk_score: 70 })];
  var s1 = fp.selectObjective(objs, {});
  var s2 = fp.selectObjective(objs.slice().reverse(), {});
  assertEqual(s1.objective_id, s2.objective_id, 'same selection regardless of input order');
});

test('FP-T31: Diagnosis order is deterministic', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 95, confidence: 0.3 })]);
  var cfg = { timestamp: '2026-02-12T00:00:00Z' };
  var p1 = fp.build(graph, {}, cfg);
  var p2 = fp.build(graph, {}, cfg);
  assertEqual(JSON.stringify(p1.diagnosis), JSON.stringify(p2.diagnosis), 'same diagnosis order');
});

// ─── LLM Tests (FP-T32 to FP-T36) ──────────────────────────────────────

console.log('--- LLM ---');

test('FP-T32: LLM disabled by default (mode=rules-only)', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 80 })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assertEqual(pack.mode, 'rules-only', 'default mode');
});

test('FP-T33: LLM forbidden when ci_mode=true', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 80, confidence: 0.3 })]);
  var called = false;
  var pack = fp.build(graph, {}, {
    timestamp: '2026-02-12T00:00:00Z',
    llm_enabled: true,
    ci_mode: true,
    llm_fn: function () { called = true; return {}; },
  });
  assert(called === false, 'LLM should not be called in CI');
  assertEqual(pack.mode, 'rules-only', 'mode stays rules-only');
  assert(pack.events.some(function (e) { return e.event === 'FIXPACK_LLM_SKIPPED' && e.reason === 'ci_forbidden'; }), 'ci_forbidden event');
});

test('FP-T34: LLM invalid output → fallback rules-only', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 80, confidence: 0.3 })]);
  var pack = fp.build(graph, {}, {
    timestamp: '2026-02-12T00:00:00Z',
    llm_enabled: true,
    llm_fn: function () { return null; }, // invalid
  });
  assertEqual(pack.mode, 'rules-only', 'fallback to rules-only');
});

test('FP-T35: LLM refines intent/guardrails/stop_conditions only', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 80, confidence: 0.3 })]);
  var origPack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var origCmds = origPack.commands.map(function (c) { return c.cmd; });

  var pack = fp.build(graph, {}, {
    timestamp: '2026-02-12T00:00:00Z',
    llm_enabled: true,
    llm_fn: function () {
      return {
        refined_intents: { 'FP-C01': 'LLM-refined intent' },
        refined_guardrails: ['LLM guardrail 1'],
        refined_stop_conditions: ['LLM stop 1'],
      };
    },
  });
  assertEqual(pack.mode, 'hybrid', 'mode should be hybrid');
  // Commands should be unchanged (LLM cannot modify them)
  var newCmds = pack.commands.map(function (c) { return c.cmd; });
  assertEqual(JSON.stringify(origCmds), JSON.stringify(newCmds), 'commands unchanged by LLM');
});

test('FP-T36: LLM exception → fallback rules-only', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 80, confidence: 0.3 })]);
  var pack = fp.build(graph, {}, {
    timestamp: '2026-02-12T00:00:00Z',
    llm_enabled: true,
    llm_fn: function () { throw new Error('LLM crashed'); },
  });
  assertEqual(pack.mode, 'rules-only', 'fallback on exception');
});

// ─── Bounds Tests (FP-T37 to FP-T39) ────────────────────────────────────

console.log('--- Bounds ---');

test('FP-T37: reason_codes bounded to max 8', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 95, confidence: 0.2 }, { forced_zero_reason: 'HIGH_RISK' })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.selected.reason_codes.length <= fp.LIMITS.max_reason_codes, 'bounded');
});

test('FP-T38: String fields truncated to max 256', function () {
  var longSignal = 'x'.repeat(500);
  var obj = makeObj('obj-1', { risk_score: 80 });
  obj.signals = [{ lens: 'dev', severity: 'high', text: longSignal, evidence_ref: 'drift' }];
  var graph = makeGraph([obj]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var json = JSON.stringify(pack);
  assert(json.indexOf('x'.repeat(300)) < 0, 'long strings should be truncated');
});

test('FP-T39: All array fields respect max limits', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 80 })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.diagnosis.length <= fp.LIMITS.max_diagnosis, 'diagnosis bounded');
  assert(pack.proposed_changes.length <= fp.LIMITS.max_proposed_changes, 'changes bounded');
  assert(pack.commands.length <= fp.LIMITS.max_commands, 'commands bounded');
  assert(pack.tests_to_run.length <= fp.LIMITS.max_tests_to_run, 'tests bounded');
  assert(pack.stop_conditions.length <= fp.LIMITS.max_stop_conditions, 'stops bounded');
  assert(pack.rollback_steps.length <= fp.LIMITS.max_rollback_steps, 'rollback bounded');
});

// ─── Proposed Changes Tests (FP-T40 to FP-T42) ─────────────────────────

console.log('--- Proposed Changes ---');

test('FP-T40: Kill switch → hold pack with no target files', function () {
  var graph = makeGraph([makeObj('obj-1', { recommended_action: 'STOP' }, { forced_zero_reason: 'KILL_SWITCH' })]);
  var pack = fp.build(graph, { killSwitch: true }, { timestamp: '2026-02-12T00:00:00Z' });
  var ksChange = pack.proposed_changes.find(function (c) { return c.intent.indexOf('Hold') >= 0 || c.intent.indexOf('hold') >= 0; });
  assert(ksChange !== undefined, 'should have hold change');
  assert(ksChange.target_files.length === 0, 'no target files for kill switch');
});

test('FP-T41: Changes have valid risk levels', function () {
  var graph = makeGraph([makeObj('obj-1', { risk_score: 95 })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  for (var i = 0; i < pack.proposed_changes.length; i++) {
    assert(fp.RISK_LEVELS.indexOf(pack.proposed_changes[i].risk) >= 0, 'valid risk: ' + pack.proposed_changes[i].risk);
  }
});

test('FP-T42: Changes bounded to max 10', function () {
  // Generate many diagnoses by having many signals
  var obj = makeObj('obj-1', { risk_score: 95, confidence: 0.2, recommended_action: 'HOLD' }, { forced_zero_reason: 'QUARANTINE' });
  obj.derivations = [
    { kind: 'OVERRIDE', target: 'recommended_action', from: 'PROCEED', to: 'HOLD', rule: 'test', evidence: [] },
    { kind: 'CLAMP', target: 'risk_score', from: 110, to: 100, rule: 'clamp', evidence: [] },
  ];
  obj.signals = [
    { lens: 'dev', severity: 'high', text: 'drift issue', evidence_ref: 'drift detected' },
    { lens: 'ops', severity: 'high', text: 'budget problem', evidence_ref: 'budget exceeded' },
  ];
  var graph = makeGraph([obj]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  assert(pack.proposed_changes.length <= fp.LIMITS.max_proposed_changes, 'bounded to max');
});

// ─── Markdown Tests (FP-T43 to FP-T44) ──────────────────────────────────

console.log('--- Markdown ---');

test('FP-T43: Markdown contains key sections', function () {
  var graph = makeGraph([makeObj('obj-42', { risk_score: 80 })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var md = fp.toMarkdown(pack);
  assert(md.indexOf('Fix Pack') >= 0, 'has title');
  assert(md.indexOf('obj-42') >= 0, 'has objective');
  assert(md.indexOf('Proposed Changes') >= 0 || md.indexOf('Diagnosis') >= 0, 'has content');
});

test('FP-T44: Failclosed markdown contains FAILCLOSED', function () {
  var pack = fp.buildFailclosedPack('test_reason', '2026-02-12T00:00:00Z');
  var md = fp.toMarkdown(pack);
  assert(md.indexOf('FAILCLOSED') >= 0, 'has FAILCLOSED');
  assert(md.indexOf('test_reason') >= 0, 'has reason');
});

// ─── Integration Test (FP-T45) ──────────────────────────────────────────

console.log('--- Integration ---');

test('FP-T45: Build + validate round-trip', function () {
  var objs = [
    makeObj('obj-A', { risk_score: 80, confidence: 0.6 }),
    makeObj('obj-B', { risk_score: 95, confidence: 0.3 }, { forced_zero_reason: 'HIGH_RISK' }),
    makeObj('obj-C', { risk_score: 40, confidence: 0.9 }),
  ];
  objs[1].derivations = [{ kind: 'DELTA', target: 'risk_score', from: 50, to: 95, rule: 'high risk signals', evidence: [{ source: 'event_log', ref: 'repeated failures' }] }];
  objs[1].signals = [{ lens: 'ops', severity: 'high', text: 'critical failures detected', evidence_ref: 'event_log' }];
  var graph = makeGraph(objs);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var result = fp.validate(pack);
  assert(result.valid === true, 'round-trip valid: ' + result.errors.join(', '));
  assertEqual(pack.selected.objective_id, 'obj-B', 'highest risk selected');
  assert(pack.commands.length > 0, 'has commands');
  assert(pack.commands.every(function (c) { return fp.isCommandAllowed(c.cmd); }), 'all commands allowed');
});

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log('');
console.log('============================================');
console.log('  Fix Pack Tests: ' + passed + ' passed, ' + failed + ' failed');
console.log('============================================');
process.exit(failed > 0 ? 1 : 0);
