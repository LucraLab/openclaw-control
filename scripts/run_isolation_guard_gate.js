#!/usr/bin/env node
/**
 * run_isolation_guard_gate.js — CI gate for environment isolation enforcement
 *
 * Usage: node scripts/run_isolation_guard_gate.js [--ci]
 *
 * Smoke checks:
 *   1. oc_paths.sh exists and is sourceable
 *   2. oc_events.sh exists and is sourceable
 *   3. oc_atomic_json.py runs help
 *   4. valid agent IDs accepted
 *   5. invalid agent ID rejected
 *   6. obj_id validation works
 *   7. path traversal blocked
 *   8. atomic json write + root check
 *   9. emit_event produces valid JSONL
 *  10. no inline emit_event in modified scripts
 *  11. scripts source lib files
 *  12. oc_agent_root resolves correctly
 *  13. oc_require_agent_id enforced
 *  14. oc_migrate_legacy_file works
 *  15. no legacy path writes in production scripts
 *  16. all scripts use agent-scoped paths
 *
 * Exit 0 = gate pass, Exit 1 = gate fail
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const LIB_DIR = path.join(REPO_ROOT, 'scripts', 'lib');
const isCI = process.argv.includes('--ci');

let passed = 0;
let failed = 0;
const findings = [];

function check(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
    findings.push({ check: name, status: 'PASS' });
  } catch (e) {
    console.log(`  FAIL: ${name} — ${e.message}`);
    failed++;
    findings.push({ check: name, status: 'FAIL', detail: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function bash(snippet) {
  try {
    const stdout = execSync(`bash -c '${snippet}'`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000
    }).trim();
    return { stdout, exitCode: 0 };
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), exitCode: e.status || 1 };
  }
}

console.log('============================================');
console.log('  Isolation Guard — Gate Runner');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// --- Smoke checks (1-12: existing from Port #6) ---

check('oc_paths_exists', () => {
  assert(fs.existsSync(path.join(LIB_DIR, 'oc_paths.sh')), 'oc_paths.sh missing');
  const r = bash(`source "${LIB_DIR}/oc_paths.sh" && echo ok`);
  assert(r.exitCode === 0 && r.stdout === 'ok', 'oc_paths.sh not sourceable');
});

check('oc_events_exists', () => {
  assert(fs.existsSync(path.join(LIB_DIR, 'oc_events.sh')), 'oc_events.sh missing');
  const r = bash(`source "${LIB_DIR}/oc_events.sh" && echo ok`);
  assert(r.exitCode === 0 && r.stdout === 'ok', 'oc_events.sh not sourceable');
});

check('oc_atomic_json_runs', () => {
  assert(fs.existsSync(path.join(LIB_DIR, 'oc_atomic_json.py')), 'oc_atomic_json.py missing');
  const r = bash(`python3 "${LIB_DIR}/oc_atomic_json.py" --help 2>&1 | head -1`);
  assert(r.exitCode === 0, `oc_atomic_json.py --help failed: exit ${r.exitCode}`);
});

check('valid_agent_ids_accepted', () => {
  for (const id of ['builder', 'executor', 'auditor']) {
    const r = bash(`source "${LIB_DIR}/oc_paths.sh" && oc_validate_agent_id ${id}`);
    assert(r.exitCode === 0, `${id} should be accepted`);
  }
});

check('invalid_agent_id_rejected', () => {
  const r = bash(`source "${LIB_DIR}/oc_paths.sh" && oc_validate_agent_id hacker`);
  assert(r.exitCode !== 0, 'hacker should be rejected');
});

check('obj_id_validation', () => {
  const good = bash(`source "${LIB_DIR}/oc_paths.sh" && oc_validate_obj_id obj-test-123`);
  assert(good.exitCode === 0, 'valid obj_id rejected');
  const bad = bash(`source "${LIB_DIR}/oc_paths.sh" && oc_validate_obj_id '../escape'`);
  assert(bad.exitCode !== 0, 'traversal obj_id accepted');
});

check('path_traversal_blocked', () => {
  const r = bash(`source "${LIB_DIR}/oc_paths.sh" && oc_safe_path /tmp/root '../escape'`);
  assert(r.exitCode !== 0, 'traversal path should be blocked');
});

check('atomic_json_write_and_root', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-gate-'));
  try {
    // Good write
    execSync(
      `echo '{"gate":"test"}' | python3 "${LIB_DIR}/oc_atomic_json.py" "${tmpDir}/ok.json" --root "${tmpDir}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    assert(fs.existsSync(path.join(tmpDir, 'ok.json')), 'ok.json should exist');

    // Bad write (escape root)
    try {
      execSync(
        `echo '{"bad":true}' | python3 "${LIB_DIR}/oc_atomic_json.py" "/tmp/ig-escape.json" --root "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
      assert(false, 'escape should fail');
    } catch (e) {
      assert(e.status === 1, `expected exit 1, got ${e.status}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

check('emit_event_valid_jsonl', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-gate-evt-'));
  const logsDir = path.join(tmpDir, '_logs');
  fs.mkdirSync(logsDir, { recursive: true });
  try {
    const cmd = `DELIVERY_OS_HOME="${tmpDir}" OBJ_ID=obj-gate OC_AGENT_ID=builder bash -c 'source "${LIB_DIR}/oc_events.sh" && emit_event GATE_TEST "k=v"'`;
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const log = fs.readFileSync(path.join(logsDir, 'agent-events.jsonl'), 'utf8').trim();
    const evt = JSON.parse(log);
    assert(evt.event === 'GATE_TEST', `expected GATE_TEST, got ${evt.event}`);
    assert(evt.agent_id === 'builder', `expected builder, got ${evt.agent_id}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

check('no_inline_emit_event', () => {
  const scripts = [
    'delivery_loop.sh',
    'staging_smoke.sh',
    'task_pr_sync.sh'
  ];
  for (const s of scripts) {
    const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', s), 'utf8');
    const inlineDef = content.match(/^emit_event\s*\(\s*\)\s*\{/m);
    assert(!inlineDef, `${s} still has inline emit_event() definition`);
  }
});

check('scripts_source_libs', () => {
  const scripts = [
    'delivery_loop.sh',
    'objective_create.sh',
    'staging_smoke.sh',
    'task_pr_sync.sh'
  ];
  for (const s of scripts) {
    const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', s), 'utf8');
    assert(content.includes('lib/oc_events.sh'), `${s} must source oc_events.sh`);
    assert(content.includes('lib/oc_paths.sh'), `${s} must source oc_paths.sh`);
  }
});

check('oc_agent_root_resolves', () => {
  const r = bash(
    `source "${LIB_DIR}/oc_paths.sh" && DELIVERY_OS_HOME=/tmp/doh oc_agent_root executor`
  );
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
  assert(r.stdout === '/tmp/doh/agents/executor', `expected /tmp/doh/agents/executor, got ${r.stdout}`);
});

// --- Smoke checks 13-16: Port #7 additions ---

check('oc_require_agent_id_enforced', () => {
  // Valid
  const good = bash(`source "${LIB_DIR}/oc_paths.sh" && OC_AGENT_ID=builder oc_require_agent_id`);
  assert(good.exitCode === 0, 'valid agent should pass');
  // Missing
  const bad = bash(`source "${LIB_DIR}/oc_paths.sh" && unset OC_AGENT_ID && oc_require_agent_id`);
  assert(bad.exitCode !== 0, 'missing agent should fail');
});

check('oc_migrate_legacy_file_works', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-gate-mig-'));
  const legacy = path.join(tmpDir, 'leg.json');
  const target = path.join(tmpDir, 'agt', 'tgt.json');
  fs.writeFileSync(legacy, '{"gate":"migrate"}');
  try {
    const r = bash(`source "${LIB_DIR}/oc_paths.sh" && oc_migrate_legacy_file "${legacy}" "${target}"`);
    assert(r.exitCode === 0, `migration should succeed, got exit ${r.exitCode}`);
    assert(!fs.existsSync(legacy), 'legacy should be gone');
    assert(fs.existsSync(target), 'target should exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

check('no_legacy_path_writes', () => {
  const scripts = [
    'delivery_loop.sh',
    'objective_create.sh',
    'staging_smoke.sh',
    'task_pr_sync.sh'
  ];
  for (const s of scripts) {
    const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', s), 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('#')) continue;
      if (line.includes('_LEGACY_')) continue;
      if (/^OBJECTIVES_DIR=.*\$DELIVERY_OS_HOME\/objectives/.test(line.trim())) {
        throw new Error(`${s}:${i + 1} has legacy OBJECTIVES_DIR`);
      }
      if (/^WORK_DIR=.*\$\{?DELIVERY_OS_HOME\}?\/workspaces/.test(line.trim())) {
        throw new Error(`${s}:${i + 1} has legacy WORK_DIR`);
      }
    }
  }
});

check('all_scripts_use_agent_scoped_paths', () => {
  const scripts = [
    'delivery_loop.sh',
    'objective_create.sh',
    'staging_smoke.sh'
  ];
  for (const s of scripts) {
    const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', s), 'utf8');
    assert(
      content.includes('oc_require_agent_id'),
      `${s} must call oc_require_agent_id`
    );
    assert(
      content.includes('OC_AGENT_ROOT'),
      `${s} must use OC_AGENT_ROOT`
    );
  }
  // task_pr_sync.sh requires agent_id but doesn't own path writes
  const tps = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'task_pr_sync.sh'), 'utf8');
  assert(tps.includes('oc_require_agent_id'), 'task_pr_sync.sh must call oc_require_agent_id');
});

// --- Report ---
console.log('');
console.log('============================================');
console.log(`  Gate: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
console.log('============================================');

// Write reports
const reportDir = path.join(REPO_ROOT, 'tmp');
fs.mkdirSync(reportDir, { recursive: true });

const commitSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: REPO_ROOT }).trim();
  } catch (_) { return 'unknown'; }
})();

const report = {
  gate: 'isolation-guard',
  status: failed === 0 ? 'PASS' : 'FAIL',
  checks_passed: passed,
  checks_total: passed + failed,
  commit_sha: commitSha,
  timestamp: new Date().toISOString(),
  findings
};

fs.writeFileSync(
  path.join(reportDir, 'isolation-guard-report.json'),
  JSON.stringify(report, null, 2) + '\n'
);

const mdLines = [
  '# Isolation Guard — Gate Report',
  '',
  `**Status:** ${report.status}`,
  `**Checks:** ${passed}/${passed + failed}`,
  `**Commit:** ${commitSha}`,
  `**Time:** ${report.timestamp}`,
  '',
  '| Check | Result |',
  '|-------|--------|',
  ...findings.map(f => `| ${f.check} | ${f.status}${f.detail ? ` — ${f.detail}` : ''} |`),
  ''
];

fs.writeFileSync(
  path.join(reportDir, 'isolation-guard-report.md'),
  mdLines.join('\n')
);

console.log('');
console.log(`Reports: tmp/isolation-guard-report.{json,md}`);

process.exit(failed > 0 ? 1 : 0);
