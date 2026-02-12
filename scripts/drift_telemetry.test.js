#!/usr/bin/env node
/**
 * drift_telemetry.test.js — Tests for Drift + Spend Telemetry (Port #10)
 *
 * Usage: node scripts/drift_telemetry.test.js
 * Exit 0 = all tests pass, Exit 1 = failures
 *
 * Tests: branch protection drift, workflow integrity, write-surface scan,
 *        spend telemetry parsing, artifact generation, fail-closed behavior
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'scripts', 'fixtures');
const GATE_RUNNER = path.join(REPO_ROOT, 'scripts', 'run_drift_telemetry_gate.js');

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

function runGate(extraArgs) {
  const cmd = `node "${GATE_RUNNER}" ${extraArgs || ''}`;
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    }).trim();
    return { stdout, exitCode: 0 };
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), exitCode: e.status || 1 };
  }
}

console.log('============================================');
console.log('  Drift + Spend Telemetry — Test Suite');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// ─── Section 1: Branch Protection Drift (DT-T1 to DT-T5) ───

test('DT-T1: correct branch protection contexts pass', () => {
  const fixture = path.join(FIXTURES_DIR, 'branch_protection_ok.json');
  const r = runGate(`--fixture-bp "${fixture}"`);
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
  assert(r.stdout.includes('PASS: D1_branch_protection_contexts'), 'D1 should pass');
});

test('DT-T2: missing required check fails', () => {
  const fixture = path.join(FIXTURES_DIR, 'branch_protection_missing.json');
  const r = runGate(`--fixture-bp "${fixture}"`);
  assert(r.exitCode !== 0, 'should fail with missing check');
  assert(r.stdout.includes('FAIL: D1_branch_protection_contexts'), 'D1 should fail');
  assert(r.stdout.includes('arbitration'), 'should name missing check');
});

test('DT-T3: extra unexpected check fails', () => {
  const fixture = path.join(FIXTURES_DIR, 'branch_protection_extra.json');
  const r = runGate(`--fixture-bp "${fixture}"`);
  assert(r.exitCode !== 0, 'should fail with extra check');
  assert(r.stdout.includes('FAIL: D1_branch_protection_contexts'), 'D1 should fail');
  assert(r.stdout.includes('unknown-check'), 'should name extra check');
});

test('DT-T4: empty contexts list fails', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-t4-'));
  const fixture = path.join(tmpDir, 'empty.json');
  fs.writeFileSync(fixture, JSON.stringify({
    required_status_checks: { contexts: [] }
  }));
  try {
    const r = runGate(`--fixture-bp "${fixture}"`);
    assert(r.exitCode !== 0, 'should fail with empty contexts');
    assert(r.stdout.includes('FAIL: D1_branch_protection_contexts'), 'D1 should fail');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DT-T5: contexts in different order still passes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-t5-'));
  const fixture = path.join(tmpDir, 'reordered.json');
  // Reverse alphabetical order
  fs.writeFileSync(fixture, JSON.stringify({
    required_status_checks: {
      contexts: [
        'verification-gate',
        'two-stage-pr-review',
        'scan-secrets',
        'scan-public-safe',
        'lint-markdown',
        'isolation-guard',
        'drift-telemetry',
        'context-budget',
        'capability-matrix',
        'budget-enforcement',
        'arbitration'
      ]
    }
  }));
  try {
    const r = runGate(`--fixture-bp "${fixture}"`);
    assert(r.exitCode === 0, `should pass with reordered contexts, got exit ${r.exitCode}`);
    assert(r.stdout.includes('PASS: D1_branch_protection_contexts'), 'D1 should pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 2: Workflow Integrity (DT-T6 to DT-T9) ───

test('DT-T6: all required gate workflows exist', () => {
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}"`);
  assert(r.stdout.includes('PASS: D2_required_gate_workflows_exist'), 'D2 should pass');
});

test('DT-T7: gate workflows contain correct job IDs', () => {
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}"`);
  assert(r.stdout.includes('PASS: D3_gate_workflow_job_ids'), 'D3 should pass');
});

test('DT-T8: missing gate workflow file detected', () => {
  // Create a temp copy of the repo without one workflow
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-t8-'));
  const tmpWorkflowDir = path.join(tmpDir, '.github', 'workflows');
  fs.mkdirSync(tmpWorkflowDir, { recursive: true });

  // Copy all gate workflows except one
  const srcDir = path.join(REPO_ROOT, '.github', 'workflows');
  const files = fs.readdirSync(srcDir);
  for (const f of files) {
    if (f === 'gate-arbitration.yml') continue; // skip this one
    fs.copyFileSync(path.join(srcDir, f), path.join(tmpWorkflowDir, f));
  }

  // Copy scripts and fixtures
  const tmpScriptsDir = path.join(tmpDir, 'scripts');
  fs.mkdirSync(path.join(tmpScriptsDir, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(tmpScriptsDir, 'lib'), { recursive: true });
  fs.copyFileSync(GATE_RUNNER, path.join(tmpScriptsDir, 'run_drift_telemetry_gate.js'));
  // Copy production scripts
  for (const s of ['delivery_loop.sh', 'staging_smoke.sh', 'task_pr_sync.sh', 'objective_create.sh', 'arbiter.sh']) {
    const src = path.join(REPO_ROOT, 'scripts', s);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpScriptsDir, s));
  }
  // Copy fixtures
  const fixtureFiles = fs.readdirSync(FIXTURES_DIR);
  for (const f of fixtureFiles) {
    fs.copyFileSync(path.join(FIXTURES_DIR, f), path.join(tmpScriptsDir, 'fixtures', f));
  }

  try {
    const bpFixture = path.join(tmpScriptsDir, 'fixtures', 'branch_protection_ok.json');
    const cmd = `node "${path.join(tmpScriptsDir, 'run_drift_telemetry_gate.js')}" --fixture-bp "${bpFixture}"`;
    let result;
    try {
      const stdout = execSync(cmd, {
        encoding: 'utf8', cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000
      });
      result = { stdout, exitCode: 0 };
    } catch (e) {
      result = { stdout: (e.stdout || ''), exitCode: e.status || 1 };
    }
    assert(result.exitCode !== 0, 'should fail with missing workflow');
    assert(result.stdout.includes('FAIL: D2_required_gate_workflows_exist'), 'D2 should fail');
    assert(result.stdout.includes('gate-arbitration.yml'), 'should name missing file');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DT-T9: workflow with wrong job ID detected', () => {
  // Create temp repo with a gate workflow that has wrong job ID
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-t9-'));
  const tmpWorkflowDir = path.join(tmpDir, '.github', 'workflows');
  fs.mkdirSync(tmpWorkflowDir, { recursive: true });

  // Copy all gate workflows
  const srcDir = path.join(REPO_ROOT, '.github', 'workflows');
  for (const f of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, f), path.join(tmpWorkflowDir, f));
  }

  // Overwrite one with wrong job ID
  fs.writeFileSync(path.join(tmpWorkflowDir, 'gate-arbitration.yml'),
    'name: Arbitration\non:\n  pull_request:\njobs:\n  wrong-job-name:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo test\n');

  // Copy scripts
  const tmpScriptsDir = path.join(tmpDir, 'scripts');
  fs.mkdirSync(path.join(tmpScriptsDir, 'fixtures'), { recursive: true });
  fs.copyFileSync(GATE_RUNNER, path.join(tmpScriptsDir, 'run_drift_telemetry_gate.js'));
  for (const s of ['delivery_loop.sh', 'staging_smoke.sh', 'task_pr_sync.sh', 'objective_create.sh', 'arbiter.sh']) {
    const src = path.join(REPO_ROOT, 'scripts', s);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpScriptsDir, s));
  }
  for (const f of fs.readdirSync(FIXTURES_DIR)) {
    fs.copyFileSync(path.join(FIXTURES_DIR, f), path.join(tmpScriptsDir, 'fixtures', f));
  }

  try {
    const bpFixture = path.join(tmpScriptsDir, 'fixtures', 'branch_protection_ok.json');
    const cmd = `node "${path.join(tmpScriptsDir, 'run_drift_telemetry_gate.js')}" --fixture-bp "${bpFixture}"`;
    let result;
    try {
      const stdout = execSync(cmd, {
        encoding: 'utf8', cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000
      });
      result = { stdout, exitCode: 0 };
    } catch (e) {
      result = { stdout: (e.stdout || ''), exitCode: e.status || 1 };
    }
    assert(result.exitCode !== 0, 'should fail with wrong job ID');
    assert(result.stdout.includes('FAIL: D3_gate_workflow_job_ids'), 'D3 should fail');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 3: Write-Surface Drift (DT-T10 to DT-T13) ───

test('DT-T10: production scripts pass write-surface scan', () => {
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}"`);
  assert(r.stdout.includes('PASS: D4_no_forbidden_writes'), 'D4 should pass');
});

test('DT-T11: forbidden write in fixture script detected', () => {
  // Create temp repo with a script that has a forbidden write
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-t11-'));
  const tmpWorkflowDir = path.join(tmpDir, '.github', 'workflows');
  fs.mkdirSync(tmpWorkflowDir, { recursive: true });
  const srcDir = path.join(REPO_ROOT, '.github', 'workflows');
  for (const f of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, f), path.join(tmpWorkflowDir, f));
  }

  const tmpScriptsDir = path.join(tmpDir, 'scripts');
  fs.mkdirSync(path.join(tmpScriptsDir, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(tmpScriptsDir, 'lib'), { recursive: true });
  fs.copyFileSync(GATE_RUNNER, path.join(tmpScriptsDir, 'run_drift_telemetry_gate.js'));

  // Copy real scripts but add forbidden write to delivery_loop.sh
  for (const s of ['delivery_loop.sh', 'staging_smoke.sh', 'task_pr_sync.sh', 'objective_create.sh', 'arbiter.sh']) {
    const src = path.join(REPO_ROOT, 'scripts', s);
    if (fs.existsSync(src)) {
      let content = fs.readFileSync(src, 'utf8');
      if (s === 'delivery_loop.sh') {
        content += '\necho "HACK" > /tmp/malicious_write.txt\n';
      }
      fs.writeFileSync(path.join(tmpScriptsDir, s), content);
    }
  }
  for (const f of fs.readdirSync(FIXTURES_DIR)) {
    fs.copyFileSync(path.join(FIXTURES_DIR, f), path.join(tmpScriptsDir, 'fixtures', f));
  }

  try {
    const bpFixture = path.join(tmpScriptsDir, 'fixtures', 'branch_protection_ok.json');
    const cmd = `node "${path.join(tmpScriptsDir, 'run_drift_telemetry_gate.js')}" --fixture-bp "${bpFixture}"`;
    let result;
    try {
      const stdout = execSync(cmd, {
        encoding: 'utf8', cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000
      });
      result = { stdout, exitCode: 0 };
    } catch (e) {
      result = { stdout: (e.stdout || ''), exitCode: e.status || 1 };
    }
    assert(result.exitCode !== 0, 'should fail with forbidden write');
    assert(result.stdout.includes('FAIL: D4_no_forbidden_writes'), 'D4 should fail');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DT-T12: approved write patterns are not flagged', () => {
  // The real scripts use approved patterns (echo > $TMP_FILE, echo > $OUTPUT_PATH)
  // This is already covered by DT-T10 passing, but let's verify explicitly
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}"`);
  assert(r.stdout.includes('PASS: D4_no_forbidden_writes'),
    'Approved writes should not be flagged');
});

test('DT-T13: no cron drift when no cron files present', () => {
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}"`);
  assert(r.stdout.includes('PASS: D5_no_cron_drift'), 'D5 should pass (no cron present)');
});

// ─── Section 4: Spend Telemetry Parsing (DT-T14 to DT-T18) ───

test('DT-T14: budget breaches counted from sample events', () => {
  const fixture = path.join(FIXTURES_DIR, 'sample_events.jsonl');
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}" --fixture-events "${fixture}"`);
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
  assert(r.stdout.includes('breaches=2'), 'should count 2 budget breaches');
  assert(r.stdout.includes('near=1'), 'should count 1 near-breach');
});

test('DT-T15: model escalation attempts/blocks counted', () => {
  const fixture = path.join(FIXTURES_DIR, 'sample_events.jsonl');
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}" --fixture-events "${fixture}"`);
  assert(r.stdout.includes('attempts=1'), 'should count 1 escalation attempt');
  assert(r.stdout.includes('blocks=1'), 'should count 1 escalation block');
});

test('DT-T16: arbitration blocks counted', () => {
  const fixture = path.join(FIXTURES_DIR, 'sample_events.jsonl');
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}" --fixture-events "${fixture}"`);
  // S3 check
  assert(r.stdout.includes('blocks=3'), 'should count 3 arbitration blocks');
});

test('DT-T17: objective failures and retries counted', () => {
  const fixture = path.join(FIXTURES_DIR, 'sample_events.jsonl');
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}" --fixture-events "${fixture}"`);
  assert(r.stdout.includes('failures=3'), 'should count 3 objective failures');
  assert(r.stdout.includes('retries=2'), 'should count 2 retries');
});

test('DT-T18: top failing objectives identified', () => {
  const fixture = path.join(FIXTURES_DIR, 'sample_events.jsonl');
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}" --fixture-events "${fixture}"`);
  assert(r.stdout.includes('obj-42(2)'), 'obj-42 should have 2 failures');
});

// ─── Section 5: Empty/Missing Events (DT-T19 to DT-T20) ───

test('DT-T19: empty events file produces zero metrics', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-t19-'));
  const emptyEvents = path.join(tmpDir, 'empty.jsonl');
  fs.writeFileSync(emptyEvents, '');
  try {
    const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}" --fixture-events "${emptyEvents}"`);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
    assert(r.stdout.includes('breaches=0'), 'should have 0 breaches');
    assert(r.stdout.includes('failures=0'), 'should have 0 failures');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DT-T20: malformed JSONL lines are skipped gracefully', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-t20-'));
  const badEvents = path.join(tmpDir, 'bad.jsonl');
  fs.writeFileSync(badEvents, [
    'not-valid-json',
    '{"event":"BUDGET_BREACH","agent_id":"builder","obj_id":"obj-1"}',
    '{broken',
    '{"event":"DELIVERY_FAILED","agent_id":"builder","obj_id":"obj-2"}',
    ''
  ].join('\n'));
  try {
    const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}" --fixture-events "${badEvents}"`);
    assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
    assert(r.stdout.includes('breaches=1'), 'should count 1 valid breach');
    assert(r.stdout.includes('failures=1'), 'should count 1 valid failure');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Section 6: Artifact Generation (DT-T21 to DT-T23) ───

test('DT-T21: artifacts directory created with JSON report', () => {
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}"`);
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
  const jsonReport = path.join(REPO_ROOT, 'artifacts', 'drift-telemetry-report.json');
  assert(fs.existsSync(jsonReport), 'JSON report should exist');
  const report = JSON.parse(fs.readFileSync(jsonReport, 'utf8'));
  assert(report.gate === 'drift-telemetry', `expected gate=drift-telemetry, got ${report.gate}`);
  assert(report.status === 'PASS', `expected status=PASS, got ${report.status}`);
  assert(typeof report.telemetry === 'object', 'should contain telemetry object');
});

test('DT-T22: artifacts directory contains markdown report', () => {
  const mdReport = path.join(REPO_ROOT, 'artifacts', 'drift-telemetry-report.md');
  assert(fs.existsSync(mdReport), 'Markdown report should exist');
  const content = fs.readFileSync(mdReport, 'utf8');
  assert(content.includes('Drift + Spend Telemetry'), 'should contain title');
  assert(content.includes('Drift Checks'), 'should contain drift section');
  assert(content.includes('Spend Telemetry'), 'should contain telemetry section');
});

test('DT-T23: JSON report contains drift and telemetry sections', () => {
  const jsonReport = path.join(REPO_ROOT, 'artifacts', 'drift-telemetry-report.json');
  const report = JSON.parse(fs.readFileSync(jsonReport, 'utf8'));
  assert(report.drift, 'report should contain drift section');
  assert(report.drift.branch_protection, 'drift should contain branch_protection');
  assert(report.drift.workflows, 'drift should contain workflows');
  assert(report.drift.write_surface, 'drift should contain write_surface');
  assert(report.telemetry, 'report should contain telemetry section');
  assert(typeof report.telemetry.budget_breaches === 'number', 'telemetry should contain budget_breaches');
  assert(typeof report.telemetry.arbitration_blocks === 'number', 'telemetry should contain arbitration_blocks');
});

// ─── Section 7: Gate Overall Behavior (DT-T24 to DT-T25) ───

test('DT-T24: gate passes with all correct inputs', () => {
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_ok.json')}" --fixture-events "${path.join(FIXTURES_DIR, 'sample_events.jsonl')}"`);
  assert(r.exitCode === 0, `gate should pass, got exit ${r.exitCode}`);
  assert(r.stdout.includes('PASS'), 'should contain PASS');
});

test('DT-T25: gate fails closed on any drift check failure', () => {
  const r = runGate(`--fixture-bp "${path.join(FIXTURES_DIR, 'branch_protection_missing.json')}"`);
  assert(r.exitCode !== 0, 'gate should fail with drift');
  assert(r.stdout.includes('FAIL'), 'should contain FAIL');
});

// ─── Report ───

console.log('');
console.log('============================================');
console.log(`  Drift Telemetry: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
console.log('============================================');

process.exit(failed > 0 ? 1 : 0);
