#!/usr/bin/env node
/**
 * sheets_gateway.test.js — Fixture-only tests for sheets_gateway_policy.js
 *
 * 40 tests covering:
 *   SG-T1:  empty sheet allowlist denies all reads (fail-closed)
 *   SG-T2:  sheet not in allowlist blocked
 *   SG-T3:  range not in range allowlist blocked
 *   SG-T4:  valid sheet + range read allowed
 *   SG-T5:  PII detected — formatted SSN (###-##-####)
 *   SG-T6:  PII detected — 9 consecutive digits
 *   SG-T7:  PII detected — keyword heuristic
 *   SG-T8:  PII scan fail-closed on unknown type
 *   SG-T9:  PII clean data passes scan
 *   SG-T10: proposeWrite returns pendingChange with payload_sha256
 *   SG-T11: proposeWrite blocks PII in values
 *   SG-T12: commitWrite with missing approval token blocked
 *   SG-T13: commitWrite with expired approval blocked
 *   SG-T14: commitWrite with valid approval + clean data => ok
 *   SG-T15: commitWrite writes audit log entry (temp file)
 *   SG-T16: commitWrite calls eventSink with correct fields
 *   SG-T17: commitWrite with approval not required => ok without token
 *   SG-T18: payload integrity check catches tampered values
 *   SG-T19: split-SSN across adjacent cells detected
 *   SG-T20: token not leaked in pendingChange object
 *   SG-T21: split-SSN with dash separators detected
 *   WM-T1:  readWriteMode() returns AUTO when no file exists
 *   WM-T2:  setWriteMode(SAFE) persists and reads back
 *   WM-T3:  setWriteMode(INVALID) throws
 *   WM-T4:  setWriteMode(LOCKDOWN) emits SHEETS_WRITE_MODE_CHANGED event
 *   WM-T5:  corrupt JSON file falls back to AUTO
 *   WM-T6:  AUTO mode + allowlisted sheet + clean data → approval NOT required
 *   WM-T7:  AUTO mode + out-of-range → approval required (out_of_range)
 *   WM-T8:  AUTO mode + >100 cells → approval required (large_write)
 *   WM-T9:  AUTO mode + destructive operation → approval required (destructive)
 *   WM-T10: AUTO mode + uncertain PII → approval required (uncertain_pii)
 *   WM-T11: SAFE mode + append → approval required (append_in_safe_mode)
 *   WM-T12: SAFE mode + >10 rows → approval required (large_write_safe)
 *   WM-T13: LOCKDOWN mode → always required
 *   WM-T18: addPendingApproval creates JSONL entry
 *   WM-T19: listPendingApprovals returns only pending entries
 *   WM-T20: resolvePendingApproval(approved) stores token and returns it
 *   WM-T21b: resolvePendingApproval(denied) emits SHEETS_WRITE_DENIED
 *   WM-T22: expired pending approvals filtered out by list
 *   WM-T23: resolve non-existent request_id returns error
 *
 * Zero network. Temp files under tmp/. No external dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  loadConfig,
  scanForPII,
  checkSheetAllowlist,
  checkRangeAllowlist,
  createApprovalToken,
  validateApproval,
  getStoredToken,
  _resetTokenStore,
  readValues,
  proposeWrite,
  commitWrite,
  WRITE_MODES,
  DEFAULT_WRITE_MODE,
  readWriteMode,
  setWriteMode,
  shouldRequireApproval,
  _resetWriteModeState,
  addPendingApproval,
  listPendingApprovals,
  resolvePendingApproval,
  _resetPendingApprovals,
  RUNTIME_DIR,
  runtimePath,
} = require('./sheets_gateway_policy.js');

// ─── Minimal test harness (matches repo convention) ───

let _passed = 0;
let _failed = 0;
const _failures = [];

function test(name, fn) {
  _resetTokenStore(); // clean state per test
  try {
    fn();
    _passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    _failed++;
    _failures.push({ name, message: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// ─── Fixtures ───

const TEST_SHEET_ID = 'abc123-test-sheet';
const TEST_RANGE = 'Sheet1!A1:C10';
const CLEAN_VALUES = [['Name', 'Amount'], ['Alice', '100'], ['Bob', '200']];

function makeConfig(overrides) {
  return loadConfig({
    GOOGLE_SHEETS_ALLOWLIST: TEST_SHEET_ID,
    GOOGLE_SHEETS_RANGE_ALLOWLIST: TEST_RANGE,
    SHEETS_WRITE_APPROVAL_REQUIRED: 'true',
    SHEETS_WRITE_APPROVAL_TTL_SECONDS: '300',
    SHEETS_AUDIT_LOG_PATH: '',
    ...overrides,
  });
}

function makeTmpAuditLog() {
  const tmpDir = path.join(os.tmpdir(), 'openclaw-sheets-test-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const logPath = path.join(tmpDir, 'audit.jsonl');
  return { tmpDir, logPath };
}

// ─── Tests ───

console.log('\nSheets Gateway Tests');
console.log('='.repeat(50));

// --- Read allowlist tests ---

test('SG-T1: empty sheet allowlist denies all reads (fail-closed)', () => {
  const config = makeConfig({ GOOGLE_SHEETS_ALLOWLIST: '' });
  const result = readValues(config, TEST_SHEET_ID, TEST_RANGE);
  assert(!result.allowed, 'Should deny with empty allowlist');
  assert(result.reason.includes('empty'), 'Reason should mention empty');
});

test('SG-T2: sheet not in allowlist blocked', () => {
  const config = makeConfig({});
  const result = readValues(config, 'unauthorized-sheet-xyz', TEST_RANGE);
  assert(!result.allowed, 'Should deny sheet not in allowlist');
  assert(result.reason.includes('not in'), 'Reason should mention not in allowlist');
});

test('SG-T3: range not in range allowlist blocked', () => {
  const config = makeConfig({});
  const result = readValues(config, TEST_SHEET_ID, 'Sheet2!Z99:Z100');
  assert(!result.allowed, 'Should deny range not in allowlist');
  assert(result.reason.includes('not in'), 'Reason should mention not in allowlist');
});

test('SG-T4: valid sheet + range read allowed', () => {
  const config = makeConfig({});
  const result = readValues(config, TEST_SHEET_ID, TEST_RANGE);
  assert(result.allowed, 'Should allow valid sheet + range');
});

// --- PII detection tests ---

test('SG-T5: PII detected — formatted SSN (###-##-####)', () => {
  // Direct string test (no keyword headers that would match first)
  const result = scanForPII([['Name', 'ID'], ['Alice', '123-45-6789']]);
  assert(!result.safe, 'Should detect formatted SSN');
  assert(result.reason.includes('SSN_PATTERN'), 'Reason should mention SSN');
});

test('SG-T6: PII detected — 9 consecutive digits', () => {
  const result = scanForPII([['ID'], ['123456789']]);
  assert(!result.safe, 'Should detect 9 consecutive digits');
  assert(result.reason.includes('SSN_PATTERN'), 'Reason should mention SSN pattern');
});

test('SG-T7: PII detected — keyword heuristic', () => {
  const result = scanForPII([['Field'], ['Social Security Number']]);
  assert(!result.safe, 'Should detect PII keyword');
  assert(result.reason.includes('PII_KEYWORD'), 'Reason should mention PII keyword');
});

test('SG-T8: PII scan fail-closed on unknown type', () => {
  const result = scanForPII(Symbol('test'));
  assert(!result.safe, 'Should fail-closed on unknown type');
  assert(result.reason.includes('FAILCLOSED'), 'Reason should mention failclosed');
});

test('SG-T9: PII clean data passes scan', () => {
  const result = scanForPII(CLEAN_VALUES);
  assert(result.safe, 'Should pass clean data');
});

// --- proposeWrite tests ---

test('SG-T10: proposeWrite returns pendingChange with payload_sha256', () => {
  const config = makeConfig({});
  const result = proposeWrite(config, TEST_SHEET_ID, TEST_RANGE, CLEAN_VALUES, { agent_id: 'tax-vault-operator' });
  assert(result.ok, 'Should succeed for valid proposal');
  assert(result.pendingChange !== null, 'Should return pendingChange');
  assert(typeof result.payload_sha256 === 'string' && result.payload_sha256.length === 64, 'Should return 64-char sha256');
  // Token stored server-side, retrievable by request_id
  const stored = getStoredToken(result.pendingChange.request_id);
  assert(stored !== null && stored.token.length > 0, 'Should have server-side approval token');
  assert(result.pendingChange.agent_id === 'tax-vault-operator', 'Should capture agent_id');
});

test('SG-T11: proposeWrite blocks PII in values', () => {
  const config = makeConfig({});
  const result = proposeWrite(config, TEST_SHEET_ID, TEST_RANGE, [['SSN', '123-45-6789']]);
  assert(!result.ok, 'Should block PII');
  assert(result.reason.includes('PII_BLOCKED'), 'Reason should mention PII');
  assert(result.pendingChange === null, 'No pendingChange on PII block');
});

// --- commitWrite tests ---

test('SG-T12: commitWrite with missing approval token blocked', () => {
  const config = makeConfig({});
  const proposal = proposeWrite(config, TEST_SHEET_ID, TEST_RANGE, CLEAN_VALUES, { agent_id: 'test' });
  assert(proposal.ok, 'Proposal should succeed');

  const result = commitWrite(config, proposal.pendingChange, '', {});
  assert(!result.ok, 'Should block missing approval');
  assert(result.outcome === 'blocked', 'Outcome should be blocked');
  assert(result.reason.includes('Missing approval'), 'Reason should mention missing');
});

test('SG-T13: commitWrite with expired approval blocked', () => {
  const config = makeConfig({ SHEETS_WRITE_APPROVAL_TTL_SECONDS: '1' });
  const proposal = proposeWrite(config, TEST_SHEET_ID, TEST_RANGE, CLEAN_VALUES, { agent_id: 'test' });
  assert(proposal.ok, 'Proposal should succeed');

  // Get server-side token
  const stored = getStoredToken(proposal.pendingChange.request_id);
  assert(stored !== null, 'Should have stored token');

  // Simulate time passing (2 seconds after expiry)
  const futureTime = new Date(Date.now() + 5000);
  const result = commitWrite(config, proposal.pendingChange, stored.token, { now: futureTime });
  assert(!result.ok, 'Should block expired token');
  assert(result.outcome === 'blocked', 'Outcome should be blocked');
  assert(result.reason.includes('expired'), 'Reason should mention expired');
});

test('SG-T14: commitWrite with valid approval + clean data => ok', () => {
  const config = makeConfig({});
  const proposal = proposeWrite(config, TEST_SHEET_ID, TEST_RANGE, CLEAN_VALUES, { agent_id: 'tax-vault-operator' });
  assert(proposal.ok, 'Proposal should succeed');

  const stored = getStoredToken(proposal.pendingChange.request_id);
  const result = commitWrite(config, proposal.pendingChange, stored.token, {});
  assert(result.ok, 'Should succeed');
  assert(result.outcome === 'ok', 'Outcome should be ok');
});

test('SG-T15: commitWrite writes audit log entry (temp file)', () => {
  const { tmpDir, logPath } = makeTmpAuditLog();
  try {
    const config = makeConfig({ SHEETS_AUDIT_LOG_PATH: logPath });
    const proposal = proposeWrite(config, TEST_SHEET_ID, TEST_RANGE, CLEAN_VALUES, { agent_id: 'test-agent' });
    assert(proposal.ok, 'Proposal should succeed');

    const stored = getStoredToken(proposal.pendingChange.request_id);
    commitWrite(config, proposal.pendingChange, stored.token, {});

    assert(fs.existsSync(logPath), 'Audit log file should exist');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    assert(lines.length >= 1, 'Should have at least 1 audit entry');
    const entry = JSON.parse(lines[lines.length - 1]);
    assert(entry.outcome === 'ok', 'Audit entry outcome should be ok');
    assert(entry.agent_id === 'test-agent', 'Audit entry should have agent_id');
    assert(entry.sheet_id === TEST_SHEET_ID, 'Audit entry should have sheet_id');
    assert(entry.range === TEST_RANGE, 'Audit entry should have range');
    assert(typeof entry.timestamp_utc === 'string', 'Audit entry should have timestamp');
  } finally {
    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
  }
});

test('SG-T16: commitWrite calls eventSink with correct fields', () => {
  const events = [];
  const config = makeConfig({});
  const proposal = proposeWrite(config, TEST_SHEET_ID, TEST_RANGE, CLEAN_VALUES, {
    agent_id: 'irs-specialist',
    request_id: 'req-abc123',
  });
  assert(proposal.ok, 'Proposal should succeed');

  const stored = getStoredToken(proposal.pendingChange.request_id);
  const result = commitWrite(config, proposal.pendingChange, stored.token, {
    eventSink: (evt) => events.push(evt),
  });
  assert(result.ok, 'Should succeed');
  assert(events.length === 1, 'Should emit exactly 1 event');

  const evt = events[0];
  assert(evt.event_type === 'SHEETS_WRITE_ATTEMPT', 'Event type should be SHEETS_WRITE_ATTEMPT');
  assert(evt.agent_id === 'irs-specialist', 'Event should have agent_id');
  assert(evt.request_id === 'req-abc123', 'Event should have request_id');
  assert(evt.sheet_id === TEST_SHEET_ID, 'Event should have sheet_id');
  assert(evt.range === TEST_RANGE, 'Event should have range');
  assert(evt.outcome === 'ok', 'Event outcome should be ok');
});

test('SG-T17: commitWrite with approval not required => ok without token', () => {
  const config = makeConfig({ SHEETS_WRITE_APPROVAL_REQUIRED: 'false' });
  const proposal = proposeWrite(config, TEST_SHEET_ID, TEST_RANGE, CLEAN_VALUES, { agent_id: 'test' });
  assert(proposal.ok, 'Proposal should succeed');

  // Pass empty token — should still work because approval not required
  const result = commitWrite(config, proposal.pendingChange, '', {});
  assert(result.ok, 'Should succeed without approval when not required');
  assert(result.outcome === 'ok', 'Outcome should be ok');
});

test('SG-T18: payload integrity check catches tampered values', () => {
  const config = makeConfig({});
  const proposal = proposeWrite(config, TEST_SHEET_ID, TEST_RANGE, CLEAN_VALUES, { agent_id: 'test' });
  assert(proposal.ok, 'Proposal should succeed');

  // Tamper with values after proposal
  proposal.pendingChange.values = [['TAMPERED', 'DATA']];

  const stored = getStoredToken(proposal.pendingChange.request_id);
  const result = commitWrite(config, proposal.pendingChange, stored.token, {});
  assert(!result.ok, 'Should fail on tampered payload');
  assert(result.outcome === 'failclosed', 'Outcome should be failclosed');
  assert(result.reason.includes('integrity'), 'Reason should mention integrity');
});

// --- Security patch tests ---

test('SG-T19: split-SSN across adjacent cells detected', () => {
  // SSN 123-45-6789 split across cells: '123', '45', '6789'
  const result = scanForPII([['123', '45', '6789']]);
  assert(!result.safe, 'Should detect split SSN');
  assert(result.reason.includes('SSN_SPLIT'), 'Reason should mention SSN_SPLIT');
});

test('SG-T20: token not leaked in pendingChange object', () => {
  const config = makeConfig({});
  const result = proposeWrite(config, TEST_SHEET_ID, TEST_RANGE, CLEAN_VALUES, { agent_id: 'test' });
  assert(result.ok, 'Proposal should succeed');

  // pendingChange must NOT contain approval token
  assert(result.pendingChange.approval === undefined, 'pendingChange must not have approval field');
  const serialized = JSON.stringify(result.pendingChange);
  assert(!serialized.includes('token'), 'Serialized pendingChange must not contain token');

  // But token must be retrievable server-side
  const stored = getStoredToken(result.pendingChange.request_id);
  assert(stored !== null, 'Token must be stored server-side');
  assert(stored.token.length === 32, 'Token should be 32 hex chars');
});

test('SG-T21: split-SSN with dash separators detected', () => {
  // SSN split with dashes in separate cells: '123-', '45-', '6789'
  const result = scanForPII([['123-', '45-', '6789']]);
  assert(!result.safe, 'Should detect dash-separated split SSN');
  assert(result.reason.includes('SSN_SPLIT'), 'Reason should mention SSN_SPLIT');
});

// --- WriteMode tests ---

test('WM-T1: readWriteMode() returns AUTO when no file exists', () => {
  _resetWriteModeState();
  const wm = readWriteMode();
  assert(wm.mode === 'AUTO', `Expected AUTO, got ${wm.mode}`);
  assert(wm.rate_limit_per_minute === 30, 'Default rate_limit_per_minute should be 30');
  assert(wm.rate_limit_per_hour === 500, 'Default rate_limit_per_hour should be 500');
});

test('WM-T2: setWriteMode(SAFE) persists and reads back', () => {
  _resetWriteModeState();
  const { state } = setWriteMode('SAFE', 'operator');
  assert(state.mode === 'SAFE', 'State mode should be SAFE');
  assert(state.changed_by === 'operator', 'changed_by should be operator');
  const readBack = readWriteMode();
  assert(readBack.mode === 'SAFE', `Read back mode should be SAFE, got ${readBack.mode}`);
  assert(readBack.changed_by === 'operator', 'Read back changed_by should be operator');
  _resetWriteModeState();
});

test('WM-T3: setWriteMode(INVALID) throws', () => {
  let threw = false;
  try {
    setWriteMode('INVALID', 'test');
  } catch (err) {
    threw = true;
    assert(err.message.includes('Invalid write mode'), 'Error should mention invalid mode');
  }
  assert(threw, 'Should have thrown for invalid mode');
});

test('WM-T4: setWriteMode(LOCKDOWN) emits SHEETS_WRITE_MODE_CHANGED event', () => {
  _resetWriteModeState();
  const { event } = setWriteMode('LOCKDOWN', 'admin');
  assert(event.event_type === 'SHEETS_WRITE_MODE_CHANGED', 'Event type should be SHEETS_WRITE_MODE_CHANGED');
  assert(event.previous_mode === 'AUTO', `Previous mode should be AUTO (default), got ${event.previous_mode}`);
  assert(event.new_mode === 'LOCKDOWN', 'New mode should be LOCKDOWN');
  assert(event.changed_by === 'admin', 'Changed by should be admin');
  _resetWriteModeState();
});

test('WM-T5: corrupt JSON file falls back to AUTO', () => {
  _resetWriteModeState();
  // Write corrupt JSON
  const fs = require('fs');
  const filePath = runtimePath('sheets-write-mode.json');
  const dir = require('path').dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, '{corrupt json!!!');
  const wm = readWriteMode();
  assert(wm.mode === 'AUTO', `Corrupt file should fall back to AUTO, got ${wm.mode}`);
  _resetWriteModeState();
});

// --- shouldRequireApproval tests ---

test('WM-T6: AUTO mode + allowlisted sheet + clean data → approval NOT required', () => {
  _resetWriteModeState();
  const config = makeConfig({});
  const writeMode = { mode: 'AUTO' };
  const pendingChange = { range: TEST_RANGE, values: CLEAN_VALUES };
  const result = shouldRequireApproval(config, writeMode, pendingChange, {});
  assert(!result.required, `Should not require approval, got: ${result.reason}`);
  assert(result.exception_type === null, 'exception_type should be null');
});

test('WM-T7: AUTO mode + out-of-range → approval required (out_of_range)', () => {
  const config = makeConfig({});
  const writeMode = { mode: 'AUTO' };
  const pendingChange = { range: 'Sheet2!Z99:Z100', values: CLEAN_VALUES };
  const result = shouldRequireApproval(config, writeMode, pendingChange, {});
  assert(result.required, 'Should require approval for out-of-range');
  assert(result.exception_type === 'out_of_range', `Expected out_of_range, got ${result.exception_type}`);
});

test('WM-T8: AUTO mode + >100 cells → approval required (large_write)', () => {
  const config = makeConfig({});
  const writeMode = { mode: 'AUTO' };
  const pendingChange = { range: TEST_RANGE, values: CLEAN_VALUES };
  const result = shouldRequireApproval(config, writeMode, pendingChange, { cell_count: 150 });
  assert(result.required, 'Should require approval for large write');
  assert(result.exception_type === 'large_write', `Expected large_write, got ${result.exception_type}`);
});

test('WM-T9: AUTO mode + destructive operation → approval required (destructive)', () => {
  const config = makeConfig({});
  const writeMode = { mode: 'AUTO' };
  const pendingChange = { range: TEST_RANGE, values: [] };
  const result = shouldRequireApproval(config, writeMode, pendingChange, { operation: 'deleteRows' });
  assert(result.required, 'Should require approval for destructive op');
  assert(result.exception_type === 'destructive', `Expected destructive, got ${result.exception_type}`);
});

test('WM-T10: AUTO mode + uncertain PII → approval required (uncertain_pii)', () => {
  const config = makeConfig({});
  const writeMode = { mode: 'AUTO' };
  const pendingChange = { range: TEST_RANGE, values: [['ssn_field', '(redacted)']] };
  const result = shouldRequireApproval(config, writeMode, pendingChange, {});
  assert(result.required, 'Should require approval for uncertain PII');
  assert(result.exception_type === 'uncertain_pii', `Expected uncertain_pii, got ${result.exception_type}`);
});

test('WM-T11: SAFE mode + append → approval required (append_in_safe_mode)', () => {
  const config = makeConfig({});
  const writeMode = { mode: 'SAFE' };
  const pendingChange = { range: TEST_RANGE, values: CLEAN_VALUES };
  const result = shouldRequireApproval(config, writeMode, pendingChange, { operation: 'append' });
  assert(result.required, 'Should require approval for append in SAFE mode');
  assert(result.exception_type === 'append_in_safe_mode', `Expected append_in_safe_mode, got ${result.exception_type}`);
});

test('WM-T12: SAFE mode + >10 rows → approval required (large_write_safe)', () => {
  const config = makeConfig({});
  const writeMode = { mode: 'SAFE' };
  const pendingChange = { range: TEST_RANGE, values: CLEAN_VALUES };
  const result = shouldRequireApproval(config, writeMode, pendingChange, { row_count: 15 });
  assert(result.required, 'Should require approval for >10 rows in SAFE mode');
  assert(result.exception_type === 'large_write_safe', `Expected large_write_safe, got ${result.exception_type}`);
});

test('WM-T13: LOCKDOWN mode → always required', () => {
  const config = makeConfig({});
  const writeMode = { mode: 'LOCKDOWN' };
  const pendingChange = { range: TEST_RANGE, values: CLEAN_VALUES };
  const result = shouldRequireApproval(config, writeMode, pendingChange, {});
  assert(result.required, 'LOCKDOWN should always require approval');
  assert(result.exception_type === 'lockdown', `Expected lockdown, got ${result.exception_type}`);
});

// --- PendingApprovalStore tests ---

test('WM-T18: addPendingApproval creates JSONL entry', () => {
  _resetPendingApprovals();
  const pendingChange = {
    request_id: 'req-001',
    sheet_id: TEST_SHEET_ID,
    range: TEST_RANGE,
    agent_id: 'tax-vault-operator',
    proposed_at: new Date().toISOString(),
  };
  const entry = addPendingApproval(pendingChange, 'out_of_range');
  assert(entry.request_id === 'req-001', 'Entry should have request_id');
  assert(entry.status === 'pending', 'Entry should be pending');
  assert(entry.exception_type === 'out_of_range', 'Entry should have exception_type');
  _resetPendingApprovals();
});

test('WM-T19: listPendingApprovals returns only pending entries', () => {
  _resetPendingApprovals();
  const now = new Date().toISOString();
  addPendingApproval({ request_id: 'req-a', sheet_id: 's', range: 'r', agent_id: 'a', proposed_at: now }, 'lockdown');
  addPendingApproval({ request_id: 'req-b', sheet_id: 's', range: 'r', agent_id: 'a', proposed_at: now }, 'lockdown');
  // Resolve one
  resolvePendingApproval('req-a', 'denied', 'operator');
  const pending = listPendingApprovals();
  assert(pending.length === 1, `Expected 1 pending, got ${pending.length}`);
  assert(pending[0].request_id === 'req-b', 'Should only have req-b');
  _resetPendingApprovals();
});

test('WM-T20: resolvePendingApproval(approved) stores token and returns it', () => {
  _resetTokenStore();
  _resetPendingApprovals();
  const config = makeConfig({});
  addPendingApproval({ request_id: 'req-approve', sheet_id: 's', range: 'r', agent_id: 'a', proposed_at: new Date().toISOString() }, 'lockdown');
  const result = resolvePendingApproval('req-approve', 'approved', 'admin', { config });
  assert(result.ok, 'Should resolve ok');
  assert(typeof result.token === 'string' && result.token.length > 0, 'Should return a token');
  // Token should be stored server-side
  const stored = getStoredToken('req-approve');
  assert(stored !== null, 'Token should be stored in token store');
  assert(stored.token === result.token, 'Stored token should match returned token');
  _resetPendingApprovals();
});

test('WM-T21b: resolvePendingApproval(denied) emits SHEETS_WRITE_DENIED', () => {
  _resetPendingApprovals();
  addPendingApproval({ request_id: 'req-deny', sheet_id: 's', range: 'r', agent_id: 'a', proposed_at: new Date().toISOString() }, 'lockdown');
  const result = resolvePendingApproval('req-deny', 'denied', 'admin');
  assert(result.ok, 'Should resolve ok');
  assert(result.event, 'Should have event');
  assert(result.event.event_type === 'SHEETS_WRITE_DENIED', 'Event type should be SHEETS_WRITE_DENIED');
  assert(result.event.resolved_by === 'admin', 'Resolved by should be admin');
  _resetPendingApprovals();
});

test('WM-T22: expired pending approvals filtered out by list', () => {
  _resetPendingApprovals();
  // Add entry with old timestamp
  const oldDate = new Date(Date.now() - 7200 * 1000).toISOString(); // 2 hours ago
  addPendingApproval({ request_id: 'req-old', sheet_id: 's', range: 'r', agent_id: 'a', proposed_at: oldDate }, 'lockdown');
  addPendingApproval({ request_id: 'req-new', sheet_id: 's', range: 'r', agent_id: 'a', proposed_at: new Date().toISOString() }, 'lockdown');
  const pending = listPendingApprovals({ ttlSeconds: 3600 }); // 1 hour TTL
  assert(pending.length === 1, `Expected 1 pending (old expired), got ${pending.length}`);
  assert(pending[0].request_id === 'req-new', 'Should only have req-new');
  _resetPendingApprovals();
});

test('WM-T23: resolve non-existent request_id returns error', () => {
  _resetPendingApprovals();
  const result = resolvePendingApproval('req-nonexistent', 'approved', 'admin');
  assert(!result.ok, 'Should fail for non-existent request');
  assert(result.reason.includes('No pending approval'), `Reason should mention not found, got: ${result.reason}`);
});

// ─── Results ───

console.log();
console.log('='.repeat(50));
console.log(`Results: ${_passed} passed, ${_failed} failed out of ${_passed + _failed}`);

if (_failures.length > 0) {
  console.log('\nFailures:');
  for (const f of _failures) {
    console.log(`  - ${f.name}: ${f.message}`);
  }
}

process.exit(_failed > 0 ? 1 : 0);
