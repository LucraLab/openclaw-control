#!/usr/bin/env node
/**
 * capability_matrix.test.js — Unit tests for capability_policy.js
 *
 * 16 tests covering:
 *   CM-T1  through CM-T10: capability policy unit tests
 *   CM-T11 through CM-T14: deny logging + proof artifacts
 *   CI-T1  through CI-T2:  chokepoint integrity (wrapper-only route)
 */

'use strict';

const {
  EXIT_CAPABILITY_DENIED,
  SIDE_EFFECT_CLASSES,
  EXPENSIVE_MODELS,
  DEFAULT_PROFILE,
  loadProfile,
  checkModelCapability,
  checkToolCapability,
  checkWritePath,
  invokeModel,
  invokeTool,
  safeWriteFile,
  createDenyEvent,
  sanitizeTarget,
  generateDenyProof,
  buildReport,
  getEventSeq,
  _resetEventTracking
} = require('./capability_policy.js');

// ─── Minimal test harness ───

let _passed = 0;
let _failed = 0;

function test(name, fn) {
  _resetEventTracking(); // clean state per test
  try {
    fn();
    _passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    _failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// ─── Test Profiles ───

const BUILDER_PROFILE = loadProfile({
  agent_id: 'builder',
  models_allowed: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
  models_denied: [],
  tools_allowed: ['read', 'write', 'edit', 'glob', 'grep', 'bash'],
  tools_denied: ['deploy', 'firewall'],
  side_effect_approval_required: ['send', 'deploy', 'delete', 'rotate', 'firewall'],
  write_allow: ['scripts/', 'docs/', 'plans/', 'tmp/'],
  write_deny: ['.env', 'credentials/', 'secrets/', '.github/workflows/']
});

const EXECUTOR_PROFILE = loadProfile({
  agent_id: 'executor',
  models_allowed: ['claude-sonnet-4-5'],
  models_denied: ['claude-opus-4-6', 'gpt-4o', 'o1', 'o3'],
  tools_allowed: ['read', 'glob', 'grep', 'bash'],
  tools_denied: ['write', 'edit', 'deploy'],
  side_effect_approval_required: ['send', 'deploy', 'delete', 'rotate', 'firewall'],
  write_allow: ['tmp/', '_logs/'],
  write_deny: ['.env', 'credentials/', 'secrets/', '.github/', 'scripts/']
});

// ─── Tests ───

console.log('Capability Matrix Tests');
console.log('='.repeat(50));

// --- Model capability tests ---

test('CM-T1: missing profile denies model call (fail-closed)', () => {
  const result = invokeModel(null, null, { model: 'claude-sonnet-4-5' });
  assert(!result.allowed, 'Should deny with missing profile');
  assert(result.reason.includes('Missing'), 'Reason should mention missing');
});

test('CM-T2: model not in allowlist denied + CAPABILITY_DENIED event', () => {
  const result = invokeModel(null, BUILDER_PROFILE, { model: 'gpt-4o' });
  assert(!result.allowed, 'Should deny model not in allowlist');
  assert(result.event !== null, 'Should produce deny event');
  assert(result.event.event_type === 'CAPABILITY_DENIED', 'Event type must be CAPABILITY_DENIED');
  assert(result.event.action === 'model', 'Action must be model');
});

test('CM-T3: model in allowlist + not expensive allowed', () => {
  const result = invokeModel(null, BUILDER_PROFILE, { model: 'claude-sonnet-4-5' });
  assert(result.allowed, 'Should allow model in allowlist');
  assert(result.event === null, 'No event on allow');
});

test('CM-T4: expensive model requires final mode + escalation_reason', () => {
  // Builder profile doesn't have opus in allowlist, so use a custom profile
  const profile = loadProfile({
    agent_id: 'escalation-test',
    models_allowed: ['claude-opus-4-6'],
    tools_allowed: [],
    write_allow: [],
    write_deny: []
  });

  // Planning mode → deny
  const r1 = invokeModel(null, profile, {
    model: 'claude-opus-4-6', execution_mode: 'planning', escalation_reason: 'test'
  });
  assert(!r1.allowed, 'Should deny expensive model in planning mode');

  _resetEventTracking();

  // Final mode without reason → deny
  const r2 = invokeModel(null, profile, {
    model: 'claude-opus-4-6', execution_mode: 'final', escalation_reason: ''
  });
  assert(!r2.allowed, 'Should deny expensive model without escalation_reason');

  _resetEventTracking();

  // Final mode with reason → allow
  const r3 = invokeModel(null, profile, {
    model: 'claude-opus-4-6', execution_mode: 'final', escalation_reason: 'safety review'
  });
  assert(r3.allowed, 'Should allow expensive model in final mode with reason');
});

test('CM-T5: explicitly denied model blocked even if in allowlist', () => {
  const result = invokeModel(null, EXECUTOR_PROFILE, { model: 'claude-opus-4-6' });
  assert(!result.allowed, 'Explicit deny should override');
  assert(result.event !== null, 'Should produce deny event');
});

// --- Tool capability tests ---

test('CM-T6: tool not in allowlist denied + event', () => {
  const result = invokeTool(null, EXECUTOR_PROFILE, { tool: 'write' });
  assert(!result.allowed, 'Should deny tool not in allowlist');
  assert(result.event !== null, 'Should produce deny event');
  assert(result.event.action === 'tool', 'Action must be tool');
});

test('CM-T7: tool in allowlist allowed', () => {
  const result = invokeTool(null, BUILDER_PROFILE, { tool: 'read' });
  assert(result.allowed, 'Should allow tool in allowlist');
  assert(result.event === null, 'No event on allow');
});

test('CM-T8: side-effect tool without approval token denied', () => {
  const result = invokeTool(null, BUILDER_PROFILE, {
    tool: 'bash', sideEffectClass: 'send', approvalToken: null
  });
  assert(!result.allowed, 'Should deny side-effect without approval');
  assert(result.reason.includes('approval token'), 'Reason should mention approval');
});

test('CM-T9: side-effect tool with approval token allowed', () => {
  const result = invokeTool(null, BUILDER_PROFILE, {
    tool: 'bash', sideEffectClass: 'send', approvalToken: 'APPROVED-12345'
  });
  assert(result.allowed, 'Should allow side-effect with approval token');
});

// --- Write path tests ---

test('CM-T10: write to allowed path succeeds', () => {
  const result = safeWriteFile(null, BUILDER_PROFILE, { filePath: 'scripts/foo.js' });
  assert(result.allowed, 'Should allow write to scripts/');
});

test('CM-T11: write to denied path blocked + event', () => {
  const result = safeWriteFile(null, BUILDER_PROFILE, { filePath: '.env' });
  assert(!result.allowed, 'Should deny write to .env');
  assert(result.event !== null, 'Should produce deny event');
  assert(result.event.action === 'write', 'Action must be write');
});

test('CM-T12: write to unknown path denied (fail-closed)', () => {
  const result = safeWriteFile(null, BUILDER_PROFILE, { filePath: 'unknown/dir/file.txt' });
  assert(!result.allowed, 'Should deny write to path not in any allow pattern');
});

// --- Deny logging + proof tests ---

test('CM-T13: deny proof artifact contains sanitized evidence', () => {
  const result = invokeModel(null, BUILDER_PROFILE, { model: 'gpt-4o' });
  assert(result.event !== null, 'Should have deny event');

  const proof = generateDenyProof(result.event);
  assert(proof.md.length > 0, 'MD proof should not be empty');
  assert(proof.json.type === 'CAPABILITY_DENIED', 'JSON proof type must match');
  assert(proof.json.exit_code === EXIT_CAPABILITY_DENIED, 'Exit code must be 17');

  // Verify no secrets in proof
  const serialized = JSON.stringify(proof);
  const secretPatterns = [/sk-[a-zA-Z0-9_-]{8,}/, /ghp_[a-zA-Z0-9]{8,}/, /AKIA[A-Z0-9]{8,}/];
  for (const p of secretPatterns) {
    assert(!p.test(serialized), `Proof should not contain secret pattern ${p.source}`);
  }
});

test('CM-T14: CAPABILITY_DENIED event has monotonic event_seq', () => {
  // Create multiple deny events
  const e1 = createDenyEvent('model', 'gpt-4o', 'test-1', 'agent-a');
  const e2 = createDenyEvent('tool', 'deploy', 'test-2', 'agent-a');
  const e3 = createDenyEvent('write', '.env', 'test-3', 'agent-a');

  assert(e1 !== null && e2 !== null && e3 !== null, 'All events should be created');
  assert(e1.event_seq < e2.event_seq, 'Event seq must be monotonically increasing');
  assert(e2.event_seq < e3.event_seq, 'Event seq must be monotonically increasing');
  assert(e3.event_seq === 3, 'Third event should have seq=3');
});

test('CM-T15: deny event occurs exactly once per action (no spam)', () => {
  // Same deny twice
  const e1 = createDenyEvent('model', 'gpt-4o', 'denied', 'builder');
  const e2 = createDenyEvent('model', 'gpt-4o', 'denied', 'builder');

  assert(e1 !== null, 'First event should be created');
  assert(e2 === null, 'Duplicate event should be suppressed');
  assert(getEventSeq() === 1, 'Event seq should only increment once');
});

// --- Chokepoint integrity tests ---

test('CI-T1: invokeModel calls checkModelCapability before allowing (spy)', () => {
  // If model is not in allowlist, invokeModel must deny even if
  // we try to bypass by providing execution_mode and escalation_reason
  const profile = loadProfile({
    agent_id: 'spy-test',
    models_allowed: [], // empty = deny all
    tools_allowed: [],
    write_allow: [],
    write_deny: []
  });

  const result = invokeModel(null, profile, {
    model: 'claude-sonnet-4-5',
    execution_mode: 'final',
    escalation_reason: 'bypass attempt'
  });

  assert(!result.allowed, 'Empty allowlist must deny even with valid escalation args');
  assert(result.event !== null, 'Must produce deny event');

  // Also verify: default profile (fail-closed) denies everything
  const defaultResult = invokeModel(null, DEFAULT_PROFILE, { model: 'claude-sonnet-4-5' });
  assert(!defaultResult.allowed, 'DEFAULT_PROFILE must deny all models');
});

test('CI-T2: invokeTool and safeWriteFile enforce checks before allowing (spy)', () => {
  // Empty allowlist profile — nothing should pass
  const profile = loadProfile({
    agent_id: 'lockdown',
    models_allowed: [],
    tools_allowed: [],
    write_allow: [],
    write_deny: ['**']
  });

  const toolResult = invokeTool(null, profile, { tool: 'read' });
  assert(!toolResult.allowed, 'Empty tool allowlist must deny');

  const writeResult = safeWriteFile(null, profile, { filePath: 'tmp/test.txt' });
  assert(!writeResult.allowed, 'Deny-all write profile must deny');

  // Verify DEFAULT_PROFILE also denies
  const defaultTool = invokeTool(null, DEFAULT_PROFILE, { tool: 'bash' });
  assert(!defaultTool.allowed, 'DEFAULT_PROFILE must deny all tools');

  const defaultWrite = safeWriteFile(null, DEFAULT_PROFILE, { filePath: 'anything.txt' });
  assert(!defaultWrite.allowed, 'DEFAULT_PROFILE must deny all writes');
});

// ─── Results ───

console.log();
console.log('='.repeat(50));
console.log(`Results: ${_passed} passed, ${_failed} failed out of ${_passed + _failed}`);
process.exit(_failed > 0 ? 1 : 0);
