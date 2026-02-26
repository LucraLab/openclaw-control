#!/usr/bin/env node
/**
 * multiagent_stress.test.js — Multiagent Stress & Automation Test Pack
 *
 * Usage: node scripts/multiagent_stress.test.js
 * Exit 0 = all tests pass, Exit 1 = failures
 *
 * All tests use stubs/fixtures. No network calls. No LLM calls.
 * Covers: concurrency stability, killswitch, quarantine, artifact naming,
 * sanitization, LLM assist gating, cross-module determinism.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

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

// ─── Load modules under test ───
const swarm = require('./war_room_swarm');
const engine = require('./executive_strategy_engine');
const schema = require('./executive_strategy_schema');
const llmAssist = require('./executive_llm_assist');

// ─── Setup temp runtime dir for real runtime tests ───
const TEMP_RUNTIME_DIR = path.join(os.tmpdir(), `oc-stress-test-${Date.now()}`);
process.env.OPENCLAW_RUNTIME_DIR = TEMP_RUNTIME_DIR;

// Re-require autonomy_runtime with the temp dir set
delete require.cache[require.resolve('./autonomy_runtime')];
const runtime = require('./autonomy_runtime');

function cleanupRuntime() {
  try {
    fs.rmSync(TEMP_RUNTIME_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ─── Mock runtime for swarm tests ───
function createMockRuntime({ killswitch = false, quarantine = [], failKillswitch = false } = {}) {
  const events = [];
  const artifacts = [];
  return {
    events,
    artifacts,
    killSwitchGuard(entrypoint) {
      if (failKillswitch) throw new Error('killswitch check failed');
      if (killswitch) {
        events.push({ event: 'KILLSWITCH_ACTIVE', entrypoint });
        return true;
      }
      return false;
    },
    quarantineList() { return [...quarantine]; },
    emitEvent(type, payload) {
      events.push({ event: type, ...payload });
    },
    writeCanonicalArtifact(type, data) {
      const jsonPath = `/tmp/test-artifacts/${type}-test.json`;
      const mdPath = `/tmp/test-artifacts/${type}-test.md`;
      artifacts.push({ type, data, jsonPath, mdPath });
      return { jsonPath, mdPath };
    },
  };
}

// ─── Load fixtures ───
const fixtureDir = path.join(__dirname, 'fixtures', 'executive_strategy');
const fixtureObjectives = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'objectives.json'), 'utf8'));
const fixtureEvents = fs.readFileSync(path.join(fixtureDir, 'events.jsonl'), 'utf8')
  .trim().split('\n').map(l => JSON.parse(l));
const fixtureGateReports = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'gate_reports.json'), 'utf8'));
const fixtureQuarantine = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'quarantine.json'), 'utf8'));


// ═══════════════════════════════════════════════
// Wrap all tests in async main so asyncTest calls are awaited
// ═══════════════════════════════════════════════
async function main() {

// ═══════════════════════════════════════════════
// CATEGORY A: Swarm Formatting Determinism (Fixtures)
// ═══════════════════════════════════════════════
console.log('\n── A: Swarm Formatting Determinism ──');

test('A1: formatSwarmResponse is deterministic across 100 runs', () => {
  const params = {
    prompt: 'Review the deployment plan',
    results: [
      { agentId: 'pa', content: 'Looks good.', latencyMs: 50, status: 'ok' },
      { agentId: 'developer', content: 'LGTM.', latencyMs: 80, status: 'ok' },
      { agentId: 'debugger', content: null, latencyMs: 100, status: 'error', error: 'ECONNREFUSED' },
    ],
    capped: true,
    requestedCount: 16,
    cap: 5,
    skippedQuarantine: ['vault'],
  };

  const first = swarm.formatSwarmResponse(params);
  for (let i = 0; i < 100; i++) {
    const next = swarm.formatSwarmResponse(params);
    assertEqual(next, first, `Run ${i} differed`);
  }
  assert(first.includes('Swarm (2 agents)'), 'should show success count');
  assert(first.includes('CAPPED'), 'should show capped');
  assert(first.includes('QUARANTINED: vault'), 'should show quarantined');
  assert(first.includes('[FAILED] debugger'), 'should show failed agent');
});

test('A2: formatSwarmResponse with empty results', () => {
  const out = swarm.formatSwarmResponse({
    prompt: 'test',
    results: [],
    capped: false,
    requestedCount: 0,
    cap: 5,
    skippedQuarantine: [],
  });
  assert(out.includes('Swarm (0 agents)'), 'should show 0 agents');
  assert(!out.includes('CAPPED'), 'should not show capped');
});

test('A3: formatSwarmResponse truncates long prompts', () => {
  const longPrompt = 'A'.repeat(200);
  const out = swarm.formatSwarmResponse({
    prompt: longPrompt,
    results: [{ agentId: 'pa', content: 'ok', latencyMs: 10, status: 'ok' }],
    capped: false,
    requestedCount: 1,
    cap: 5,
    skippedQuarantine: [],
  });
  assert(out.includes('...'), 'should truncate long prompt');
  assert(!out.includes('A'.repeat(200)), 'should not include full prompt');
});

test('A4: selectAgents is deterministic across 100 runs', () => {
  const params = { explicitAgents: [], cap: 5, quarantinedAgents: ['pa', 'developer'] };
  const first = swarm.selectAgents(params);
  for (let i = 0; i < 100; i++) {
    const next = swarm.selectAgents(params);
    assertDeepEqual(next.selected, first.selected, `Run ${i} roster differed`);
  }
});


// ═══════════════════════════════════════════════
// CATEGORY B: Kill Switch Forces Fail-Closed
// ═══════════════════════════════════════════════
console.log('\n── B: Kill Switch Fail-Closed ──');

test('B1: Swarm blocked when killswitch active', () => {
  const rt = createMockRuntime({ killswitch: true });
  const safety = swarm.checkSafetyGates(rt);
  assert(safety.blocked, 'should be blocked');
  assertEqual(safety.reason, 'killswitch_active', 'reason should be killswitch_active');
});

test('B2: Swarm blocked when killswitch check throws', () => {
  const rt = createMockRuntime({ failKillswitch: true });
  const safety = swarm.checkSafetyGates(rt);
  assert(safety.blocked, 'should be blocked on throw');
  assertEqual(safety.reason, 'killswitch_check_failed', 'reason should be killswitch_check_failed');
});

test('B3: Swarm blocked when runtime is null', () => {
  const safety = swarm.checkSafetyGates(null);
  assert(safety.blocked, 'should be blocked');
  assertEqual(safety.reason, 'runtime_unavailable', 'reason should be runtime_unavailable');
});

test('B4: Real runtime killswitch via temp dir', () => {
  runtime.ensureRuntimeDir();
  if (runtime.isKillSwitchActive()) runtime.killSwitchDisable();

  runtime.killSwitchEnable();
  assert(runtime.isKillSwitchActive(), 'killswitch should be active');

  const safety = swarm.checkSafetyGates(runtime);
  assert(safety.blocked, 'swarm should be blocked');
  assertEqual(safety.reason, 'killswitch_active', 'reason should match');

  runtime.killSwitchDisable();
  assert(!runtime.isKillSwitchActive(), 'killswitch should be disabled');
});

test('B5: Executive strategy engine STOP on killswitch', () => {
  const context = {
    objectives: { 'obj-test': { objective_id: 'obj-test', tags: ['revenue'] } },
    events: [],
    gateReports: {},
    quarantine: {},
    killSwitch: true,
    commitSha: 'test-commit',
  };
  const report = engine.run(context);
  assertEqual(report.objectives[0].recommended_action, 'STOP', 'should be STOP');
  assert(report.objectives[0].blocks.some(b => b.type === 'kill_switch'), 'should have kill_switch block');
});

test('B6: Executive strategy FAILCLOSED on null context', () => {
  const report = engine.run(null);
  assertEqual(report.status, 'FAILCLOSED', 'should be FAILCLOSED');
  assert(report.events.some(e => e.event === 'EXEC_STRATEGY_FAILCLOSED'), 'should emit failclosed event');
});


// ═══════════════════════════════════════════════
// CATEGORY C: Quarantine Removes Agents
// ═══════════════════════════════════════════════
console.log('\n── C: Quarantine Agent Removal ──');

test('C1: Quarantined agents removed from swarm roster', () => {
  const result = swarm.selectAgents({
    explicitAgents: [],
    cap: 16,
    quarantinedAgents: ['pa', 'developer', 'architect'],
  });
  assert(!result.selected.includes('pa'), 'pa should be removed');
  assert(!result.selected.includes('developer'), 'developer should be removed');
  assert(!result.selected.includes('architect'), 'architect should be removed');
  assert(result.skippedQuarantine.includes('pa'), 'pa in skippedQuarantine');
  assertEqual(result.selected.length, 13, 'should have 13 remaining');
});

test('C2: All agents quarantined → empty roster', () => {
  const result = swarm.selectAgents({
    explicitAgents: [],
    cap: 16,
    quarantinedAgents: [...swarm.AGENT_ROSTER],
  });
  assertEqual(result.selected.length, 0, 'should have 0 agents');
  assertEqual(result.skippedQuarantine.length, 16, 'all 16 should be skipped');
});

test('C3: Explicit agent quarantined → still removed', () => {
  const result = swarm.selectAgents({
    explicitAgents: ['developer', 'pa'],
    cap: 5,
    quarantinedAgents: ['developer'],
  });
  assert(!result.selected.includes('developer'), 'developer should be removed');
  assert(result.selected.includes('pa'), 'pa should remain');
  assert(result.skippedQuarantine.includes('developer'), 'developer in skippedQuarantine');
});

test('C4: Real runtime quarantine add/remove cycle', () => {
  const q = runtime.readQuarantine();
  for (const a of q.agents) runtime.quarantineRemove(a);

  runtime.quarantineAdd('test-agent-1');
  runtime.quarantineAdd('test-agent-2');
  const list = runtime.quarantineList();
  assert(list.includes('test-agent-1'), 'should contain test-agent-1');
  assert(list.includes('test-agent-2'), 'should contain test-agent-2');

  runtime.quarantineRemove('test-agent-1');
  const list2 = runtime.quarantineList();
  assert(!list2.includes('test-agent-1'), 'test-agent-1 should be removed');
  assert(list2.includes('test-agent-2'), 'test-agent-2 should remain');

  runtime.quarantineRemove('test-agent-2');
});

test('C5: Executive strategy engine HOLD on quarantined objective', () => {
  const context = {
    objectives: { 'obj-q': { objective_id: 'obj-q', tags: ['revenue'] } },
    events: [],
    gateReports: {},
    quarantine: { 'obj-q': { quarantined: true, reason: 'test' } },
    killSwitch: false,
    commitSha: 'test',
  };
  const report = engine.run(context);
  assertEqual(report.objectives[0].recommended_action, 'HOLD', 'should be HOLD');
  assert(report.objectives[0].blocks.some(b => b.type === 'quarantine'), 'should have quarantine block');
});


// ═══════════════════════════════════════════════
// CATEGORY D: Canonical Artifact Naming
// ═══════════════════════════════════════════════
console.log('\n── D: Canonical Artifact Naming ──');

test('D1: ops-pulse artifact naming pattern', () => {
  const { jsonPath, mdPath } = runtime.writeCanonicalArtifact('ops-pulse', {
    gateway: 'OK',
    memory: '62%',
    disk: '45%',
    agents_active: 5,
    killswitch_active: false,
    quarantined_agents: [],
  });
  const jsonBasename = path.basename(jsonPath);
  const mdBasename = path.basename(mdPath);
  assert(jsonBasename.match(/^ops-pulse-.*\.json$/), `ops-pulse JSON naming wrong: ${jsonBasename}`);
  assert(mdBasename.match(/^ops-pulse-.*\.md$/), `ops-pulse MD naming wrong: ${mdBasename}`);
  assert(fs.existsSync(jsonPath), 'ops-pulse JSON should exist');
  assert(fs.existsSync(mdPath), 'ops-pulse MD should exist');
});

test('D2: swarm-run artifact naming via mock runtime', () => {
  const rt = createMockRuntime();
  rt.writeCanonicalArtifact('swarm-run', { test: true });
  assertEqual(rt.artifacts.length, 1, 'should have 1 artifact');
  assertEqual(rt.artifacts[0].type, 'swarm-run', 'type should be swarm-run');
});

test('D3: daily-exec-brief artifact naming pattern', () => {
  const { jsonPath, mdPath } = runtime.writeCanonicalArtifact('daily-exec-brief', {
    objectives_scanned: 5,
    tasks_completed: 3,
    tasks_failed: 1,
    daily_spend_usd: 2.50,
    alerts: [],
  });
  const jsonBasename = path.basename(jsonPath);
  assert(jsonBasename.match(/^daily-exec-brief-.*\.json$/), `naming wrong: ${jsonBasename}`);
  assert(fs.existsSync(jsonPath), 'daily-exec-brief JSON should exist');
});

test('D4: swarm-run artifact via real runtime', () => {
  const { jsonPath } = runtime.writeCanonicalArtifact('swarm-run', {
    correlation_id: 'test-corr-123',
    agents_dispatched: ['pa', 'developer'],
    success_count: 2,
    error_count: 0,
  });
  const basename = path.basename(jsonPath);
  assert(basename.match(/^swarm-run-.*\.json$/), `swarm-run naming wrong: ${basename}`);
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert(data.correlation_id === 'test-corr-123', 'correlation_id should be preserved');
});


// ═══════════════════════════════════════════════
// CATEGORY E: Sanitization Redaction
// ═══════════════════════════════════════════════
console.log('\n── E: Sanitization Redaction ──');

test('E1: Swarm sanitizeOutput redacts sk- tokens', () => {
  const dirty = 'Key is sk-abc1234567890xyz and more text';
  const clean = swarm.sanitizeOutput(dirty);
  assert(!clean.includes('sk-abc1234567890'), 'sk- token should be redacted');
  assert(clean.includes('[REDACTED]'), 'should contain REDACTED');
});

test('E2: Swarm sanitizeOutput redacts ghp_ tokens', () => {
  const dirty = 'Token: ghp_abcdef12345678';
  const clean = swarm.sanitizeOutput(dirty);
  assert(!clean.includes('ghp_abcdef'), 'ghp_ token should be redacted');
});

test('E3: Swarm sanitizeOutput redacts Bearer tokens', () => {
  const dirty = 'Auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
  const clean = swarm.sanitizeOutput(dirty);
  assert(!clean.includes('eyJhbGci'), 'Bearer token should be redacted');
});

test('E4: Swarm sanitizeOutput redacts AKIA keys', () => {
  const dirty = 'AWS key: AKIAtest12345678';
  const clean = swarm.sanitizeOutput(dirty);
  assert(!clean.includes('AKIAtest1234'), 'AKIA key should be redacted');
});

test('E5: Swarm sanitizeOutput redacts ya29. tokens', () => {
  const dirty = 'Google token: ya29.a0ARrdaM8something-long';
  const clean = swarm.sanitizeOutput(dirty);
  assert(!clean.includes('ya29.a0ARrdaM8'), 'ya29. token should be redacted');
});

test('E6: Swarm sanitizeOutput redacts 1/ refresh tokens', () => {
  // Pattern: 1/ followed by 20+ alphanumeric/underscore/dash chars
  const dirty = 'Refresh: 1/0abcdefghijklmnopqrstuvwxyz';
  const clean = swarm.sanitizeOutput(dirty);
  assert(!clean.includes('1/0abcdefghij'), '1/ token should be redacted');
});

test('E7: Swarm sanitizeOutput redacts Telegram bot tokens', () => {
  const dirty = 'Bot token: 12345678:AABBCCDDEEFFGGHHIIJJKKLLMMNNOOPPabcdef';
  const clean = swarm.sanitizeOutput(dirty);
  assert(!clean.includes('12345678:AABBCCDDEE'), 'Telegram token should be redacted');
});

test('E8: Engine sanitize redacts pit- tokens', () => {
  const dirty = 'GHL: pit-abc123456789xyz';
  const clean = engine.sanitize(dirty);
  assert(!clean.includes('pit-abc1234'), 'pit- token should be redacted');
  assert(clean.includes('[REDACTED]'), 'should contain REDACTED');
});

test('E9: Runtime sanitize matches engine sanitize on common patterns', () => {
  // Test patterns where BOTH runtime and engine regex thresholds overlap
  // Note: ghp_ requires 20+ chars in engine (same as CI gate), so tested separately in E2
  // These patterns have compatible thresholds between the two sanitizers
  const testCases = [
    'sk-abcdef1234567890',            // sk-: engine >=10, runtime >=8, CI gate >=20 → 16 chars = safe
    'Bearer eyJhbGciOiJIUzI1test',    // Bearer: engine >=10, runtime >=8
    'eyJhbGciOiJSUzI1NiIsInR5cCI',   // eyJ: engine >=20, runtime >=8 → 26 chars, no CI gate for eyJ
    'AKIAabcDEF12345678',              // AKIA: engine >=10, runtime >=8, CI gate uppercase >=16 → mixed case = safe
  ];
  for (const dirty of testCases) {
    const rtClean = runtime.sanitize(dirty);
    const engClean = engine.sanitize(dirty);
    assert(rtClean.includes('[REDACTED]'), `runtime should redact: ${dirty.slice(0, 10)}`);
    assert(engClean.includes('[REDACTED]'), `engine should redact: ${dirty.slice(0, 10)}`);
  }
});

test('E10: sanitizeOutput leaves clean text unchanged', () => {
  const clean = 'This is a perfectly normal response with no secrets.';
  assertEqual(swarm.sanitizeOutput(clean), clean, 'clean text should pass through');
});


// ═══════════════════════════════════════════════
// CATEGORY F: LLM Assist Gating
// ═══════════════════════════════════════════════
console.log('\n── F: LLM Assist Gating ──');

test('F1: shouldTriggerLLM returns null when confidence >= 0.65', () => {
  const result = engine.shouldTriggerLLM(
    { confidence: 0.8, risk_score: 30, objective_id: 'obj-1' },
    { events: [], objectives: { 'obj-1': { tags: ['revenue'] } } }
  );
  assertEqual(result, null, 'should not trigger');
});

test('F2: shouldTriggerLLM returns low_confidence when confidence < 0.65', () => {
  const result = engine.shouldTriggerLLM(
    { confidence: 0.4, risk_score: 30, objective_id: 'obj-1' },
    { events: [], objectives: { 'obj-1': { tags: ['revenue'] } } }
  );
  assert(result !== null, 'should trigger');
  assert(result.startsWith('low_confidence'), `should start with low_confidence, got: ${result}`);
});

test('F3: shouldTriggerLLM returns high_risk_missing_evidence', () => {
  const result = engine.shouldTriggerLLM(
    { confidence: 0.7, risk_score: 75, objective_id: 'obj-1' },
    { events: [], objectives: { 'obj-1': { tags: [] } } }
  );
  assertEqual(result, 'high_risk_missing_evidence', 'should be high_risk_missing_evidence');
});

test('F4: shouldTriggerLLM returns repeated_failures_varied', () => {
  const events = [
    { event: 'DELIVERY_FAILED', objective_id: 'obj-1', reason: 'test_failure' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-1', reason: 'merge_conflict' },
    { event: 'DELIVERY_FAILED', objective_id: 'obj-1', reason: 'timeout' },
  ];
  const result = engine.shouldTriggerLLM(
    { confidence: 0.7, risk_score: 30, objective_id: 'obj-1' },
    { events, objectives: { 'obj-1': { tags: ['revenue'] } } }
  );
  assert(result !== null && result.startsWith('repeated_failures_varied'), `should trigger: ${result}`);
});

test('F5: LLM assist OFF by default (env + config)', () => {
  const origEnv = process.env.EXEC_STRATEGY_LLM;
  delete process.env.EXEC_STRATEGY_LLM;

  const result = llmAssist.assist(
    schema.makeDefaultResult('obj-1'),
    { events: [], objectives: {} },
    { llm_enabled: false }
  );
  assertEqual(result, null, 'should return null when disabled');

  if (origEnv !== undefined) process.env.EXEC_STRATEGY_LLM = origEnv;
});

test('F6: LLM assist stub injection works', () => {
  const origEnv = process.env.EXEC_STRATEGY_LLM;
  process.env.EXEC_STRATEGY_LLM = '1';

  const stubResponse = JSON.stringify({
    root_cause_category: 'test_flake',
    suggestions: ['Fix flaky test', 'Add retry'],
    confidence_adjustment: 0.1,
  });

  const result = llmAssist.assist(
    schema.makeDefaultResult('obj-1'),
    { events: [], objectives: {} },
    { llm_enabled: true, _llmStub: () => stubResponse }
  );

  assert(result !== null, 'should return result');
  assertEqual(result.root_cause_category, 'test_flake', 'root_cause_category');
  assertEqual(result.suggestions.length, 2, 'should have 2 suggestions');

  if (origEnv !== undefined) process.env.EXEC_STRATEGY_LLM = origEnv;
  else delete process.env.EXEC_STRATEGY_LLM;
});

test('F7: LLM assist fails closed on invalid JSON', () => {
  const origEnv = process.env.EXEC_STRATEGY_LLM;
  process.env.EXEC_STRATEGY_LLM = '1';

  const result = llmAssist.assist(
    schema.makeDefaultResult('obj-1'),
    { events: [], objectives: {} },
    { llm_enabled: true, _llmStub: () => 'not valid json' }
  );

  assert(result !== null, 'should return failure object');
  assert(result.failed === true, 'should be marked as failed');
  assertEqual(result.reason, 'schema_invalid', 'reason should be schema_invalid');

  if (origEnv !== undefined) process.env.EXEC_STRATEGY_LLM = origEnv;
  else delete process.env.EXEC_STRATEGY_LLM;
});

test('F8: LLM assist fails closed on stub exception', () => {
  const origEnv = process.env.EXEC_STRATEGY_LLM;
  process.env.EXEC_STRATEGY_LLM = '1';

  const result = llmAssist.assist(
    schema.makeDefaultResult('obj-1'),
    { events: [], objectives: {} },
    { llm_enabled: true, _llmStub: () => { throw new Error('boom'); } }
  );

  assert(result !== null, 'should return failure object');
  assert(result.failed === true, 'should be marked as failed');
  assertEqual(result.reason, 'stub_exception', 'reason should be stub_exception');

  if (origEnv !== undefined) process.env.EXEC_STRATEGY_LLM = origEnv;
  else delete process.env.EXEC_STRATEGY_LLM;
});

test('F9: LLM assist max 3 suggestions enforced', () => {
  const origEnv = process.env.EXEC_STRATEGY_LLM;
  process.env.EXEC_STRATEGY_LLM = '1';

  const stubResponse = JSON.stringify({
    root_cause_category: 'overload',
    suggestions: ['A', 'B', 'C', 'D', 'E'],
    confidence_adjustment: 0.0,
  });

  const result = llmAssist.assist(
    schema.makeDefaultResult('obj-1'),
    { events: [], objectives: {} },
    { llm_enabled: true, _llmStub: () => stubResponse }
  );

  assert(result !== null, 'should return result');
  assert(result.suggestions.length <= 3, `suggestions should be capped at 3, got ${result.suggestions.length}`);

  if (origEnv !== undefined) process.env.EXEC_STRATEGY_LLM = origEnv;
  else delete process.env.EXEC_STRATEGY_LLM;
});

test('F10: Engine run with llm_enabled=false emits LLM_SKIPPED:disabled', () => {
  const context = {
    objectives: { 'obj-test': { objective_id: 'obj-test', tags: [] } },
    events: [],
    gateReports: {},
    quarantine: {},
    killSwitch: false,
    commitSha: 'test',
  };
  const report = engine.run(context, { llm_enabled: false });
  const skipEvent = report.events.find(e => e.event === 'EXEC_STRATEGY_LLM_SKIPPED');
  assert(skipEvent !== undefined, 'should have LLM_SKIPPED event');
  assertEqual(skipEvent.reason, 'disabled', 'reason should be disabled');
});


// ═══════════════════════════════════════════════
// CATEGORY G: Concurrency Stability
// ═══════════════════════════════════════════════
console.log('\n── G: Concurrency Stability ──');

await asyncTest('G1: runWithConcurrency respects limit=1 (sequential)', async () => {
  let maxConcurrent = 0;
  let current = 0;
  const tasks = Array.from({ length: 5 }, (_, i) => async () => {
    current++;
    maxConcurrent = Math.max(maxConcurrent, current);
    await new Promise(r => setTimeout(r, 5));
    current--;
    return i;
  });
  const results = await swarm.runWithConcurrency(tasks, 1);
  assertEqual(maxConcurrent, 1, 'max concurrent should be 1');
  assertEqual(results.length, 5, 'should have 5 results');
  assert(results.every(r => r.status === 'fulfilled'), 'all should succeed');
});

await asyncTest('G2: runWithConcurrency respects limit=3', async () => {
  let maxConcurrent = 0;
  let current = 0;
  const tasks = Array.from({ length: 10 }, (_, i) => async () => {
    current++;
    maxConcurrent = Math.max(maxConcurrent, current);
    await new Promise(r => setTimeout(r, 5));
    current--;
    return i;
  });
  const results = await swarm.runWithConcurrency(tasks, 3);
  assert(maxConcurrent <= 3, `max concurrent should be <=3, got ${maxConcurrent}`);
  assertEqual(results.length, 10, 'should have 10 results');
});

await asyncTest('G3: runWithConcurrency handles mixed success/failure', async () => {
  const tasks = [
    async () => 'ok',
    async () => { throw new Error('fail1'); },
    async () => 'ok2',
    async () => { throw new Error('fail2'); },
  ];
  const results = await swarm.runWithConcurrency(tasks, 2);
  assertEqual(results.length, 4, 'should have 4 results');
  assertEqual(results[0].status, 'fulfilled', 'task 0 should succeed');
  assertEqual(results[1].status, 'rejected', 'task 1 should fail');
  assertEqual(results[2].status, 'fulfilled', 'task 2 should succeed');
  assertEqual(results[3].status, 'rejected', 'task 3 should fail');
});

await asyncTest('G4: runWithConcurrency with empty task list', async () => {
  const results = await swarm.runWithConcurrency([], 3);
  assertEqual(results.length, 0, 'should have 0 results');
});

await asyncTest('G5: Full swarm executeSwarm concurrency bounded', async () => {
  let maxConcurrent = 0;
  let current = 0;
  const rt = createMockRuntime();

  const mockHttp = async (url, opts) => {
    current++;
    maxConcurrent = Math.max(maxConcurrent, current);
    await new Promise(r => setTimeout(r, 10));
    current--;
    const agentId = opts.headers['x-openclaw-agent-id'];
    return {
      ok: true,
      data: { choices: [{ message: { content: `Response from ${agentId}` } }] },
    };
  };

  const result = await swarm.executeSwarm({
    prompt: 'test concurrent',
    explicitAgents: [],
    chatId: 'chat-1',
    messageId: 'msg-1',
    senderId: 'sender-1',
    authTokens: { builder1: 'tok1', builder2: 'tok2' },
    httpClient: mockHttp,
    runtime: rt,
    options: { maxConcurrency: 2, perAgentTimeoutMs: 500 },
  });

  assert(!result.blocked, 'should not be blocked');
  assert(maxConcurrent <= 2, `max concurrent should be <=2, got ${maxConcurrent}`);
  assert(result.results.length > 0, 'should have results');
});


// ═══════════════════════════════════════════════
// CATEGORY H: Cross-Module Determinism (Fixture-Based)
// ═══════════════════════════════════════════════
console.log('\n── H: Cross-Module Determinism ──');

test('H1: Executive strategy produces identical report on same fixtures', () => {
  const context = {
    objectives: fixtureObjectives,
    events: fixtureEvents,
    gateReports: fixtureGateReports,
    quarantine: fixtureQuarantine,
    killSwitch: false,
    commitSha: 'fixture-sha-001',
  };

  const report1 = engine.run(context, { llm_enabled: false, fixtures_mode: true });
  const report2 = engine.run(context, { llm_enabled: false, fixtures_mode: true });

  assertEqual(report1.objectives.length, report2.objectives.length, 'same number of objectives');
  for (let i = 0; i < report1.objectives.length; i++) {
    assertEqual(
      report1.objectives[i].objective_id,
      report2.objectives[i].objective_id,
      `objective ${i} order`
    );
    assertEqual(
      report1.objectives[i].priority_score,
      report2.objectives[i].priority_score,
      `objective ${i} priority_score`
    );
    assertEqual(
      report1.objectives[i].risk_score,
      report2.objectives[i].risk_score,
      `objective ${i} risk_score`
    );
    assertEqual(
      report1.objectives[i].recommended_action,
      report2.objectives[i].recommended_action,
      `objective ${i} recommended_action`
    );
  }
});

test('H2: Fixture obj-44 is quarantined → HOLD', () => {
  const context = {
    objectives: fixtureObjectives,
    events: fixtureEvents,
    gateReports: fixtureGateReports,
    quarantine: fixtureQuarantine,
    killSwitch: false,
    commitSha: 'fixture-sha',
  };
  const report = engine.run(context, { llm_enabled: false });
  const obj44 = report.objectives.find(o => o.objective_id === 'obj-44');
  assert(obj44 !== undefined, 'obj-44 should exist');
  assertEqual(obj44.recommended_action, 'HOLD', 'obj-44 should be HOLD (quarantined)');
});

test('H3: Schema validation passes for fixture-based report', () => {
  const context = {
    objectives: fixtureObjectives,
    events: fixtureEvents,
    gateReports: fixtureGateReports,
    quarantine: fixtureQuarantine,
    killSwitch: false,
    commitSha: 'fixture-sha',
  };
  const report = engine.run(context, { llm_enabled: false });
  const validation = schema.validateStrategyReport(report);
  assert(validation.valid, `report should be valid: ${validation.errors.join(', ')}`);
});

test('H4: Each scored objective passes schema validation', () => {
  const context = {
    objectives: fixtureObjectives,
    events: fixtureEvents,
    gateReports: fixtureGateReports,
    quarantine: fixtureQuarantine,
    killSwitch: false,
    commitSha: 'fixture-sha',
  };
  const report = engine.run(context, { llm_enabled: false });
  for (const obj of report.objectives) {
    const v = schema.validateObjectiveResult(obj);
    assert(v.valid, `${obj.objective_id} should be valid: ${v.errors.join(', ')}`);
  }
});

test('H5: Score clamping: priority 0-100, confidence 0-1', () => {
  assertEqual(schema.clampScore(-50), 0, 'negative score should clamp to 0');
  assertEqual(schema.clampScore(200), 100, 'over-100 score should clamp to 100');
  assertEqual(schema.clampScore(75), 75, 'valid score should pass through');
  assertEqual(schema.clampConfidence(-0.5), 0, 'negative confidence should clamp to 0');
  assertEqual(schema.clampConfidence(1.5), 1, 'over-1 confidence should clamp to 1');
  assertEqual(schema.clampConfidence(0.75), 0.75, 'valid confidence should pass through');
});


// ═══════════════════════════════════════════════
// CATEGORY I: Swarm Full Orchestration
// ═══════════════════════════════════════════════
console.log('\n── I: Swarm Full Orchestration ──');

await asyncTest('I1: executeSwarm blocked on null runtime emits FAILCLOSED', async () => {
  const result = await swarm.executeSwarm({
    prompt: 'test',
    chatId: 'chat-1',
    messageId: 'msg-1',
    senderId: 'sender-1',
    authTokens: { builder1: 'tok1', builder2: 'tok2' },
    httpClient: async () => ({ ok: true, data: { choices: [{ message: { content: 'hi' } }] } }),
    runtime: null,
  });
  assert(result.blocked, 'should be blocked');
  assertEqual(result.reason, 'runtime_unavailable', 'reason should be runtime_unavailable');
  assert(result.events.some(e => e.event === 'SWARM_FAILCLOSED'), 'should emit FAILCLOSED');
});

await asyncTest('I2: executeSwarm with killswitch emits KILLSWITCH_BLOCKED', async () => {
  const rt = createMockRuntime({ killswitch: true });
  const result = await swarm.executeSwarm({
    prompt: 'test',
    chatId: 'chat-1',
    messageId: 'msg-1',
    senderId: 'sender-1',
    authTokens: { builder1: 'tok1', builder2: 'tok2' },
    httpClient: async () => ({ ok: true, data: {} }),
    runtime: rt,
  });
  assert(result.blocked, 'should be blocked');
  assertEqual(result.reason, 'killswitch_active', 'reason');
  assert(result.events.some(e => e.event === 'SWARM_KILLSWITCH_BLOCKED'), 'should emit KILLSWITCH_BLOCKED');
});

await asyncTest('I3: executeSwarm with no auth tokens → FAILCLOSED', async () => {
  const rt = createMockRuntime();
  const result = await swarm.executeSwarm({
    prompt: 'test',
    chatId: 'chat-1',
    messageId: 'msg-1',
    senderId: 'sender-1',
    authTokens: {},
    httpClient: async () => ({ ok: true, data: {} }),
    runtime: rt,
  });
  assert(result.blocked, 'should be blocked');
  assertEqual(result.reason, 'no_reachable_targets', 'reason should be no_reachable_targets');
});

await asyncTest('I4: executeSwarm handles agent HTTP errors gracefully', async () => {
  const rt = createMockRuntime();
  let callCount = 0;
  const mockHttp = async (url, opts) => {
    callCount++;
    if (callCount === 1) {
      return { ok: false, status: 500, statusText: 'Internal Server Error', data: {} };
    }
    const agentId = opts.headers['x-openclaw-agent-id'];
    return { ok: true, data: { choices: [{ message: { content: `OK from ${agentId}` } }] } };
  };

  const result = await swarm.executeSwarm({
    prompt: 'test errors',
    chatId: 'chat-1',
    messageId: 'msg-1',
    senderId: 'sender-1',
    authTokens: { builder1: 'tok1', builder2: 'tok2' },
    httpClient: mockHttp,
    runtime: rt,
    options: { maxConcurrency: 1, perAgentTimeoutMs: 500 },
  });

  assert(!result.blocked, 'should not be blocked');
  const hasError = result.results.some(r => r.status === 'error');
  const hasOk = result.results.some(r => r.status === 'ok');
  assert(hasError, 'should have at least one error');
  assert(hasOk, 'should have at least one success');
});


// ═══════════════════════════════════════════════
// CATEGORY J: Event Emission Payload Shape
// ═══════════════════════════════════════════════
console.log('\n── J: Event Emission Payload Shape ──');

test('J1: Runtime emitEvent writes to events.jsonl', () => {
  runtime.emitEvent('STRESS_TEST_EVENT', { test: true, value: 42 });
  const eventsPath = runtime.runtimePath('events.jsonl');
  const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
  const lastEvent = JSON.parse(lines[lines.length - 1]);
  assertEqual(lastEvent.event, 'STRESS_TEST_EVENT', 'event type');
  assertEqual(lastEvent.test, true, 'payload.test');
  assertEqual(lastEvent.value, 42, 'payload.value');
  assert(lastEvent.ts !== undefined, 'should have timestamp');
});

test('J2: Runtime emitEvent sanitizes secrets in payload', () => {
  runtime.emitEvent('SECRET_TEST', { token: 'sk-testkey12345abcd' });
  const eventsPath = runtime.runtimePath('events.jsonl');
  const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
  const lastEvent = JSON.parse(lines[lines.length - 1]);
  assert(!lastEvent.token.includes('sk-testkey'), 'sk- token should be redacted');
  assert(lastEvent.token.includes('[REDACTED]'), 'should contain [REDACTED]');
});

await asyncTest('J3: Swarm events include correlation_id', async () => {
  const rt = createMockRuntime();
  const result = await swarm.executeSwarm({
    prompt: 'event shape test',
    chatId: 'chat-1',
    messageId: 'msg-1',
    senderId: 'sender-1',
    authTokens: { builder1: 'tok1', builder2: 'tok2' },
    httpClient: async (url, opts) => {
      const agentId = opts.headers['x-openclaw-agent-id'];
      return { ok: true, data: { choices: [{ message: { content: `hi from ${agentId}` } }] } };
    },
    runtime: rt,
    options: { maxConcurrency: 2, perAgentTimeoutMs: 500 },
  });

  assert(!result.blocked, 'should not be blocked');
  for (const evt of result.events) {
    assert(evt.correlation_id !== undefined, `event ${evt.event} missing correlation_id`);
  }
  assert(result.events.some(e => e.event === 'SWARM_REQUESTED'), 'should have REQUESTED');
  assert(result.events.some(e => e.event === 'SWARM_DISPATCHED'), 'should have DISPATCHED');
  assert(result.events.some(e => e.event === 'SWARM_AGENT_RESULT'), 'should have AGENT_RESULT');
});


// ═══════════════════════════════════════════════
// Cleanup and report
// ═══════════════════════════════════════════════
cleanupRuntime();

console.log(`\n═══ Results: ${passed} passed, ${failed} failed, ${passed + failed} total ═══\n`);
process.exit(failed > 0 ? 1 : 0);

} // end main()

main().catch(err => {
  console.error('Fatal error:', err);
  cleanupRuntime();
  process.exit(1);
});
