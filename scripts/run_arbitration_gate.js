#!/usr/bin/env node
/**
 * run_arbitration_gate.js — CI gate for Objective Arbitration (Port #9)
 *
 * Usage: node scripts/run_arbitration_gate.js [--ci]
 *
 * Smoke checks:
 *   1. oc_resource_lock.sh exists and is sourceable
 *   2. arbiter.sh exists and is executable
 *   3. delivery_loop.sh sources oc_resource_lock.sh
 *   4. delivery_loop.sh accepts --run-token argument
 *   5. resource_lock_acquire uses shared _locks dir
 *   6. arbiter.sh sources oc_resource_lock.sh
 *   7. arbiter.sh emits ARBITRATION_SELECTED event
 *   8. arbiter.sh emits ARBITRATION_SKIPPED event
 *   9. resource_lock_release checks PID ownership
 *  10. lock ordering: resource_lock_acquire before lock_acquire
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
console.log('  Arbitration — Gate Runner');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// --- Smoke check 1: oc_resource_lock.sh exists and is sourceable ---

check('oc_resource_lock_exists', () => {
  assert(fs.existsSync(path.join(LIB_DIR, 'oc_resource_lock.sh')), 'oc_resource_lock.sh missing');
  const r = bash(`source "${LIB_DIR}/oc_paths.sh" && source "${LIB_DIR}/oc_events.sh" && source "${LIB_DIR}/oc_resource_lock.sh" && echo ok`);
  assert(r.exitCode === 0 && r.stdout === 'ok', 'oc_resource_lock.sh not sourceable');
});

// --- Smoke check 2: arbiter.sh exists ---

check('arbiter_exists', () => {
  const arbiterPath = path.join(REPO_ROOT, 'scripts', 'arbiter.sh');
  assert(fs.existsSync(arbiterPath), 'arbiter.sh missing');
  const content = fs.readFileSync(arbiterPath, 'utf8');
  assert(content.startsWith('#!/usr/bin/env bash'), 'arbiter.sh missing shebang');
});

// --- Smoke check 3: delivery_loop.sh sources oc_resource_lock.sh ---

check('delivery_loop_sources_resource_lock', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8');
  assert(content.includes('lib/oc_resource_lock.sh'), 'delivery_loop.sh must source oc_resource_lock.sh');
});

// --- Smoke check 4: delivery_loop.sh accepts --run-token ---

check('delivery_loop_accepts_run_token', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8');
  assert(content.includes('--run-token'), 'delivery_loop.sh must accept --run-token argument');
  assert(content.includes('RUN_TOKEN'), 'delivery_loop.sh must reference RUN_TOKEN');
});

// --- Smoke check 5: resource locks use shared _locks dir ---

check('resource_lock_uses_shared_locks', () => {
  const content = fs.readFileSync(path.join(LIB_DIR, 'oc_resource_lock.sh'), 'utf8');
  assert(content.includes('DELIVERY_OS_HOME'), 'must reference DELIVERY_OS_HOME');
  assert(content.includes('_locks'), 'must reference _locks directory');
  // Must NOT use OC_AGENT_ROOT for lock path
  assert(!content.includes('OC_AGENT_ROOT/_locks'), 'resource locks must NOT be agent-scoped');
});

// --- Smoke check 6: arbiter.sh sources oc_resource_lock.sh ---

check('arbiter_sources_resource_lock', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'arbiter.sh'), 'utf8');
  assert(content.includes('lib/oc_resource_lock.sh'), 'arbiter.sh must source oc_resource_lock.sh');
});

// --- Smoke check 7: arbiter.sh emits ARBITRATION_SELECTED ---

check('arbiter_emits_selected', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'arbiter.sh'), 'utf8');
  assert(content.includes('ARBITRATION_SELECTED'), 'arbiter.sh must emit ARBITRATION_SELECTED');
});

// --- Smoke check 8: arbiter.sh emits ARBITRATION_SKIPPED ---

check('arbiter_emits_skipped', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'arbiter.sh'), 'utf8');
  assert(content.includes('ARBITRATION_SKIPPED'), 'arbiter.sh must emit ARBITRATION_SKIPPED');
});

// --- Smoke check 9: resource_lock_release checks PID ownership ---

check('resource_lock_release_pid_check', () => {
  const content = fs.readFileSync(path.join(LIB_DIR, 'oc_resource_lock.sh'), 'utf8');
  assert(content.includes('lock_pid') && content.includes('$$'),
    'resource_lock_release must check PID ownership');
});

// --- Smoke check 10: lock ordering in delivery_loop.sh ---

check('lock_ordering_resource_before_objective', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8');
  const resourcePos = content.indexOf('resource_lock_acquire');
  assert(resourcePos > 0, 'resource_lock_acquire not found in delivery_loop.sh');
  // Find lock_acquire that follows resource_lock_acquire (main block, not close-check)
  const objectiveAfterResource = content.indexOf('lock_acquire "$OBJ_ID"', resourcePos);
  assert(objectiveAfterResource > resourcePos,
    'lock_acquire "$OBJ_ID" must appear after resource_lock_acquire (lock ordering)');
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
  gate: 'arbitration',
  status: failed === 0 ? 'PASS' : 'FAIL',
  checks_passed: passed,
  checks_total: passed + failed,
  commit_sha: commitSha,
  timestamp: new Date().toISOString(),
  findings
};

fs.writeFileSync(
  path.join(reportDir, 'arbitration-report.json'),
  JSON.stringify(report, null, 2) + '\n'
);

const mdLines = [
  '# Arbitration — Gate Report',
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
  path.join(reportDir, 'arbitration-report.md'),
  mdLines.join('\n')
);

console.log('');
console.log(`Reports: tmp/arbitration-report.{json,md}`);

process.exit(failed > 0 ? 1 : 0);
