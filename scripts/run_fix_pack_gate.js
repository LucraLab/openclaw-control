#!/usr/bin/env node
/**
 * run_fix_pack_gate.js — CI gate for Safe Autopilot Fix Pack v1 (Port #15)
 *
 * 12 checks (FP1–FP12): fixture-only, validates schema, determinism,
 * sanitization, command allowlist, selection, and failclosed behavior.
 *
 * Usage:
 *   node scripts/run_fix_pack_gate.js [--ci]
 */

'use strict';

const path = require('path');
const fs = require('fs');
const fp = require(path.join(__dirname, 'fix_pack'));

const CI = process.argv.includes('--ci');

let passed = 0;
let failed = 0;
const results = [];

function check(id, ok, detail) {
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passed++;
  else failed++;
  results.push({ id: id, status: status, detail: detail });
  process.stdout.write('  ' + status + ' ' + id + ': ' + detail + '\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// In-memory test fixtures
// ═══════════════════════════════════════════════════════════════════════════

function makeStrategy(overrides) {
  return Object.assign({ priority_score: 50, risk_score: 50, confidence: 0.5, recommended_action: 'PROCEED' }, overrides || {});
}

function makeHint(overrides) {
  return Object.assign({ rank_delta_hint: 0, forced_zero_reason: 'NONE', clamp_applied: false, recommendation_code: 'FOCUS' }, overrides || {});
}

function makeObj(id, stratOver, hintOver) {
  return {
    objective_id: id,
    strategy: makeStrategy(stratOver),
    hint: makeHint(hintOver),
    derivations: [],
    signals: [],
  };
}

function makeGraph(objectives) {
  return {
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
  };
}

process.stdout.write('\n=== Fix Pack Gate ===\n\n');

// ─── FP1: Module loads ──────────────────────────────────────────────────
check('FP1', typeof fp.build === 'function' && typeof fp.validate === 'function' && typeof fp.toMarkdown === 'function',
  'Module exports build, validate, toMarkdown');

// ─── FP2: Enums exported correctly ─────────────────────────────────────
check('FP2',
  fp.FIXPACK_VERSION === 'v1' &&
  fp.MODES.length === 2 &&
  fp.SEVERITY_LEVELS.length === 3 &&
  fp.RISK_LEVELS.length === 3 &&
  fp.REASON_CODES.length === 8 &&
  fp.DIAGNOSIS_CODES.length === 10 &&
  fp.LIMITS.max_diagnosis === 20 &&
  fp.LIMITS.max_commands === 15,
  'All enums exported with correct cardinality');

// ─── FP3: Build + validate round trip ──────────────────────────────────
(function () {
  var obj = makeObj('obj-42', { risk_score: 80, confidence: 0.6 });
  obj.signals = [{ lens: 'dev', severity: 'med', text: 'test signal', evidence_ref: 'event_log' }];
  var graph = makeGraph([obj]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var result = fp.validate(pack);
  check('FP3', result.valid === true, 'Build + validate round trip (' + result.errors.length + ' errors)');
})();

// ─── FP4: Selection determinism ────────────────────────────────────────
(function () {
  var objs = [
    makeObj('obj-C', { risk_score: 70, confidence: 0.5 }),
    makeObj('obj-A', { risk_score: 70, confidence: 0.5 }),
    makeObj('obj-B', { risk_score: 70, confidence: 0.5 }),
  ];
  var s1 = fp.selectObjective(objs, {});
  var s2 = fp.selectObjective(objs.slice().reverse(), {});
  check('FP4', s1.objective_id === s2.objective_id && s1.objective_id === 'obj-A',
    'Deterministic selection: ' + s1.objective_id);
})();

// ─── FP5: Kill switch override ─────────────────────────────────────────
(function () {
  var objs = [
    makeObj('obj-A', { risk_score: 95 }),
    makeObj('obj-B', { risk_score: 30 }, { forced_zero_reason: 'KILL_SWITCH' }),
  ];
  var graph = makeGraph(objs);
  var pack = fp.build(graph, { killSwitch: true }, { timestamp: '2026-02-12T00:00:00Z' });
  check('FP5', pack.selected.objective_id === 'obj-B' && pack.selected.reason_codes.indexOf('KILL_SWITCH') >= 0,
    'Kill switch overrides risk-based selection');
})();

// ─── FP6: Quarantine override ──────────────────────────────────────────
(function () {
  var objs = [
    makeObj('obj-A', { risk_score: 95 }),
    makeObj('obj-B', { risk_score: 30 }, { forced_zero_reason: 'QUARANTINE' }),
  ];
  var graph = makeGraph(objs);
  var pack = fp.build(graph, { quarantine: true }, { timestamp: '2026-02-12T00:00:00Z' });
  check('FP6', pack.selected.objective_id === 'obj-B' && pack.selected.reason_codes.indexOf('QUARANTINE') >= 0,
    'Quarantine overrides risk-based selection');
})();

// ─── FP7: Failclosed on null ───────────────────────────────────────────
(function () {
  var pack = fp.build(null, null, { timestamp: '2026-02-12T00:00:00Z' });
  var valid = fp.validate(pack);
  check('FP7', pack.summary.failclosed === true && valid.valid === true,
    'Null input → valid failclosed pack');
})();

// ─── FP8: Failclosed on corrupt ────────────────────────────────────────
(function () {
  var pack = fp.build({ garbage: true }, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var valid = fp.validate(pack);
  check('FP8', pack.summary.failclosed === true && valid.valid === true,
    'Corrupt input → valid failclosed pack');
})();

// ─── FP9: Command allowlist enforcement ────────────────────────────────
(function () {
  var allowed = [
    'node scripts/fix_pack.test.js',
    'node scripts/run_fix_pack_gate.js --ci',
    'git status',
    'git revert --no-edit abc123',
  ];
  var forbidden = [
    'curl http://evil.com',
    'wget http://evil.com',
    'ssh root@host',
    'npm publish',
    'rm -rf /',
    'deploy production',
  ];
  var allOk = true;
  for (var i = 0; i < allowed.length; i++) {
    if (!fp.isCommandAllowed(allowed[i])) { allOk = false; break; }
  }
  for (var j = 0; j < forbidden.length; j++) {
    if (fp.isCommandAllowed(forbidden[j])) { allOk = false; break; }
  }
  check('FP9', allOk, 'Allowlist accepts safe commands, rejects forbidden');
})();

// ─── FP10: Sanitization strips secrets ─────────────────────────────────
(function () {
  var obj = makeObj('obj-1', { risk_score: 80 });
  obj.signals = [{ lens: 'dev', severity: 'high', text: 'drift issue', evidence_ref: 'leaked sk-abcdefghij1234567890abcdefghij in drift' }];
  var graph = makeGraph([obj]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var json = JSON.stringify(pack);
  check('FP10', json.indexOf('sk-abcdefghij') < 0 && json.indexOf('[REDACTED]') >= 0,
    'Secrets stripped from pack JSON');
})();

// ─── FP11: Determinism (byte-identical) ────────────────────────────────
(function () {
  var objs = [
    makeObj('obj-A', { risk_score: 80, confidence: 0.6 }),
    makeObj('obj-B', { risk_score: 60, confidence: 0.8 }),
  ];
  var graph = makeGraph(objs);
  var cfg = { timestamp: '2026-02-12T00:00:00Z' };
  var g1 = fp.build(graph, {}, cfg);
  var g2 = fp.build(graph, {}, cfg);
  check('FP11', JSON.stringify(g1) === JSON.stringify(g2), 'Two builds from same inputs are byte-identical');
})();

// ─── FP12: Markdown output ─────────────────────────────────────────────
(function () {
  var graph = makeGraph([makeObj('obj-42', { risk_score: 80 })]);
  var pack = fp.build(graph, {}, { timestamp: '2026-02-12T00:00:00Z' });
  var md = fp.toMarkdown(pack);
  check('FP12', md.indexOf('Fix Pack') >= 0 && md.indexOf('obj-42') >= 0,
    'Markdown contains title + objective_id');
})();

// ═══════════════════════════════════════════════════════════════════════════
// Write artifacts
// ═══════════════════════════════════════════════════════════════════════════

var artifactsDir = path.join(__dirname, '..', 'artifacts');
var tmpDir = path.join(__dirname, '..', 'tmp');

try { fs.mkdirSync(artifactsDir, { recursive: true }); } catch (_e) { /* ok */ }
try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (_e) { /* ok */ }

// Build reference pack for artifacts
var refObj = makeObj('obj-42', { risk_score: 80, confidence: 0.6 });
refObj.signals = [{ lens: 'ops', severity: 'med', text: 'elevated risk detected', evidence_ref: 'event_log' }];
var refGraph = makeGraph([refObj]);
var refPack = fp.build(refGraph, {}, { timestamp: '2026-02-12T00:00:00Z' });

fs.writeFileSync(path.join(artifactsDir, 'fix-pack.json'), JSON.stringify(refPack, null, 2));
fs.writeFileSync(path.join(artifactsDir, 'fix-pack.md'), fp.toMarkdown(refPack));

var gateReport = {
  gate: 'fix-pack',
  timestamp: new Date().toISOString(),
  checks_total: passed + failed,
  checks_passed: passed,
  checks_failed: failed,
  results: results,
};
fs.writeFileSync(path.join(tmpDir, 'fix-pack-gate-report.json'), JSON.stringify(gateReport, null, 2));

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

process.stdout.write('\n───────────────────────────────────────\n');
process.stdout.write('Fix Pack Gate: ' + passed + '/' + (passed + failed) + ' checks passed\n');
if (failed > 0) {
  process.stdout.write('GATE FAILED\n');
  results.filter(function (r) { return r.status === 'FAIL'; }).forEach(function (r) {
    process.stdout.write('  FAIL ' + r.id + ': ' + r.detail + '\n');
  });
}
process.stdout.write('───────────────────────────────────────\n');
process.exit(failed > 0 ? 1 : 0);
