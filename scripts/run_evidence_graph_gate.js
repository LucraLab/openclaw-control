#!/usr/bin/env node
/**
 * run_evidence_graph_gate.js — CI gate for Evidence Graph v1 (Port #14)
 *
 * 12 checks (EG1–EG12): fixture-only, validates schema, markdown,
 * determinism, sanitization, limits, enums, and failclosed behavior.
 *
 * Usage:
 *   node scripts/run_evidence_graph_gate.js [--ci]
 */

'use strict';

const path = require('path');
const fs = require('fs');
const eg = require(path.join(__dirname, 'executive_evidence_graph'));

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
// Build test fixtures (in-memory, no external files needed)
// ═══════════════════════════════════════════════════════════════════════════

function makeObjResult(id, overrides) {
  var base = {
    objective_id: id,
    priority_score: 50,
    risk_score: 50,
    confidence: 0.5,
    recommended_action: 'PROCEED',
    why: [],
    next_steps: [],
    blocks: [],
    lenses: {
      dev: { score_delta: 0, risk_delta: 0, confidence_delta: 0, signals: [] },
      ops: { score_delta: 0, risk_delta: 0, confidence_delta: 0, signals: [] },
      business: { score_delta: 0, risk_delta: 0, confidence_delta: 0, signals: [] },
    },
    llm_assist: null,
  };
  return Object.assign(base, overrides || {});
}

function makeReport(objectives) {
  return {
    engine_version: '1.0.0',
    timestamp: '2026-02-12T00:00:00Z',
    commit_sha: 'abc123',
    status: 'OK',
    objectives: objectives || [],
    llm_used: false,
    llm_enabled: false,
    config: { llm_enabled: false },
    events: [],
  };
}

function makeHints(hints) {
  return {
    version: '1.0.0',
    computed_at: '2026-02-12T00:00:00Z',
    source_engine_version: '1.0.0',
    hints: hints || [],
  };
}

process.stdout.write('\n=== Evidence Graph Gate ===\n\n');

// ─── EG1: Module loads without error ───────────────────────────────────
check('EG1', typeof eg.build === 'function' && typeof eg.validate === 'function' && typeof eg.toMarkdown === 'function',
  'Module exports build, validate, toMarkdown');

// ─── EG2: Enums exported correctly ────────────────────────────────────
check('EG2',
  eg.GRAPH_VERSION === 'v1' &&
  eg.FORCED_ZERO_REASONS.length === 6 &&
  eg.DERIVATION_KINDS.length === 4 &&
  eg.DERIVATION_TARGETS.length === 5 &&
  eg.EVIDENCE_SOURCES.length === 7 &&
  eg.SIGNAL_SEVERITIES.length === 3 &&
  eg.SIGNAL_LENSES.length === 3 &&
  eg.RECOMMENDATION_CODES.length === 6,
  'All enums exported with correct cardinality');

// ─── EG3: Build + validate round trip ─────────────────────────────────
(function () {
  var obj = makeObjResult('obj-42', {
    priority_score: 75, risk_score: 30, confidence: 0.85,
    lenses: {
      dev: { score_delta: 10, risk_delta: -5, confidence_delta: 0.1, signals: ['fast builds'] },
      ops: { score_delta: 5, risk_delta: -10, confidence_delta: 0.15, signals: ['healthy'] },
      business: { score_delta: 10, risk_delta: -5, confidence_delta: 0.1, signals: ['high ROI'] },
    },
  });
  var hints = makeHints([{ objective_id: 'obj-42', priority_score: 75, risk_score: 30, confidence: 0.85, recommendation_code: 'FOCUS', rank_delta_hint: 5, why_codes: ['high_impact'] }]);
  var graph = eg.build(makeReport([obj]), hints, {});
  var result = eg.validate(graph);
  check('EG3', result.valid === true, 'Build + validate round trip (' + result.errors.length + ' errors)');
})();

// ─── EG4: Derivation bounds respected ─────────────────────────────────
(function () {
  var obj = makeObjResult('obj-1', {
    priority_score: 70,
    lenses: {
      dev: { score_delta: 10, risk_delta: 5, confidence_delta: 0.1, signals: ['a', 'b'] },
      ops: { score_delta: 5, risk_delta: -3, confidence_delta: 0.05, signals: ['c'] },
      business: { score_delta: 5, risk_delta: -2, confidence_delta: 0.05, signals: ['d'] },
    },
  });
  var hints = makeHints([{ objective_id: 'obj-1', priority_score: 70, risk_score: 50, confidence: 0.7, recommendation_code: 'FOCUS', rank_delta_hint: 4, why_codes: [] }]);
  var graph = eg.build(makeReport([obj]), hints, {});
  var derivCount = graph.objectives[0].derivations.length;
  var sigCount = graph.objectives[0].signals.length;
  check('EG4', derivCount <= eg.LIMITS.max_derivations && sigCount <= eg.LIMITS.max_signals,
    'Derivations=' + derivCount + ' (max=' + eg.LIMITS.max_derivations + '), signals=' + sigCount + ' (max=' + eg.LIMITS.max_signals + ')');
})();

// ─── EG5: Safety overrides produce correct forced_zero_reason ─────────
(function () {
  var cases = [
    { action: 'STOP', blocks: [{ type: 'kill_switch', detail: 'ks' }], expected: 'KILL_SWITCH' },
    { action: 'HOLD', blocks: [{ type: 'quarantine', detail: 'q' }], expected: 'QUARANTINE' },
    { action: 'PROCEED', confidence: 0.3, expected: 'LOW_CONFIDENCE' },
    { action: 'PROCEED', risk_score: 95, expected: 'HIGH_RISK' },
  ];
  var allOk = true;
  for (var i = 0; i < cases.length; i++) {
    var c = cases[i];
    var obj = makeObjResult('obj-' + i, {
      priority_score: 70,
      recommended_action: c.action,
      blocks: c.blocks || [],
      risk_score: c.risk_score || 50,
      confidence: c.confidence || 0.5,
    });
    var hints = makeHints([{ objective_id: 'obj-' + i, priority_score: 70, risk_score: c.risk_score || 50, confidence: c.confidence || 0.5, recommendation_code: 'FOCUS', rank_delta_hint: 4, why_codes: [] }]);
    var graph = eg.build(makeReport([obj]), hints, {});
    if (graph.objectives[0].hint.forced_zero_reason !== c.expected) {
      allOk = false;
    }
  }
  check('EG5', allOk, 'All 4 forced_zero_reason cases correct');
})();

// ─── EG6: Failclosed graph for null report ────────────────────────────
(function () {
  var graph = eg.build(null, null, null);
  var valid = eg.validate(graph);
  check('EG6', graph.summary.failclosed === true && valid.valid === true,
    'Null report → valid failclosed graph');
})();

// ─── EG7: Failclosed graph for FAILCLOSED report ─────────────────────
(function () {
  var report = makeReport([]);
  report.status = 'FAILCLOSED';
  var graph = eg.build(report, null, {});
  check('EG7', graph.summary.failclosed === true && graph.summary.failclosed_reason === 'upstream_failclosed',
    'FAILCLOSED report → failclosed graph with correct reason');
})();

// ─── EG8: Markdown output for valid graph ─────────────────────────────
(function () {
  var obj = makeObjResult('obj-42', { priority_score: 70 });
  var graph = eg.build(makeReport([obj]), null, {});
  var md = eg.toMarkdown(graph);
  check('EG8', md.includes('Evidence Graph') && md.includes('obj-42') && md.includes('Derivations'),
    'Markdown contains title + objective_id + derivations');
})();

// ─── EG9: Markdown for failclosed graph ───────────────────────────────
(function () {
  var graph = eg.buildFailclosedGraph('test_reason');
  var md = eg.toMarkdown(graph);
  check('EG9', md.includes('FAILCLOSED') && md.includes('test_reason'),
    'Failclosed markdown contains FAILCLOSED + reason');
})();

// ─── EG10: Sanitization strips secrets ────────────────────────────────
(function () {
  var obj = makeObjResult('obj-1', {
    lenses: {
      dev: { score_delta: 5, risk_delta: 0, confidence_delta: 0, signals: ['leaked sk-abcdefghij1234567890'] },
      ops: { score_delta: 0, risk_delta: 0, confidence_delta: 0, signals: [] },
      business: { score_delta: 0, risk_delta: 0, confidence_delta: 0, signals: [] },
    },
  });
  var graph = eg.build(makeReport([obj]), null, {});
  var json = JSON.stringify(graph);
  check('EG10', !json.includes('sk-abcdefghij1234567890') && json.includes('[REDACTED]'),
    'Secrets stripped from graph JSON');
})();

// ─── EG11: Determinism check ──────────────────────────────────────────
(function () {
  var obj = makeObjResult('obj-42', {
    priority_score: 70, risk_score: 40, confidence: 0.7,
    lenses: {
      dev: { score_delta: 10, risk_delta: -5, confidence_delta: 0.1, signals: ['ok'] },
      ops: { score_delta: 5, risk_delta: -5, confidence_delta: 0.1, signals: ['ok'] },
      business: { score_delta: 5, risk_delta: 0, confidence_delta: 0, signals: [] },
    },
  });
  var report = makeReport([obj]);
  var hints = makeHints([{ objective_id: 'obj-42', priority_score: 70, risk_score: 40, confidence: 0.7, recommendation_code: 'FOCUS', rank_delta_hint: 4, why_codes: [] }]);
  var ctx = {};
  var g1 = eg.build(report, hints, ctx);
  var g2 = eg.build(report, hints, ctx);
  check('EG11', JSON.stringify(g1) === JSON.stringify(g2), 'Two builds from same inputs are byte-identical');
})();

// ─── EG12: Arbiter simulation matches expected order ──────────────────
(function () {
  var objs = [
    makeObjResult('obj-A', { priority_score: 50 }),
    makeObjResult('obj-B', { priority_score: 80 }),
    makeObjResult('obj-C', { priority_score: 30 }),
  ];
  var hints = makeHints([
    { objective_id: 'obj-A', priority_score: 50, risk_score: 50, confidence: 0.5, recommendation_code: 'FOCUS', rank_delta_hint: 0, why_codes: [] },
    { objective_id: 'obj-B', priority_score: 80, risk_score: 50, confidence: 0.5, recommendation_code: 'FOCUS', rank_delta_hint: 6, why_codes: [] },
    { objective_id: 'obj-C', priority_score: 30, risk_score: 50, confidence: 0.5, recommendation_code: 'CONTAIN', rank_delta_hint: -4, why_codes: [] },
  ]);
  var graph = eg.build(makeReport(objs), hints, {});
  var order = graph.arbiter_simulation.map(function (e) { return e.objective_id; });
  check('EG12', order[0] === 'obj-B' && order[1] === 'obj-A' && order[2] === 'obj-C',
    'Arbiter simulation: B(+6) → A(0) → C(-4)');
})();

// ═══════════════════════════════════════════════════════════════════════════
// Write artifacts
// ═══════════════════════════════════════════════════════════════════════════

var artifactsDir = path.join(__dirname, '..', 'artifacts');
var tmpDir = path.join(__dirname, '..', 'tmp');

try { fs.mkdirSync(artifactsDir, { recursive: true }); } catch (_e) { /* ok */ }
try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (_e) { /* ok */ }

// Build a reference graph for artifact
var refObj = makeObjResult('obj-42', {
  priority_score: 75, risk_score: 30, confidence: 0.85,
  lenses: {
    dev: { score_delta: 10, risk_delta: -5, confidence_delta: 0.1, signals: ['CI green'] },
    ops: { score_delta: 5, risk_delta: -10, confidence_delta: 0.15, signals: ['All healthy'] },
    business: { score_delta: 10, risk_delta: -5, confidence_delta: 0.1, signals: ['High ROI'] },
  },
});
var refHints = makeHints([{
  objective_id: 'obj-42', priority_score: 75, risk_score: 30, confidence: 0.85,
  recommendation_code: 'FOCUS', rank_delta_hint: 5, why_codes: ['high_impact'],
}]);
var refGraph = eg.build(makeReport([refObj]), refHints, {});

fs.writeFileSync(path.join(artifactsDir, 'executive-evidence-graph.json'), JSON.stringify(refGraph, null, 2));
fs.writeFileSync(path.join(artifactsDir, 'executive-evidence-graph.md'), eg.toMarkdown(refGraph));

var gateReport = {
  gate: 'evidence-graph',
  timestamp: new Date().toISOString(),
  checks_total: passed + failed,
  checks_passed: passed,
  checks_failed: failed,
  results: results,
};
fs.writeFileSync(path.join(tmpDir, 'evidence-graph-gate-report.json'), JSON.stringify(gateReport, null, 2));

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n───────────────────────────────────────\n');
process.stdout.write('Evidence Graph Gate: ' + passed + '/' + (passed + failed) + ' checks passed\n');
if (failed > 0) {
  process.stdout.write('GATE FAILED\n');
  results.filter(function (r) { return r.status === 'FAIL'; }).forEach(function (r) {
    process.stdout.write('  FAIL ' + r.id + ': ' + r.detail + '\n');
  });
}
process.stdout.write('───────────────────────────────────────\n');
process.exit(failed > 0 ? 1 : 0);
