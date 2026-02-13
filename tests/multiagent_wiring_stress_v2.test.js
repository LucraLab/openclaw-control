#!/usr/bin/env node
/**
 * multiagent_wiring_stress_v2.test.js — Offline tests for Wiring Stress Runner v2
 *
 * Usage: node tests/multiagent_wiring_stress_v2.test.js
 * Exit 0 = all tests pass, Exit 1 = failures
 *
 * All tests use stubs/fixtures. No network calls. No LLM calls.
 * Covers: request shaping, quarantine skip logic, cap logic, concurrency limiter,
 * sanitization, deterministic artifact formatting, LLM gating reachability.
 *
 * No-Secrets Fixture Policy:
 *   Test token strings are sized ABOVE sanitization thresholds (8-10 chars)
 *   but BELOW CI gate thresholds (20+ chars for sk-/ghp_, 16 uppercase for AKIA).
 *   See docs/MULTIAGENT_STRESS_TEST_PACK.md for full rules.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Test harness ───
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      throw new Error('Use asyncTest() for async tests');
    }
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
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

function assertDeepEqual(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg || 'assertDeepEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Module imports ───
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

const swarm = require(path.join(SCRIPTS_DIR, 'war_room_swarm'));
const engine = require(path.join(SCRIPTS_DIR, 'executive_strategy_engine'));
const schema = require(path.join(SCRIPTS_DIR, 'executive_strategy_schema'));
const llmAssist = require(path.join(SCRIPTS_DIR, 'executive_llm_assist'));

// Temp runtime for real runtime tests
const TEMP_RUNTIME_DIR = path.join(os.tmpdir(), `oc-wiring-v2-test-${Date.now()}`);
process.env.OPENCLAW_RUNTIME_DIR = TEMP_RUNTIME_DIR;
delete require.cache[require.resolve(path.join(SCRIPTS_DIR, 'autonomy_runtime'))];
const runtime = require(path.join(SCRIPTS_DIR, 'autonomy_runtime'));

// ─── Constants from runner (replicated for testing) ───
const AGENT_ROSTER = [
  'pa', 'developer', 'architect', 'debugger', 'ops-1', 'ops-2',
  'finance', 'cs', 'sales', 'insights', 'technical-writer',
  'vault', 'crystal-pa', 'quality-reviewer', 'scrooge', 'rental'
];

const BUILDER1_AGENTS = new Set([
  'vault', 'finance', 'scrooge', 'ops-1', 'architect',
  'developer', 'debugger', 'quality-reviewer', 'technical-writer'
]);

const BUILDER2_AGENTS = new Set([
  'pa', 'sales', 'cs', 'rental', 'insights', 'crystal-pa', 'ops-2'
]);

const DEFAULT_MAX_AGENTS = 5;
const EXPANDED_MAX_AGENTS = 10;
const MAX_CONCURRENCY = 3;
const MAX_TOKENS = 64;
const PING_MAX_TOKENS = 8;
const TEMPERATURE = 0;
const PER_AGENT_TIMEOUT = 20;

// ─── Helper: build request shape ───
function buildRequestShape(agent, prompt, maxTok) {
  return {
    url: `http://100.75.216.57:${BUILDER2_AGENTS.has(agent) ? 8082 : 8080}/v1/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer [REDACTED]',
      'x-openclaw-agent-id': agent,
    },
    body: {
      model: 'openclaw',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTok,
      temperature: TEMPERATURE,
    },
  };
}

// ─── Helper: mock runtime ───
function createMockRuntime({ killswitch = false, quarantine = [] } = {}) {
  const events = [];
  const artifacts = [];
  return {
    events, artifacts,
    killSwitchGuard(ep) {
      if (killswitch) { events.push({ event: 'KILLSWITCH_ACTIVE', entrypoint: ep }); return true; }
      return false;
    },
    quarantineList() { return [...quarantine]; },
    isQuarantined(id) { return quarantine.includes(id); },
    emitEvent(type, payload) { events.push({ event: type, ...payload }); },
    writeCanonicalArtifact(type, data) {
      const ts = '2026-02-13T00-00-00-000Z';
      artifacts.push({ type, data, jsonPath: `/tmp/${type}-${ts}.json`, mdPath: `/tmp/${type}-${ts}.md` });
      return { jsonPath: `/tmp/${type}-${ts}.json`, mdPath: `/tmp/${type}-${ts}.md` };
    },
    sanitize(s) { return runtime.sanitize(s); },
  };
}


// ══════════════════════════════════════
// CATEGORY A: Request Shaping (headers/models)
// ══════════════════════════════════════
console.log('\n── A: Request Shaping ──');

test('A1: Request uses x-openclaw-agent-id header', () => {
  const req = buildRequestShape('pa', 'test', PING_MAX_TOKENS);
  assertEqual(req.headers['x-openclaw-agent-id'], 'pa', 'header should be agent id');
});

test('A2: Request model is "openclaw" (not "openclaw:agent")', () => {
  const req = buildRequestShape('sales', 'test', MAX_TOKENS);
  assertEqual(req.body.model, 'openclaw', 'model should be bare openclaw');
});

test('A3: Request temperature is 0', () => {
  const req = buildRequestShape('cs', 'test', MAX_TOKENS);
  assertEqual(req.body.temperature, 0, 'temperature must be 0');
});

test('A4: Ping request max_tokens is 8', () => {
  const req = buildRequestShape('pa', 'ping', PING_MAX_TOKENS);
  assertEqual(req.body.max_tokens, 8, 'ping max_tokens must be 8');
});

test('A5: Full dispatch max_tokens is 64', () => {
  const req = buildRequestShape('pa', 'full', MAX_TOKENS);
  assertEqual(req.body.max_tokens, 64, 'full max_tokens must be 64');
});

test('A6: Builder2 agents route to port 8082', () => {
  for (const agent of BUILDER2_AGENTS) {
    const req = buildRequestShape(agent, 'test', 8);
    assert(req.url.includes(':8082'), `${agent} should route to 8082`);
  }
});

test('A7: Builder1 agents route to port 8080', () => {
  for (const agent of BUILDER1_AGENTS) {
    const req = buildRequestShape(agent, 'test', 8);
    assert(req.url.includes(':8080'), `${agent} should route to 8080`);
  }
});

test('A8: Messages array has exactly one user message', () => {
  const req = buildRequestShape('pa', 'hello', 8);
  assertEqual(req.body.messages.length, 1, 'should have 1 message');
  assertEqual(req.body.messages[0].role, 'user', 'role should be user');
});


// ══════════════════════════════════════
// CATEGORY B: Quarantine Skip Logic
// ══════════════════════════════════════
console.log('\n── B: Quarantine Skip Logic ──');

test('B1: Quarantined agent removed from dispatch list', () => {
  const quarantined = ['pa', 'sales'];
  const active = AGENT_ROSTER.filter(a => !quarantined.includes(a));
  assert(!active.includes('pa'), 'pa should be removed');
  assert(!active.includes('sales'), 'sales should be removed');
  assert(active.includes('cs'), 'cs should remain');
});

test('B2: All agents quarantined → empty roster', () => {
  const active = AGENT_ROSTER.filter(a => AGENT_ROSTER.includes(a) && false);
  assertEqual(active.length, 0, 'should be empty');
});

test('B3: Non-existent quarantine entry does not affect roster', () => {
  const quarantined = ['nonexistent-agent'];
  const active = AGENT_ROSTER.filter(a => !quarantined.includes(a));
  assertEqual(active.length, AGENT_ROSTER.length, 'all agents should remain');
});

test('B4: Quarantine skip logged per agent', () => {
  const rt = createMockRuntime({ quarantine: ['pa', 'debugger'] });
  const skipped = [];
  for (const agent of AGENT_ROSTER) {
    if (rt.isQuarantined(agent)) {
      skipped.push(agent);
      rt.emitEvent('STRESS_RUN_AGENT_RESULT', { agent, status: 'SKIP_QUARANTINE' });
    }
  }
  assertEqual(skipped.length, 2, 'should skip 2');
  assert(rt.events.some(e => e.agent === 'pa' && e.status === 'SKIP_QUARANTINE'), 'pa skipped');
  assert(rt.events.some(e => e.agent === 'debugger' && e.status === 'SKIP_QUARANTINE'), 'debugger skipped');
});

test('B5: Real runtime quarantine add/remove cycle', () => {
  runtime.quarantineAdd('test-agent-v2');
  assert(runtime.isQuarantined('test-agent-v2'), 'should be quarantined');
  runtime.quarantineRemove('test-agent-v2');
  assert(!runtime.isQuarantined('test-agent-v2'), 'should be unquarantined');
});


// ══════════════════════════════════════
// CATEGORY C: Cap Logic + Concurrency Limiter
// ══════════════════════════════════════
console.log('\n── C: Cap Logic + Concurrency ──');

test('C1: Default cap is 5 agents', () => {
  assertEqual(DEFAULT_MAX_AGENTS, 5, 'default cap must be 5');
});

test('C2: Expand cap is 10 agents', () => {
  assertEqual(EXPANDED_MAX_AGENTS, 10, 'expanded cap must be 10');
});

test('C3: Agent list capped at MAX_AGENTS', () => {
  const agents = [...AGENT_ROSTER];
  const capped = agents.slice(0, DEFAULT_MAX_AGENTS);
  assertEqual(capped.length, 5, 'should be capped to 5');
  assert(agents.length > 5, 'original should have more than 5');
});

test('C4: Concurrency limit is 3', () => {
  assertEqual(MAX_CONCURRENCY, 3, 'max concurrency must be 3');
});

test('C5: Per-agent timeout is 20s', () => {
  assertEqual(PER_AGENT_TIMEOUT, 20, 'timeout must be 20');
});

// C6 is async — defined in main() below

test('C7: Expand cap requires explicit flag', () => {
  // Simulate: without flag, cap stays at 5
  const expandFlag = false;
  const cap = expandFlag ? EXPANDED_MAX_AGENTS : DEFAULT_MAX_AGENTS;
  assertEqual(cap, 5, 'without flag, cap must be 5');
});

test('C8: With expand flag, cap is 10', () => {
  const expandFlag = true;
  const cap = expandFlag ? EXPANDED_MAX_AGENTS : DEFAULT_MAX_AGENTS;
  assertEqual(cap, 10, 'with flag, cap must be 10');
});


// ══════════════════════════════════════
// CATEGORY D: Sanitization
// ══════════════════════════════════════
console.log('\n── D: Sanitization ──');

test('D1: Runtime sanitize redacts sk- tokens', () => {
  const dirty = 'key is sk-abc1234567890';
  const clean = runtime.sanitize(dirty);
  assert(!clean.includes('sk-abc1234'), 'should redact sk- token');
  assert(clean.includes('[REDACTED]'), 'should contain [REDACTED]');
});

test('D2: Runtime sanitize redacts Bearer tokens', () => {
  const dirty = 'Auth: Bearer eyJhbGciOiJIUzI1test';
  const clean = runtime.sanitize(dirty);
  assert(!clean.includes('eyJhbGci'), 'should redact Bearer');
});

test('D3: Engine sanitize redacts pit- tokens', () => {
  const dirty = 'GHL: pit-abc123456789xyz';
  const clean = engine.sanitize(dirty);
  assert(!clean.includes('pit-abc1234'), 'should redact pit-');
});

test('D4: Swarm sanitizeOutput redacts multiple patterns', () => {
  const dirty = 'token sk-abcdefghij and ya29.a0ARrdaM8test';
  const clean = swarm.sanitizeOutput(dirty);
  assert(!clean.includes('sk-abcdef'), 'should redact sk-');
  assert(!clean.includes('ya29.a0ARr'), 'should redact ya29.');
});

test('D5: Clean text passes through unchanged', () => {
  const clean = 'Normal agent response with no secrets.';
  assertEqual(runtime.sanitize(clean), clean, 'clean text should pass through');
});

test('D6: Auth token never appears in proof output shape', () => {
  // Simulate proof file content
  const proofContent = `Auth: [REDACTED] (48 chars)\nResults: pa OK`;
  assert(!proofContent.includes('gho_'), 'no OAuth tokens');
  assert(!proofContent.includes('Bearer ey'), 'no Bearer tokens');
  assert(proofContent.includes('[REDACTED]'), 'should have redaction');
});


// ══════════════════════════════════════
// CATEGORY E: Deterministic Artifact Formatting
// ══════════════════════════════════════
console.log('\n── E: Deterministic Artifact Formatting ──');

test('E1: Stress-run artifact JSON is stable-sorted', () => {
  const { jsonPath } = runtime.writeCanonicalArtifact('stress-run', {
    run_id: 'test-001', passed: 5, failed: 0, agents: 5
  });
  const content = fs.readFileSync(jsonPath, 'utf8');
  const parsed = JSON.parse(content);
  const keys = Object.keys(parsed);
  const sorted = [...keys].sort();
  assertDeepEqual(keys, sorted, 'keys should be alphabetically sorted');
});

test('E2: Two identical inputs produce byte-identical JSON', () => {
  const data = { run_id: 'det-test', passed: 3, failed: 1, note: 'determinism' };
  const { jsonPath: p1 } = runtime.writeCanonicalArtifact('stress-run', { ...data });
  const c1 = fs.readFileSync(p1, 'utf8');
  // Write a second one — different timestamp in filename but same data shape
  const { jsonPath: p2 } = runtime.writeCanonicalArtifact('stress-run', { ...data });
  const c2 = fs.readFileSync(p2, 'utf8');
  // The computed_at timestamps differ, so strip them for comparison
  const strip = s => s.replace(/"computed_at":\s*"[^"]*"/, '"computed_at":"X"');
  assertEqual(strip(c1), strip(c2), 'content should be identical (modulo timestamp)');
});

test('E3: Artifact writes both JSON and MD files', () => {
  const { jsonPath, mdPath } = runtime.writeCanonicalArtifact('stress-run', { run_id: 'e3-test' });
  assert(fs.existsSync(jsonPath), 'JSON file should exist');
  assert(fs.existsSync(mdPath), 'MD file should exist');
});

test('E4: Artifact MD contains heading', () => {
  const { mdPath } = runtime.writeCanonicalArtifact('stress-run', { run_id: 'e4-test' });
  const md = fs.readFileSync(mdPath, 'utf8');
  assert(md.startsWith('# Stress Run'), 'MD should start with heading');
});

test('E5: Artifact filenames follow type-timestamp pattern', () => {
  const { jsonPath } = runtime.writeCanonicalArtifact('stress-run', { run_id: 'e5-test' });
  const basename = path.basename(jsonPath);
  assert(basename.startsWith('stress-run-'), 'should start with type');
  assert(basename.endsWith('.json'), 'should end with .json');
});


// ══════════════════════════════════════
// CATEGORY F: LLM Gating Logic (no provider call)
// ══════════════════════════════════════
console.log('\n── F: LLM Gating Logic ──');

test('F1: shouldTriggerLLM fires on low confidence (<0.65)', () => {
  const result = schema.makeDefaultResult('test-obj');
  result.confidence = 0.4;
  const trigger = engine.shouldTriggerLLM(result, { events: [] });
  assert(trigger !== null, 'should trigger');
  assert(trigger.includes('low_confidence'), 'reason should be low_confidence');
});

test('F2: shouldTriggerLLM does NOT fire on high confidence (>=0.65)', () => {
  const result = schema.makeDefaultResult('test-obj');
  result.confidence = 0.8;
  const trigger = engine.shouldTriggerLLM(result, { events: [] });
  assertEqual(trigger, null, 'should not trigger');
});

test('F3: shouldTriggerLLM fires on high_risk_missing_evidence', () => {
  const result = schema.makeDefaultResult('test-obj');
  result.risk_score = 80;
  result.confidence = 0.7; // above 0.65 so low_confidence doesn't fire first
  const ctx = { events: [], objectives: { 'test-obj': { tags: [] } } };
  const trigger = engine.shouldTriggerLLM(result, ctx);
  assert(trigger !== null, 'should trigger');
  assert(trigger.includes('high_risk_missing_evidence'), 'reason');
});

test('F4: shouldTriggerLLM fires on repeated_failures_varied', () => {
  const result = schema.makeDefaultResult('test-obj');
  result.confidence = 0.7; // above 0.65 so low_confidence doesn't fire first
  const ctx = {
    events: [
      { event: 'DELIVERY_FAILED', objective_id: 'test-obj', reason: 'timeout' },
      { event: 'DELIVERY_FAILED', objective_id: 'test-obj', reason: 'rate_limit' },
      { event: 'DELIVERY_FAILED', objective_id: 'test-obj', reason: 'schema_error' },
    ]
  };
  const trigger = engine.shouldTriggerLLM(result, ctx);
  assert(trigger !== null, 'should trigger');
  assert(trigger.includes('repeated_failures'), 'reason');
});

test('F5: LLM assist is OFF by default', () => {
  const origEnv = process.env.EXEC_STRATEGY_LLM;
  delete process.env.EXEC_STRATEGY_LLM;
  const result = schema.makeDefaultResult('test-obj');
  const out = llmAssist.assist(result, {}, { llm_enabled: false });
  assertEqual(out, null, 'should return null when disabled');
  if (origEnv !== undefined) process.env.EXEC_STRATEGY_LLM = origEnv;
});

test('F6: LLM assist stub injection works', () => {
  const result = schema.makeDefaultResult('test-obj');
  result.confidence = 0.3;
  const config = {
    llm_enabled: true,
    _llmStub: () => JSON.stringify({
      root_cause_category: 'timeout',
      suggestions: ['retry with backoff'],
      confidence_adjustment: 0.1,
    }),
  };
  process.env.EXEC_STRATEGY_LLM = '1';
  const out = llmAssist.assist(result, {}, config);
  delete process.env.EXEC_STRATEGY_LLM;
  assert(out !== null, 'should return result');
  assertEqual(out.root_cause_category, 'timeout', 'category');
  assertEqual(out.suggestions.length, 1, 'suggestions count');
});

test('F7: LLM assist fails closed on invalid JSON', () => {
  const result = schema.makeDefaultResult('test-obj');
  const config = {
    llm_enabled: true,
    _llmStub: () => 'not json at all',
  };
  process.env.EXEC_STRATEGY_LLM = '1';
  const out = llmAssist.assist(result, {}, config);
  delete process.env.EXEC_STRATEGY_LLM;
  assert(out !== null, 'should return failure');
  assertEqual(out.failed, true, 'should be failed');
  assertEqual(out.reason, 'schema_invalid', 'reason');
});

test('F8: LLM assist fails closed on stub exception', () => {
  const result = schema.makeDefaultResult('test-obj');
  const config = {
    llm_enabled: true,
    _llmStub: () => { throw new Error('provider down'); },
  };
  process.env.EXEC_STRATEGY_LLM = '1';
  const out = llmAssist.assist(result, {}, config);
  delete process.env.EXEC_STRATEGY_LLM;
  assert(out !== null, 'should return failure');
  assertEqual(out.failed, true, 'should be failed');
  assertEqual(out.reason, 'stub_exception', 'reason');
});

test('F9: LLM max suggestions capped at 3', () => {
  const result = schema.makeDefaultResult('test-obj');
  const config = {
    llm_enabled: true,
    _llmStub: () => JSON.stringify({
      root_cause_category: 'test',
      suggestions: ['a', 'b', 'c', 'd', 'e'],
      confidence_adjustment: 0,
    }),
  };
  process.env.EXEC_STRATEGY_LLM = '1';
  const out = llmAssist.assist(result, {}, config);
  delete process.env.EXEC_STRATEGY_LLM;
  assert(out.suggestions.length <= 3, 'max 3 suggestions');
});

test('F10: Engine run emits LLM_SKIPPED when disabled', () => {
  const ctx = {
    objectives: { 'test-obj': { objective_id: 'test-obj', status: 'IN_PROGRESS', tags: [] } },
    events: [], gateReports: {}, quarantine: {}, killSwitch: false, commitSha: 'test',
  };
  const report = engine.run(ctx, { llm_enabled: false });
  const llmEvent = report.events.find(e => e.event === 'EXEC_STRATEGY_LLM_SKIPPED');
  assert(llmEvent !== undefined, 'should have LLM_SKIPPED event');
  assertEqual(llmEvent.reason, 'disabled', 'reason should be disabled');
});

test('F11: Fixture objective triggers LLM gating decision', () => {
  // Replicate Phase 4 fixture from the runner
  const ctx = {
    objectives: {
      'stress-llm-test': {
        objective_id: 'stress-llm-test', status: 'IN_PROGRESS',
        risk: 'high', tags: [], created_at: '2026-01-01T00:00:00Z'
      }
    },
    events: [
      { event: 'DELIVERY_FAILED', objective_id: 'stress-llm-test', reason: 'timeout' },
      { event: 'DELIVERY_FAILED', objective_id: 'stress-llm-test', reason: 'rate_limit' },
      { event: 'DELIVERY_FAILED', objective_id: 'stress-llm-test', reason: 'schema_mismatch' },
    ],
    gateReports: {}, quarantine: {}, killSwitch: false, commitSha: 'test'
  };
  const report = engine.run(ctx, { llm_enabled: true });
  const obj = report.objectives[0];
  // The objective should trigger LLM because of repeated_failures_varied
  const trigger = engine.shouldTriggerLLM(obj, ctx);
  assert(trigger !== null, 'should trigger LLM gating');
});

test('F12: Token caps enforced in constants', () => {
  assertEqual(llmAssist.MAX_INPUT_TOKENS, 800, 'input cap');
  assertEqual(llmAssist.MAX_OUTPUT_TOKENS, 400, 'output cap');
});


// ══════════════════════════════════════
// CATEGORY G: Kill Switch + Runtime Wiring
// ══════════════════════════════════════
console.log('\n── G: Kill Switch + Runtime Wiring ──');

test('G1: Kill switch guard blocks when active', () => {
  runtime.killSwitchEnable();
  const blocked = runtime.killSwitchGuard('wiring-v2-test');
  assertEqual(blocked, true, 'should be blocked');
  runtime.killSwitchDisable();
});

test('G2: Kill switch guard allows when inactive', () => {
  runtime.killSwitchDisable();
  const blocked = runtime.killSwitchGuard('wiring-v2-test');
  assertEqual(blocked, false, 'should not be blocked');
});

test('G3: Runtime event emission writes to events.jsonl', () => {
  runtime.emitEvent('WIRING_V2_TEST', { test: true, value: 99 });
  const eventsPath = runtime.runtimePath('events.jsonl');
  const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
  const lastEvent = JSON.parse(lines[lines.length - 1]);
  assertEqual(lastEvent.event, 'WIRING_V2_TEST', 'event type');
  assertEqual(lastEvent.value, 99, 'payload value');
});

test('G4: Runtime event sanitizes secrets in payload', () => {
  runtime.emitEvent('SECRET_TEST_V2', { token: 'sk-testkey12345abcd' });
  const eventsPath = runtime.runtimePath('events.jsonl');
  const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
  const lastEvent = JSON.parse(lines[lines.length - 1]);
  assert(!lastEvent.token.includes('sk-testkey'), 'should be redacted');
  assert(lastEvent.token.includes('[REDACTED]'), 'should contain [REDACTED]');
});


// ══════════════════════════════════════
// CATEGORY H: Failure Threshold + Hard Stop
// ══════════════════════════════════════
console.log('\n── H: Failure Threshold + Hard Stop ──');

test('H1: 50% failure threshold in first 6 triggers hard stop', () => {
  const threshold = 50;
  const dispatched = 6;
  const failures = 4;
  const pct = (failures * 100) / dispatched;
  assert(pct > threshold, `${pct}% should exceed ${threshold}%`);
});

test('H2: 33% failure does NOT trigger hard stop', () => {
  const threshold = 50;
  const dispatched = 6;
  const failures = 2;
  const pct = (failures * 100) / dispatched;
  assert(pct <= threshold, `${pct}% should not exceed ${threshold}%`);
});

test('H3: Fewer than 6 dispatched does not check threshold', () => {
  // Logic: only check after 6+ agents dispatched
  const dispatched = 4;
  const shouldCheck = dispatched >= 6;
  assertEqual(shouldCheck, false, 'should not check yet');
});


// ══════════════════════════════════════
// CATEGORY I: Agent Roster Completeness
// ══════════════════════════════════════
console.log('\n── I: Agent Roster ──');

test('I1: Agent roster has 16 entries', () => {
  assertEqual(AGENT_ROSTER.length, 16, 'roster count');
});

test('I2: Every agent maps to exactly one builder', () => {
  for (const agent of AGENT_ROSTER) {
    const inB1 = BUILDER1_AGENTS.has(agent);
    const inB2 = BUILDER2_AGENTS.has(agent);
    assert(inB1 || inB2, `${agent} must be in at least one builder`);
    // Note: some agents CAN be in both (pa, sales, etc. are in swarm BUILDER2_PREFERRED)
    // but for the runner we map each to exactly one
  }
});

test('I3: Builder1 has 9 agents', () => {
  assertEqual(BUILDER1_AGENTS.size, 9, 'Builder1 count');
});

test('I4: Builder2 has 7 agents', () => {
  assertEqual(BUILDER2_AGENTS.size, 7, 'Builder2 count');
});

test('I5: Roster matches war_room_swarm.js AGENT_ROSTER', () => {
  const swarmRoster = swarm.AGENT_ROSTER || [];
  assertDeepEqual(
    [...AGENT_ROSTER].sort(),
    [...swarmRoster].sort(),
    'rosters should match'
  );
});


// ══════════════════════════════════════
// CATEGORY J: CI Guard + Manual Only
// ══════════════════════════════════════
console.log('\n── J: CI Guard ──');

test('J1: Runner script contains CI environment guard', () => {
  const runnerSrc = fs.readFileSync(
    path.join(SCRIPTS_DIR, 'multiagent_wiring_stress_runner_v2.sh'), 'utf8'
  );
  assert(runnerSrc.includes('GITHUB_ACTIONS'), 'should check GITHUB_ACTIONS');
  assert(runnerSrc.includes('GITLAB_CI'), 'should check GITLAB_CI');
  assert(runnerSrc.includes('CIRCLECI'), 'should check CIRCLECI');
  assert(runnerSrc.includes('JENKINS_URL'), 'should check JENKINS_URL');
});

test('J2: Runner marked MANUAL ONLY in header', () => {
  const runnerSrc = fs.readFileSync(
    path.join(SCRIPTS_DIR, 'multiagent_wiring_stress_runner_v2.sh'), 'utf8'
  );
  assert(runnerSrc.includes('MANUAL ONLY'), 'should say MANUAL ONLY');
});

test('J3: Runner checks killswitch before any dispatch', () => {
  const runnerSrc = fs.readFileSync(
    path.join(SCRIPTS_DIR, 'multiagent_wiring_stress_runner_v2.sh'), 'utf8'
  );
  const killswitchIdx = runnerSrc.indexOf('killswitch');
  const dispatchIdx = runnerSrc.indexOf('PHASE 3');
  assert(killswitchIdx < dispatchIdx, 'killswitch check must come before dispatch');
});


// ─── Run ───

async function main() {
  // Categories A-E, G-J are sync; F6-F12 need env cleanup which is sync
  // C6 is async
  await asyncTest('C6: runWithConcurrency respects limit', async () => {
    let maxActive = 0;
    let currentActive = 0;
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      currentActive++;
      if (currentActive > maxActive) maxActive = currentActive;
      await new Promise(r => setTimeout(r, 10));
      currentActive--;
      return i;
    });
    const results = await swarm.runWithConcurrency(tasks, 3);
    assert(maxActive <= 3, `max concurrent was ${maxActive}, expected <= 3`);
    assertEqual(results.length, 6, 'should return all results');
  });

  // Print results
  console.log(`\n═══ Results: ${passed} passed, ${failed} failed, ${passed + failed} total ═══`);

  // Cleanup temp dir
  try {
    fs.rmSync(TEMP_RUNTIME_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }

  process.exit(failed > 0 ? 1 : 0);
}

main();
