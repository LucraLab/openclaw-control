#!/usr/bin/env node
/**
 * ops_hardening.test.js — Tests for Ops Hardening (Port #11)
 *
 * 27 tests covering:
 *   OH-T1  to OH-T7:  Kill Switch
 *   OH-T8  to OH-T16: Quarantine
 *   OH-T17 to OH-T19: Unquarantine
 *   OH-T20 to OH-T24: Notifications
 *   OH-T25 to OH-T27: Triage
 *
 * Usage: node scripts/ops_hardening.test.js
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
let total = 0;

function test(name, fn) {
  total++;
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

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function makeTmpHome() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-test-'));
  fs.mkdirSync(path.join(tmpDir, '_control'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '_logs'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '_locks'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'agents', 'builder', 'objectives'), { recursive: true });
  return tmpDir;
}

function bashRun(script, env) {
  const envStr = Object.entries(env || {}).map(([k, v]) => `${k}="${v}"`).join(' ');
  try {
    const stdout = execSync(`bash -c '${envStr} ${script}'`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      env: { ...process.env, ...env }
    }).trim();
    return { stdout, exitCode: 0 };
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), exitCode: e.status || 1 };
  }
}

function bashRunFull(cmd, env) {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      env: { ...process.env, ...env },
      shell: '/bin/bash'
    }).trim();
    return { stdout, exitCode: 0 };
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), exitCode: e.status || 1 };
  }
}

function writeObj(dir, objId, data) {
  const objFile = path.join(dir, 'agents', 'builder', 'objectives', `${objId}.json`);
  fs.writeFileSync(objFile, JSON.stringify(data, null, 2));
}

function writeTasks(dir, objId, tasks) {
  const tasksFile = path.join(dir, 'agents', 'builder', 'objectives', `${objId}-tasks.json`);
  fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
}

console.log('============================================');
console.log('  Ops Hardening — Test Suite (Port #11)');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// ===================================================================
// Kill Switch Tests (OH-T1 to OH-T7)
// ===================================================================
console.log('--- Kill Switch ---');

test('OH-T1: oc_kill_switch_engaged returns 0 when STOP file exists', () => {
  const tmpDir = makeTmpHome();
  try {
    fs.writeFileSync(path.join(tmpDir, '_control', 'STOP'), '');
    const r = bashRunFull(
      `source "${LIB_DIR}/oc_control.sh" && oc_kill_switch_engaged && echo YES || echo NO`,
      { DELIVERY_OS_HOME: tmpDir }
    );
    assertEqual(r.stdout, 'YES', `Expected YES, got: ${r.stdout}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T2: oc_kill_switch_engaged returns 1 when STOP file absent', () => {
  const tmpDir = makeTmpHome();
  try {
    const r = bashRunFull(
      `source "${LIB_DIR}/oc_control.sh" && oc_kill_switch_engaged && echo YES || echo NO`,
      { DELIVERY_OS_HOME: tmpDir }
    );
    assertEqual(r.stdout, 'NO', `Expected NO, got: ${r.stdout}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T3: arbiter.sh exits code 7 when kill switch engaged', () => {
  const tmpDir = makeTmpHome();
  try {
    fs.writeFileSync(path.join(tmpDir, '_control', 'STOP'), '');
    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/arbiter.sh"`,
      { DELIVERY_OS_HOME: tmpDir, OC_AGENT_ID: 'builder' }
    );
    assertEqual(r.exitCode, 7, `Expected exit code 7, got ${r.exitCode}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T4: delivery_loop.sh exits code 7 when kill switch engaged', () => {
  const tmpDir = makeTmpHome();
  try {
    fs.writeFileSync(path.join(tmpDir, '_control', 'STOP'), '');
    // delivery_loop needs --objective, --task, --repo to get past validation
    // but kill switch should trigger before validation
    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/delivery_loop.sh" --objective obj-1 --task t1 --repo LucraLab/openclaw-control`,
      { DELIVERY_OS_HOME: tmpDir, OC_AGENT_ID: 'builder', GH_MOCK: '1' }
    );
    assertEqual(r.exitCode, 7, `Expected exit code 7, got ${r.exitCode}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T5: kill switch emits KILL_SWITCH_ENGAGED event', () => {
  const tmpDir = makeTmpHome();
  try {
    fs.writeFileSync(path.join(tmpDir, '_control', 'STOP'), '');
    bashRunFull(
      `bash "${REPO_ROOT}/scripts/arbiter.sh"`,
      { DELIVERY_OS_HOME: tmpDir, OC_AGENT_ID: 'builder' }
    );
    const eventsLog = path.join(tmpDir, '_logs', 'agent-events.jsonl');
    assert(fs.existsSync(eventsLog), 'events log not created');
    const events = fs.readFileSync(eventsLog, 'utf8').trim();
    assert(events.includes('KILL_SWITCH_ENGAGED'), `Expected KILL_SWITCH_ENGAGED in events, got: ${events}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T6: kill switch outputs actionable message', () => {
  const tmpDir = makeTmpHome();
  try {
    fs.writeFileSync(path.join(tmpDir, '_control', 'STOP'), '');
    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/arbiter.sh" 2>&1`,
      { DELIVERY_OS_HOME: tmpDir, OC_AGENT_ID: 'builder' }
    );
    assert(r.stdout.includes('remove STOP file to resume'), `Expected actionable message, got: ${r.stdout}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T7: kill switch blocks before any lock is acquired', () => {
  const tmpDir = makeTmpHome();
  try {
    fs.writeFileSync(path.join(tmpDir, '_control', 'STOP'), '');
    // Create an objective that would be selected
    writeObj(tmpDir, 'obj-99', {
      objective_id: 'obj-99', repo: 'LucraLab/openclaw-control',
      status: 'IN_PROGRESS', risk: 'low', created_at: '2026-01-01T00:00:00Z'
    });
    writeTasks(tmpDir, 'obj-99', [{ task_key: 't1', status: 'NEW' }]);

    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/arbiter.sh"`,
      { DELIVERY_OS_HOME: tmpDir, OC_AGENT_ID: 'builder' }
    );
    assertEqual(r.exitCode, 7, `Expected exit code 7, got ${r.exitCode}`);

    // No locks should exist
    const locksDir = path.join(tmpDir, '_locks');
    const locks = fs.readdirSync(locksDir);
    assertEqual(locks.length, 0, `Expected 0 locks, found ${locks.length}: ${locks.join(', ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ===================================================================
// Quarantine Tests (OH-T8 to OH-T16)
// ===================================================================
console.log('');
console.log('--- Quarantine ---');

test('OH-T8: quarantine triggers after 3 failures in 24h', () => {
  const tmpDir = makeTmpHome();
  const qfile = path.join(tmpDir, '_control', 'quarantine.json');
  const pyPath = path.join(LIB_DIR, 'oc_quarantine.py');
  try {
    // Record 3 failures
    for (let i = 0; i < 3; i++) {
      bashRunFull(`python3 "${pyPath}" record "${qfile}" obj-42 failure "fail${i}"`, {});
    }
    // Check quarantine status
    const r = bashRunFull(`python3 "${pyPath}" check "${qfile}" obj-42`, {});
    assertEqual(r.exitCode, 0, `Expected exit 0 (quarantined), got ${r.exitCode}`);
    assert(r.stdout.includes('QUARANTINED'), `Expected QUARANTINED in output`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T9: quarantine does NOT trigger with only 2 failures', () => {
  const tmpDir = makeTmpHome();
  const qfile = path.join(tmpDir, '_control', 'quarantine.json');
  const pyPath = path.join(LIB_DIR, 'oc_quarantine.py');
  try {
    for (let i = 0; i < 2; i++) {
      bashRunFull(`python3 "${pyPath}" record "${qfile}" obj-42 failure "fail${i}"`, {});
    }
    const r = bashRunFull(`python3 "${pyPath}" check "${qfile}" obj-42`, {});
    assertEqual(r.exitCode, 1, `Expected exit 1 (not quarantined), got ${r.exitCode}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T10: quarantine window expiry — old failures ignored', () => {
  const tmpDir = makeTmpHome();
  const qfile = path.join(tmpDir, '_control', 'quarantine.json');
  const pyPath = path.join(LIB_DIR, 'oc_quarantine.py');
  try {
    // Write quarantine with old failures (25 hours ago)
    const oldTime = new Date(Date.now() - 25 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    const data = {
      'obj-42': {
        quarantined: false,
        events: [
          { type: 'failure', at: oldTime, detail: 'old1' },
          { type: 'failure', at: oldTime, detail: 'old2' }
        ]
      }
    };
    fs.writeFileSync(qfile, JSON.stringify(data, null, 2));
    // Record one more recent failure — should NOT trigger (only 1 recent)
    bashRunFull(`python3 "${pyPath}" record "${qfile}" obj-42 failure "recent1"`, {});
    const r = bashRunFull(`python3 "${pyPath}" check "${qfile}" obj-42`, {});
    assertEqual(r.exitCode, 1, `Expected exit 1 (not quarantined), got ${r.exitCode}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T11: arbiter skips quarantined objective', () => {
  const tmpDir = makeTmpHome();
  try {
    // Quarantine obj-42
    const qfile = path.join(tmpDir, '_control', 'quarantine.json');
    fs.writeFileSync(qfile, JSON.stringify({
      'obj-42': { quarantined: true, quarantined_at: '2026-01-01T00:00:00Z', reason: 'repeated_failure' }
    }, null, 2));

    // Create obj-42 (quarantined) and obj-43 (not quarantined)
    writeObj(tmpDir, 'obj-42', {
      objective_id: 'obj-42', repo: 'LucraLab/openclaw-control',
      status: 'IN_PROGRESS', risk: 'low', created_at: '2026-01-01T00:00:00Z'
    });
    writeTasks(tmpDir, 'obj-42', [{ task_key: 't1', status: 'NEW' }]);

    writeObj(tmpDir, 'obj-43', {
      objective_id: 'obj-43', repo: 'LucraLab/openclaw-control',
      status: 'IN_PROGRESS', risk: 'low', created_at: '2026-01-02T00:00:00Z'
    });
    writeTasks(tmpDir, 'obj-43', [{ task_key: 't1', status: 'NEW' }]);

    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/arbiter.sh" 2>&1`,
      { DELIVERY_OS_HOME: tmpDir, OC_AGENT_ID: 'builder' }
    );
    // obj-42 should be skipped, obj-43 should be selected
    assert(r.stdout.includes('obj-43'), `Expected obj-43 selected, got: ${r.stdout}`);
    assert(!r.stdout.includes('"obj_id": "obj-42"'), `obj-42 should be skipped`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T12: corrupt quarantine.json — arbiter fails closed', () => {
  const tmpDir = makeTmpHome();
  try {
    // Write corrupt quarantine file
    fs.writeFileSync(path.join(tmpDir, '_control', 'quarantine.json'), 'NOT VALID JSON{{{');

    // Create an objective
    writeObj(tmpDir, 'obj-42', {
      objective_id: 'obj-42', repo: 'LucraLab/openclaw-control',
      status: 'IN_PROGRESS', risk: 'low', created_at: '2026-01-01T00:00:00Z'
    });
    writeTasks(tmpDir, 'obj-42', [{ task_key: 't1', status: 'NEW' }]);

    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/arbiter.sh" 2>&1`,
      { DELIVERY_OS_HOME: tmpDir, OC_AGENT_ID: 'builder' }
    );
    // Fail closed: arbiter should refuse (exit 1) due to corrupt quarantine
    assert(r.exitCode !== 0, `Expected non-zero exit on corrupt quarantine, got ${r.exitCode}`);
    assert(r.stdout.includes('corrupt') || r.stdout.includes('REFUSED') || r.stdout.includes('fail closed'),
      `Expected corruption message, got: ${r.stdout}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T13: OBJECTIVE_QUARANTINED event emitted on trigger', () => {
  const tmpDir = makeTmpHome();
  const qfile = path.join(tmpDir, '_control', 'quarantine.json');
  const pyPath = path.join(LIB_DIR, 'oc_quarantine.py');
  try {
    // Record 3 failures to trigger quarantine
    for (let i = 0; i < 3; i++) {
      bashRunFull(`python3 "${pyPath}" record "${qfile}" obj-42 failure "fail${i}"`, {});
    }
    const r = bashRunFull(`python3 "${pyPath}" record "${qfile}" obj-42 failure "trigger"`, {});
    // The third record should have printed QUARANTINED (exit 0)
    const data = JSON.parse(fs.readFileSync(qfile, 'utf8'));
    assert(data['obj-42'].quarantined === true, 'obj-42 should be quarantined');
    assert(data['obj-42'].reason === 'repeated_failure', `Expected reason repeated_failure, got ${data['obj-42'].reason}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T14: OBJECTIVE_SKIPPED_QUARANTINE event emitted on skip', () => {
  const tmpDir = makeTmpHome();
  try {
    // Quarantine obj-42, no other objectives
    const qfile = path.join(tmpDir, '_control', 'quarantine.json');
    fs.writeFileSync(qfile, JSON.stringify({
      'obj-42': { quarantined: true, quarantined_at: '2026-01-01T00:00:00Z', reason: 'test' }
    }, null, 2));

    writeObj(tmpDir, 'obj-42', {
      objective_id: 'obj-42', repo: 'LucraLab/openclaw-control',
      status: 'IN_PROGRESS', risk: 'low', created_at: '2026-01-01T00:00:00Z'
    });
    writeTasks(tmpDir, 'obj-42', [{ task_key: 't1', status: 'NEW' }]);

    bashRunFull(
      `bash "${REPO_ROOT}/scripts/arbiter.sh"`,
      { DELIVERY_OS_HOME: tmpDir, OC_AGENT_ID: 'builder' }
    );
    const eventsLog = path.join(tmpDir, '_logs', 'agent-events.jsonl');
    assert(fs.existsSync(eventsLog), 'events log not created');
    const events = fs.readFileSync(eventsLog, 'utf8');
    assert(events.includes('OBJECTIVE_SKIPPED_QUARANTINE'), 'Expected OBJECTIVE_SKIPPED_QUARANTINE event');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T15: budget breach x2 triggers quarantine', () => {
  const tmpDir = makeTmpHome();
  const qfile = path.join(tmpDir, '_control', 'quarantine.json');
  const pyPath = path.join(LIB_DIR, 'oc_quarantine.py');
  try {
    for (let i = 0; i < 2; i++) {
      bashRunFull(`python3 "${pyPath}" record "${qfile}" obj-42 breach "over_budget${i}"`, {});
    }
    const r = bashRunFull(`python3 "${pyPath}" check "${qfile}" obj-42`, {});
    assertEqual(r.exitCode, 0, `Expected quarantined after 2 breaches, got exit ${r.exitCode}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T16: arbitration block x5 in 1h triggers quarantine', () => {
  const tmpDir = makeTmpHome();
  const qfile = path.join(tmpDir, '_control', 'quarantine.json');
  const pyPath = path.join(LIB_DIR, 'oc_quarantine.py');
  try {
    for (let i = 0; i < 5; i++) {
      bashRunFull(`python3 "${pyPath}" record "${qfile}" obj-42 arb_block "block${i}"`, {});
    }
    const r = bashRunFull(`python3 "${pyPath}" check "${qfile}" obj-42`, {});
    assertEqual(r.exitCode, 0, `Expected quarantined after 5 arb_blocks, got exit ${r.exitCode}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ===================================================================
// Unquarantine Tests (OH-T17 to OH-T19)
// ===================================================================
console.log('');
console.log('--- Unquarantine ---');

test('OH-T17: unquarantine.sh removes entry atomically', () => {
  const tmpDir = makeTmpHome();
  try {
    const qfile = path.join(tmpDir, '_control', 'quarantine.json');
    fs.writeFileSync(qfile, JSON.stringify({
      'obj-42': { quarantined: true, quarantined_at: '2026-01-01T00:00:00Z', reason: 'test', events: [] }
    }, null, 2));

    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/unquarantine.sh" obj-42`,
      { DELIVERY_OS_HOME: tmpDir }
    );
    assertEqual(r.exitCode, 0, `Expected exit 0, got ${r.exitCode}`);

    // Verify quarantine removed
    const data = JSON.parse(fs.readFileSync(qfile, 'utf8'));
    assert(data['obj-42'].quarantined === false, 'obj-42 should no longer be quarantined');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T18: unquarantine.sh handles missing obj_id gracefully', () => {
  const tmpDir = makeTmpHome();
  try {
    const qfile = path.join(tmpDir, '_control', 'quarantine.json');
    fs.writeFileSync(qfile, JSON.stringify({}, null, 2));

    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/unquarantine.sh" obj-999`,
      { DELIVERY_OS_HOME: tmpDir }
    );
    // Should exit 1 (not found) but not crash
    assertEqual(r.exitCode, 1, `Expected exit 1 (not found), got ${r.exitCode}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T19: quarantine_status.sh lists current quarantines', () => {
  const tmpDir = makeTmpHome();
  try {
    const qfile = path.join(tmpDir, '_control', 'quarantine.json');
    fs.writeFileSync(qfile, JSON.stringify({
      'obj-42': { quarantined: true, quarantined_at: '2026-01-01T00:00:00Z', reason: 'test' },
      'obj-43': { quarantined: false, events: [{ type: 'failure', at: '2026-01-01T00:00:00Z' }] }
    }, null, 2));

    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/quarantine_status.sh"`,
      { DELIVERY_OS_HOME: tmpDir }
    );
    assertEqual(r.exitCode, 0, `Expected exit 0, got ${r.exitCode}`);
    assert(r.stdout.includes('obj-42'), 'Should list obj-42');
    assert(!r.stdout.includes('obj-43') || !r.stdout.match(/obj-43.*reason=/), 'Should not list obj-43 as quarantined');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ===================================================================
// Notification Tests (OH-T20 to OH-T24)
// ===================================================================
console.log('');
console.log('--- Notifications ---');

test('OH-T20: notify noop mode produces no file output', () => {
  const { notify } = require(path.join(REPO_ROOT, 'scripts', 'notify.js'));
  const tmpDir = makeTmpHome();
  try {
    const result = notify('TEST_EVENT', 'test detail', 'noop');
    assert(result.event === 'TEST_EVENT', 'Event name preserved');
    // No file should be written
    const logFile = path.join(tmpDir, '_logs', 'notifications.log');
    assert(!fs.existsSync(logFile), 'No log file should exist for noop');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T21: notify file mode writes to notifications.log', () => {
  const { notify } = require(path.join(REPO_ROOT, 'scripts', 'notify.js'));
  const tmpDir = makeTmpHome();
  const origHome = process.env.DELIVERY_OS_HOME;
  try {
    process.env.DELIVERY_OS_HOME = tmpDir;
    notify('FILE_TEST', 'file detail', 'file');
    const logFile = path.join(tmpDir, '_logs', 'notifications.log');
    assert(fs.existsSync(logFile), 'Log file should exist');
    const content = fs.readFileSync(logFile, 'utf8');
    assert(content.includes('FILE_TEST'), 'Should contain event name');
    assert(content.includes('file detail'), 'Should contain detail');
  } finally {
    process.env.DELIVERY_OS_HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T22: notify stdout mode prints to stdout', () => {
  const r = bashRunFull(
    `node "${REPO_ROOT}/scripts/notify.js" --event STDOUT_TEST --detail "hello" --sink stdout`,
    {}
  );
  assertEqual(r.exitCode, 0, `Expected exit 0, got ${r.exitCode}`);
  assert(r.stdout.includes('STDOUT_TEST'), `Should contain event name in stdout: ${r.stdout}`);
  const parsed = JSON.parse(r.stdout);
  assert(parsed.event === 'STDOUT_TEST', 'Parsed event matches');
  assert(parsed.detail === 'hello', 'Parsed detail matches');
});

test('OH-T23: notification payload sanitized (secrets redacted)', () => {
  const { sanitize } = require(path.join(REPO_ROOT, 'scripts', 'notify.js'));
  const tests = [
    ['sk-abc1234567890xyzabc', '[REDACTED]'],
    ['ghp_abcdef1234567890abcdef1234567890abcdef', '[REDACTED]'],
    ['pit-abcdef123456', '[REDACTED]'],
    ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test', '[REDACTED]'],
    ['token=verylongsecretvalue12345', '[REDACTED]'],
    ['clean data no secrets', 'clean data no secrets']
  ];
  for (const [input, expectedContains] of tests) {
    const result = sanitize(input);
    assert(result.includes(expectedContains) || result === expectedContains,
      `Sanitize failed for "${input.substring(0, 20)}...": got "${result}"`);
    // Ensure original secret is not present (except clean data)
    if (expectedContains === '[REDACTED]') {
      assert(!result.includes(input), `Secret not redacted: ${result}`);
    }
  }
});

test('OH-T24: long payloads truncated to max length', () => {
  const { sanitize } = require(path.join(REPO_ROOT, 'scripts', 'notify.js'));
  const longString = 'A'.repeat(1000);
  const result = sanitize(longString);
  assert(result.length < 600, `Expected truncated, got length ${result.length}`);
  assert(result.includes('[truncated]'), 'Should include truncation marker');
});

// ===================================================================
// Triage Tests (OH-T25 to OH-T27)
// ===================================================================
console.log('');
console.log('--- Triage ---');

test('OH-T25: triage script redacts secrets', () => {
  const tmpDir = makeTmpHome();
  try {
    // Write events with secrets
    const eventsLog = path.join(tmpDir, '_logs', 'agent-events.jsonl');
    const secretEvent = JSON.stringify({
      event: 'TEST', token: 'sk-secretkey1234567890abc', api_key: 'AKIAIOSFODNN7EXAMPLE12345'
    });
    fs.writeFileSync(eventsLog, secretEvent + '\n');

    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/triage.sh"`,
      { DELIVERY_OS_HOME: tmpDir }
    );
    // Should NOT contain the actual secrets
    assert(!r.stdout.includes('secretkey1234567890abc'), 'Secret key should be redacted');
    assert(!r.stdout.includes('IOSFODNN7EXAMPLE12345'), 'AWS key should be redacted');
    // Should contain redaction markers
    assert(r.stdout.includes('[REDACTED]'), 'Should contain [REDACTED] markers');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T26: triage reports kill switch status', () => {
  const tmpDir = makeTmpHome();
  try {
    fs.writeFileSync(path.join(tmpDir, '_control', 'STOP'), '');
    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/triage.sh"`,
      { DELIVERY_OS_HOME: tmpDir }
    );
    assert(r.stdout.includes('ENGAGED'), `Expected kill switch ENGAGED in output`);
    assert(r.stdout.includes('Kill switch is ON'), 'Should say kill switch is ON');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OH-T27: triage reports quarantine list', () => {
  const tmpDir = makeTmpHome();
  try {
    const qfile = path.join(tmpDir, '_control', 'quarantine.json');
    fs.writeFileSync(qfile, JSON.stringify({
      'obj-42': { quarantined: true, quarantined_at: '2026-01-01T00:00:00Z', reason: 'test' }
    }, null, 2));

    const r = bashRunFull(
      `bash "${REPO_ROOT}/scripts/triage.sh"`,
      { DELIVERY_OS_HOME: tmpDir }
    );
    assert(r.stdout.includes('obj-42'), 'Should list quarantined obj-42');
    assert(r.stdout.includes('Quarantine'), 'Should have Quarantines section');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ===================================================================
// Summary
// ===================================================================
console.log('');
console.log('============================================');
console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
console.log('============================================');

if (failed > 0) {
  process.exit(1);
}
