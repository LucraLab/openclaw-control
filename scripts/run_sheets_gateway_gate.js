#!/usr/bin/env node
/**
 * run_sheets_gateway_gate.js — CI gate runner for Sheets Gateway enforcement
 *
 * Verifies that:
 *   1. Policy module loads without error
 *   2. Allowlist enforcement works (fail-closed)
 *   3. PII detection blocks sensitive data
 *   4. Approval tokens enforce write gating
 *   5. Audit logging produces append-only entries
 *   6. Event emission includes all required fields
 *
 * Produces tmp/sheets-gateway-report.json + tmp/sheets-gateway-report.md
 *
 * Exit codes:
 *   0  = all checks pass
 *   1  = check failure
 *   2  = internal error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  EXIT_SHEETS_BLOCKED,
  loadConfig,
  scanForPII,
  checkSheetAllowlist,
  checkRangeAllowlist,
  readValues,
  proposeWrite,
  commitWrite,
  buildReport,
  getStoredToken,
  _resetTokenStore,
  shouldRequireApproval,
  checkWriteRateLimit,
  handleSheetsCommand,
  readWriteMode,
  _resetWriteModeState,
  _resetWriteLedger,
  _resetPendingApprovals,
} = require('./sheets_gateway_policy.js');

// ─── Parse args ───

const args = process.argv.slice(2);
const isCI = args.includes('--ci');
const repoDirIdx = args.indexOf('--repo-dir');
const repoDir = repoDirIdx >= 0 ? args[repoDirIdx + 1] : process.cwd();

// ─── Smoke checks ───

function runSmokeChecks() {
  const findings = [];
  let checksPassed = 0;
  let checksFailed = 0;

  function smokeCheck(name, fn) {
    _resetTokenStore(); // clean state per check
    try {
      fn();
      checksPassed++;
      console.log(`  PASS: ${name}`);
    } catch (err) {
      checksFailed++;
      findings.push({ rule: name, message: err.message, severity: 'FAIL' });
      console.log(`  FAIL: ${name} — ${err.message}`);
    }
  }

  // Check 1: Policy module exports
  smokeCheck('policy_module_exports', () => {
    const mod = require('./sheets_gateway_policy.js');
    const required = [
      'loadConfig', 'scanForPII', 'checkSheetAllowlist', 'checkRangeAllowlist',
      'readValues', 'proposeWrite', 'commitWrite', 'buildReport',
      'EXIT_SHEETS_BLOCKED', 'createApprovalToken', 'validateApproval',
      'appendAuditLog', 'buildAuditEntry', 'buildSheetsEvent',
      'storeToken', 'getStoredToken', 'clearStoredToken', '_resetTokenStore',
    ];
    for (const name of required) {
      if (typeof mod[name] === 'undefined') {
        throw new Error(`Missing export: ${name}`);
      }
    }
  });

  // Check 2: Empty allowlist = deny all (fail-closed)
  smokeCheck('empty_allowlist_denies_all', () => {
    const config = loadConfig({ GOOGLE_SHEETS_ALLOWLIST: '' });
    const r = readValues(config, 'any-sheet', 'A1:B2');
    if (r.allowed) throw new Error('Empty allowlist should deny all');
  });

  // Check 3: Sheet not in allowlist blocked
  smokeCheck('sheet_not_in_allowlist_blocked', () => {
    const config = loadConfig({ GOOGLE_SHEETS_ALLOWLIST: 'allowed-sheet' });
    const r = readValues(config, 'wrong-sheet', 'A1:B2');
    if (r.allowed) throw new Error('Should deny sheet not in allowlist');
  });

  // Check 4: Range not in allowlist blocked
  smokeCheck('range_not_in_allowlist_blocked', () => {
    const config = loadConfig({
      GOOGLE_SHEETS_ALLOWLIST: 'test-sheet',
      GOOGLE_SHEETS_RANGE_ALLOWLIST: 'Sheet1!A1:C10',
    });
    const r = readValues(config, 'test-sheet', 'Sheet2!Z1:Z99');
    if (r.allowed) throw new Error('Should deny range not in allowlist');
  });

  // Check 5: PII — formatted SSN blocked
  smokeCheck('pii_ssn_formatted_blocked', () => {
    const r = scanForPII('123-45-6789');
    if (r.safe) throw new Error('Should detect formatted SSN');
  });

  // Check 6: PII — 9 consecutive digits blocked
  smokeCheck('pii_ssn_unformatted_blocked', () => {
    const r = scanForPII('123456789');
    if (r.safe) throw new Error('Should detect 9 consecutive digits');
  });

  // Check 7: PII — keyword blocked
  smokeCheck('pii_keyword_blocked', () => {
    const r = scanForPII('Social Security Number');
    if (r.safe) throw new Error('Should detect PII keyword');
  });

  // Check 8: PII — fail-closed on unknown type
  smokeCheck('pii_failclosed_unknown_type', () => {
    const r = scanForPII(Symbol('test'));
    if (r.safe) throw new Error('Should fail-closed on unknown type');
  });

  // Check 9: Write approval required blocks without token
  smokeCheck('write_approval_blocks_without_token', () => {
    const config = loadConfig({
      GOOGLE_SHEETS_ALLOWLIST: 'test-sheet',
      GOOGLE_SHEETS_RANGE_ALLOWLIST: 'A1:B2',
      SHEETS_WRITE_APPROVAL_REQUIRED: 'true',
      SHEETS_WRITE_APPROVAL_TTL_SECONDS: '300',
    });
    const p = proposeWrite(config, 'test-sheet', 'A1:B2', [['safe']], { agent_id: 'test' });
    if (!p.ok) throw new Error('Proposal should succeed');
    const r = commitWrite(config, p.pendingChange, '');
    if (r.ok) throw new Error('Should block without approval token');
  });

  // Check 10: Expired approval blocked
  smokeCheck('expired_approval_blocked', () => {
    const config = loadConfig({
      GOOGLE_SHEETS_ALLOWLIST: 'test-sheet',
      GOOGLE_SHEETS_RANGE_ALLOWLIST: 'A1:B2',
      SHEETS_WRITE_APPROVAL_REQUIRED: 'true',
      SHEETS_WRITE_APPROVAL_TTL_SECONDS: '1',
    });
    const p = proposeWrite(config, 'test-sheet', 'A1:B2', [['safe']], { agent_id: 'test' });
    if (!p.ok) throw new Error('Proposal should succeed');
    const stored = getStoredToken(p.pendingChange.request_id);
    if (!stored) throw new Error('Token should be stored server-side');
    const future = new Date(Date.now() + 10000);
    const r = commitWrite(config, p.pendingChange, stored.token, { now: future });
    if (r.ok) throw new Error('Should block expired approval');
  });

  // Check 11: Valid approved write => ok + audit entry
  smokeCheck('valid_approved_write_ok_with_audit', () => {
    const tmpDir = path.join(os.tmpdir(), 'oc-sheets-gate-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const logPath = path.join(tmpDir, 'audit.jsonl');
    try {
      const config = loadConfig({
        GOOGLE_SHEETS_ALLOWLIST: 'test-sheet',
        GOOGLE_SHEETS_RANGE_ALLOWLIST: 'A1:B2',
        SHEETS_WRITE_APPROVAL_REQUIRED: 'true',
        SHEETS_WRITE_APPROVAL_TTL_SECONDS: '300',
        SHEETS_AUDIT_LOG_PATH: logPath,
      });
      const p = proposeWrite(config, 'test-sheet', 'A1:B2', [['safe']], { agent_id: 'test' });
      if (!p.ok) throw new Error('Proposal should succeed');
      const stored = getStoredToken(p.pendingChange.request_id);
      if (!stored) throw new Error('Token should be stored server-side');
      const r = commitWrite(config, p.pendingChange, stored.token);
      if (!r.ok) throw new Error('Valid write should succeed');
      if (r.outcome !== 'ok') throw new Error('Outcome should be ok');
      if (!fs.existsSync(logPath)) throw new Error('Audit log file should exist');
      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      const entry = JSON.parse(lines[lines.length - 1]);
      if (entry.outcome !== 'ok') throw new Error('Audit entry outcome should be ok');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
    }
  });

  // Check 12: Event emission has required fields
  smokeCheck('event_emission_has_required_fields', () => {
    const events = [];
    const config = loadConfig({
      GOOGLE_SHEETS_ALLOWLIST: 'test-sheet',
      GOOGLE_SHEETS_RANGE_ALLOWLIST: 'A1:B2',
      SHEETS_WRITE_APPROVAL_REQUIRED: 'true',
      SHEETS_WRITE_APPROVAL_TTL_SECONDS: '300',
    });
    const p = proposeWrite(config, 'test-sheet', 'A1:B2', [['data']], {
      agent_id: 'irs-specialist', request_id: 'req-test',
    });
    if (!p.ok) throw new Error('Proposal should succeed');
    const stored = getStoredToken(p.pendingChange.request_id);
    if (!stored) throw new Error('Token should be stored server-side');
    commitWrite(config, p.pendingChange, stored.token, {
      eventSink: (evt) => events.push(evt),
    });
    if (events.length !== 1) throw new Error('Should emit exactly 1 event');
    const evt = events[0];
    const requiredFields = ['event_type', 'timestamp_utc', 'agent_id', 'request_id', 'sheet_id', 'range', 'outcome'];
    for (const f of requiredFields) {
      if (!evt[f]) throw new Error(`Event missing required field: ${f}`);
    }
    if (evt.event_type !== 'SHEETS_WRITE_ATTEMPT') throw new Error('Wrong event type');
  });

  // Check 13: WriteModeStore defaults to AUTO
  smokeCheck('write_mode_defaults_to_auto', () => {
    const { readWriteMode: rwm, _resetWriteModeState: rwms } = require('./sheets_gateway_policy.js');
    rwms();
    const wm = rwm();
    if (wm.mode !== 'AUTO') throw new Error(`Expected AUTO, got ${wm.mode}`);
    rwms();
  });

  // Check 14: shouldRequireApproval returns not-required for AUTO + clean data
  smokeCheck('auto_mode_clean_write_not_required', () => {
    _resetWriteModeState();
    _resetWriteLedger();
    _resetPendingApprovals();
    const config = loadConfig({
      GOOGLE_SHEETS_ALLOWLIST: 'test-sheet',
      GOOGLE_SHEETS_RANGE_ALLOWLIST: 'A1:B2',
    });
    const result = shouldRequireApproval(config, { mode: 'AUTO' }, { range: 'A1:B2', values: [['safe']] }, {});
    if (result.required) throw new Error(`Should not require approval: ${result.reason}`);
    _resetWriteModeState();
    _resetWriteLedger();
    _resetPendingApprovals();
  });

  // Check 15: shouldRequireApproval returns required for LOCKDOWN
  smokeCheck('lockdown_mode_always_requires_approval', () => {
    _resetWriteModeState();
    _resetWriteLedger();
    _resetPendingApprovals();
    const config = loadConfig({
      GOOGLE_SHEETS_ALLOWLIST: 'test-sheet',
      GOOGLE_SHEETS_RANGE_ALLOWLIST: 'A1:B2',
    });
    const result = shouldRequireApproval(config, { mode: 'LOCKDOWN' }, { range: 'A1:B2', values: [['safe']] }, {});
    if (!result.required) throw new Error('LOCKDOWN should always require approval');
    _resetWriteModeState();
    _resetWriteLedger();
    _resetPendingApprovals();
  });

  // Check 16: Rate limit check returns allowed for fresh state
  smokeCheck('rate_limit_allowed_fresh_state', () => {
    _resetWriteLedger();
    const result = checkWriteRateLimit('test-agent', { rate_limit_per_minute: 30, rate_limit_per_hour: 500 });
    if (!result.allowed) throw new Error('Fresh state should be within rate limits');
    _resetWriteLedger();
  });

  // Check 17: handleSheetsCommand returns formatted string
  smokeCheck('sheets_command_returns_text', () => {
    _resetWriteModeState();
    const result = handleSheetsCommand('/sheet mode', 'operator');
    if (typeof result.text !== 'string') throw new Error('Should return text string');
    if (!result.text.includes('AUTO')) throw new Error('Should show current mode');
    _resetWriteModeState();
  });

  // Check 18: Backward compat — proposeWrite still works without explicit write mode
  smokeCheck('backward_compat_propose_without_write_mode', () => {
    _resetWriteModeState();
    _resetWriteLedger();
    _resetPendingApprovals();
    const config = loadConfig({
      GOOGLE_SHEETS_ALLOWLIST: 'test-sheet',
      GOOGLE_SHEETS_RANGE_ALLOWLIST: 'A1:B2',
      SHEETS_WRITE_APPROVAL_REQUIRED: 'true',
      SHEETS_WRITE_APPROVAL_TTL_SECONDS: '300',
    });
    const p = proposeWrite(config, 'test-sheet', 'A1:B2', [['safe']], { agent_id: 'test' });
    if (!p.ok) throw new Error(`Proposal should succeed: ${p.reason}`);
    // In default AUTO mode, allowlisted write should be auto-approved
    if (p.auto_approved) {
      // New behavior: token provided directly
      if (!p.approval_token) throw new Error('Auto-approved should have token');
    } else {
      // Old behavior: token stored server-side
      const stored = getStoredToken(p.pendingChange.request_id);
      if (!stored) throw new Error('Token should be stored server-side');
    }
    _resetWriteModeState();
    _resetWriteLedger();
    _resetPendingApprovals();
  });

  return { checksPassed, checksFailed, findings };
}

// ─── Main ───

function main() {
  console.log('Sheets Gateway Gate');
  console.log('='.repeat(50));
  console.log(`Repo: ${repoDir}`);
  console.log(`CI mode: ${isCI}`);
  console.log();

  console.log('Running smoke checks...');
  const { checksPassed, checksFailed, findings } = runSmokeChecks();

  const status = checksFailed > 0 ? 'FAIL' : 'PASS';

  console.log();
  console.log('='.repeat(50));
  console.log(`Status: ${status}`);
  console.log(`Checks: ${checksPassed} passed, ${checksFailed} failed`);

  // Write report
  const report = buildReport({
    status,
    findings,
    run_id: process.env.GITHUB_RUN_ID || 'local',
    commit_sha: process.env.GITHUB_SHA || 'local',
  });

  const tmpDir = path.join(repoDir, 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const jsonPath = path.join(tmpDir, 'sheets-gateway-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');

  const mdLines = [
    '# Sheets Gateway Gate Report',
    '',
    `**Status:** ${status}`,
    `**Checks:** ${checksPassed} passed, ${checksFailed} failed`,
    `**Time:** ${report.timestamp_utc}`,
    '',
    '## Gates Enforced',
    '',
    '| Gate | Enforces | On Violation |',
    '|------|----------|--------------|',
    '| Sheet allowlist | GOOGLE_SHEETS_ALLOWLIST | blocked |',
    '| Range allowlist | GOOGLE_SHEETS_RANGE_ALLOWLIST | blocked |',
    '| PII detection | SSN + keyword heuristics | failclosed |',
    '| Write approval | SHEETS_WRITE_APPROVAL_REQUIRED | blocked |',
    '| Approval TTL | SHEETS_WRITE_APPROVAL_TTL_SECONDS | blocked |',
    '| Payload integrity | SHA-256 hash comparison | failclosed |',
    '',
    '## Env Vars',
    '',
    '| Variable | Purpose |',
    '|----------|---------|',
    '| `GOOGLE_SHEETS_ALLOWLIST` | Comma-separated sheet IDs |',
    '| `GOOGLE_SHEETS_RANGE_ALLOWLIST` | Comma-separated A1 ranges |',
    '| `SHEETS_WRITE_APPROVAL_REQUIRED` | true/false (default: true) |',
    '| `SHEETS_WRITE_APPROVAL_TTL_SECONDS` | Token TTL (default: 300) |',
    '| `SHEETS_AUDIT_LOG_PATH` | Path to JSONL audit log |',
    '',
  ];

  if (findings.length > 0) {
    mdLines.push('## Findings', '');
    for (const f of findings) {
      mdLines.push(`- **${f.severity}** [${f.rule}]: ${f.message}`);
    }
    mdLines.push('');
  }

  const mdPath = path.join(tmpDir, 'sheets-gateway-report.md');
  fs.writeFileSync(mdPath, mdLines.join('\n'));

  console.log(`Report: ${jsonPath}`);
  console.log(`Summary: ${mdPath}`);

  process.exit(checksFailed > 0 ? 1 : 0);
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(2);
}
