#!/usr/bin/env node
/**
 * evidence_graph.test.js — 33 tests for Evidence Graph v1 (Port #14)
 *
 * Coverage:
 *   EG-T1  to EG-T5  : Schema validation
 *   EG-T6  to EG-T10 : Determinism + hashing
 *   EG-T11 to EG-T15 : Strategy derivations (lens deltas)
 *   EG-T16 to EG-T20 : Hint derivations + forced-zero reasons
 *   EG-T21 to EG-T25 : Kill switch / quarantine overrides
 *   EG-T26 to EG-T30 : Arbiter simulation + clamping + edge cases
 *   EG-T31 to EG-T33 : Sanitization, markdown, failclosed
 */

'use strict';

const path = require('path');
const eg = require(path.join(__dirname, 'executive_evidence_graph'));

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testId, msg) {
  if (condition) {
    passed++;
    process.stdout.write('  PASS ' + testId + ': ' + msg + '\n');
  } else {
    failed++;
    failures.push(testId + ': ' + msg);
    process.stdout.write('  FAIL ' + testId + ': ' + msg + '\n');
  }
}

function assertEq(actual, expected, testId, msg) {
  const eq = JSON.stringify(actual) === JSON.stringify(expected);
  if (!eq) {
    assert(false, testId, msg + ' (expected=' + JSON.stringify(expected) + ', got=' + JSON.stringify(actual) + ')');
  } else {
    assert(true, testId, msg);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test fixtures
// ═══════════════════════════════════════════════════════════════════════════

function makeObjResult(id, overrides) {
  const base = {
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

function makeReport(objectives, overrides) {
  const base = {
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
  return Object.assign(base, overrides || {});
}

function makeHints(hints, overrides) {
  const base = {
    version: '1.0.0',
    computed_at: '2026-02-12T00:00:00Z',
    source_engine_version: '1.0.0',
    hints: hints || [],
  };
  return Object.assign(base, overrides || {});
}

function makeContext(overrides) {
  return Object.assign({ objectives: {}, quarantine: {}, killSwitch: false, events: [] }, overrides || {});
}

// ═══════════════════════════════════════════════════════════════════════════
// EG-T1 to EG-T5: Schema validation
// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n=== Schema Validation ===\n');

// EG-T1: Valid graph passes validation
(function () {
  var obj = makeObjResult('obj-42', {
    priority_score: 75, risk_score: 30, confidence: 0.85,
    lenses: {
      dev: { score_delta: 10, risk_delta: -5, confidence_delta: 0.1, signals: ['CI green'] },
      ops: { score_delta: 5, risk_delta: -10, confidence_delta: 0.15, signals: ['All healthy'] },
      business: { score_delta: 10, risk_delta: -5, confidence_delta: 0.1, signals: ['High ROI'] },
    },
  });
  var report = makeReport([obj]);
  var hints = makeHints([{ objective_id: 'obj-42', priority_score: 75, risk_score: 30, confidence: 0.85, recommendation_code: 'FOCUS', rank_delta_hint: 5, why_codes: ['high_impact'] }]);
  var graph = eg.build(report, hints, makeContext());
  var result = eg.validate(graph);
  assert(result.valid === true, 'EG-T1', 'Valid graph passes validation (' + result.errors.length + ' errors)');
})();

// EG-T2: Graph with wrong version fails validation
(function () {
  var graph = eg.build(makeReport([makeObjResult('obj-1')]), null, makeContext());
  graph.version = 'v99';
  var result = eg.validate(graph);
  assert(result.valid === false, 'EG-T2', 'Wrong version fails validation');
  assert(result.errors.some(function (e) { return e.includes('version'); }), 'EG-T2b', 'Error mentions version');
})();

// EG-T3: Missing computed_at fails validation
(function () {
  var graph = eg.build(makeReport([makeObjResult('obj-1')]), null, makeContext());
  graph.computed_at = '';
  var result = eg.validate(graph);
  assert(result.valid === false, 'EG-T3', 'Empty computed_at fails validation');
})();

// EG-T4: Invalid derivation kind fails
(function () {
  var graph = eg.build(makeReport([makeObjResult('obj-1')]), null, makeContext());
  graph.objectives[0].derivations[0].kind = 'INVALID';
  var result = eg.validate(graph);
  assert(result.valid === false, 'EG-T4', 'Invalid derivation kind fails');
})();

// EG-T5: Invalid evidence source fails
(function () {
  var graph = eg.build(makeReport([makeObjResult('obj-1')]), null, makeContext());
  graph.objectives[0].derivations[0].evidence[0].source = 'unknown_source';
  var result = eg.validate(graph);
  assert(result.valid === false, 'EG-T5', 'Invalid evidence source fails');
})();

// ═══════════════════════════════════════════════════════════════════════════
// EG-T6 to EG-T10: Determinism + hashing
// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n=== Determinism + Hashing ===\n');

// EG-T6: Same inputs produce identical hashes
(function () {
  var obj = makeObjResult('obj-42', { priority_score: 70 });
  var report = makeReport([obj]);
  var ctx = makeContext();
  var g1 = eg.build(report, null, ctx);
  var g2 = eg.build(report, null, ctx);
  assertEq(g1.inputs.objectives_hash, g2.inputs.objectives_hash, 'EG-T6', 'Identical inputs produce same objectives_hash');
})();

// EG-T7: Different inputs produce different hashes
(function () {
  var obj1 = makeObjResult('obj-42', { priority_score: 70 });
  var obj2 = makeObjResult('obj-42', { priority_score: 80 });
  var g1 = eg.build(makeReport([obj1]), null, makeContext());
  var g2 = eg.build(makeReport([obj2]), null, makeContext());
  assert(g1.inputs.objectives_hash !== g2.inputs.objectives_hash, 'EG-T7', 'Different inputs produce different objectives_hash');
})();

// EG-T8: sortedStringify is key-order independent
(function () {
  var a = eg.sortedStringify({ z: 1, a: 2 });
  var b = eg.sortedStringify({ a: 2, z: 1 });
  assertEq(a, b, 'EG-T8', 'sortedStringify is key-order independent');
})();

// EG-T9: sha256 produces 64-char hex
(function () {
  var hash = eg.sha256('test');
  assert(hash.length === 64, 'EG-T9', 'sha256 produces 64-char hex');
  assert(/^[0-9a-f]+$/.test(hash), 'EG-T9b', 'sha256 is valid hex');
})();

// EG-T10: Two identical builds produce identical graphs (minus computed_at if overridden)
(function () {
  var obj = makeObjResult('obj-42', { priority_score: 65, risk_score: 40, confidence: 0.7 });
  var report = makeReport([obj]);
  var hints = makeHints([{ objective_id: 'obj-42', priority_score: 65, risk_score: 40, confidence: 0.7, recommendation_code: 'FOCUS', rank_delta_hint: 3, why_codes: [] }]);
  var ctx = makeContext();
  var g1 = eg.build(report, hints, ctx);
  var g2 = eg.build(report, hints, ctx);
  assertEq(JSON.stringify(g1), JSON.stringify(g2), 'EG-T10', 'Two identical builds produce identical JSON');
})();

// ═══════════════════════════════════════════════════════════════════════════
// EG-T11 to EG-T15: Strategy derivations (lens deltas)
// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n=== Strategy Derivations ===\n');

// EG-T11: BASE derivations always present (3 per objective)
(function () {
  var graph = eg.build(makeReport([makeObjResult('obj-1')]), null, makeContext());
  var derivs = graph.objectives[0].derivations;
  var bases = derivs.filter(function (d) { return d.kind === 'BASE'; });
  assertEq(bases.length, 3, 'EG-T11', 'Exactly 3 BASE derivations present');
  var targets = bases.map(function (b) { return b.target; }).sort();
  assertEq(targets, ['confidence', 'priority_score', 'risk_score'], 'EG-T11b', 'BASE targets are priority/risk/confidence');
})();

// EG-T12: Lens DELTA derivations recorded for non-zero deltas
(function () {
  var obj = makeObjResult('obj-1', {
    priority_score: 60,
    lenses: {
      dev: { score_delta: 10, risk_delta: 0, confidence_delta: 0, signals: ['fast builds'] },
      ops: { score_delta: 0, risk_delta: 0, confidence_delta: 0, signals: [] },
      business: { score_delta: 0, risk_delta: 0, confidence_delta: 0, signals: [] },
    },
  });
  var graph = eg.build(makeReport([obj]), null, makeContext());
  var deltas = graph.objectives[0].derivations.filter(function (d) { return d.kind === 'DELTA' && d.target === 'priority_score'; });
  assert(deltas.length >= 1, 'EG-T12', 'DELTA derivation for non-zero score_delta');
  assertEq(deltas[0].from, 50, 'EG-T12b', 'DELTA from=50 (base)');
  assertEq(deltas[0].to, 60, 'EG-T12c', 'DELTA to=60 (50+10)');
})();

// EG-T13: Multiple lens deltas chain correctly
(function () {
  var obj = makeObjResult('obj-1', {
    priority_score: 75,
    lenses: {
      dev: { score_delta: 10, risk_delta: 0, confidence_delta: 0, signals: ['a'] },
      ops: { score_delta: 5, risk_delta: 0, confidence_delta: 0, signals: ['b'] },
      business: { score_delta: 10, risk_delta: 0, confidence_delta: 0, signals: ['c'] },
    },
  });
  var graph = eg.build(makeReport([obj]), null, makeContext());
  var deltas = graph.objectives[0].derivations.filter(function (d) { return d.kind === 'DELTA' && d.target === 'priority_score'; });
  assertEq(deltas.length, 3, 'EG-T13', 'Three DELTA derivations for three lenses');
  assertEq(deltas[0].from, 50, 'EG-T13b', 'First starts at 50');
  assertEq(deltas[0].to, 60, 'EG-T13c', 'First ends at 60');
  assertEq(deltas[1].from, 60, 'EG-T13d', 'Second starts at 60');
  assertEq(deltas[1].to, 65, 'EG-T13e', 'Second ends at 65');
  assertEq(deltas[2].from, 65, 'EG-T13f', 'Third starts at 65');
  assertEq(deltas[2].to, 75, 'EG-T13g', 'Third ends at 75');
})();

// EG-T14: Zero-delta lenses produce no DELTA derivation
(function () {
  var obj = makeObjResult('obj-1');
  var graph = eg.build(makeReport([obj]), null, makeContext());
  var deltas = graph.objectives[0].derivations.filter(function (d) { return d.kind === 'DELTA'; });
  assertEq(deltas.length, 0, 'EG-T14', 'No DELTA derivations for zero deltas');
})();

// EG-T15: Signals extracted from lens signals
(function () {
  var obj = makeObjResult('obj-1', {
    lenses: {
      dev: { score_delta: 10, risk_delta: 0, confidence_delta: 0, signals: ['CI gate failure detected', 'drift anomaly'] },
      ops: { score_delta: 0, risk_delta: 5, confidence_delta: 0, signals: ['budget near-breach'] },
      business: { score_delta: 0, risk_delta: 0, confidence_delta: 0, signals: [] },
    },
  });
  var graph = eg.build(makeReport([obj]), null, makeContext());
  var sigs = graph.objectives[0].signals;
  assert(sigs.length === 3, 'EG-T15', 'Three signals extracted');
  assert(sigs[0].lens === 'dev', 'EG-T15b', 'First signal from dev lens');
  assert(sigs[2].lens === 'ops', 'EG-T15c', 'Third signal from ops lens');
  assert(sigs[2].evidence_ref === 'budget', 'EG-T15d', 'Budget signal classified correctly');
})();

// ═══════════════════════════════════════════════════════════════════════════
// EG-T16 to EG-T20: Hint derivations + forced-zero reasons
// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n=== Hint Derivations ===\n');

// EG-T16: Hint DELTA derivation with correct formula
(function () {
  var obj = makeObjResult('obj-1', { priority_score: 75 });
  var report = makeReport([obj]);
  var hints = makeHints([{ objective_id: 'obj-1', priority_score: 75, risk_score: 50, confidence: 0.5, recommendation_code: 'FOCUS', rank_delta_hint: 5, why_codes: [] }]);
  var graph = eg.build(report, hints, makeContext());
  var hintDeltas = graph.objectives[0].derivations.filter(function (d) { return d.target === 'rank_delta_hint' && d.kind === 'DELTA'; });
  assertEq(hintDeltas.length, 1, 'EG-T16', 'One hint DELTA derivation');
  assertEq(hintDeltas[0].from, 0, 'EG-T16b', 'Hint delta from=0');
  assertEq(hintDeltas[0].to, 5, 'EG-T16c', 'Hint delta to=5 for priority=75');
})();

// EG-T17: forced_zero_reason=NONE for normal objective
(function () {
  var obj = makeObjResult('obj-1', { priority_score: 70, risk_score: 30, confidence: 0.8 });
  var report = makeReport([obj]);
  var hints = makeHints([{ objective_id: 'obj-1', priority_score: 70, risk_score: 30, confidence: 0.8, recommendation_code: 'FOCUS', rank_delta_hint: 4, why_codes: [] }]);
  var graph = eg.build(report, hints, makeContext());
  assertEq(graph.objectives[0].hint.forced_zero_reason, 'NONE', 'EG-T17', 'forced_zero_reason=NONE for normal objective');
  assertEq(graph.objectives[0].hint.rank_delta_hint, 4, 'EG-T17b', 'Effective delta=4');
})();

// EG-T18: forced_zero_reason=HIGH_RISK for risk>=90
(function () {
  var obj = makeObjResult('obj-1', { priority_score: 75, risk_score: 95, confidence: 0.8 });
  var hints = makeHints([{ objective_id: 'obj-1', priority_score: 75, risk_score: 95, confidence: 0.8, recommendation_code: 'FOCUS', rank_delta_hint: 5, why_codes: [] }]);
  var graph = eg.build(makeReport([obj]), hints, makeContext());
  assertEq(graph.objectives[0].hint.forced_zero_reason, 'HIGH_RISK', 'EG-T18', 'forced_zero_reason=HIGH_RISK');
  assertEq(graph.objectives[0].hint.rank_delta_hint, 0, 'EG-T18b', 'Delta zeroed for high risk');
})();

// EG-T19: forced_zero_reason=LOW_CONFIDENCE for confidence<0.4
(function () {
  var obj = makeObjResult('obj-1', { priority_score: 70, confidence: 0.3 });
  var hints = makeHints([{ objective_id: 'obj-1', priority_score: 70, risk_score: 50, confidence: 0.3, recommendation_code: 'FOCUS', rank_delta_hint: 4, why_codes: [] }]);
  var graph = eg.build(makeReport([obj]), hints, makeContext());
  assertEq(graph.objectives[0].hint.forced_zero_reason, 'LOW_CONFIDENCE', 'EG-T19', 'forced_zero_reason=LOW_CONFIDENCE');
  assertEq(graph.objectives[0].hint.rank_delta_hint, 0, 'EG-T19b', 'Delta zeroed for low confidence');
})();

// EG-T20: forced_zero_reason=SCHEMA_INVALID for corrupt hints
(function () {
  var obj = makeObjResult('obj-1', { priority_score: 70 });
  var badHints = { version: '2.0.0', hints: [{ objective_id: 'obj-1' }] };
  var graph = eg.build(makeReport([obj]), badHints, makeContext());
  assertEq(graph.objectives[0].hint.forced_zero_reason, 'SCHEMA_INVALID', 'EG-T20', 'forced_zero_reason=SCHEMA_INVALID for bad hints');
  assertEq(graph.objectives[0].hint.rank_delta_hint, 0, 'EG-T20b', 'Delta zeroed for schema invalid');
})();

// ═══════════════════════════════════════════════════════════════════════════
// EG-T21 to EG-T25: Kill switch / quarantine overrides
// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n=== Kill Switch / Quarantine Overrides ===\n');

// EG-T21: Kill switch produces OVERRIDE derivation
(function () {
  var obj = makeObjResult('obj-1', {
    recommended_action: 'STOP',
    blocks: [{ type: 'kill_switch', detail: 'Kill switch engaged' }],
  });
  var graph = eg.build(makeReport([obj]), null, makeContext());
  var overrides = graph.objectives[0].derivations.filter(function (d) { return d.kind === 'OVERRIDE' && d.target === 'recommended_action'; });
  assertEq(overrides.length, 1, 'EG-T21', 'Kill switch produces 1 OVERRIDE derivation');
  assertEq(overrides[0].to, 'STOP', 'EG-T21b', 'Override to=STOP');
  assert(overrides[0].evidence[0].source === 'kill_switch', 'EG-T21c', 'Evidence source is kill_switch');
})();

// EG-T22: Quarantine produces OVERRIDE derivation
(function () {
  var obj = makeObjResult('obj-1', {
    recommended_action: 'HOLD',
    blocks: [{ type: 'quarantine', detail: 'Quarantined: repeated_failure' }],
  });
  var graph = eg.build(makeReport([obj]), null, makeContext());
  var overrides = graph.objectives[0].derivations.filter(function (d) { return d.kind === 'OVERRIDE' && d.target === 'recommended_action'; });
  assertEq(overrides.length, 1, 'EG-T22', 'Quarantine produces 1 OVERRIDE derivation');
  assertEq(overrides[0].to, 'HOLD', 'EG-T22b', 'Override to=HOLD');
  assert(overrides[0].evidence[0].source === 'quarantine', 'EG-T22c', 'Evidence source is quarantine');
})();

// EG-T23: Kill switch forces hint forced_zero_reason=KILL_SWITCH
(function () {
  var obj = makeObjResult('obj-1', {
    priority_score: 80, recommended_action: 'STOP',
    blocks: [{ type: 'kill_switch', detail: 'Kill switch engaged' }],
  });
  var hints = makeHints([{ objective_id: 'obj-1', priority_score: 80, risk_score: 50, confidence: 0.5, recommendation_code: 'STOP', rank_delta_hint: 6, why_codes: [] }]);
  var graph = eg.build(makeReport([obj]), hints, makeContext());
  assertEq(graph.objectives[0].hint.forced_zero_reason, 'KILL_SWITCH', 'EG-T23', 'Kill switch → forced_zero_reason=KILL_SWITCH');
  assertEq(graph.objectives[0].hint.rank_delta_hint, 0, 'EG-T23b', 'Delta zeroed by kill switch');
})();

// EG-T24: Quarantine forces hint forced_zero_reason=QUARANTINE
(function () {
  var obj = makeObjResult('obj-1', {
    priority_score: 70, recommended_action: 'HOLD',
    blocks: [{ type: 'quarantine', detail: 'quarantined' }],
  });
  var hints = makeHints([{ objective_id: 'obj-1', priority_score: 70, risk_score: 50, confidence: 0.5, recommendation_code: 'HOLD', rank_delta_hint: 4, why_codes: [] }]);
  var graph = eg.build(makeReport([obj]), hints, makeContext());
  assertEq(graph.objectives[0].hint.forced_zero_reason, 'QUARANTINE', 'EG-T24', 'Quarantine → forced_zero_reason=QUARANTINE');
})();

// EG-T25: Summary forced_zero_count is correct
(function () {
  var objs = [
    makeObjResult('obj-1', { priority_score: 80, recommended_action: 'STOP', blocks: [{ type: 'kill_switch', detail: 'ks' }] }),
    makeObjResult('obj-2', { priority_score: 70, risk_score: 30, confidence: 0.8 }),
    makeObjResult('obj-3', { priority_score: 60, risk_score: 95, confidence: 0.8 }),
  ];
  var hints = makeHints([
    { objective_id: 'obj-1', priority_score: 80, risk_score: 50, confidence: 0.5, recommendation_code: 'STOP', rank_delta_hint: 6, why_codes: [] },
    { objective_id: 'obj-2', priority_score: 70, risk_score: 30, confidence: 0.8, recommendation_code: 'FOCUS', rank_delta_hint: 4, why_codes: [] },
    { objective_id: 'obj-3', priority_score: 60, risk_score: 95, confidence: 0.8, recommendation_code: 'FOCUS', rank_delta_hint: 2, why_codes: [] },
  ]);
  var graph = eg.build(makeReport(objs), hints, makeContext());
  assertEq(graph.summary.forced_zero_count, 2, 'EG-T25', 'forced_zero_count=2 (kill_switch + high_risk)');
})();

// ═══════════════════════════════════════════════════════════════════════════
// EG-T26 to EG-T30: Arbiter simulation + clamping + edge cases
// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n=== Arbiter Simulation + Edge Cases ===\n');

// EG-T26: Arbiter simulation reorders by rank_delta descending
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
  var graph = eg.build(makeReport(objs), hints, makeContext());
  var sim = graph.arbiter_simulation;
  assertEq(sim[0].objective_id, 'obj-B', 'EG-T26', 'Highest delta first (obj-B delta=6)');
  assertEq(sim[1].objective_id, 'obj-A', 'EG-T26b', 'Zero delta second (obj-A delta=0)');
  assertEq(sim[2].objective_id, 'obj-C', 'EG-T26c', 'Negative delta last (obj-C delta=-4)');
})();

// EG-T27: Arbiter simulation tie-breaking by original position
(function () {
  var objs = [
    makeObjResult('obj-A', { priority_score: 75 }),
    makeObjResult('obj-B', { priority_score: 75 }),
  ];
  var hints = makeHints([
    { objective_id: 'obj-A', priority_score: 75, risk_score: 50, confidence: 0.5, recommendation_code: 'FOCUS', rank_delta_hint: 5, why_codes: [] },
    { objective_id: 'obj-B', priority_score: 75, risk_score: 50, confidence: 0.5, recommendation_code: 'FOCUS', rank_delta_hint: 5, why_codes: [] },
  ]);
  var graph = eg.build(makeReport(objs), hints, makeContext());
  assertEq(graph.arbiter_simulation[0].objective_id, 'obj-A', 'EG-T27', 'Same delta: original position wins (A before B)');
  assertEq(graph.arbiter_simulation[1].objective_id, 'obj-B', 'EG-T27b', 'B comes second');
})();

// EG-T28: No hints → passthrough order
(function () {
  var objs = [
    makeObjResult('obj-A', { priority_score: 60 }),
    makeObjResult('obj-B', { priority_score: 80 }),
  ];
  var graph = eg.build(makeReport(objs), null, makeContext());
  assertEq(graph.arbiter_simulation[0].objective_id, 'obj-A', 'EG-T28', 'No hints: original order preserved');
  assertEq(graph.arbiter_simulation[0].rank_delta, 0, 'EG-T28b', 'No hints: delta=0');
  assertEq(graph.inputs.hints_hash, 'none', 'EG-T28c', 'No hints: hints_hash=none');
})();

// EG-T29: Empty objectives → empty graph
(function () {
  var graph = eg.build(makeReport([]), null, makeContext());
  assertEq(graph.objectives.length, 0, 'EG-T29', 'Empty objectives → empty graph');
  assertEq(graph.summary.total_objectives, 0, 'EG-T29b', 'Summary shows 0 objectives');
  assertEq(graph.summary.mean_confidence, 0, 'EG-T29c', 'Mean confidence=0 for empty');
})();

// EG-T30: clamp_applied=false for normal priority scores (0-100)
(function () {
  var obj = makeObjResult('obj-1', { priority_score: 100 });
  var hints = makeHints([{ objective_id: 'obj-1', priority_score: 100, risk_score: 50, confidence: 0.5, recommendation_code: 'FOCUS', rank_delta_hint: 10, why_codes: [] }]);
  var graph = eg.build(makeReport([obj]), hints, makeContext());
  assertEq(graph.objectives[0].hint.clamp_applied, false, 'EG-T30', 'clamp_applied=false for priority=100 (delta=10, within [-10,10])');
})();

// ═══════════════════════════════════════════════════════════════════════════
// EG-T31 to EG-T33: Sanitization, markdown, failclosed
// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n=== Sanitization + Markdown + Failclosed ===\n');

// EG-T31: Secrets sanitized in signals
(function () {
  var obj = makeObjResult('obj-1', {
    lenses: {
      dev: { score_delta: 5, risk_delta: 0, confidence_delta: 0, signals: ['token=sk-abcdefghij1234567890 leaked'] },
      ops: { score_delta: 0, risk_delta: 0, confidence_delta: 0, signals: [] },
      business: { score_delta: 0, risk_delta: 0, confidence_delta: 0, signals: [] },
    },
  });
  var graph = eg.build(makeReport([obj]), null, makeContext());
  var sigText = graph.objectives[0].signals[0].text;
  assert(!sigText.includes('sk-abcdefghij1234567890'), 'EG-T31', 'Secret sanitized from signal text');
  assert(sigText.includes('[REDACTED]'), 'EG-T31b', '[REDACTED] placeholder present');
})();

// EG-T32: toMarkdown produces non-empty string
(function () {
  var obj = makeObjResult('obj-42', {
    priority_score: 75, risk_score: 30, confidence: 0.85,
    lenses: {
      dev: { score_delta: 10, risk_delta: -5, confidence_delta: 0.1, signals: ['healthy'] },
      ops: { score_delta: 5, risk_delta: -10, confidence_delta: 0.15, signals: ['stable'] },
      business: { score_delta: 10, risk_delta: -5, confidence_delta: 0.1, signals: ['high ROI'] },
    },
  });
  var graph = eg.build(makeReport([obj]), null, makeContext());
  var md = eg.toMarkdown(graph);
  assert(md.length > 100, 'EG-T32', 'Markdown output > 100 chars');
  assert(md.includes('obj-42'), 'EG-T32b', 'Markdown contains objective_id');
  assert(md.includes('Evidence Graph'), 'EG-T32c', 'Markdown contains title');
  assert(md.includes('Derivations'), 'EG-T32d', 'Markdown contains derivations table');
})();

// EG-T33: Failclosed graph for null report
(function () {
  var graph = eg.build(null, null, null);
  assertEq(graph.summary.failclosed, true, 'EG-T33', 'Null report → failclosed=true');
  assertEq(graph.objectives.length, 0, 'EG-T33b', 'Failclosed has 0 objectives');
  assertEq(graph.inputs.telemetry_bundle_hash, 'none', 'EG-T33c', 'Failclosed has none hashes');
  var result = eg.validate(graph);
  assert(result.valid === true, 'EG-T33d', 'Failclosed graph still validates');
  var md = eg.toMarkdown(graph);
  assert(md.includes('FAILCLOSED'), 'EG-T33e', 'Failclosed markdown shows FAILCLOSED');
})();

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n───────────────────────────────────────\n');
process.stdout.write('Evidence Graph Tests: ' + passed + ' passed, ' + failed + ' failed\n');
if (failures.length > 0) {
  process.stdout.write('Failures:\n');
  for (var i = 0; i < failures.length; i++) {
    process.stdout.write('  ' + failures[i] + '\n');
  }
}
process.stdout.write('───────────────────────────────────────\n');
process.exit(failed > 0 ? 1 : 0);
