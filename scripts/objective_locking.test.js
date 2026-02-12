#!/usr/bin/env node
/**
 * objective_locking.test.js — Tests for Objective Locking (Port #8)
 *
 * Usage: node scripts/objective_locking.test.js
 * Exit 0 = all tests pass, Exit 1 = failures
 *
 * Tests: oc_lock.sh lock_acquire, lock_release, lock_is_stale,
 *        lock_recover_stale, trap cleanup, agent-scoped paths,
 *        fail-closed on ambiguous locks, delivery_loop.sh integration
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
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
 * Run a bash snippet that sources all libs.
 */
function bashAll(snippet, env) {
  const allEnv = { ...process.env, ...env };
  const cmd = `bash -c 'source "${LIB_DIR}/oc_paths.sh" && source "${LIB_DIR}/oc_events.sh" && source "${LIB_DIR}/oc_lock.sh" && ${snippet}'`;
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: allEnv,
      timeout: 15000
    }).trim();
    return { stdout, exitCode: 0 };
  } catch (e) {
    return {
      stdout: (e.stdout || '').trim(),
      stderr: (e.stderr || '').trim(),
      exitCode: e.status || 1
    };
  }
}

/**
 * Create a temp DELIVERY_OS_HOME with agent root and objectives dir.
 */
function makeTmpHome(agentId) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-lock-'));
  const agentRoot = path.join(tmpDir, 'agents', agentId);
  const objDir = path.join(agentRoot, 'objectives');
  const logsDir = path.join(tmpDir, '_logs');
  fs.mkdirSync(objDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  return { tmpDir, agentRoot, objDir, logsDir };
}

function baseEnv(tmpDir, agentId) {
  return {
    DELIVERY_OS_HOME: tmpDir,
    OC_AGENT_ID: agentId || 'executor',
    OC_AGENT_ROOT: path.join(tmpDir, 'agents', agentId || 'executor'),
    OBJ_ID: 'obj-test-lock-123',
    PATH: process.env.PATH,
    HOME: process.env.HOME
  };
}

console.log('============================================');
console.log('  Objective Locking — Test Suite');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// ─── Section 1: lock_acquire + lock_release ───

test('LK-T1: lock_acquire creates lock dir with metadata', () => {
  const { tmpDir, objDir } = makeTmpHome('executor');
  const env = baseEnv(tmpDir, 'executor');
  try {
    const r = bashAll('lock_acquire obj-test-lock-123 && ls "${OC_AGENT_ROOT}/objectives/obj-test-lock-123.lock.d/meta.json"', env);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}: ${r.stderr}`);
    const lockDir = path.join(objDir, 'obj-test-lock-123.lock.d');
    assert(fs.existsSync(lockDir), 'lock dir should exist');
    const metaFile = path.join(lockDir, 'meta.json');
    assert(fs.existsSync(metaFile), 'meta.json should exist');
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    assert(meta.obj_id === 'obj-test-lock-123', `expected obj_id, got ${meta.obj_id}`);
    assert(meta.agent_id === 'executor', `expected executor, got ${meta.agent_id}`);
    assert(typeof meta.pid === 'number', 'pid should be number');
    assert(meta.start_ts_utc.length > 0, 'timestamp should be set');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('LK-T2: lock_release removes lock dir', () => {
  const { tmpDir, objDir } = makeTmpHome('executor');
  const env = baseEnv(tmpDir, 'executor');
  try {
    const r = bashAll('lock_acquire obj-test-lock-123 && lock_release obj-test-lock-123 && echo "released"', env);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
    assert(r.stdout.includes('released'), 'should print released');
    const lockDir = path.join(objDir, 'obj-test-lock-123.lock.d');
    assert(!fs.existsSync(lockDir), 'lock dir should be gone after release');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('LK-T3: lock_release emits LOCK_RELEASED event', () => {
  const { tmpDir, logsDir } = makeTmpHome('executor');
  const env = baseEnv(tmpDir, 'executor');
  try {
    bashAll('lock_acquire obj-test-lock-123 && lock_release obj-test-lock-123', env);
    const logFile = path.join(logsDir, 'agent-events.jsonl');
    assert(fs.existsSync(logFile), 'event log should exist');
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    const events = lines.map(l => JSON.parse(l));
    const acquired = events.find(e => e.event === 'LOCK_ACQUIRED');
    const released = events.find(e => e.event === 'LOCK_RELEASED');
    assert(acquired, 'LOCK_ACQUIRED event should exist');
    assert(released, 'LOCK_RELEASED event should exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 2: Blocked by existing lock ───

test('LK-T4: lock_acquire blocked by existing valid lock', () => {
  const { tmpDir, objDir, logsDir } = makeTmpHome('executor');
  const env = baseEnv(tmpDir, 'executor');
  const lockDir = path.join(objDir, 'obj-test-lock-123.lock.d');

  try {
    // Pre-create lock with current shell's pid (will be running)
    fs.mkdirSync(lockDir, { recursive: true });
    const meta = {
      obj_id: 'obj-test-lock-123',
      agent_id: 'executor',
      pid: process.pid,  // This PID IS running
      hostname: os.hostname().split('.')[0],
      start_ts_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      commit_sha: 'test',
      command: 'test'
    };
    fs.writeFileSync(path.join(lockDir, 'meta.json'), JSON.stringify(meta, null, 2));

    const r = bashAll('lock_acquire obj-test-lock-123', env);
    assert(r.exitCode !== 0, `expected non-zero exit (blocked), got ${r.exitCode}`);
    assert(r.stderr.includes('BLOCKED'), `expected BLOCKED in stderr, got: ${r.stderr}`);

    // Check LOCK_BLOCKED event
    const logFile = path.join(logsDir, 'agent-events.jsonl');
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
      const events = lines.map(l => JSON.parse(l));
      const blocked = events.find(e => e.event === 'LOCK_BLOCKED');
      assert(blocked, 'LOCK_BLOCKED event should exist');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 3: Stale lock recovery ───

test('LK-T5: stale lock (dead PID) is recovered', () => {
  const { tmpDir, objDir, logsDir } = makeTmpHome('executor');
  const env = baseEnv(tmpDir, 'executor');
  const lockDir = path.join(objDir, 'obj-test-lock-123.lock.d');

  try {
    // Create lock with a PID that is NOT running (99999999)
    fs.mkdirSync(lockDir, { recursive: true });
    const meta = {
      obj_id: 'obj-test-lock-123',
      agent_id: 'executor',
      pid: 99999999,
      hostname: os.hostname().split('.')[0],
      start_ts_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      commit_sha: 'old',
      command: 'old-run'
    };
    fs.writeFileSync(path.join(lockDir, 'meta.json'), JSON.stringify(meta, null, 2));

    const r = bashAll('lock_acquire obj-test-lock-123 && echo "acquired-after-recovery"', env);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}: ${r.stderr}`);
    assert(r.stdout.includes('acquired-after-recovery'), 'should acquire after stale recovery');

    // Old lock should be moved to .stale.<ts>
    const files = fs.readdirSync(objDir);
    const staleFiles = files.filter(f => f.includes('.stale.'));
    assert(staleFiles.length > 0, `expected stale backup, found: ${files.join(', ')}`);

    // New lock should exist
    assert(fs.existsSync(lockDir), 'new lock dir should exist');

    // Check LOCK_STALE_RECOVERED event
    const logFile = path.join(logsDir, 'agent-events.jsonl');
    assert(fs.existsSync(logFile), 'event log should exist');
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    const events = lines.map(l => JSON.parse(l));
    const recovered = events.find(e => e.event === 'LOCK_STALE_RECOVERED');
    assert(recovered, 'LOCK_STALE_RECOVERED event should exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('LK-T6: stale lock (TTL exceeded) is recovered', () => {
  const { tmpDir, objDir } = makeTmpHome('executor');
  const env = { ...baseEnv(tmpDir, 'executor'), OC_LOCK_TTL: '1' };  // 1 second TTL
  const lockDir = path.join(objDir, 'obj-test-lock-123.lock.d');

  try {
    // Create lock with current PID (running) but old timestamp
    fs.mkdirSync(lockDir, { recursive: true });
    const meta = {
      obj_id: 'obj-test-lock-123',
      agent_id: 'executor',
      pid: process.pid,  // PID IS running, but TTL exceeded
      hostname: os.hostname().split('.')[0],
      start_ts_utc: '2020-01-01T00:00:00Z',  // Very old
      commit_sha: 'old',
      command: 'old-run'
    };
    fs.writeFileSync(path.join(lockDir, 'meta.json'), JSON.stringify(meta, null, 2));

    const r = bashAll('lock_acquire obj-test-lock-123 && echo "acquired-ttl"', env);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}: ${r.stderr}`);
    assert(r.stdout.includes('acquired-ttl'), 'should acquire after TTL recovery');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 4: Fail-closed on ambiguous lock ───

test('LK-T7: corrupt metadata within TTL fails closed', () => {
  const { tmpDir, objDir } = makeTmpHome('executor');
  const env = baseEnv(tmpDir, 'executor');
  const lockDir = path.join(objDir, 'obj-test-lock-123.lock.d');

  try {
    // Create lock dir with NO metadata (corrupt)
    fs.mkdirSync(lockDir, { recursive: true });
    // Touch the dir so it's "fresh" (within TTL)

    const r = bashAll('lock_acquire obj-test-lock-123', env);
    assert(r.exitCode !== 0, `expected non-zero exit (fail closed), got ${r.exitCode}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('LK-T8: corrupt metadata with invalid JSON fails closed', () => {
  const { tmpDir, objDir } = makeTmpHome('executor');
  const env = baseEnv(tmpDir, 'executor');
  const lockDir = path.join(objDir, 'obj-test-lock-123.lock.d');

  try {
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, 'meta.json'), 'NOT VALID JSON');

    const r = bashAll('lock_acquire obj-test-lock-123', env);
    assert(r.exitCode !== 0, `expected non-zero exit (fail closed), got ${r.exitCode}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 5: Agent-scoped lock path ───

test('LK-T9: lock path is under OC_AGENT_ROOT/objectives', () => {
  const { tmpDir, objDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  env.OC_AGENT_ID = 'builder';
  env.OC_AGENT_ROOT = path.join(tmpDir, 'agents', 'builder');
  fs.mkdirSync(path.join(tmpDir, 'agents', 'builder', 'objectives'), { recursive: true });

  try {
    bashAll('lock_acquire obj-test-lock-123', env);
    const lockDir = path.join(tmpDir, 'agents', 'builder', 'objectives', 'obj-test-lock-123.lock.d');
    assert(fs.existsSync(lockDir), `lock dir should be under agent root: ${lockDir}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('LK-T10: different agents have isolated locks', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-lock-iso-'));
  const logsDir = path.join(tmpDir, '_logs');
  fs.mkdirSync(logsDir, { recursive: true });

  try {
    // Create objectives dirs for both agents
    for (const agent of ['builder', 'executor']) {
      fs.mkdirSync(path.join(tmpDir, 'agents', agent, 'objectives'), { recursive: true });
    }

    // Builder acquires lock
    const env1 = {
      DELIVERY_OS_HOME: tmpDir,
      OC_AGENT_ID: 'builder',
      OC_AGENT_ROOT: path.join(tmpDir, 'agents', 'builder'),
      OBJ_ID: 'obj-test-lock-123',
      PATH: process.env.PATH,
      HOME: process.env.HOME
    };
    const r1 = bashAll('lock_acquire obj-test-lock-123', env1);
    assert(r1.exitCode === 0, `builder should acquire lock, got ${r1.exitCode}`);

    // Executor also acquires lock (different agent root → no conflict)
    const env2 = {
      DELIVERY_OS_HOME: tmpDir,
      OC_AGENT_ID: 'executor',
      OC_AGENT_ROOT: path.join(tmpDir, 'agents', 'executor'),
      OBJ_ID: 'obj-test-lock-123',
      PATH: process.env.PATH,
      HOME: process.env.HOME
    };
    const r2 = bashAll('lock_acquire obj-test-lock-123', env2);
    assert(r2.exitCode === 0, `executor should also acquire (isolated), got ${r2.exitCode}`);

    // Both lock dirs exist
    assert(fs.existsSync(path.join(tmpDir, 'agents', 'builder', 'objectives', 'obj-test-lock-123.lock.d')),
      'builder lock should exist');
    assert(fs.existsSync(path.join(tmpDir, 'agents', 'executor', 'objectives', 'obj-test-lock-123.lock.d')),
      'executor lock should exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 6: Trap releases lock ───

test('LK-T11: trap releases lock on script exit', () => {
  const { tmpDir, objDir } = makeTmpHome('executor');
  const env = baseEnv(tmpDir, 'executor');

  try {
    // Run a subshell that acquires lock, installs trap, then exits
    const r = bashAll('lock_acquire obj-test-lock-123 && lock_install_trap obj-test-lock-123 && echo "done"', env);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
    // After the subshell exits, trap should have fired and released the lock
    const lockDir = path.join(objDir, 'obj-test-lock-123.lock.d');
    assert(!fs.existsSync(lockDir), 'lock dir should be gone after trap fires on exit');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('LK-T12: trap releases lock on script failure', () => {
  const { tmpDir, objDir } = makeTmpHome('executor');
  const env = baseEnv(tmpDir, 'executor');

  try {
    // Run a subshell that acquires lock, installs trap, then fails
    const r = bashAll('lock_acquire obj-test-lock-123 && lock_install_trap obj-test-lock-123 && false', env);
    assert(r.exitCode !== 0, 'should fail');
    // Trap should still release the lock
    const lockDir = path.join(objDir, 'obj-test-lock-123.lock.d');
    assert(!fs.existsSync(lockDir), 'lock dir should be gone after trap fires on failure');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 7: delivery_loop.sh integration ───

test('LK-T13: delivery_loop.sh sources oc_lock.sh', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  assert(script.includes('lib/oc_lock.sh'), 'delivery_loop.sh must source oc_lock.sh');
});

test('LK-T14: delivery_loop.sh calls lock_acquire', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  assert(script.includes('lock_acquire'), 'delivery_loop.sh must call lock_acquire');
});

test('LK-T15: delivery_loop.sh installs lock trap', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  assert(script.includes('lock_install_trap'), 'delivery_loop.sh must call lock_install_trap');
});

test('LK-T16: lock_acquire before first write in delivery_loop.sh', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  // lock_acquire must appear before "Execute delivery steps"
  const lockPos = script.indexOf('lock_acquire "$OBJ_ID"');
  const executePos = script.indexOf('# --- Execute delivery steps ---');
  assert(lockPos > 0 && lockPos < executePos,
    'lock_acquire must appear before "Execute delivery steps"');
});

// ─── Section 8: lock_release ownership check ───

test('LK-T17: lock_release refuses if PID mismatch', () => {
  const { tmpDir, objDir } = makeTmpHome('executor');
  const env = baseEnv(tmpDir, 'executor');
  const lockDir = path.join(objDir, 'obj-test-lock-123.lock.d');

  try {
    // Create lock owned by a different PID
    fs.mkdirSync(lockDir, { recursive: true });
    const meta = {
      obj_id: 'obj-test-lock-123',
      agent_id: 'executor',
      pid: 99999998,  // Different PID
      hostname: os.hostname().split('.')[0],
      start_ts_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      commit_sha: 'test',
      command: 'test'
    };
    fs.writeFileSync(path.join(lockDir, 'meta.json'), JSON.stringify(meta, null, 2));

    const r = bashAll('lock_release obj-test-lock-123', env);
    assert(r.exitCode !== 0, `expected non-zero (PID mismatch), got ${r.exitCode}`);
    // Lock should still exist (not released)
    assert(fs.existsSync(lockDir), 'lock should still exist after refused release');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Summary ───

console.log('');
console.log('============================================');
console.log(`  Objective Locking: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
console.log('============================================');

process.exit(failed > 0 ? 1 : 0);
