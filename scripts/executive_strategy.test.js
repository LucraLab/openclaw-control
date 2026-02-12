#!/usr/bin/env node
/**
 * executive_strategy.test.js — Test suite for Executive Strategy Engine (Port #12)
 *
 * 35 tests covering:
 *   ES-T1  to ES-T5:  Schema validation
 *   ES-T6  to ES-T10: Deterministic scoring stability
 *   ES-T11 to ES-T15: Dev intel lens
 *   ES-T16 to ES-T20: Ops intel lens
 *   ES-T21 to ES-T25: Business intel lens
 *   ES-T26 to ES-T30: Action determination + fail-closed
 *   ES-T31 to ES-T35: LLM assist (disabled, enabled, fail-closed)
 *
 * No network calls. All fixture-driven.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..');

// --- Test harness ---
let _passed = 0;
let _failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    _passed++;
  } catch (e) {
    console.log(`  FAIL: ${name} — ${e.message}`);
    _failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// --- Fixture helpers ---
function loadFixtures() {
  const dir = path.join(REPO_ROOT, 'scripts', 'fixtures', 'executive_strategy');
  const objectives = JSON.parse(fs.readFileSync(path.join(dir, 'objectives.json'), 'utf8'));
  const eventsRaw = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim();
  const events = eventsRaw.split('\n').map(l => JSON.parse(l));
  const gateReports = JSON.parse(fs.readFileSync(path.join(dir, 'gate_reports.json'), 'utf8'));
  const quarantine = JSON.parse(fs.readFileSync(path.join(dir, 'quarantine.json'), 'utf8'));
  return { objectives, events, gateReports, quarantine };
}

function makeContext(overrides) {
  const base = {
    events: [],
    gateReports: {},
    objectives: {},
    quarantine: {},
    killSwitch: false,
    commitSha: 'test-sha',
  };
  return Object.assign(base, overrides);
}

console.log('============================================');
console.log('  Executive Strategy — Test Suite (Port #12)');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// =========================================================================
// Schema validation
// =========================================================================
console.log('--- Schema Validation ---');

test('ES-T1: makeDefaultResult returns valid structure', () => {
  const schema = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_schema'));
  const r = schema.makeDefaultResult('obj-test');
  assert(r.objective_id === 'obj-test', 'objective_id');
  assert(r.priority_score === 50, 'default priority');
  assert(r.risk_score === 50, 'default risk');
  assert(r.confidence === 0.5, 'default confidence');
  assert(r.recommended_action === 'PROCEED', 'default action');
  assert(Array.isArray(r.why), 'why array');
  assert(Array.isArray(r.next_steps), 'next_steps array');
  assert(Array.isArray(r.blocks), 'blocks array');
});

test('ES-T2: validateObjectiveResult accepts valid result', () => {
  const schema = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_schema'));
  const r = schema.makeDefaultResult('obj-1');
  const v = schema.validateObjectiveResult(r);
  assert(v.valid, `Expected valid, got: ${v.errors.join(', ')}`);
});

test('ES-T3: validateObjectiveResult rejects invalid priority_score', () => {
  const schema = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_schema'));
  const r = schema.makeDefaultResult('obj-1');
  r.priority_score = 150;
  const v = schema.validateObjectiveResult(r);
  assert(!v.valid, 'Should reject score > 100');
});

test('ES-T4: validateLensDelta accepts valid delta', () => {
  const schema = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_schema'));
  const v = schema.validateLensDelta({ score_delta: 10, risk_delta: 5, confidence_delta: -0.1, signals: ['test'] });
  assert(v.valid, `Expected valid: ${v.errors.join(', ')}`);
});

test('ES-T5: clampScore and clampConfidence enforce bounds', () => {
  const schema = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_schema'));
  assert(schema.clampScore(-10) === 0, 'clamp below 0');
  assert(schema.clampScore(150) === 100, 'clamp above 100');
  assert(schema.clampConfidence(-0.5) === 0, 'conf below 0');
  assert(schema.clampConfidence(1.5) === 1, 'conf above 1');
});

// =========================================================================
// Deterministic scoring stability
// =========================================================================
console.log('');
console.log('--- Deterministic Scoring ---');

test('ES-T6: Same fixtures produce identical scores on repeated runs', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const fixtures = loadFixtures();
  const ctx = makeContext({ ...fixtures, commitSha: 'stable-test' });
  const cfg = { fixtures_mode: true };

  const r1 = engine.run(ctx, cfg);
  const r2 = engine.run(ctx, cfg);

  // Compare scores (strip timestamps)
  for (let i = 0; i < r1.objectives.length; i++) {
    assert(r1.objectives[i].priority_score === r2.objectives[i].priority_score,
      `priority_score mismatch for ${r1.objectives[i].objective_id}`);
    assert(r1.objectives[i].risk_score === r2.objectives[i].risk_score,
      `risk_score mismatch`);
    assert(r1.objectives[i].confidence === r2.objectives[i].confidence,
      `confidence mismatch`);
    assert(r1.objectives[i].recommended_action === r2.objectives[i].recommended_action,
      `action mismatch`);
  }
});

test('ES-T7: Objectives are sorted by priority descending then ID ascending', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const fixtures = loadFixtures();
  const ctx = makeContext({ ...fixtures, commitSha: 'sort-test' });
  const report = engine.run(ctx, { fixtures_mode: true });

  for (let i = 1; i < report.objectives.length; i++) {
    const prev = report.objectives[i - 1];
    const curr = report.objectives[i];
    const ok = prev.priority_score > curr.priority_score ||
      (prev.priority_score === curr.priority_score &&
       prev.objective_id.localeCompare(curr.objective_id) <= 0);
    assert(ok, `Sort violation: ${prev.objective_id}(${prev.priority_score}) before ${curr.objective_id}(${curr.priority_score})`);
  }
});

test('ES-T8: Empty objectives produce empty report with OK status', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const report = engine.run(makeContext({}), { fixtures_mode: true });
  assert(report.status === 'OK', 'Status should be OK');
  assert(report.objectives.length === 0, 'Should have 0 objectives');
});

test('ES-T9: Null context produces FAILCLOSED', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const report = engine.run(null, {});
  assert(report.status === 'FAILCLOSED', `Expected FAILCLOSED, got ${report.status}`);
  const ev = report.events.find(e => e.event === 'EXEC_STRATEGY_FAILCLOSED');
  assert(ev, 'FAILCLOSED event missing');
});

test('ES-T10: Report contains EXEC_STRATEGY_COMPUTED event', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const report = engine.run(
    makeContext({ objectives: { 'obj-1': { objective_id: 'obj-1', tags: [] } } }),
    { fixtures_mode: true }
  );
  const ev = report.events.find(e => e.event === 'EXEC_STRATEGY_COMPUTED');
  assert(ev, 'EXEC_STRATEGY_COMPUTED event missing');
  assert(ev.objective_count === 1, `Expected count 1, got ${ev.objective_count}`);
});

// =========================================================================
// Dev intel lens
// =========================================================================
console.log('');
console.log('--- Dev Intel Lens ---');

test('ES-T11: Repeated CI failures raise priority and risk', () => {
  const devIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'dev_intel'));
  const events = [
    { event: 'DELIVERY_FAILED', objective_id: 'obj-1', reason: 'test_failure' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-1', reason: 'test_failure' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-1', reason: 'merge_conflict' },
  ];
  const delta = devIntel.analyze('obj-1', { events, gateReports: {}, objectives: {} });
  assert(delta.score_delta > 0, 'Priority should increase');
  assert(delta.risk_delta > 0, 'Risk should increase');
  assert(delta.confidence_delta < 0, 'Confidence should decrease');
});

test('ES-T12: No failures produce zero deltas', () => {
  const devIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'dev_intel'));
  const delta = devIntel.analyze('obj-clean', { events: [], gateReports: {}, objectives: {} });
  assert(delta.score_delta === 0, 'Score delta should be 0');
  assert(delta.risk_delta === 0, 'Risk delta should be 0');
});

test('ES-T13: Retries indicate churn', () => {
  const devIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'dev_intel'));
  const events = [
    { event: 'DELIVERY_RETRY', objective_id: 'obj-1', attempt: 2 },
    { event: 'DELIVERY_RETRY', objective_id: 'obj-1', attempt: 3 },
    { event: 'DELIVERY_RETRY', objective_id: 'obj-1', attempt: 4 },
  ];
  const delta = devIntel.analyze('obj-1', { events, gateReports: {}, objectives: {} });
  assert(delta.score_delta >= 10, 'High churn should raise priority');
  assert(delta.signals.some(s => s.includes('churn')), 'Should mention churn');
});

test('ES-T14: Gate failures raise risk', () => {
  const devIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'dev_intel'));
  const gateReports = {
    'drift-telemetry': { checks_passed: 8, checks_total: 10, failed: 2 },
  };
  const delta = devIntel.analyze('obj-1', { events: [], gateReports, objectives: {} });
  assert(delta.risk_delta > 0, 'Gate failures should raise risk');
});

test('ES-T15: Model escalation blocks signal complexity', () => {
  const devIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'dev_intel'));
  const events = [
    { event: 'MODEL_ESCALATION_BLOCKED', objective_id: 'obj-1' },
  ];
  const delta = devIntel.analyze('obj-1', { events, gateReports: {}, objectives: {} });
  assert(delta.risk_delta > 0, 'Escalation block should raise risk');
  assert(delta.signals.some(s => s.includes('complexity')), 'Should mention complexity');
});

// =========================================================================
// Ops intel lens
// =========================================================================
console.log('');
console.log('--- Ops Intel Lens ---');

test('ES-T16: Drift failures raise priority and risk', () => {
  const opsIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'ops_intel'));
  const gateReports = {
    'drift-telemetry': { checks_passed: 7, checks_total: 10, failed: 3 },
  };
  const delta = opsIntel.analyze('obj-1', { events: [], gateReports, quarantine: {} });
  assert(delta.score_delta > 0, 'Drift failures should raise priority');
  assert(delta.risk_delta >= 20, 'Drift failures should raise risk significantly');
  assert(delta.signals.some(s => s.includes('drift')), 'Should mention drift');
});

test('ES-T17: Lock contention raises risk', () => {
  const opsIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'ops_intel'));
  const events = [
    { event: 'ARBITRATION_BLOCKED', objective_id: 'obj-1' },
    { event: 'ARBITRATION_BLOCKED', objective_id: 'obj-1' },
    { event: 'ARBITRATION_BLOCKED', objective_id: 'obj-1' },
    { event: 'ARBITRATION_BLOCKED', objective_id: 'obj-1' },
    { event: 'ARBITRATION_BLOCKED', objective_id: 'obj-1' },
  ];
  const delta = opsIntel.analyze('obj-1', { events, gateReports: {}, quarantine: {} });
  assert(delta.risk_delta >= 15, 'Severe contention should raise risk');
  assert(delta.signals.some(s => s.includes('contention')), 'Should mention contention');
});

test('ES-T18: Budget breaches raise risk', () => {
  const opsIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'ops_intel'));
  const events = [
    { event: 'BUDGET_BREACH', objective_id: 'obj-1' },
  ];
  const delta = opsIntel.analyze('obj-1', { events, gateReports: {}, quarantine: {} });
  assert(delta.risk_delta >= 25, 'Budget breach should raise risk');
  assert(delta.confidence_delta < 0, 'Budget breach should lower confidence');
});

test('ES-T19: Quarantined objective raises risk and lowers confidence', () => {
  const opsIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'ops_intel'));
  const quarantine = { 'obj-1': { quarantined: true, reason: 'repeated_failure' } };
  const delta = opsIntel.analyze('obj-1', { events: [], gateReports: {}, quarantine });
  assert(delta.risk_delta >= 30, 'Quarantine should raise risk significantly');
  assert(delta.confidence_delta < 0, 'Quarantine should lower confidence');
  assert(delta.signals.some(s => s.includes('QUARANTINED')), 'Should mention quarantine');
});

test('ES-T20: Kill switch raises risk dramatically', () => {
  const opsIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'ops_intel'));
  const delta = opsIntel.analyze('obj-1', { events: [], gateReports: {}, quarantine: {}, killSwitch: true });
  assert(delta.risk_delta >= 50, 'Kill switch should raise risk dramatically');
  assert(delta.signals.some(s => s.includes('KILL SWITCH')), 'Should mention kill switch');
});

// =========================================================================
// Business intel lens
// =========================================================================
console.log('');
console.log('--- Business Intel Lens ---');

test('ES-T21: Revenue tag raises priority', () => {
  const bizIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'business_intel'));
  const objectives = { 'obj-1': { objective_id: 'obj-1', tags: ['revenue'], roi_likelihood: 'high' } };
  const delta = bizIntel.analyze('obj-1', { objectives });
  assert(delta.score_delta > 0, 'Revenue tag should raise priority');
});

test('ES-T22: Customer blocking raises priority and risk', () => {
  const bizIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'business_intel'));
  const objectives = { 'obj-1': { objective_id: 'obj-1', tags: ['customer_blocking'] } };
  const delta = bizIntel.analyze('obj-1', { objectives });
  assert(delta.score_delta > 0, 'Customer blocking should raise priority');
  assert(delta.risk_delta > 0, 'Customer blocking should raise risk');
});

test('ES-T23: nice_to_have tag lowers priority', () => {
  const bizIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'business_intel'));
  const objectives = { 'obj-1': { objective_id: 'obj-1', tags: ['nice_to_have'] } };
  const delta = bizIntel.analyze('obj-1', { objectives });
  assert(delta.score_delta < 0, 'nice_to_have should lower priority');
});

test('ES-T24: Overdue objective raises priority and risk', () => {
  const bizIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'business_intel'));
  const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const objectives = { 'obj-1': { objective_id: 'obj-1', tags: [], due_date: pastDate } };
  const delta = bizIntel.analyze('obj-1', { objectives });
  assert(delta.score_delta >= 20, 'Overdue should raise priority');
  assert(delta.risk_delta >= 20, 'Overdue should raise risk');
  assert(delta.signals.some(s => s.includes('OVERDUE')), 'Should mention overdue');
});

test('ES-T25: No business metadata lowers confidence', () => {
  const bizIntel = require(path.join(REPO_ROOT, 'scripts', 'modules', 'business_intel'));
  const objectives = { 'obj-1': { objective_id: 'obj-1', tags: [] } };
  const delta = bizIntel.analyze('obj-1', { objectives });
  assert(delta.confidence_delta < 0, 'Missing metadata should lower confidence');
  assert(delta.signals.some(s => s.includes('No business metadata')), 'Should signal missing metadata');
});

// =========================================================================
// Action determination + fail-closed
// =========================================================================
console.log('');
console.log('--- Action Determination ---');

test('ES-T26: Quarantined objective forces HOLD', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const report = engine.run(
    makeContext({
      objectives: { 'obj-q': { objective_id: 'obj-q', tags: ['revenue'] } },
      quarantine: { 'obj-q': { quarantined: true, reason: 'test' } },
    }),
    { fixtures_mode: true }
  );
  assert(report.objectives[0].recommended_action === 'HOLD', 'Should be HOLD');
  assert(report.objectives[0].blocks.length > 0, 'Should have blocks');
});

test('ES-T27: Kill switch forces STOP', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const report = engine.run(
    makeContext({
      objectives: { 'obj-k': { objective_id: 'obj-k', tags: ['revenue'] } },
      killSwitch: true,
    }),
    { fixtures_mode: true }
  );
  assert(report.objectives[0].recommended_action === 'STOP', 'Should be STOP');
});

test('ES-T28: Corrupt/missing inputs fail closed to safe output', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  // null context
  const r1 = engine.run(null, {});
  assert(r1.status === 'FAILCLOSED', 'null context → FAILCLOSED');
  // undefined context
  const r2 = engine.run(undefined, {});
  assert(r2.status === 'FAILCLOSED', 'undefined context → FAILCLOSED');
  // non-object context
  const r3 = engine.run('garbage', {});
  assert(r3.status === 'FAILCLOSED', 'string context → FAILCLOSED');
});

test('ES-T29: Low priority + low risk → DEPRIORITIZE', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  // nice_to_have tag gives -10 score, low roi gives *0.7, no events → low everything
  const report = engine.run(
    makeContext({
      objectives: {
        'obj-low': {
          objective_id: 'obj-low',
          tags: ['nice_to_have'],
          roi_likelihood: 'low',
        },
      },
    }),
    { fixtures_mode: true }
  );
  const obj = report.objectives[0];
  assert(obj.recommended_action === 'DEPRIORITIZE', `Expected DEPRIORITIZE, got ${obj.recommended_action}`);
});

test('ES-T30: Repeated failures with varied reasons → action reflects confidence', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const events = [
    { event: 'DELIVERY_FAILED', objective_id: 'obj-f', reason: 'test_failure' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-f', reason: 'merge_conflict' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-f', reason: 'timeout' },
  ];
  const report = engine.run(
    makeContext({
      events,
      objectives: { 'obj-f': { objective_id: 'obj-f', tags: [] } },
    }),
    { fixtures_mode: true }
  );
  const obj = report.objectives[0];
  // With 3 failures + no biz metadata → low confidence → should be INVESTIGATE
  assert(
    obj.recommended_action === 'INVESTIGATE' || obj.recommended_action === 'RETRY',
    `Expected INVESTIGATE or RETRY, got ${obj.recommended_action}`
  );
});

// =========================================================================
// LLM assist
// =========================================================================
console.log('');
console.log('--- LLM Assist ---');

test('ES-T31: LLM disabled → never called', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  let llmCalled = false;
  const report = engine.run(
    makeContext({
      objectives: { 'obj-1': { objective_id: 'obj-1', tags: [] } },
    }),
    {
      llm_enabled: false,
      _llmStub: () => { llmCalled = true; return '{}'; },
    }
  );
  assert(!llmCalled, 'LLM should not be called when disabled');
  assert(report.llm_used === false, 'llm_used should be false');
});

test('ES-T32: LLM enabled + low confidence → called with valid stub', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  let llmCalled = false;
  // Create a low-confidence scenario
  const events = [
    { event: 'DELIVERY_FAILED', objective_id: 'obj-lc', reason: 'test_failure' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-lc', reason: 'merge_conflict' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-lc', reason: 'timeout' },
  ];
  const report = engine.run(
    makeContext({
      events,
      objectives: { 'obj-lc': { objective_id: 'obj-lc', tags: [] } },
    }),
    {
      llm_enabled: true,
      _llmStub: (prompt) => {
        llmCalled = true;
        return JSON.stringify({
          root_cause_category: 'intermittent_infra',
          suggestions: ['Check CI runner health', 'Review merge queue'],
          confidence_adjustment: 0.1,
        });
      },
    }
  );
  assert(llmCalled, 'LLM should be called for low confidence objective');
  assert(report.llm_used === true, 'llm_used should be true');
  const obj = report.objectives.find(o => o.objective_id === 'obj-lc');
  assert(obj.llm_assist !== null, 'llm_assist should be populated');
  assert(obj.llm_assist.root_cause_category === 'intermittent_infra', 'root_cause should match');
});

test('ES-T33: Invalid LLM JSON → fall back to rules-only', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const events = [
    { event: 'DELIVERY_FAILED', objective_id: 'obj-bad', reason: 'test_failure' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-bad', reason: 'merge_conflict' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-bad', reason: 'timeout' },
  ];
  const report = engine.run(
    makeContext({
      events,
      objectives: { 'obj-bad': { objective_id: 'obj-bad', tags: [] } },
    }),
    {
      llm_enabled: true,
      _llmStub: () => 'not valid json at all!!!',
    }
  );
  const obj = report.objectives.find(o => o.objective_id === 'obj-bad');
  assert(obj.llm_assist !== null, 'llm_assist should exist');
  assert(obj.llm_assist.failed === true, 'Should be marked as failed');
  assert(obj.llm_assist.reason === 'schema_invalid', `Expected schema_invalid, got ${obj.llm_assist.reason}`);
});

test('ES-T34: LLM stub exception → fail closed', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const events = [
    { event: 'DELIVERY_FAILED', objective_id: 'obj-ex', reason: 'a' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-ex', reason: 'b' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-ex', reason: 'c' },
  ];
  const report = engine.run(
    makeContext({
      events,
      objectives: { 'obj-ex': { objective_id: 'obj-ex', tags: [] } },
    }),
    {
      llm_enabled: true,
      _llmStub: () => { throw new Error('simulated timeout'); },
    }
  );
  const obj = report.objectives.find(o => o.objective_id === 'obj-ex');
  assert(obj.llm_assist !== null, 'llm_assist should exist');
  assert(obj.llm_assist.failed === true, 'Should be marked as failed');
});

test('ES-T35: LLM suggestions limited to max 3', () => {
  const llmAssist = require(path.join(REPO_ROOT, 'scripts', 'executive_llm_assist'));
  const parsed = llmAssist.parseLLMResponse(JSON.stringify({
    root_cause_category: 'test',
    suggestions: ['a', 'b', 'c', 'd', 'e'],
    confidence_adjustment: 0,
  }));
  assert(parsed !== null, 'Should parse');
  assert(parsed.suggestions.length === 3, `Expected 3 suggestions, got ${parsed.suggestions.length}`);
});

// =========================================================================
// Summary
// =========================================================================
console.log('');
console.log('============================================');
console.log(`  Results: ${_passed}/${_passed + _failed} passed, ${_failed} failed`);
console.log('============================================');

process.exit(_failed > 0 ? 1 : 0);
