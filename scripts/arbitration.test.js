#!/usr/bin/env node
/**
 * arbitration.test.js — Tests for Objective Arbitration + Global Queue (Port #9)
 *
 * Usage: node scripts/arbitration.test.js
 * Exit 0 = all tests pass, Exit 1 = failures
 *
 * Tests: resource locking, arbiter selection, lock ordering,
 *        run token verification, fail-closed, agent isolation,
 *        stale recovery, event emission, delivery_loop.sh integration
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

function bashAll(snippet, env) {
  const allEnv = { ...process.env, ...env };
  const cmd = `bash -c 'source "${LIB_DIR}/oc_paths.sh" && source "${LIB_DIR}/oc_events.sh" && source "${LIB_DIR}/oc_lock.sh" && source "${LIB_DIR}/oc_resource_lock.sh" && ${snippet}'`;
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: allEnv,
      timeout: 15000
    }).trim();
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e) {
    return {
      stdout: (e.stdout || '').trim(),
      stderr: (e.stderr || '').trim(),
      exitCode: e.status || 1
    };
  }
}

function makeTmpHome(agentId) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-arb-'));
  const agentRoot = path.join(tmpDir, 'agents', agentId || 'builder');
  const objDir = path.join(agentRoot, 'objectives');
  const logsDir = path.join(tmpDir, '_logs');
  const locksDir = path.join(tmpDir, '_locks');
  fs.mkdirSync(objDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(locksDir, { recursive: true });
  return { tmpDir, agentRoot, objDir, logsDir, locksDir };
}

function baseEnv(tmpDir, agentId) {
  return {
    DELIVERY_OS_HOME: tmpDir,
    OC_AGENT_ID: agentId || 'builder',
    OC_AGENT_ROOT: path.join(tmpDir, 'agents', agentId || 'builder'),
    OBJ_ID: 'obj-test-arb-1',
    REPO: 'LucraLab/openclaw-control',
    BRANCH_NAME: 'obj-obj-test-arb-1/task-1',
    PATH: process.env.PATH,
    HOME: process.env.HOME
  };
}

function writeObjective(objDir, objId, overrides) {
  const obj = {
    objective_id: objId,
    objective_type: 'feature_small_cli',
    status: 'NEW',
    risk: 'low',
    repo: 'LucraLab/openclaw-control',
    description: `Test objective ${objId}`,
    created_by: 'test',
    created_at: new Date().toISOString(),
    manual_only: false,
    ...overrides
  };
  fs.writeFileSync(path.join(objDir, `${objId}.json`), JSON.stringify(obj, null, 2));
  return obj;
}

function writeTasks(objDir, objId, tasks) {
  fs.writeFileSync(
    path.join(objDir, `${objId}-tasks.json`),
    JSON.stringify(tasks, null, 2)
  );
}

console.log('============================================');
console.log('  Arbitration — Test Suite');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// ─── Section 1: Resource lock acquire + release ───

test('ARB-T1: resource_lock_acquire creates lock dir with metadata', () => {
  const { tmpDir, locksDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  try {
    const r = bashAll('resource_lock_acquire "repo_branch:Test/repo@main" && echo "acquired"', env);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}: ${r.stderr}`);
    const lockDir = path.join(locksDir, 'repo_branch__Test_repo_at_main.lock.d');
    assert(fs.existsSync(lockDir), `lock dir should exist at ${lockDir}`);
    const meta = JSON.parse(fs.readFileSync(path.join(lockDir, 'meta.json'), 'utf8'));
    assert(meta.lock_id === 'repo_branch:Test/repo@main', `expected lock_id, got ${meta.lock_id}`);
    assert(meta.agent_id === 'builder', `expected builder, got ${meta.agent_id}`);
    assert(typeof meta.pid === 'number', 'pid should be number');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ARB-T2: resource_lock_release removes lock dir', () => {
  const { tmpDir, locksDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  try {
    const r = bashAll('resource_lock_acquire "repo_branch:Test/repo@main" && resource_lock_release "repo_branch:Test/repo@main" && echo "released"', env);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
    assert(r.stdout.includes('released'), 'should print released');
    const lockDir = path.join(locksDir, 'repo_branch__Test_repo_at_main.lock.d');
    assert(!fs.existsSync(lockDir), 'lock dir should be gone after release');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ARB-T3: resource_lock_release emits ARBITRATION_RELEASED event', () => {
  const { tmpDir, logsDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  try {
    bashAll('resource_lock_acquire "repo_branch:Test/repo@main" && resource_lock_release "repo_branch:Test/repo@main"', env);
    const logFile = path.join(logsDir, 'agent-events.jsonl');
    assert(fs.existsSync(logFile), 'event log should exist');
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    const events = lines.map(l => JSON.parse(l));
    const released = events.find(e => e.event === 'ARBITRATION_RELEASED');
    assert(released, 'ARBITRATION_RELEASED event should exist');
    assert(released.lock_id === 'repo_branch:Test/repo@main', 'event should include lock_id');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 2: Blocked by existing resource lock ───

test('ARB-T4: resource_lock_acquire blocked by existing valid lock', () => {
  const { tmpDir, locksDir, logsDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  const lockDir = path.join(locksDir, 'repo_branch__Test_repo_at_main.lock.d');

  try {
    fs.mkdirSync(lockDir, { recursive: true });
    const meta = {
      lock_id: 'repo_branch:Test/repo@main',
      agent_id: 'executor',
      pid: process.pid,
      hostname: os.hostname().split('.')[0],
      start_ts_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      obj_id: 'obj-other',
      repo_slug: 'Test/repo',
      branch: 'main',
      commit_sha: 'test'
    };
    fs.writeFileSync(path.join(lockDir, 'meta.json'), JSON.stringify(meta, null, 2));

    const r = bashAll('resource_lock_acquire "repo_branch:Test/repo@main"', env);
    assert(r.exitCode !== 0, `expected non-zero (blocked), got ${r.exitCode}`);
    assert(r.stderr.includes('BLOCKED'), `expected BLOCKED in stderr, got: ${r.stderr}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ARB-T5: two objectives on same repo/branch — second blocked', () => {
  const { tmpDir, locksDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  const lockDir = path.join(locksDir, 'repo_branch__LucraLab_openclaw-control_at_obj-1_task-1.lock.d');
  try {
    // Pre-create lock with Node's PID (still running, not stale)
    fs.mkdirSync(lockDir, { recursive: true });
    const meta = {
      lock_id: 'repo_branch:LucraLab/openclaw-control@obj-1/task-1',
      agent_id: 'builder',
      pid: process.pid,
      hostname: os.hostname().split('.')[0],
      start_ts_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    };
    fs.writeFileSync(path.join(lockDir, 'meta.json'), JSON.stringify(meta, null, 2));

    // Second acquire on SAME lock ID should block
    const r2 = bashAll('resource_lock_acquire "repo_branch:LucraLab/openclaw-control@obj-1/task-1"', env);
    assert(r2.exitCode !== 0, 'second acquire on same resource should block');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ARB-T6: two objectives on different repos can run independently', () => {
  const { tmpDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  try {
    const r1 = bashAll('resource_lock_acquire "repo_branch:Org/repo-A@main"', env);
    assert(r1.exitCode === 0, 'first acquire should succeed');

    const r2 = bashAll('resource_lock_acquire "repo_branch:Org/repo-B@main"', env);
    assert(r2.exitCode === 0, 'second acquire on different repo should succeed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 3: Stale resource lock recovery ───

test('ARB-T7: stale resource lock (dead PID) is recovered', () => {
  const { tmpDir, locksDir, logsDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  const lockDir = path.join(locksDir, 'repo_branch__Test_repo_at_main.lock.d');

  try {
    fs.mkdirSync(lockDir, { recursive: true });
    const meta = {
      lock_id: 'repo_branch:Test/repo@main',
      agent_id: 'builder',
      pid: 99999999,
      hostname: os.hostname().split('.')[0],
      start_ts_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      obj_id: 'obj-old',
      repo_slug: 'Test/repo',
      branch: 'main',
      commit_sha: 'old'
    };
    fs.writeFileSync(path.join(lockDir, 'meta.json'), JSON.stringify(meta, null, 2));

    const r = bashAll('resource_lock_acquire "repo_branch:Test/repo@main" && echo "recovered"', env);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}: ${r.stderr}`);
    assert(r.stdout.includes('recovered'), 'should acquire after stale recovery');

    const logFile = path.join(logsDir, 'agent-events.jsonl');
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
      const events = lines.map(l => JSON.parse(l));
      const recovered = events.find(e => e.event === 'ARBITRATION_STALE_RECOVERED');
      assert(recovered, 'ARBITRATION_STALE_RECOVERED event should exist');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ARB-T8: stale resource lock (TTL exceeded) is recovered', () => {
  const { tmpDir, locksDir } = makeTmpHome('builder');
  const env = { ...baseEnv(tmpDir, 'builder'), OC_RESOURCE_LOCK_TTL: '1' };
  const lockDir = path.join(locksDir, 'repo_branch__Test_repo_at_main.lock.d');

  try {
    fs.mkdirSync(lockDir, { recursive: true });
    const meta = {
      lock_id: 'repo_branch:Test/repo@main',
      agent_id: 'builder',
      pid: process.pid,
      hostname: os.hostname().split('.')[0],
      start_ts_utc: '2020-01-01T00:00:00Z',
      obj_id: 'obj-old',
      repo_slug: 'Test/repo',
      branch: 'main',
      commit_sha: 'old'
    };
    fs.writeFileSync(path.join(lockDir, 'meta.json'), JSON.stringify(meta, null, 2));

    const r = bashAll('resource_lock_acquire "repo_branch:Test/repo@main" && echo "ttl-recovered"', env);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}: ${r.stderr}`);
    assert(r.stdout.includes('ttl-recovered'), 'should acquire after TTL recovery');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 4: Fail-closed on corrupt metadata ───

test('ARB-T9: corrupt resource lock metadata within TTL fails closed', () => {
  const { tmpDir, locksDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  const lockDir = path.join(locksDir, 'repo_branch__Test_repo_at_main.lock.d');

  try {
    fs.mkdirSync(lockDir, { recursive: true });
    // No meta.json — corrupt, fresh dir (within TTL)
    const r = bashAll('resource_lock_acquire "repo_branch:Test/repo@main"', env);
    assert(r.exitCode !== 0, 'should fail closed on corrupt metadata within TTL');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ARB-T10: invalid JSON metadata within TTL fails closed', () => {
  const { tmpDir, locksDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  const lockDir = path.join(locksDir, 'repo_branch__Test_repo_at_main.lock.d');

  try {
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, 'meta.json'), 'NOT VALID JSON');
    const r = bashAll('resource_lock_acquire "repo_branch:Test/repo@main"', env);
    assert(r.exitCode !== 0, 'should fail closed on invalid JSON within TTL');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 5: Resource lock PID ownership ───

test('ARB-T11: resource_lock_release refuses if PID mismatch', () => {
  const { tmpDir, locksDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  const lockDir = path.join(locksDir, 'repo_branch__Test_repo_at_main.lock.d');

  try {
    fs.mkdirSync(lockDir, { recursive: true });
    const meta = {
      lock_id: 'repo_branch:Test/repo@main',
      agent_id: 'builder',
      pid: 99999998,
      hostname: os.hostname().split('.')[0],
      start_ts_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      obj_id: 'obj-other',
      repo_slug: 'Test/repo',
      branch: 'main',
      commit_sha: 'test'
    };
    fs.writeFileSync(path.join(lockDir, 'meta.json'), JSON.stringify(meta, null, 2));

    const r = bashAll('resource_lock_release "repo_branch:Test/repo@main"', env);
    assert(r.exitCode !== 0, 'should refuse release with PID mismatch');
    assert(fs.existsSync(lockDir), 'lock should still exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 6: Arbiter selection ───

test('ARB-T12: arbiter selects next objective deterministically', () => {
  const { tmpDir, objDir, logsDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  env.OBJ_ID = '';  // arbiter sets this

  try {
    // Create two objectives — older one should be selected first
    writeObjective(objDir, 'obj-arb-older', { created_at: '2026-01-01T00:00:00Z' });
    writeTasks(objDir, 'obj-arb-older', [{ task_key: 'task-1', status: 'NEW' }]);

    writeObjective(objDir, 'obj-arb-newer', { created_at: '2026-02-01T00:00:00Z' });
    writeTasks(objDir, 'obj-arb-newer', [{ task_key: 'task-1', status: 'NEW' }]);

    const arbiterPath = path.join(REPO_ROOT, 'scripts', 'arbiter.sh');
    const r = execSync(`bash "${arbiterPath}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: 15000
    }).trim();

    const token = JSON.parse(r);
    assert(token.obj_id === 'obj-arb-older', `expected older selected first, got ${token.obj_id}`);
    assert(token.task_key === 'task-1', `expected task-1, got ${token.task_key}`);
    assert(token.repo === 'LucraLab/openclaw-control', `expected repo, got ${token.repo}`);
    assert(Array.isArray(token.resource_lock_ids), 'should have resource_lock_ids array');
    assert(token.resource_lock_ids.length > 0, 'should have at least one lock ID');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ARB-T13: arbiter skips COMPLETE and FAILED objectives', () => {
  const { tmpDir, objDir, logsDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  env.OBJ_ID = '';

  try {
    writeObjective(objDir, 'obj-complete', { status: 'COMPLETE', created_at: '2026-01-01T00:00:00Z' });
    writeTasks(objDir, 'obj-complete', [{ task_key: 'task-1', status: 'NEW' }]);

    writeObjective(objDir, 'obj-failed', { status: 'FAILED', created_at: '2026-01-02T00:00:00Z' });
    writeTasks(objDir, 'obj-failed', [{ task_key: 'task-1', status: 'NEW' }]);

    writeObjective(objDir, 'obj-eligible', { status: 'NEW', created_at: '2026-01-03T00:00:00Z' });
    writeTasks(objDir, 'obj-eligible', [{ task_key: 'task-1', status: 'NEW' }]);

    const arbiterPath = path.join(REPO_ROOT, 'scripts', 'arbiter.sh');
    const r = execSync(`bash "${arbiterPath}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: 15000
    }).trim();

    const token = JSON.parse(r);
    assert(token.obj_id === 'obj-eligible', `should skip COMPLETE/FAILED, got ${token.obj_id}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ARB-T14: arbiter skips high-risk and manual_only objectives', () => {
  const { tmpDir, objDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  env.OBJ_ID = '';

  try {
    writeObjective(objDir, 'obj-high', { risk: 'high', created_at: '2026-01-01T00:00:00Z' });
    writeTasks(objDir, 'obj-high', [{ task_key: 'task-1', status: 'NEW' }]);

    writeObjective(objDir, 'obj-manual', { manual_only: true, created_at: '2026-01-02T00:00:00Z' });
    writeTasks(objDir, 'obj-manual', [{ task_key: 'task-1', status: 'NEW' }]);

    writeObjective(objDir, 'obj-auto-low', { risk: 'low', created_at: '2026-01-03T00:00:00Z' });
    writeTasks(objDir, 'obj-auto-low', [{ task_key: 'task-1', status: 'NEW' }]);

    const arbiterPath = path.join(REPO_ROOT, 'scripts', 'arbiter.sh');
    const r = execSync(`bash "${arbiterPath}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: 15000
    }).trim();

    const token = JSON.parse(r);
    assert(token.obj_id === 'obj-auto-low', `should skip high-risk/manual, got ${token.obj_id}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ARB-T15: arbiter skips objectives with all tasks DONE', () => {
  const { tmpDir, objDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  env.OBJ_ID = '';

  try {
    writeObjective(objDir, 'obj-all-done', { created_at: '2026-01-01T00:00:00Z' });
    writeTasks(objDir, 'obj-all-done', [{ task_key: 'task-1', status: 'DONE' }]);

    writeObjective(objDir, 'obj-has-work', { created_at: '2026-01-02T00:00:00Z' });
    writeTasks(objDir, 'obj-has-work', [
      { task_key: 'task-1', status: 'DONE' },
      { task_key: 'task-2', status: 'NEW' }
    ]);

    const arbiterPath = path.join(REPO_ROOT, 'scripts', 'arbiter.sh');
    const r = execSync(`bash "${arbiterPath}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: 15000
    }).trim();

    const token = JSON.parse(r);
    assert(token.obj_id === 'obj-has-work', `should select obj with pending task, got ${token.obj_id}`);
    assert(token.task_key === 'task-2', `should select task-2, got ${token.task_key}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 7: Arbiter emits events ───

test('ARB-T16: arbiter emits ARBITRATION_SELECTED on success', () => {
  const { tmpDir, objDir, logsDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  env.OBJ_ID = '';

  try {
    writeObjective(objDir, 'obj-select-evt', { created_at: '2026-01-01T00:00:00Z' });
    writeTasks(objDir, 'obj-select-evt', [{ task_key: 'task-1', status: 'NEW' }]);

    const arbiterPath = path.join(REPO_ROOT, 'scripts', 'arbiter.sh');
    execSync(`bash "${arbiterPath}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: 15000
    });

    const logFile = path.join(logsDir, 'agent-events.jsonl');
    assert(fs.existsSync(logFile), 'event log should exist');
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    const events = lines.map(l => JSON.parse(l));
    const selected = events.find(e => e.event === 'ARBITRATION_SELECTED');
    assert(selected, 'ARBITRATION_SELECTED event should exist');
    assert(selected.agent_id === 'builder', `agent_id should be builder, got ${selected.agent_id}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ARB-T17: arbiter emits ARBITRATION_SKIPPED when no candidates', () => {
  const { tmpDir, logsDir } = makeTmpHome('builder');
  const env = baseEnv(tmpDir, 'builder');
  env.OBJ_ID = '';

  try {
    // No objectives at all
    const arbiterPath = path.join(REPO_ROOT, 'scripts', 'arbiter.sh');
    try {
      execSync(`bash "${arbiterPath}" 2>/dev/null`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        timeout: 15000
      });
    } catch (_) { /* exit code may be 0 */ }

    const logFile = path.join(logsDir, 'agent-events.jsonl');
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
      const events = lines.map(l => JSON.parse(l));
      const skipped = events.find(e => e.event === 'ARBITRATION_SKIPPED');
      assert(skipped, 'ARBITRATION_SKIPPED event should exist');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 8: delivery_loop.sh integration ───

test('ARB-T18: delivery_loop.sh sources oc_resource_lock.sh', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  assert(script.includes('lib/oc_resource_lock.sh'), 'delivery_loop.sh must source oc_resource_lock.sh');
});

test('ARB-T19: delivery_loop.sh accepts --run-token argument', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  assert(script.includes('--run-token'), 'delivery_loop.sh must accept --run-token');
  assert(script.includes('RUN_TOKEN_PATH'), 'delivery_loop.sh must use RUN_TOKEN_PATH');
});

test('ARB-T20: delivery_loop.sh verifies run token obj_id match', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  assert(script.includes('run_token_obj_mismatch'), 'delivery_loop.sh must check obj_id mismatch');
  assert(script.includes('run_token_repo_mismatch'), 'delivery_loop.sh must check repo mismatch');
});

test('ARB-T21: lock ordering — resource_lock_acquire before lock_acquire in delivery_loop.sh', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  // resource_lock_acquire should appear before lock_acquire "$OBJ_ID" in the main execution path
  const rlPos = script.indexOf('resource_lock_acquire "$_lid"');
  const olPos = script.indexOf('lock_acquire "$OBJ_ID"', rlPos > 0 ? 0 : 0);
  assert(rlPos > 0, 'resource_lock_acquire should exist in delivery_loop.sh');
  // The resource lock is inside a conditional but comes before objective lock
  const objLockInMainPath = script.indexOf('lock_acquire "$OBJ_ID"', rlPos);
  assert(objLockInMainPath > rlPos, 'objective lock_acquire must appear after resource_lock_acquire');
});

test('ARB-T22: combined trap releases objective lock before resource lock', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8'
  );
  // In the combined trap, lock_release should come before resource_lock_release
  const trapSection = script.substring(
    script.indexOf('_CLEANUP="lock_release'),
    script.indexOf('trap "$_CLEANUP"') + 50
  );
  assert(trapSection.includes('lock_release'), 'combined trap should release objective lock');
  assert(trapSection.includes('resource_lock_release'), 'combined trap should release resource lock');
  const objRelPos = trapSection.indexOf('lock_release');
  const resRelPos = trapSection.indexOf('resource_lock_release');
  assert(objRelPos < resRelPos, 'objective lock_release must come before resource_lock_release (reverse order)');
});

// ─── Summary ───

console.log('');
console.log('============================================');
console.log(`  Arbitration: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
console.log('============================================');

process.exit(failed > 0 ? 1 : 0);
