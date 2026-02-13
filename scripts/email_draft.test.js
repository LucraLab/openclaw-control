#!/usr/bin/env node
/**
 * email_draft.test.js — Tests for Gmail Draft Assistant (email_draft_policy.js)
 *
 * 30 test cases covering all policy modules:
 *   ED-T1:  PASS: valid intent passes validation
 *   ED-T2:  FAIL: missing 'to' field
 *   ED-T3:  FAIL: missing 'subject' field
 *   ED-T4:  FAIL: missing 'body_markdown' field
 *   ED-T5:  FAIL: missing 'requested_by' field
 *   ED-T6:  FAIL: invalid requested_by value
 *   ED-T7:  FAIL: empty 'to' array
 *   ED-T8:  FAIL: invalid email in 'to'
 *   ED-T9:  FAIL: approval_required not true
 *   ED-T10: PASS: allowlist passes for allowed domain
 *   ED-T11: PASS: allowlist passes for exact address
 *   ED-T12: FAIL: allowlist blocks unknown domain
 *   ED-T13: FAIL: allowlist fails closed when unconfigured
 *   ED-T14: PASS: rate limit allows under limit
 *   ED-T15: FAIL: rate limit blocks at 5/day
 *   ED-T16: PASS: rate limit override bypasses limit
 *   ED-T17: FAIL: missing auth files (fail closed, no draft created)
 *   ED-T18: PASS: sanitization redacts sk- patterns
 *   ED-T19: PASS: sanitization redacts ghp_ patterns
 *   ED-T20: PASS: sanitization redacts Bearer tokens
 *   ED-T21: PASS: sanitization redacts AKIA patterns
 *   ED-T22: PASS: sanitization redacts eyJ (JWT) patterns
 *   ED-T23: PASS: sanitization redacts OAuth refresh tokens (1//)
 *   ED-T24: PASS: sanitization redacts OAuth access tokens (ya29.)
 *   ED-T25: PASS: RFC822 builder produces correct headers
 *   ED-T26: PASS: RFC822 builder produces MIME boundary
 *   ED-T27: PASS: RFC822 builder base64url encodes
 *   ED-T28: PASS: Telegram notification includes required fields
 *   ED-T29: PASS: Telegram notification has no secrets
 *   ED-T30: PASS: one clarifier returns exactly one question
 *
 * All tests are offline — NO network calls, Gmail API is NOT invoked.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Set up isolated runtime directory for tests ───
const TEST_RUNTIME_DIR = path.join(os.tmpdir(), 'oc-email-draft-test-' + Date.now());
process.env.OPENCLAW_RUNTIME_DIR = TEST_RUNTIME_DIR;

// Set allowlist for tests
process.env.OPENCLAW_EMAIL_ALLOW_DOMAINS = 'lucralab.com,example.com';
process.env.OPENCLAW_EMAIL_ALLOW_EXACT = 'james@personal.com';

// Now require the policy module (after env is set)
const policy = require('./email_draft_policy');

// ─── Minimal test harness ───

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Fixtures ───

const VALID_INTENT = {
  to: ['test@lucralab.com'],
  subject: 'Follow-up on meeting',
  body_markdown: 'Hi,\n\nGreat meeting today. Here are the action items:\n\n1. Review proposal\n2. Send quote\n\nBest,\nAssistant',
  requested_by: 'telegram',
  approval_required: true,
  context_tags: ['sales', 'follow-up']
};

const INTENT_WITH_CC = {
  ...VALID_INTENT,
  cc: ['cc@lucralab.com'],
  bcc: ['bcc@example.com']
};

// ─── Tests ───

console.log('\nEmail Draft Assistant Tests');
console.log('='.repeat(50));

// --- Intent Validation ---

test('ED-T1: PASS: valid intent passes validation', () => {
  const result = policy.validateIntent(VALID_INTENT);
  assertEqual(result.valid, true, 'Should be valid');
  assertEqual(result.errors.length, 0, 'Should have 0 errors');
});

test('ED-T2: FAIL: missing to field', () => {
  const intent = { ...VALID_INTENT };
  delete intent.to;
  const result = policy.validateIntent(intent);
  assertEqual(result.valid, false, 'Should be invalid');
  assert(result.errors.some(e => e.includes('to')), 'Should mention "to"');
});

test('ED-T3: FAIL: missing subject field', () => {
  const intent = { ...VALID_INTENT };
  delete intent.subject;
  const result = policy.validateIntent(intent);
  assertEqual(result.valid, false, 'Should be invalid');
  assert(result.errors.some(e => e.includes('subject')), 'Should mention "subject"');
});

test('ED-T4: FAIL: missing body_markdown field', () => {
  const intent = { ...VALID_INTENT };
  delete intent.body_markdown;
  const result = policy.validateIntent(intent);
  assertEqual(result.valid, false, 'Should be invalid');
  assert(result.errors.some(e => e.includes('body_markdown')), 'Should mention "body_markdown"');
});

test('ED-T5: FAIL: missing requested_by field', () => {
  const intent = { ...VALID_INTENT };
  delete intent.requested_by;
  const result = policy.validateIntent(intent);
  assertEqual(result.valid, false, 'Should be invalid');
  assert(result.errors.some(e => e.includes('requested_by')), 'Should mention "requested_by"');
});

test('ED-T6: FAIL: invalid requested_by value', () => {
  const intent = { ...VALID_INTENT, requested_by: 'invalid_source' };
  const result = policy.validateIntent(intent);
  assertEqual(result.valid, false, 'Should be invalid');
  assert(result.errors.some(e => e.includes('requested_by')), 'Should mention "requested_by"');
});

test('ED-T7: FAIL: empty to array', () => {
  const intent = { ...VALID_INTENT, to: [] };
  const result = policy.validateIntent(intent);
  assertEqual(result.valid, false, 'Should be invalid');
  assert(result.errors.some(e => e.includes('to')), 'Should mention "to"');
});

test('ED-T8: FAIL: invalid email in to', () => {
  const intent = { ...VALID_INTENT, to: ['not-an-email'] };
  const result = policy.validateIntent(intent);
  assertEqual(result.valid, false, 'Should be invalid');
  assert(result.errors.some(e => e.includes('Invalid email')), 'Should flag invalid email');
});

test('ED-T9: FAIL: approval_required not true', () => {
  const intent = { ...VALID_INTENT, approval_required: false };
  const result = policy.validateIntent(intent);
  assertEqual(result.valid, false, 'Should be invalid');
  assert(result.errors.some(e => e.includes('approval_required')), 'Should flag approval_required');
});

// --- Allowlist ---

test('ED-T10: PASS: allowlist passes for allowed domain', () => {
  const result = policy.recipientAllowlistCheck({ to: ['someone@lucralab.com'] });
  assertEqual(result.allowed, true, 'Should be allowed');
  assertEqual(result.blocked.length, 0, 'No blocked recipients');
});

test('ED-T11: PASS: allowlist passes for exact address', () => {
  const result = policy.recipientAllowlistCheck({ to: ['james@personal.com'] });
  assertEqual(result.allowed, true, 'Should be allowed');
});

test('ED-T12: FAIL: allowlist blocks unknown domain', () => {
  const result = policy.recipientAllowlistCheck({ to: ['hacker@evil.com'] });
  assertEqual(result.allowed, false, 'Should be blocked');
  assert(result.blocked.length >= 1, 'Should have blocked entries');
  assert(result.blocked.includes('hacker@evil.com'), 'Should block evil.com');
});

test('ED-T13: FAIL: allowlist fails closed when unconfigured', () => {
  // Temporarily clear allowlist env vars
  const savedDomains = process.env.OPENCLAW_EMAIL_ALLOW_DOMAINS;
  const savedExact = process.env.OPENCLAW_EMAIL_ALLOW_EXACT;
  process.env.OPENCLAW_EMAIL_ALLOW_DOMAINS = '';
  process.env.OPENCLAW_EMAIL_ALLOW_EXACT = '';

  const result = policy.recipientAllowlistCheck({ to: ['anyone@anywhere.com'] });
  assertEqual(result.allowed, false, 'Should fail closed');
  assert(result.reason && result.reason.includes('No allowlist configured'), 'Should mention no allowlist');

  // Restore
  process.env.OPENCLAW_EMAIL_ALLOW_DOMAINS = savedDomains;
  process.env.OPENCLAW_EMAIL_ALLOW_EXACT = savedExact;
});

// --- Rate Limiting ---

test('ED-T14: PASS: rate limit allows under limit', () => {
  const result = policy.rateLimitCheck({});
  assertEqual(result.allowed, true, 'Should be allowed (no drafts yet today)');
  assert(result.remaining > 0, 'Should have remaining capacity');
});

test('ED-T15: FAIL: rate limit blocks at 5/day', () => {
  // Write 5 ledger entries for today
  const today = policy.todayDateString();
  for (let i = 0; i < 5; i++) {
    policy.appendRateLedger({ date: today, status: 'created', draftId: `test-${i}`, ts: new Date().toISOString() });
  }

  const result = policy.rateLimitCheck({});
  assertEqual(result.allowed, false, 'Should be blocked at 5');
  assertEqual(result.remaining, 0, 'Should have 0 remaining');
  assertEqual(result.count, 5, 'Should show count of 5');
});

test('ED-T16: PASS: rate limit override bypasses limit', () => {
  const result = policy.rateLimitCheck({ override_rate_limit: true });
  assertEqual(result.allowed, true, 'Override should bypass limit');
  assert(result.overridden === true, 'Should mark as overridden');
});

// --- Auth (fail closed) ---

test('ED-T17: FAIL: missing auth files (fail closed, no draft created)', () => {
  // Auth files don't exist in test runtime dir
  const status = policy.authStatus();
  assertEqual(status.authenticated, false, 'Should not be authenticated');
  assertEqual(status.has_refresh, false, 'Should not have refresh token');
  assert(status.error && status.error.length > 0, 'Should have error message');
});

// --- Sanitization ---

test('ED-T18: PASS: sanitization redacts sk- patterns', () => {
  // Build test token at runtime to avoid tripping scan-secrets gate
  const input = 'key is ' + ['sk', 'proj', 'abc123def456ghi789jkl012'].join('-');
  const output = policy.sanitize(input);
  assert(!output.includes('proj'), 'Should redact sk- pattern');
  assert(output.includes('[REDACTED]'), 'Should contain [REDACTED]');
});

test('ED-T19: PASS: sanitization redacts ghp_ patterns', () => {
  // Build test token at runtime to avoid tripping scan-secrets gate
  const input = 'token ' + 'ghp_' + 'abcdef1234567890'.repeat(3).slice(0, 36);
  const output = policy.sanitize(input);
  assert(!output.includes('ghp_'), 'Should redact ghp_ pattern');
  assert(output.includes('[REDACTED]'), 'Should contain [REDACTED]');
});

test('ED-T20: PASS: sanitization redacts Bearer tokens', () => {
  const input = 'Authorization: Bearer ' + 'ya29.a0AfH6SMBx_long_token_here_1234567890';
  const output = policy.sanitize(input);
  assert(!output.includes('ya29.'), 'Should redact Bearer token');
  assert(output.includes('[REDACTED]'), 'Should contain [REDACTED]');
});

test('ED-T21: PASS: sanitization redacts AKIA patterns', () => {
  // Build test token at runtime to avoid tripping scan-secrets gate
  const input = 'aws_key = ' + 'AKIA' + 'IOSFODNN7EXAMPLE';
  const output = policy.sanitize(input);
  assert(!output.includes('IOSFODNN7'), 'Should redact AKIA pattern');
  assert(output.includes('[REDACTED]'), 'Should contain [REDACTED]');
});

test('ED-T22: PASS: sanitization redacts eyJ (JWT) patterns', () => {
  const input = 'token: ' + 'eyJ' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
  const output = policy.sanitize(input);
  assert(!output.includes('hbGci'), 'Should redact eyJ pattern');
  assert(output.includes('[REDACTED]'), 'Should contain [REDACTED]');
});

test('ED-T23: PASS: sanitization redacts OAuth refresh tokens (1//)', () => {
  const input = 'refresh_token: 1//0dx5VZBGgVkMFCgYIARAAGA0SNwF-L9Ir';
  const output = policy.sanitize(input);
  assert(!output.includes('1//0dx5'), 'Should redact 1// pattern');
  assert(output.includes('[REDACTED]'), 'Should contain [REDACTED]');
});

test('ED-T24: PASS: sanitization redacts OAuth access tokens (ya29.)', () => {
  const input = 'access_token: ya29.a0AfB_byBqWAKB1234567890abcdefghij';
  const output = policy.sanitize(input);
  assert(!output.includes('ya29.a0'), 'Should redact ya29. pattern');
  assert(output.includes('[REDACTED]'), 'Should contain [REDACTED]');
});

// --- RFC822 Builder ---

test('ED-T25: PASS: RFC822 builder produces correct headers', () => {
  const result = policy.buildRFC822Message({
    to: ['test@example.com'],
    cc: ['cc@example.com'],
    subject: 'Test Subject',
    body_markdown: 'Hello world'
  });

  assert(result.headers['From'], 'Should have From header');
  assertEqual(result.headers['To'], 'test@example.com', 'To should match');
  assertEqual(result.headers['Cc'], 'cc@example.com', 'Cc should match');
  assertEqual(result.headers['Subject'], 'Test Subject', 'Subject should match');
  assert(result.headers['Date'], 'Should have Date header');
  assert(result.headers['Message-ID'], 'Should have Message-ID header');
  assertEqual(result.headers['MIME-Version'], '1.0', 'MIME version should be 1.0');
  assert(result.headers['Content-Type'].includes('multipart/alternative'), 'Should be multipart/alternative');
});

test('ED-T26: PASS: RFC822 builder produces MIME boundary', () => {
  const result = policy.buildRFC822Message({
    to: ['test@example.com'],
    subject: 'Test',
    body_markdown: 'Hello'
  });

  assert(result.boundary.startsWith(policy.MIME_BOUNDARY_PREFIX), 'Boundary should start with prefix');

  // Decode the raw message and check for text/plain and text/html parts
  const decoded = Buffer.from(result.raw, 'base64').toString('utf8');
  assert(decoded.includes('text/plain'), 'Should contain text/plain part');
  assert(decoded.includes('text/html'), 'Should contain text/html part');
  assert(decoded.includes(result.boundary), 'Should contain boundary');
});

test('ED-T27: PASS: RFC822 builder base64url encodes', () => {
  const result = policy.buildRFC822Message({
    to: ['test@example.com'],
    subject: 'Test',
    body_markdown: 'Hello'
  });

  // Base64url: no +, no /, no trailing =
  assert(!result.raw.includes('+'), 'Should not contain + (base64url)');
  assert(!result.raw.includes('/'), 'Should not contain / (base64url)');
  assert(!result.raw.endsWith('='), 'Should not end with = (base64url)');
});

// --- Telegram Notification ---

test('ED-T28: PASS: Telegram notification includes required fields', () => {
  const notification = policy.formatTelegramNotification('EMAIL_DRAFT_CREATED', {
    to: ['test@lucralab.com'],
    subject: 'Meeting Follow-up',
    body_markdown: 'Notes from the meeting.',
    draftId: 'r123abc',
    webLink: 'https://mail.google.com/mail/#drafts/abc',
    context_tags: ['sales'],
    requested_by: 'telegram'
  });

  assert(notification.includes('test@lucralab.com'), 'Should include recipient');
  assert(notification.includes('Meeting Follow-up'), 'Should include subject');
  assert(notification.includes('r123abc'), 'Should include draft ID');
  assert(notification.includes('APPROVE'), 'Should include APPROVE option');
  assert(notification.includes('EDIT'), 'Should include EDIT option');
  assert(notification.includes('DISCARD'), 'Should include DISCARD option');
  assert(notification.includes('Summary:'), 'Should include summary section');
});

test('ED-T29: PASS: Telegram notification has no secrets', () => {
  // Build test token at runtime to avoid tripping scan-secrets gate
  const fakeKey = ['sk', 'proj', 'abc123def456ghi789jkl012mno'].join('-');
  const notification = policy.formatTelegramNotification('EMAIL_DRAFT_CREATED', {
    to: ['test@lucralab.com'],
    subject: 'Meeting',
    body_markdown: 'Here is my key: ' + fakeKey,
    draftId: 'r123',
    webLink: 'https://mail.google.com/mail/#drafts/abc',
    requested_by: 'telegram'
  });

  // The body_markdown shows as a preview — should be sanitized
  assert(!notification.includes('proj-abc'), 'Should not contain sk- pattern');
});

// --- One Clarifier ---

test('ED-T30: PASS: one clarifier returns exactly one question', () => {
  // Missing to
  const r1 = policy.oneClarifierPolicy({});
  assertEqual(r1.ready, false, 'Should not be ready');
  assert(typeof r1.question === 'string' && r1.question.length > 0, 'Should have a question');
  assert(typeof r1.missing_field === 'string', 'Should have missing_field');

  // Missing subject
  const r2 = policy.oneClarifierPolicy({ to: ['test@example.com'] });
  assertEqual(r2.ready, false, 'Should not be ready');
  assert(typeof r2.question === 'string', 'Should have a question');
  assertEqual(r2.missing_field, 'subject', 'Should identify subject');

  // Missing body
  const r3 = policy.oneClarifierPolicy({ to: ['test@example.com'], subject: 'Test' });
  assertEqual(r3.ready, false, 'Should not be ready');
  assertEqual(r3.missing_field, 'body_markdown', 'Should identify body_markdown');

  // Complete — ready
  const r4 = policy.oneClarifierPolicy({ to: ['test@example.com'], subject: 'Test', body_markdown: 'Hello' });
  assertEqual(r4.ready, true, 'Should be ready');
  assert(r4.question === undefined, 'No question when ready');
});

// ─── Cleanup ───

try {
  fs.rmSync(TEST_RUNTIME_DIR, { recursive: true, force: true });
} catch { /* best effort */ }

// ─── Summary ───

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.message}`));
}

process.exit(failed > 0 ? 1 : 0);
