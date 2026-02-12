#!/usr/bin/env node
/**
 * isolation_guard.test.js — Tests for Environment Isolation Enforcement
 *
 * Usage: node scripts/isolation_guard.test.js
 * Exit 0 = all tests pass, Exit 1 = failures
 *
 * Tests: oc_paths.sh, oc_events.sh, oc_atomic_json.py, script modifications
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const LIB_DIR = path.join(REPO_ROOT, 'scripts', 'lib');

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

/**
 * Run a bash snippet that sources oc_paths.sh and executes a command.
 * Returns { stdout, exitCode }
 */
function bashPaths(snippet) {
  const cmd = `bash -c 'source "${LIB_DIR}/oc_paths.sh" && ${snippet}'`;
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { stdout, exitCode: 0 };
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), exitCode: e.status || 1 };
  }
}

/**
 * Run a bash snippet that sources oc_events.sh.
 */
function bashEvents(snippet, env) {
  const cmd = `bash -c 'source "${LIB_DIR}/oc_events.sh" && ${snippet}'`;
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    }).trim();
    return { stdout, exitCode: 0 };
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), exitCode: e.status || 1 };
  }
}

console.log('============================================');
console.log('  Isolation Guard — Test Suite');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// ─── Section 1: oc_paths.sh — Agent ID validation ───

test('IG-T1: oc_validate_agent_id accepts builder', () => {
  const r = bashPaths('oc_validate_agent_id builder');
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

test('IG-T2: oc_validate_agent_id accepts executor', () => {
  const r = bashPaths('oc_validate_agent_id executor');
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

test('IG-T3: oc_validate_agent_id accepts auditor', () => {
  const r = bashPaths('oc_validate_agent_id auditor');
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

test('IG-T4: oc_validate_agent_id rejects unknown', () => {
  const r = bashPaths('oc_validate_agent_id hacker');
  assert(r.exitCode !== 0, `expected non-zero exit, got ${r.exitCode}`);
});

test('IG-T5: oc_validate_agent_id rejects empty', () => {
  const r = bashPaths('oc_validate_agent_id ""');
  assert(r.exitCode !== 0, `expected non-zero exit, got ${r.exitCode}`);
});

// ─── Section 2: oc_paths.sh — Objective ID validation ───

test('IG-T6: oc_validate_obj_id accepts valid ID', () => {
  const r = bashPaths('oc_validate_obj_id obj-feature-small-cli-1770859788');
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

test('IG-T7: oc_validate_obj_id rejects traversal', () => {
  const r = bashPaths('oc_validate_obj_id "../etc/passwd"');
  assert(r.exitCode !== 0, `expected non-zero exit, got ${r.exitCode}`);
});

test('IG-T8: oc_validate_obj_id rejects empty', () => {
  const r = bashPaths('oc_validate_obj_id ""');
  assert(r.exitCode !== 0, `expected non-zero exit, got ${r.exitCode}`);
});

test('IG-T9: oc_validate_obj_id rejects slash in ID', () => {
  const r = bashPaths('oc_validate_obj_id "obj-foo/bar"');
  assert(r.exitCode !== 0, `expected non-zero exit, got ${r.exitCode}`);
});

// ─── Section 3: oc_paths.sh — Safe path join ───

test('IG-T10: oc_safe_path allows valid subpath', () => {
  const r = bashPaths('oc_safe_path /tmp/root subdir/file.json');
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
  assert(r.stdout.includes('/tmp/root/subdir/file.json'), `expected valid path, got: ${r.stdout}`);
});

test('IG-T11: oc_safe_path rejects traversal', () => {
  const r = bashPaths('oc_safe_path /tmp/root "../escape"');
  assert(r.exitCode !== 0, `expected non-zero exit, got ${r.exitCode}`);
});

test('IG-T12: oc_safe_path rejects embedded traversal', () => {
  const r = bashPaths('oc_safe_path /tmp/root "subdir/../../escape"');
  assert(r.exitCode !== 0, `expected non-zero exit, got ${r.exitCode}`);
});

// ─── Section 4: oc_paths.sh — Repo validation ───

test('IG-T13: oc_validate_repo accepts allowed repo', () => {
  const r = bashPaths('oc_validate_repo LucraLab/openclaw-control');
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

test('IG-T14: oc_validate_repo rejects unlisted repo', () => {
  const r = bashPaths('oc_validate_repo evil/repo');
  assert(r.exitCode !== 0, `expected non-zero exit, got ${r.exitCode}`);
});

// ─── Section 5: oc_atomic_json.py — Atomic write ───

test('IG-T15: atomic_json writes valid JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-test-'));
  const target = path.join(tmpDir, 'test.json');
  try {
    execSync(
      `echo '{"hello":"world"}' | python3 "${LIB_DIR}/oc_atomic_json.py" "${target}" --root "${tmpDir}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    assert(fs.existsSync(target), 'target file should exist');
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert(data.hello === 'world', `expected hello=world, got ${data.hello}`);
    // Check permissions (owner read/write only = 0o600)
    const mode = fs.statSync(target).mode & 0o777;
    assert(mode === 0o600, `expected mode 600, got ${mode.toString(8)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('IG-T16: atomic_json rejects path outside root', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-test-'));
  const escape = path.join(os.tmpdir(), 'ig-escape-target.json');
  try {
    execSync(
      `echo '{"bad":true}' | python3 "${LIB_DIR}/oc_atomic_json.py" "${escape}" --root "${tmpDir}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.status === 1, `expected exit 1, got ${e.status}`);
    assert(!fs.existsSync(escape), 'escape target should NOT exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try { fs.unlinkSync(escape); } catch (_) {}
  }
});

test('IG-T17: atomic_json rejects invalid JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-test-'));
  const target = path.join(tmpDir, 'bad.json');
  try {
    execSync(
      `echo 'not json' | python3 "${LIB_DIR}/oc_atomic_json.py" "${target}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.status === 3, `expected exit 3, got ${e.status}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 6: oc_events.sh — Centralized event emission ───

test('IG-T18: emit_event writes valid JSONL with agent_id', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-events-'));
  const logsDir = path.join(tmpDir, '_logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const env = {
    DELIVERY_OS_HOME: tmpDir,
    OBJ_ID: 'obj-test-123',
    TASK_KEY: 'task-1',
    REPO: 'LucraLab/openclaw-control',
    OC_AGENT_ID: 'builder',
    PATH: process.env.PATH,
    HOME: process.env.HOME
  };
  try {
    bashEvents('emit_event TEST_EVENT "detail=hello"', env);
    const logFile = path.join(logsDir, 'agent-events.jsonl');
    assert(fs.existsSync(logFile), 'event log should exist');
    const line = fs.readFileSync(logFile, 'utf8').trim();
    const evt = JSON.parse(line);
    assert(evt.event === 'TEST_EVENT', `expected TEST_EVENT, got ${evt.event}`);
    assert(evt.agent_id === 'builder', `expected agent_id=builder, got ${evt.agent_id}`);
    assert(evt.objective_id === 'obj-test-123', `expected obj_id, got ${evt.objective_id}`);
    assert(evt.detail === 'hello', `expected detail=hello, got ${evt.detail}`);
    assert(typeof evt.event_seq === 'number', 'event_seq should be number');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('IG-T19: emit_event defaults agent_id to unknown', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-events-'));
  const logsDir = path.join(tmpDir, '_logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const env = {
    DELIVERY_OS_HOME: tmpDir,
    PATH: process.env.PATH,
    HOME: process.env.HOME
  };
  try {
    bashEvents('emit_event NO_AGENT_EVENT', env);
    const logFile = path.join(logsDir, 'agent-events.jsonl');
    const line = fs.readFileSync(logFile, 'utf8').trim();
    const evt = JSON.parse(line);
    assert(evt.agent_id === 'unknown', `expected unknown, got ${evt.agent_id}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 7: Script modifications — centralized events ───

test('IG-T20: delivery_loop.sh sources lib/oc_events.sh', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  assert(
    script.includes('lib/oc_events.sh'),
    'delivery_loop.sh must source lib/oc_events.sh'
  );
  // Must NOT have inline emit_event function definition
  const inlineDef = script.match(/^emit_event\s*\(\s*\)\s*\{/m);
  assert(!inlineDef, 'delivery_loop.sh must NOT define inline emit_event()');
});

test('IG-T21: objective_create.sh sources lib/oc_events.sh', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'objective_create.sh'), 'utf8'
  );
  assert(
    script.includes('lib/oc_events.sh'),
    'objective_create.sh must source lib/oc_events.sh'
  );
});

test('IG-T22: staging_smoke.sh sources lib/oc_events.sh', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'staging_smoke.sh'), 'utf8'
  );
  assert(
    script.includes('lib/oc_events.sh'),
    'staging_smoke.sh must source lib/oc_events.sh'
  );
  const inlineDef = script.match(/^emit_event\s*\(\s*\)\s*\{/m);
  assert(!inlineDef, 'staging_smoke.sh must NOT define inline emit_event()');
});

test('IG-T23: task_pr_sync.sh sources lib/oc_events.sh', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'task_pr_sync.sh'), 'utf8'
  );
  assert(
    script.includes('lib/oc_events.sh'),
    'task_pr_sync.sh must source lib/oc_events.sh'
  );
  const inlineDef = script.match(/^emit_event\s*\(\s*\)\s*\{/m);
  assert(!inlineDef, 'task_pr_sync.sh must NOT define inline emit_event()');
});

// ─── Section 8: Script modifications — path validation ───

test('IG-T24: delivery_loop.sh sources lib/oc_paths.sh', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  assert(
    script.includes('lib/oc_paths.sh'),
    'delivery_loop.sh must source lib/oc_paths.sh'
  );
});

test('IG-T25: oc_agent_root prints correct path', () => {
  const r = bashPaths(
    'DELIVERY_OS_HOME=/tmp/test-home oc_agent_root builder'
  );
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
  assert(
    r.stdout === '/tmp/test-home/agents/builder',
    `expected /tmp/test-home/agents/builder, got ${r.stdout}`
  );
});

// ─── Summary ───

console.log('');
console.log('============================================');
console.log(`  Isolation Guard: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
console.log('============================================');

process.exit(failed > 0 ? 1 : 0);
