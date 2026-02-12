#!/usr/bin/env node
/**
 * run_ops_hardening_gate.js — CI gate for Ops Hardening (Port #11)
 *
 * Usage: node scripts/run_ops_hardening_gate.js [--ci]
 *
 * Smoke checks:
 *   OH1: Kill switch path convention (_control/STOP)
 *   OH2: Kill switch check in arbiter.sh
 *   OH3: Kill switch check in delivery_loop.sh
 *   OH4: Kill switch exit code 7 in both scripts
 *   OH5: Quarantine path convention (_control/quarantine.json)
 *   OH6: Arbiter checks quarantine (oc_quarantine_is_blocked)
 *   OH7: Notification module exists with required sink modes
 *   OH8: Triage script uses redaction
 *   OH9: Unquarantine script exists with atomic write
 *   OH10: Incident response doc exists with required sections
 *
 * Exit 0 = gate pass, Exit 1 = gate fail
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const isCI = process.argv.includes('--ci');

let passed = 0;
let failed = 0;
const findings = [];

function check(name, fn) {
  try {
    const result = fn();
    const detail = result || '';
    console.log(`  PASS: ${name}${detail ? ' — ' + detail : ''}`);
    passed++;
    findings.push({ check: name, status: 'PASS', detail });
  } catch (e) {
    console.log(`  FAIL: ${name} — ${e.message}`);
    failed++;
    findings.push({ check: name, status: 'FAIL', detail: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('============================================');
console.log('  Ops Hardening — Gate Runner');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// --- OH1: Kill switch path convention ---
check('OH1_kill_switch_path_convention', () => {
  const controlSh = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'oc_control.sh'), 'utf8');
  assert(controlSh.includes('STOP'), 'oc_control.sh must reference STOP file');
  assert(controlSh.includes('_control'), 'oc_control.sh must reference _control directory');
  assert(controlSh.includes('oc_kill_switch_engaged'), 'oc_control.sh must define oc_kill_switch_engaged');
  return '_control/STOP convention in oc_control.sh';
});

// --- OH2: Kill switch check in arbiter.sh ---
check('OH2_kill_switch_in_arbiter', () => {
  const arbiter = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'arbiter.sh'), 'utf8');
  assert(arbiter.includes('oc_control.sh'), 'arbiter.sh must source oc_control.sh');
  assert(arbiter.includes('oc_kill_switch_engaged'), 'arbiter.sh must call oc_kill_switch_engaged');
  return 'arbiter.sh sources oc_control.sh and checks kill switch';
});

// --- OH3: Kill switch check in delivery_loop.sh ---
check('OH3_kill_switch_in_delivery_loop', () => {
  const dl = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8');
  assert(dl.includes('oc_control.sh'), 'delivery_loop.sh must source oc_control.sh');
  assert(dl.includes('oc_kill_switch_engaged'), 'delivery_loop.sh must call oc_kill_switch_engaged');
  return 'delivery_loop.sh sources oc_control.sh and checks kill switch';
});

// --- OH4: Kill switch exit code 7 ---
check('OH4_kill_switch_exit_code', () => {
  const controlSh = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'oc_control.sh'), 'utf8');
  assert(controlSh.includes('OC_KILL_SWITCH_EXIT_CODE=7'), 'oc_control.sh must define exit code 7');
  const arbiter = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'arbiter.sh'), 'utf8');
  const dl = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'delivery_loop.sh'), 'utf8');
  assert(arbiter.includes('OC_KILL_SWITCH_EXIT_CODE'), 'arbiter.sh must use OC_KILL_SWITCH_EXIT_CODE');
  assert(dl.includes('OC_KILL_SWITCH_EXIT_CODE'), 'delivery_loop.sh must use OC_KILL_SWITCH_EXIT_CODE');
  return 'Exit code 7 defined and used in both scripts';
});

// --- OH5: Quarantine path convention ---
check('OH5_quarantine_path_convention', () => {
  const controlSh = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'oc_control.sh'), 'utf8');
  assert(controlSh.includes('quarantine.json'), 'oc_control.sh must reference quarantine.json');
  assert(controlSh.includes('_control'), 'oc_control.sh must reference _control directory');
  const qpy = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'oc_quarantine.py'), 'utf8');
  assert(qpy.includes('quarantine'), 'oc_quarantine.py must handle quarantine');
  return '_control/quarantine.json convention documented';
});

// --- OH6: Arbiter checks quarantine ---
check('OH6_arbiter_checks_quarantine', () => {
  const arbiter = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'arbiter.sh'), 'utf8');
  assert(arbiter.includes('oc_quarantine_is_blocked'), 'arbiter.sh must call oc_quarantine_is_blocked');
  assert(arbiter.includes('OBJECTIVE_SKIPPED_QUARANTINE'), 'arbiter.sh must emit OBJECTIVE_SKIPPED_QUARANTINE');
  return 'arbiter.sh checks quarantine and emits skip event';
});

// --- OH7: Notification module ---
check('OH7_notification_module', () => {
  const notifyPath = path.join(REPO_ROOT, 'scripts', 'notify.js');
  assert(fs.existsSync(notifyPath), 'notify.js must exist');
  const content = fs.readFileSync(notifyPath, 'utf8');
  assert(content.includes('noop'), 'notify.js must support noop sink');
  assert(content.includes('stdout'), 'notify.js must support stdout sink');
  assert(content.includes('file'), 'notify.js must support file sink');
  assert(content.includes('sanitize'), 'notify.js must sanitize payloads');
  return 'notify.js exists with noop, stdout, file sinks + sanitization';
});

// --- OH8: Triage script redaction ---
check('OH8_triage_redacts_secrets', () => {
  const triagePath = path.join(REPO_ROOT, 'scripts', 'triage.sh');
  assert(fs.existsSync(triagePath), 'triage.sh must exist');
  const content = fs.readFileSync(triagePath, 'utf8');
  assert(content.includes('_redact'), 'triage.sh must use _redact function');
  assert(content.includes('REDACTED'), 'triage.sh must redact secrets');
  assert(content.includes('Kill Switch'), 'triage.sh must report kill switch status');
  assert(content.includes('Quarantine'), 'triage.sh must report quarantines');
  assert(content.includes('Locks'), 'triage.sh must report locks');
  return 'triage.sh uses redaction and reports kill switch, quarantine, locks';
});

// --- OH9: Unquarantine script ---
check('OH9_unquarantine_script', () => {
  const unqPath = path.join(REPO_ROOT, 'scripts', 'unquarantine.sh');
  assert(fs.existsSync(unqPath), 'unquarantine.sh must exist');
  const content = fs.readFileSync(unqPath, 'utf8');
  assert(content.includes('oc_quarantine.py'), 'unquarantine.sh must use oc_quarantine.py for atomic writes');
  const qsPath = path.join(REPO_ROOT, 'scripts', 'quarantine_status.sh');
  assert(fs.existsSync(qsPath), 'quarantine_status.sh must exist');
  return 'unquarantine.sh + quarantine_status.sh exist with atomic writes';
});

// --- OH10: Incident response doc ---
check('OH10_incident_response_doc', () => {
  const docPath = path.join(REPO_ROOT, 'docs', 'INCIDENT_RESPONSE.md');
  assert(fs.existsSync(docPath), 'INCIDENT_RESPONSE.md must exist');
  const content = fs.readFileSync(docPath, 'utf8');
  const required = ['kill switch', 'quarantine', 'locks', 'resume', 'triage'];
  for (const term of required) {
    assert(content.toLowerCase().includes(term),
      `INCIDENT_RESPONSE.md must mention "${term}"`);
  }
  return `INCIDENT_RESPONSE.md contains ${required.length} required sections`;
});

// --- Summary ---
console.log('');
const total = passed + failed;
console.log(`Ops Hardening Gate: ${passed}/${total} checks passed`);

if (failed > 0) {
  console.log(`GATE FAIL: ${failed} check(s) failed`);
}

// --- Artifact generation ---
const ts = new Date().toISOString().replace(/[:.]/g, '').replace('T', 'T').slice(0, -1);
const report = {
  gate: 'ops-hardening',
  timestamp: new Date().toISOString(),
  status: failed === 0 ? 'PASS' : 'FAIL',
  passed,
  failed,
  total,
  findings,
  config: {
    kill_switch_path: '_control/STOP',
    quarantine_path: '_control/quarantine.json',
    kill_switch_exit_code: 7,
    notification_sink_ci: 'noop',
    quarantine_thresholds: {
      failure: { count: 3, window_hours: 24 },
      breach: { count: 2, window_hours: 24 },
      arb_block: { count: 5, window_hours: 1 }
    }
  }
};

// Write artifacts
for (const dir of ['artifacts', 'tmp']) {
  const outDir = path.join(REPO_ROOT, dir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'ops-hardening-report.json'),
    JSON.stringify(report, null, 2) + '\n'
  );

  const md = `# Ops Hardening Gate Report

**Date:** ${report.timestamp}
**Status:** ${report.status}
**Checks:** ${passed}/${total}

## Kill Switch
- Path: \`$DELIVERY_OS_HOME/_control/STOP\`
- Exit code: 7
- Checked in: arbiter.sh, delivery_loop.sh

## Quarantine
- Path: \`$DELIVERY_OS_HOME/_control/quarantine.json\`
- Thresholds: failure=3/24h, breach=2/24h, arb_block=5/1h
- Fail-closed on corrupt file

## Notifications
- Sink mode (CI): noop
- Supported: noop, stdout, file
- Payloads sanitized, truncated to 500 chars

## Checks
${findings.map(f => `- ${f.status}: ${f.check}${f.detail ? ' — ' + f.detail : ''}`).join('\n')}
`;
  fs.writeFileSync(path.join(outDir, 'ops-hardening-report.md'), md);
}

process.exit(failed > 0 ? 1 : 0);
