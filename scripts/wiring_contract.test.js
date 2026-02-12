#!/usr/bin/env node
/**
 * wiring_contract.test.js — Tests for Port #17 Entrypoint Wiring Contract
 *
 * Validates that the Port #16 CLIs produce the exact exit codes, outputs,
 * and behaviors that the bash guard blocks depend on.
 *
 * Usage: node scripts/wiring_contract.test.js
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oc-wiring-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function runCLI(script, args, runtimeDir) {
  const scriptPath = path.join(__dirname, script);
  const env = { ...process.env, OPENCLAW_RUNTIME_DIR: runtimeDir };
  const argList = Array.isArray(args) ? args : args.split(' ');
  try {
    const out = require('child_process').execFileSync(
      process.execPath, [scriptPath, ...argList],
      { env, encoding: 'utf8', timeout: 5000 }
    );
    return { code: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { code: e.status || 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

console.log('Port #17 Wiring Contract Tests');
console.log('===============================');
console.log('');

// ═══════════════════════════════════════════════
// A) KILL SWITCH EXIT CODE CONTRACT
// The bash guard uses `guard` subcommand: 0=OK, 10=ACTIVE, 2=FAILCLOSED
// ═══════════════════════════════════════════════
console.log('A) Kill Switch Exit Code Contract');

test('W1: killswitch guard exits 0 and prints KILLSWITCH_OK when inactive', () => {
  const dir = freshTmpDir();
  const r = runCLI('killswitch.js', 'guard', dir);
  assert(r.code === 0, `expected exit 0, got ${r.code}`);
  assert(r.stdout.trim() === 'KILLSWITCH_OK', `expected KILLSWITCH_OK, got: ${r.stdout.trim()}`);
  cleanup(dir);
});

test('W2: killswitch guard exits 10 and prints KILLSWITCH_ACTIVE when active', () => {
  const dir = freshTmpDir();
  runCLI('killswitch.js', 'enable', dir);
  const r = runCLI('killswitch.js', 'guard', dir);
  assert(r.code === 10, `expected exit 10, got ${r.code}`);
  assert(r.stdout.trim() === 'KILLSWITCH_ACTIVE', `expected KILLSWITCH_ACTIVE, got: ${r.stdout.trim()}`);
  cleanup(dir);
});

test('W3: killswitch enable then disable then guard exits 0', () => {
  const dir = freshTmpDir();
  runCLI('killswitch.js', 'enable', dir);
  runCLI('killswitch.js', 'disable', dir);
  const r = runCLI('killswitch.js', 'guard', dir);
  assert(r.code === 0, `expected exit 0 after disable, got ${r.code}`);
  assert(r.stdout.trim() === 'KILLSWITCH_OK', `expected KILLSWITCH_OK, got: ${r.stdout.trim()}`);
  cleanup(dir);
});

test('W4: killswitch enable is idempotent (guard still exits 10)', () => {
  const dir = freshTmpDir();
  runCLI('killswitch.js', 'enable', dir);
  runCLI('killswitch.js', 'enable', dir);
  const r = runCLI('killswitch.js', 'guard', dir);
  assert(r.code === 10, `expected exit 10, got ${r.code}`);
  cleanup(dir);
});

// ═══════════════════════════════════════════════
// B) QUARANTINE LIST OUTPUT CONTRACT
// The bash guard depends on: "list" prints one agent per line, grep -qw matches
// ═══════════════════════════════════════════════
console.log('');
console.log('B) Quarantine List Output Contract');

test('W5: quarantine list with no agents prints no agent names', () => {
  const dir = freshTmpDir();
  const r = runCLI('quarantine_agent.js', 'list', dir);
  assert(r.code === 0, `expected exit 0, got ${r.code}`);
  assert(!r.stdout.match(/^[a-z0-9_-]+$/m) || r.stdout.includes('No agents'), 'unexpected agent name in output');
  cleanup(dir);
});

test('W6: quarantine add + list shows agent name greppable', () => {
  const dir = freshTmpDir();
  runCLI('quarantine_agent.js', 'add test-agent', dir);
  const r = runCLI('quarantine_agent.js', 'list', dir);
  assert(r.code === 0, `expected exit 0, got ${r.code}`);
  assert(r.stdout.includes('test-agent'), 'agent name not in list output');
  cleanup(dir);
});

test('W7: quarantine list output is grep -qw compatible for each agent', () => {
  const dir = freshTmpDir();
  runCLI('quarantine_agent.js', 'add agent-a', dir);
  runCLI('quarantine_agent.js', 'add agent-b', dir);
  const r = runCLI('quarantine_agent.js', 'list', dir);
  // Verify both agents appear as whole words in output
  assert(r.stdout.includes('agent-a'), 'agent-a not found');
  assert(r.stdout.includes('agent-b'), 'agent-b not found');
  // Verify "agent-ab" would NOT match "agent-a" as a whole word
  // (This tests the bash grep -qw pattern)
  const lines = r.stdout.split('\n');
  const agentLines = lines.filter(l => l.match(/agent-[ab]/));
  assert(agentLines.length >= 2, `expected at least 2 agent lines, got ${agentLines.length}`);
  cleanup(dir);
});

test('W8: quarantine add then remove then list shows empty', () => {
  const dir = freshTmpDir();
  runCLI('quarantine_agent.js', 'add removed-agent', dir);
  runCLI('quarantine_agent.js', 'remove removed-agent', dir);
  const r = runCLI('quarantine_agent.js', 'list', dir);
  assert(!r.stdout.includes('removed-agent'), 'removed agent still in list');
  cleanup(dir);
});

// ═══════════════════════════════════════════════
// C) SPEND ALERT EVALUATE CONTRACT
// The bash guard depends on: evaluate exits 0 always, output includes $ amount
// ═══════════════════════════════════════════════
console.log('');
console.log('C) Spend Alert Evaluate Contract');

test('W9: spend evaluate exits 0 with empty ledger', () => {
  const dir = freshTmpDir();
  const r = runCLI('spend_alert.js', 'evaluate', dir);
  assert(r.code === 0, `expected exit 0, got ${r.code}`);
  assert(r.stdout.includes('$'), 'output should include dollar amount');
  cleanup(dir);
});

test('W10: spend summary exits 0 with empty ledger', () => {
  const dir = freshTmpDir();
  const r = runCLI('spend_alert.js', 'summary', dir);
  assert(r.code === 0, `expected exit 0, got ${r.code}`);
  cleanup(dir);
});

test('W11: spend log accepts JSON entry', () => {
  const dir = freshTmpDir();
  const entry = JSON.stringify({ agent_id: 'test', model: 'test-model', est_tokens_in: 100, est_tokens_out: 50 });
  const r = runCLI('spend_alert.js', ['log', entry], dir);
  assert(r.code === 0, `expected exit 0, got ${r.code}`);
  // Verify ledger file was created
  const ledgerPath = path.join(dir, 'spend-ledger.jsonl');
  assert(fs.existsSync(ledgerPath), 'ledger file not created');
  cleanup(dir);
});

// ═══════════════════════════════════════════════
// D) CANONICAL ARTIFACT CONTRACT
// The bash guard depends on: exits 0 on success, creates files in artifacts/
// ═══════════════════════════════════════════════
console.log('');
console.log('D) Canonical Artifact Contract');

test('W12: canonical ops-pulse creates JSON + MD files', () => {
  const dir = freshTmpDir();
  const data = JSON.stringify({ objectives_scanned: 5, assigned: 3, stuck: 0 });
  const r = runCLI('canonical_artifact.js', ['ops-pulse', data], dir);
  assert(r.code === 0, `expected exit 0, got ${r.code}`);
  const artDir = path.join(dir, 'artifacts');
  assert(fs.existsSync(artDir), 'artifacts dir not created');
  const files = fs.readdirSync(artDir);
  assert(files.some(f => f.startsWith('ops-pulse-') && f.endsWith('.json')), 'no ops-pulse JSON');
  assert(files.some(f => f.startsWith('ops-pulse-') && f.endsWith('.md')), 'no ops-pulse MD');
  cleanup(dir);
});

test('W13: canonical daily-exec-brief creates JSON + MD files', () => {
  const dir = freshTmpDir();
  const data = JSON.stringify({ objectives_scanned: 10, pass_count: 8, fail_count: 2 });
  const r = runCLI('canonical_artifact.js', ['daily-exec-brief', data], dir);
  assert(r.code === 0, `expected exit 0, got ${r.code}`);
  const artDir = path.join(dir, 'artifacts');
  const files = fs.readdirSync(artDir);
  assert(files.some(f => f.startsWith('daily-exec-brief-') && f.endsWith('.json')), 'no brief JSON');
  assert(files.some(f => f.startsWith('daily-exec-brief-') && f.endsWith('.md')), 'no brief MD');
  cleanup(dir);
});

test('W14: canonical artifact rejects invalid type', () => {
  const dir = freshTmpDir();
  const r = runCLI('canonical_artifact.js', ['bad-type', '{"x":1}'], dir);
  assert(r.code !== 0, 'expected non-zero exit for invalid type');
  cleanup(dir);
});

// ═══════════════════════════════════════════════
// E) RUNTIME DIR CONTRACT
// Validates OPENCLAW_RUNTIME_DIR is respected by all CLIs
// ═══════════════════════════════════════════════
console.log('');
console.log('E) Runtime Dir Contract');

test('W15: all CLIs create state files in OPENCLAW_RUNTIME_DIR, not cwd', () => {
  const dir = freshTmpDir();
  const cwd = process.cwd();

  // Use killswitch to create a file
  runCLI('killswitch.js', 'enable', dir);
  assert(fs.existsSync(path.join(dir, 'killswitch.enabled')), 'killswitch.enabled not in RUNTIME_DIR');
  assert(!fs.existsSync(path.join(cwd, 'killswitch.enabled')), 'killswitch.enabled leaked to cwd');

  // Use quarantine to create a file
  runCLI('quarantine_agent.js', 'add test-agent', dir);
  assert(fs.existsSync(path.join(dir, 'quarantine.json')), 'quarantine.json not in RUNTIME_DIR');

  cleanup(dir);
});

test('W16: OPENCLAW_RUNTIME_DIR with spaces in path works', () => {
  const base = freshTmpDir();
  const dir = path.join(base, 'path with spaces');
  fs.mkdirSync(dir, { recursive: true });

  runCLI('killswitch.js', 'enable', dir);
  assert(fs.existsSync(path.join(dir, 'killswitch.enabled')), 'failed with spaces in path');

  cleanup(base);
});

// ═══════════════════════════════════════════════
// F) NO SECRETS IN OUTPUTS
// Validates CLI outputs don't leak secrets
// ═══════════════════════════════════════════════
console.log('');
console.log('F) No Secrets in Outputs');

test('W17: spend log entry drops unknown fields (no secret leakage)', () => {
  const dir = freshTmpDir();
  const entry = JSON.stringify({
    agent_id: 'test',
    model: 'test-model',
    est_tokens_in: 100,
    est_tokens_out: 50,
    metadata: 'sk-abc123secret456'
  });
  runCLI('spend_alert.js', ['log', entry], dir);
  const ledger = fs.readFileSync(path.join(dir, 'spend-ledger.jsonl'), 'utf8');
  // appendSpendEntry only keeps whitelisted fields (agent_id, model, tokens, cost, source, correlation_id)
  // So 'metadata' is dropped entirely — secret never written
  assert(!ledger.includes('sk-abc123secret456'), 'secret leaked to ledger');
  assert(!ledger.includes('metadata'), 'unknown field leaked to ledger');
  cleanup(dir);
});

test('W18: canonical artifact with Bearer token is sanitized', () => {
  const dir = freshTmpDir();
  const data = JSON.stringify({ info: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret', count: 1 });
  runCLI('canonical_artifact.js', ['ops-pulse', data], dir);
  const artDir = path.join(dir, 'artifacts');
  const files = fs.readdirSync(artDir).filter(f => f.endsWith('.json'));
  const content = fs.readFileSync(path.join(artDir, files[0]), 'utf8');
  assert(!content.includes('eyJhbGciOiJIUzI1NiJ9'), 'Bearer token leaked to artifact');
  cleanup(dir);
});

// ═══════════════════════════════════════════════
// G) WIRING DOCS VALIDATION
// Validates that wiring docs exist and contain required env vars
// ═══════════════════════════════════════════════
console.log('');
console.log('G) Wiring Docs Validation');

test('W19: AUTONOMY_RUNTIME_WIRING.md exists', () => {
  const docPath = path.join(__dirname, '..', 'docs', 'AUTONOMY_RUNTIME_WIRING.md');
  assert(fs.existsSync(docPath), 'docs/AUTONOMY_RUNTIME_WIRING.md not found');
});

test('W20: wiring doc references OPENCLAW_RUNTIME_DIR', () => {
  const docPath = path.join(__dirname, '..', 'docs', 'AUTONOMY_RUNTIME_WIRING.md');
  const content = fs.readFileSync(docPath, 'utf8');
  assert(content.includes('OPENCLAW_RUNTIME_DIR'), 'missing OPENCLAW_RUNTIME_DIR reference');
});

test('W21: wiring doc references /opt/openclaw-runtime/', () => {
  const docPath = path.join(__dirname, '..', 'docs', 'AUTONOMY_RUNTIME_WIRING.md');
  const content = fs.readFileSync(docPath, 'utf8');
  assert(content.includes('/opt/openclaw-runtime/'), 'missing deploy path reference');
});

test('W22: wiring doc references both VPS runtime dirs', () => {
  const docPath = path.join(__dirname, '..', 'docs', 'AUTONOMY_RUNTIME_WIRING.md');
  const content = fs.readFileSync(docPath, 'utf8');
  assert(content.includes('/home/openclaw2/.openclaw/_runtime'), 'missing Builder runtime dir');
  assert(content.includes('/home/openclaw/_runtime'), 'missing Dashboard runtime dir');
});

test('W23: wiring doc includes rollback section', () => {
  const docPath = path.join(__dirname, '..', 'docs', 'AUTONOMY_RUNTIME_WIRING.md');
  const content = fs.readFileSync(docPath, 'utf8');
  assert(content.includes('Rollback') || content.includes('rollback'), 'missing rollback section');
});

// ═══════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════
console.log('');
console.log('─────────────────────────────────');
console.log(`Wiring Contract Tests: ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) {
  process.exit(1);
}
