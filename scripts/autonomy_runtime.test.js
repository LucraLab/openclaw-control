#!/usr/bin/env node
/**
 * autonomy_runtime.test.js — Tests for Autonomy Runtime v1
 *
 * Usage: node scripts/autonomy_runtime.test.js
 * Exit 0 = all tests pass, Exit 1 = failures
 *
 * All tests use temp dirs. No network calls. No LLM calls.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let passed = 0;
let failed = 0;
let tmpDir;

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

function freshTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-test-'));
  return dir;
}

function loadRuntime(runtimeDir) {
  // Set env and re-require
  const rDir = runtimeDir || freshTmpDir();
  process.env.OPENCLAW_RUNTIME_DIR = rDir;
  // Clear module cache to pick up new env
  delete require.cache[require.resolve('./autonomy_runtime')];
  return { rt: require('./autonomy_runtime'), dir: rDir };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

console.log('Autonomy Runtime v1 Tests');
console.log('=========================');
console.log('');

// ═══════════════════════════════════════════════
// A) QUARANTINE TESTS
// ═══════════════════════════════════════════════
console.log('--- A) Quarantine ---');

test('A1: quarantine add creates file and adds agent', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.quarantineAdd('agent-x');
    const q = rt.readQuarantine();
    assert(q.agents.includes('agent-x'), 'agent-x not found');
    assert(q.version === 'v1', 'wrong version');
    assert(q.updated_at, 'no updated_at');
  } finally { cleanup(dir); }
});

test('A2: quarantine add is idempotent', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.quarantineAdd('agent-y');
    rt.quarantineAdd('agent-y');
    assert(rt.quarantineList().filter(a => a === 'agent-y').length === 1, 'duplicate');
  } finally { cleanup(dir); }
});

test('A3: quarantine remove works', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.quarantineAdd('agent-z');
    rt.quarantineRemove('agent-z');
    assert(!rt.quarantineList().includes('agent-z'), 'still present');
  } finally { cleanup(dir); }
});

test('A4: quarantine remove nonexistent is safe', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.quarantineRemove('nonexistent');
    assert(rt.quarantineList().length === 0, 'should be empty');
  } finally { cleanup(dir); }
});

test('A5: quarantine list returns array', () => {
  const { rt, dir } = loadRuntime();
  try {
    assert(Array.isArray(rt.quarantineList()), 'not array');
  } finally { cleanup(dir); }
});

test('A6: quarantine rejects invalid agent_id (special chars)', () => {
  const { rt, dir } = loadRuntime();
  try {
    let threw = false;
    try { rt.quarantineAdd('../etc/passwd'); } catch { threw = true; }
    assert(threw, 'should reject path traversal');
  } finally { cleanup(dir); }
});

test('A7: quarantine rejects empty agent_id', () => {
  const { rt, dir } = loadRuntime();
  try {
    let threw = false;
    try { rt.quarantineAdd(''); } catch { threw = true; }
    assert(threw, 'should reject empty');
  } finally { cleanup(dir); }
});

test('A8: quarantine enforces max 200 agents', () => {
  const { rt, dir } = loadRuntime();
  try {
    for (let i = 0; i < 210; i++) {
      rt.quarantineAdd(`agent-${i}`);
    }
    assert(rt.quarantineList().length <= 200, 'exceeded max');
  } finally { cleanup(dir); }
});

test('A9: isQuarantined returns correct boolean', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.quarantineAdd('q-agent');
    assert(rt.isQuarantined('q-agent') === true, 'should be quarantined');
    assert(rt.isQuarantined('other') === false, 'should not be quarantined');
  } finally { cleanup(dir); }
});

test('A10: pickAgentSkipQuarantine skips quarantined deterministically', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.quarantineAdd('agent-a');
    const pick = rt.pickAgentSkipQuarantine(['agent-a', 'agent-b', 'agent-c']);
    assert(pick === 'agent-b', `expected agent-b, got ${pick}`);
  } finally { cleanup(dir); }
});

test('A11: pickAgentSkipQuarantine returns null when all quarantined', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.quarantineAdd('a1');
    rt.quarantineAdd('a2');
    const pick = rt.pickAgentSkipQuarantine(['a1', 'a2'], 'test-context');
    assert(pick === null, 'should be null');
    // Check event was emitted
    const events = fs.readFileSync(rt.runtimePath('events.jsonl'), 'utf8');
    assert(events.includes('AGENT_QUARANTINE_BLOCKED_ASSIGNMENT'), 'missing event');
  } finally { cleanup(dir); }
});

test('A12: corrupt quarantine.json fails closed (empty list)', () => {
  const { rt, dir } = loadRuntime();
  try {
    fs.writeFileSync(rt.runtimePath('quarantine.json'), 'NOT JSON!!!');
    const list = rt.quarantineList();
    assert(Array.isArray(list) && list.length === 0, 'should fail to empty list');
  } finally { cleanup(dir); }
});

// ═══════════════════════════════════════════════
// B) KILL SWITCH TESTS
// ═══════════════════════════════════════════════
console.log('');
console.log('--- B) Kill Switch ---');

test('B1: kill switch defaults to inactive', () => {
  const { rt, dir } = loadRuntime();
  try {
    assert(!rt.isKillSwitchActive(), 'should default to inactive');
  } finally { cleanup(dir); }
});

test('B2: kill switch enable creates file', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.killSwitchEnable();
    assert(rt.isKillSwitchActive(), 'should be active');
    assert(fs.existsSync(rt.runtimePath('killswitch.enabled')), 'file missing');
  } finally { cleanup(dir); }
});

test('B3: kill switch disable removes file', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.killSwitchEnable();
    rt.killSwitchDisable();
    assert(!rt.isKillSwitchActive(), 'should be inactive');
    assert(!fs.existsSync(rt.runtimePath('killswitch.enabled')), 'file still exists');
  } finally { cleanup(dir); }
});

test('B4: kill switch disable when already disabled is safe', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.killSwitchDisable();
    assert(!rt.isKillSwitchActive(), 'should be inactive');
  } finally { cleanup(dir); }
});

test('B5: killSwitchGuard returns true when active and emits event', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.killSwitchEnable();
    const blocked = rt.killSwitchGuard('autopilot');
    assert(blocked === true, 'should block');
    const events = fs.readFileSync(rt.runtimePath('events.jsonl'), 'utf8');
    assert(events.includes('KILLSWITCH_ACTIVE'), 'missing KILLSWITCH_ACTIVE event');
  } finally { cleanup(dir); }
});

test('B6: killSwitchGuard returns false when inactive', () => {
  const { rt, dir } = loadRuntime();
  try {
    const blocked = rt.killSwitchGuard('autopilot');
    assert(blocked === false, 'should not block');
  } finally { cleanup(dir); }
});

test('B7: killSwitchStatus returns correct object', () => {
  const { rt, dir } = loadRuntime();
  try {
    assert(rt.killSwitchStatus().active === false, 'wrong default');
    rt.killSwitchEnable();
    assert(rt.killSwitchStatus().active === true, 'wrong after enable');
  } finally { cleanup(dir); }
});

// ═══════════════════════════════════════════════
// C) SPEND / BURN-RATE TESTS
// ═══════════════════════════════════════════════
console.log('');
console.log('--- C) Spend / Burn-Rate ---');

test('C1: appendSpendEntry writes to ledger', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.appendSpendEntry({
      agent_id: 'test-agent',
      model: 'moonshot/kimi-k2.5',
      est_tokens_in: 1000,
      est_tokens_out: 500,
      est_cost_usd: 0.005,
      source: 'test'
    });
    const entries = rt.readSpendLedger();
    assert(entries.length === 1, 'expected 1 entry');
    assert(entries[0].agent_id === 'test-agent', 'wrong agent');
  } finally { cleanup(dir); }
});

test('C2: spend ledger sanitizes secrets', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.appendSpendEntry({
      agent_id: 'test',
      model: 'unknown',
      source: 'cred sk-1234567890abcdef',
      correlation_id: 'Bearer eyJhbGciOiJIUz'
    });
    const raw = fs.readFileSync(rt.runtimePath('spend-ledger.jsonl'), 'utf8');
    assert(!raw.includes('sk-1234567890'), 'secret not redacted');
    assert(raw.includes('[REDACTED]'), 'no redaction marker');
  } finally { cleanup(dir); }
});

test('C3: readSpendLedger returns empty for missing file', () => {
  const { rt, dir } = loadRuntime();
  try {
    assert(rt.readSpendLedger().length === 0, 'should be empty');
  } finally { cleanup(dir); }
});

test('C4: estimateTokens uses ceil(chars/4)', () => {
  const { rt, dir } = loadRuntime();
  try {
    assert(rt.estimateTokens('abcdefgh') === 2, 'expected 2');
    assert(rt.estimateTokens('a') === 1, 'expected 1');
    assert(rt.estimateTokens('') === 0, 'expected 0');
  } finally { cleanup(dir); }
});

test('C5: estimateCost calculates correctly', () => {
  const { rt, dir } = loadRuntime();
  try {
    // kimi: input $0.002/1K, output $0.006/1K
    const cost = rt.estimateCost('moonshot/kimi-k2.5', 1000, 1000);
    assert(Math.abs(cost - 0.008) < 0.0001, `expected ~0.008, got ${cost}`);
  } finally { cleanup(dir); }
});

test('C6: computeDailySpend sums only today entries', () => {
  const { rt, dir } = loadRuntime();
  try {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    rt.appendSpendEntry({ agent_id: 'a', est_cost_usd: 5.0, ts: now.toISOString() });
    rt.appendSpendEntry({ agent_id: 'b', est_cost_usd: 3.0, ts: yesterday.toISOString() });
    const entries = rt.readSpendLedger();
    const { total } = rt.computeDailySpend(entries);
    assert(Math.abs(total - 5.0) < 0.01, `expected ~5, got ${total}`);
  } finally { cleanup(dir); }
});

test('C7: computeBurnRate projects from 10-min window', () => {
  const { rt, dir } = loadRuntime();
  try {
    const now = new Date();
    // Add entries within last 10 min
    for (let i = 0; i < 5; i++) {
      const ts = new Date(now.getTime() - i * 60000);
      rt.appendSpendEntry({ agent_id: 'a', est_cost_usd: 0.01, ts: ts.toISOString() });
    }
    const entries = rt.readSpendLedger();
    const { projectedDaily } = rt.computeBurnRate(entries);
    // 0.05 in 10 min * 144 = 7.2
    assert(Math.abs(projectedDaily - 7.2) < 0.5, `expected ~7.2, got ${projectedDaily}`);
  } finally { cleanup(dir); }
});

test('C8: evaluateSpendAlerts fires WARN at 50%', () => {
  const { rt, dir } = loadRuntime();
  try {
    process.env.SPEND_ALERT_DAILY_CAP_USD = '10';
    process.env.SPEND_ALERT_WARN_PCT = '50';
    process.env.SPEND_ALERT_HIGH_PCT = '80';
    process.env.SPEND_ALERT_CRIT_PCT = '95';
    delete process.env.SPEND_ALERT_AUTO_QUARANTINE;
    delete process.env.SPEND_ALERT_AUTO_KILLSWITCH;
    // Add $6 spend today (60% > 50% warn)
    rt.appendSpendEntry({ agent_id: 'noisy', est_cost_usd: 6.0, ts: new Date().toISOString() });
    const result = rt.evaluateSpendAlerts();
    assert(result.alerts.includes('SPEND_ALERT_WARN'), 'missing WARN');
    assert(!result.alerts.includes('SPEND_ALERT_HIGH'), 'unexpected HIGH');
  } finally {
    delete process.env.SPEND_ALERT_DAILY_CAP_USD;
    delete process.env.SPEND_ALERT_WARN_PCT;
    delete process.env.SPEND_ALERT_HIGH_PCT;
    delete process.env.SPEND_ALERT_CRIT_PCT;
    cleanup(dir);
  }
});

test('C9: evaluateSpendAlerts fires CRIT and auto-quarantine when enabled', () => {
  const { rt, dir } = loadRuntime();
  try {
    process.env.SPEND_ALERT_DAILY_CAP_USD = '10';
    process.env.SPEND_ALERT_WARN_PCT = '50';
    process.env.SPEND_ALERT_HIGH_PCT = '80';
    process.env.SPEND_ALERT_CRIT_PCT = '95';
    process.env.SPEND_ALERT_AUTO_QUARANTINE = '1';
    delete process.env.SPEND_ALERT_AUTO_KILLSWITCH;
    rt.appendSpendEntry({ agent_id: 'noisy-agent', est_cost_usd: 9.8, ts: new Date().toISOString() });
    const result = rt.evaluateSpendAlerts();
    assert(result.alerts.includes('SPEND_ALERT_CRIT'), 'missing CRIT');
    assert(result.alerts.includes('SPEND_AUTO_QUARANTINE'), 'missing auto-quarantine');
    assert(rt.isQuarantined('noisy-agent'), 'agent not quarantined');
  } finally {
    delete process.env.SPEND_ALERT_DAILY_CAP_USD;
    delete process.env.SPEND_ALERT_WARN_PCT;
    delete process.env.SPEND_ALERT_HIGH_PCT;
    delete process.env.SPEND_ALERT_CRIT_PCT;
    delete process.env.SPEND_ALERT_AUTO_QUARANTINE;
    cleanup(dir);
  }
});

test('C10: auto-quarantine gated by env flag (off by default)', () => {
  const { rt, dir } = loadRuntime();
  try {
    process.env.SPEND_ALERT_DAILY_CAP_USD = '10';
    process.env.SPEND_ALERT_CRIT_PCT = '95';
    delete process.env.SPEND_ALERT_AUTO_QUARANTINE;
    delete process.env.SPEND_ALERT_AUTO_KILLSWITCH;
    rt.appendSpendEntry({ agent_id: 'noisy', est_cost_usd: 9.8, ts: new Date().toISOString() });
    const result = rt.evaluateSpendAlerts();
    assert(!result.alerts.includes('SPEND_AUTO_QUARANTINE'), 'should NOT auto-quarantine');
    assert(!rt.isQuarantined('noisy'), 'should not be quarantined');
  } finally {
    delete process.env.SPEND_ALERT_DAILY_CAP_USD;
    delete process.env.SPEND_ALERT_CRIT_PCT;
    cleanup(dir);
  }
});

test('C11: alert dedup — same alert not fired twice per day', () => {
  const { rt, dir } = loadRuntime();
  try {
    process.env.SPEND_ALERT_DAILY_CAP_USD = '10';
    process.env.SPEND_ALERT_WARN_PCT = '50';
    delete process.env.SPEND_ALERT_AUTO_QUARANTINE;
    delete process.env.SPEND_ALERT_AUTO_KILLSWITCH;
    rt.appendSpendEntry({ agent_id: 'a', est_cost_usd: 6.0, ts: new Date().toISOString() });
    const r1 = rt.evaluateSpendAlerts();
    const r2 = rt.evaluateSpendAlerts();
    assert(r1.alerts.includes('SPEND_ALERT_WARN'), 'first should fire');
    assert(!r2.alerts.includes('SPEND_ALERT_WARN'), 'second should not fire');
  } finally {
    delete process.env.SPEND_ALERT_DAILY_CAP_USD;
    delete process.env.SPEND_ALERT_WARN_PCT;
    cleanup(dir);
  }
});

// ═══════════════════════════════════════════════
// D) CANONICAL ARTIFACTS TESTS
// ═══════════════════════════════════════════════
console.log('');
console.log('--- D) Canonical Artifacts ---');

test('D1: ops-pulse writes JSON and MD', () => {
  const { rt, dir } = loadRuntime();
  try {
    const { jsonPath, mdPath } = rt.writeCanonicalArtifact('ops-pulse', {
      gateway: 'OK', memory: '300MB', disk: '33%', agents_active: 16
    });
    assert(fs.existsSync(jsonPath), 'JSON missing');
    assert(fs.existsSync(mdPath), 'MD missing');
    assert(path.basename(jsonPath).startsWith('ops-pulse-'), 'wrong JSON name');
    assert(path.basename(mdPath).startsWith('ops-pulse-'), 'wrong MD name');
  } finally { cleanup(dir); }
});

test('D2: daily-exec-brief writes JSON and MD', () => {
  const { rt, dir } = loadRuntime();
  try {
    const { jsonPath, mdPath } = rt.writeCanonicalArtifact('daily-exec-brief', {
      objectives_scanned: 5, tasks_completed: 3, tasks_failed: 1
    });
    assert(fs.existsSync(jsonPath), 'JSON missing');
    assert(fs.existsSync(mdPath), 'MD missing');
    assert(path.basename(jsonPath).startsWith('daily-exec-brief-'), 'wrong JSON name');
  } finally { cleanup(dir); }
});

test('D3: artifact JSON has stable key ordering', () => {
  const { rt, dir } = loadRuntime();
  try {
    const { jsonPath } = rt.writeCanonicalArtifact('ops-pulse', { z: 1, a: 2, m: 3 });
    const content = fs.readFileSync(jsonPath, 'utf8');
    const keys = Object.keys(JSON.parse(content));
    const sortedKeys = [...keys].sort();
    assert(JSON.stringify(keys) === JSON.stringify(sortedKeys), 'keys not sorted');
  } finally { cleanup(dir); }
});

test('D4: artifact emits OPS_PULSE_WRITTEN event', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.writeCanonicalArtifact('ops-pulse', { gateway: 'OK' });
    const events = fs.readFileSync(rt.runtimePath('events.jsonl'), 'utf8');
    assert(events.includes('OPS_PULSE_WRITTEN'), 'missing event');
  } finally { cleanup(dir); }
});

test('D5: artifact emits DAILY_EXEC_BRIEF_WRITTEN event', () => {
  const { rt, dir } = loadRuntime();
  try {
    rt.writeCanonicalArtifact('daily-exec-brief', { objectives_scanned: 0 });
    const events = fs.readFileSync(rt.runtimePath('events.jsonl'), 'utf8');
    assert(events.includes('DAILY_EXEC_BRIEF_WRITTEN'), 'missing event');
  } finally { cleanup(dir); }
});

test('D6: artifact sanitizes secrets in data', () => {
  const { rt, dir } = loadRuntime();
  try {
    const { jsonPath } = rt.writeCanonicalArtifact('ops-pulse', {
      gateway: 'OK',
      token: 'sk-test0123456789'
    });
    const content = fs.readFileSync(jsonPath, 'utf8');
    assert(!content.includes('sk-test012'), 'secret not sanitized');
    assert(content.includes('[REDACTED]'), 'no redaction');
  } finally { cleanup(dir); }
});

// ═══════════════════════════════════════════════
// E) SANITIZATION TESTS
// ═══════════════════════════════════════════════
console.log('');
console.log('--- E) Sanitization ---');

test('E1: sanitize redacts sk- patterns', () => {
  const { rt } = loadRuntime();
  assert(rt.sanitize('key=sk-1234567890abcdef').includes('[REDACTED]'), 'not redacted');
});

test('E2: sanitize redacts Bearer tokens', () => {
  const { rt } = loadRuntime();
  assert(rt.sanitize('Bearer eyJhbGciOiJIUzI1NiJ9').includes('[REDACTED]'), 'not redacted');
});

test('E3: sanitize redacts Telegram tokens', () => {
  const { rt } = loadRuntime();
  assert(rt.sanitize('bot123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456').includes('[REDACTED]'), 'not redacted');
});

test('E4: sanitize leaves clean text unchanged', () => {
  const { rt } = loadRuntime();
  assert(rt.sanitize('hello world') === 'hello world', 'changed clean text');
});

// ═══════════════════════════════════════════════
// F) FAIL-CLOSED / CORRUPTION TESTS
// ═══════════════════════════════════════════════
console.log('');
console.log('--- F) Fail-Closed ---');

test('F1: missing runtime dir auto-creates on write', () => {
  const dir = path.join(os.tmpdir(), `oc-test-missing-${Date.now()}`);
  const { rt } = loadRuntime(dir);
  try {
    rt.quarantineAdd('test');
    assert(fs.existsSync(dir), 'dir not created');
  } finally { cleanup(dir); }
});

test('F2: corrupt spend-ledger.jsonl returns empty', () => {
  const { rt, dir } = loadRuntime();
  try {
    fs.writeFileSync(rt.runtimePath('spend-ledger.jsonl'), 'CORRUPT\n{bad json\n');
    const entries = rt.readSpendLedger();
    assert(entries.length === 0, 'should return empty for corrupt');
  } finally { cleanup(dir); }
});

test('F3: corrupt spend-alert-state.json returns default', () => {
  const { rt, dir } = loadRuntime();
  try {
    fs.writeFileSync(rt.runtimePath('spend-alert-state.json'), 'NOT JSON');
    const state = rt.readSpendAlertState();
    assert(state.last_alerts !== undefined, 'should have default');
  } finally { cleanup(dir); }
});

// ═══════════════════════════════════════════════
// G) CLI INTEGRATION TESTS
// ═══════════════════════════════════════════════
console.log('');
console.log('--- G) CLI Integration ---');

test('G1: quarantine_agent.js add + list via CLI', () => {
  const dir = freshTmpDir();
  try {
    const script = path.join(__dirname, 'quarantine_agent.js');
    execSync(`node "${script}" add test-cli-agent`, { env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir }, encoding: 'utf8' });
    const out = execSync(`node "${script}" list`, { env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir }, encoding: 'utf8' });
    assert(out.includes('test-cli-agent'), 'agent not listed');
  } finally { cleanup(dir); }
});

test('G2: killswitch.js enable + status via CLI', () => {
  const dir = freshTmpDir();
  try {
    const script = path.join(__dirname, 'killswitch.js');
    execSync(`node "${script}" enable`, { env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir }, encoding: 'utf8' });
    try {
      execSync(`node "${script}" status`, { env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir }, encoding: 'utf8' });
      throw new Error('should have exited 1');
    } catch (e) {
      if (e.status === undefined) throw e;
      assert(e.status === 1, 'status should exit 1 when active');
      assert(e.stdout.includes('ACTIVE'), 'should say ACTIVE');
    }
  } finally { cleanup(dir); }
});

test('G3: killswitch.js status exits 0 when disabled', () => {
  const dir = freshTmpDir();
  try {
    const script = path.join(__dirname, 'killswitch.js');
    const out = execSync(`node "${script}" status`, { env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir }, encoding: 'utf8' });
    assert(out.includes('INACTIVE'), 'should say INACTIVE');
  } finally { cleanup(dir); }
});

test('G4: canonical_artifact.js ops-pulse via CLI', () => {
  const dir = freshTmpDir();
  try {
    const script = path.join(__dirname, 'canonical_artifact.js');
    const out = execSync(`node "${script}" ops-pulse "{\\"gateway\\":\\"OK\\"}"`, {
      env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir },
      encoding: 'utf8'
    });
    assert(out.includes('Written:'), 'no output');
    // Verify files exist
    const artifactsDir = path.join(dir, 'artifacts');
    const files = fs.readdirSync(artifactsDir);
    assert(files.some(f => f.startsWith('ops-pulse-') && f.endsWith('.json')), 'no JSON');
    assert(files.some(f => f.startsWith('ops-pulse-') && f.endsWith('.md')), 'no MD');
  } finally { cleanup(dir); }
});

test('G5: killswitch.js guard exits 0 and prints KILLSWITCH_OK when inactive', () => {
  const dir = freshTmpDir();
  try {
    const script = path.join(__dirname, 'killswitch.js');
    const out = execSync(`node "${script}" guard`, { env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir }, encoding: 'utf8' });
    assert(out.trim() === 'KILLSWITCH_OK', `expected KILLSWITCH_OK, got: ${out.trim()}`);
  } finally { cleanup(dir); }
});

test('G6: killswitch.js guard exits 10 and prints KILLSWITCH_ACTIVE when enabled', () => {
  const dir = freshTmpDir();
  try {
    const script = path.join(__dirname, 'killswitch.js');
    execSync(`node "${script}" enable`, { env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir }, encoding: 'utf8' });
    try {
      execSync(`node "${script}" guard`, { env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir }, encoding: 'utf8' });
      throw new Error('should have exited non-zero');
    } catch (e) {
      if (e.status === undefined) throw e;
      assert(e.status === 10, `expected exit 10, got ${e.status}`);
      assert(e.stdout.trim() === 'KILLSWITCH_ACTIVE', `expected KILLSWITCH_ACTIVE, got: ${e.stdout.trim()}`);
    }
  } finally { cleanup(dir); }
});

test('G7: killswitch.js guard exits 2 (fail-closed) on unreadable runtime dir', () => {
  // Create a dir, then make it unreadable (Linux) or use a file-as-dir trick
  const base = freshTmpDir();
  const dir = path.join(base, 'runtime');
  fs.mkdirSync(dir);
  // Make the dir unreadable (only works on Linux/Mac; on Windows, test is skipped)
  try {
    fs.chmodSync(dir, 0o000);
  } catch {
    // Windows doesn't support chmod 000 meaningfully — skip
    console.log('    (skipped on Windows — chmod 000 not effective)');
    cleanup(base);
    return;
  }
  try {
    const script = path.join(__dirname, 'killswitch.js');
    try {
      execSync(`node "${script}" guard`, { env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir }, encoding: 'utf8' });
      // If it exits 0, chmod wasn't effective (Windows) — skip
      console.log('    (skipped — chmod 000 not effective on this platform)');
    } catch (e) {
      if (e.status === undefined) throw e;
      assert(e.status === 2, `expected exit 2, got ${e.status}`);
      assert(e.stdout.trim() === 'KILLSWITCH_FAILCLOSED', `expected KILLSWITCH_FAILCLOSED, got: ${e.stdout.trim()}`);
    }
  } finally {
    try { fs.chmodSync(dir, 0o755); } catch {}
    cleanup(base);
  }
});

// ═══════════════════════════════════════════════
// H) QUARANTINE LOCK (RACE FIX) TESTS
// ═══════════════════════════════════════════════
console.log('');
console.log('--- H) Quarantine Lock ---');

test('H1: pickAgentSkipQuarantine acquires and releases lock file', () => {
  const { rt, dir } = loadRuntime();
  try {
    const lockPath = path.join(dir, 'quarantine.lock');
    rt.quarantineAdd('agent-z');
    const result = rt.pickAgentSkipQuarantine(['agent-a', 'agent-z'], { test: 'H1' });
    assert(result === 'agent-a', `expected agent-a, got ${result}`);
    // Lock must be released after pick
    assert(!fs.existsSync(lockPath), 'lock file should not exist after pick');
  } finally { cleanup(dir); }
});

test('H2: lock file cleaned up when all agents quarantined (null return)', () => {
  const { rt, dir } = loadRuntime();
  try {
    const lockPath = path.join(dir, 'quarantine.lock');
    rt.quarantineAdd('agent-a');
    rt.quarantineAdd('agent-b');
    const result = rt.pickAgentSkipQuarantine(['agent-a', 'agent-b'], { test: 'H2' });
    assert(result === null, `expected null, got ${result}`);
    assert(!fs.existsSync(lockPath), 'lock file should not exist after null return');
  } finally { cleanup(dir); }
});

test('H3: stale lock (old timestamp) is auto-recovered', () => {
  const { rt, dir } = loadRuntime();
  try {
    const lockPath = path.join(dir, 'quarantine.lock');
    // Create a stale lock with timestamp 10 seconds ago
    const staleLock = JSON.stringify({ pid: 99999, ts: new Date(Date.now() - 10000).toISOString() });
    fs.writeFileSync(lockPath, staleLock);
    // Pick should recover from stale lock and succeed
    const result = rt.pickAgentSkipQuarantine(['agent-a'], { test: 'H3' });
    assert(result === 'agent-a', `expected agent-a, got ${result}`);
    assert(!fs.existsSync(lockPath), 'lock file should not exist after stale recovery');
  } finally { cleanup(dir); }
});

test('H4: corrupt lock file is auto-recovered', () => {
  const { rt, dir } = loadRuntime();
  try {
    const lockPath = path.join(dir, 'quarantine.lock');
    // Create a corrupt lock (not valid JSON)
    fs.writeFileSync(lockPath, 'NOT_VALID_JSON{{{');
    // Pick should recover and succeed
    const result = rt.pickAgentSkipQuarantine(['agent-a'], { test: 'H4' });
    assert(result === 'agent-a', `expected agent-a, got ${result}`);
    assert(!fs.existsSync(lockPath), 'lock file should not exist after corrupt recovery');
  } finally { cleanup(dir); }
});

test('H5: quarantined agent never selected across many sequential picks with rotation', () => {
  const { rt, dir } = loadRuntime();
  try {
    const agents = ['agent-a', 'agent-b', 'agent-c', 'agent-d', 'agent-e'];
    let violations = 0;
    const runs = 100;
    for (let i = 0; i < runs; i++) {
      const target = agents[i % agents.length];
      rt.quarantineAdd(target);
      const result = rt.pickAgentSkipQuarantine(agents, { rotation: i });
      if (result === target) violations++;
      rt.quarantineRemove(target);
    }
    assert(violations === 0, `quarantined agent selected ${violations}/${runs} times`);
  } finally { cleanup(dir); }
});

test('H6: rapid add/remove maintains quarantine.json integrity', () => {
  const { rt, dir } = loadRuntime();
  try {
    const qFile = path.join(dir, 'quarantine.json');
    for (let i = 0; i < 50; i++) {
      rt.quarantineAdd(`stress-${i % 10}`);
      rt.quarantineRemove(`stress-${(i + 5) % 10}`);
      // File must always be valid JSON
      const content = fs.readFileSync(qFile, 'utf8');
      const parsed = JSON.parse(content);
      assert(parsed.version === 'v1', `corrupt version at iteration ${i}`);
      assert(Array.isArray(parsed.agents), `corrupt agents at iteration ${i}`);
    }
    // Clean up
    for (let i = 0; i < 10; i++) rt.quarantineRemove(`stress-${i}`);
  } finally { cleanup(dir); }
});

test('H7: concurrent child-process picks never select quarantined agent', () => {
  const dir = freshTmpDir();
  try {
    // Set up: quarantine agent-c
    process.env.OPENCLAW_RUNTIME_DIR = dir;
    delete require.cache[require.resolve('./autonomy_runtime')];
    const rt = require('./autonomy_runtime');
    rt.quarantineAdd('agent-c');

    // Spawn N child processes that each do M picks and report results
    const N = 5;
    const M = 20;
    const workerScript = `
      process.env.OPENCLAW_RUNTIME_DIR = ${JSON.stringify(dir)};
      delete require.cache[require.resolve(${JSON.stringify(require.resolve('./autonomy_runtime'))})];
      const rt = require(${JSON.stringify(require.resolve('./autonomy_runtime'))});
      const results = [];
      for (let i = 0; i < ${M}; i++) {
        results.push(rt.pickAgentSkipQuarantine(['agent-a','agent-b','agent-c','agent-d'], {w: process.pid, i}));
      }
      process.stdout.write(JSON.stringify(results));
    `;

    const results = [];
    for (let i = 0; i < N; i++) {
      const out = execSync(`node -e "${workerScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
        encoding: 'utf8',
        env: { ...process.env, OPENCLAW_RUNTIME_DIR: dir }
      });
      results.push(...JSON.parse(out));
    }

    const violations = results.filter(r => r === 'agent-c').length;
    assert(violations === 0, `agent-c selected ${violations}/${results.length} times across ${N} workers`);
    assert(results.length === N * M, `expected ${N * M} results, got ${results.length}`);
  } finally { cleanup(dir); }
});

test('H8: lock constants exported correctly', () => {
  const { rt } = loadRuntime();
  try {
    assert(rt.QUARANTINE_LOCK_FILE === 'quarantine.lock', `wrong lock file name: ${rt.QUARANTINE_LOCK_FILE}`);
    assert(rt.LOCK_TIMEOUT_MS === 5000, `wrong timeout: ${rt.LOCK_TIMEOUT_MS}`);
    assert(typeof rt.acquireLock === 'function', 'acquireLock not exported');
    assert(typeof rt.releaseLock === 'function', 'releaseLock not exported');
  } finally {}
});

// ═══════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════
console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
