#!/usr/bin/env node
/**
 * verification_gate.test.js — Tests for Verification Gate Policy
 *
 * Usage: node scripts/verification_gate.test.js
 * Exit 0 = all tests pass, Exit 1 = failures
 *
 * Pattern origin: obra/superpowers verification-before-completion
 * Vendored: 2026-02-11, adapted for deterministic CI gate use
 * No runtime dependency on upstream
 */

'use strict';

const path = require('path');

// Load policy module (will fail until Phase 2 implements it)
const policy = require('./verification_gate_policy');

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

console.log('============================================');
console.log('  Verification Gate — Test Suite');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// ─── VG-T1: Normal code/docs changes with no evidence artifacts → PASS ───
test('VG-T1: allows normal code and docs changes', () => {
  const files = [
    'scripts/delivery_loop.sh',
    'registry/ROLE_REGISTRY.yaml',
    'skills/delivery_loop_v1/SPEC.md',
    'README.md',
    'CONTRIBUTING.md',
    '.github/workflows/gate-schema.yml'
  ];
  const result = policy.evaluateChangedFiles(files);
  assert(result.ok === true, `Expected ok=true, got ok=${result.ok}`);
  assert(result.violations.length === 0,
    `Expected 0 violations, got ${result.violations.length}: ${JSON.stringify(result.violations)}`);
});

// ─── VG-T2: Fails if PR adds/modifies a file under proofs/ ───
test('VG-T2: rejects files under proofs/', () => {
  const files = [
    'scripts/delivery_loop.sh',
    'proofs/PROOF_PACK_CANARY_SMS.md',
    'proofs/regression-output.txt'
  ];
  const result = policy.evaluateChangedFiles(files);
  assert(result.ok === false, 'Expected ok=false for proofs/ files');
  assert(result.violations.length === 2,
    `Expected 2 violations, got ${result.violations.length}`);
  assert(result.violations[0].rule === 'forbidden_directory',
    `Expected rule=forbidden_directory, got ${result.violations[0].rule}`);
});

// ─── VG-T3: Fails if PR adds PROOF_PACK_*.md outside docs/ ───
test('VG-T3: rejects PROOF_PACK pattern outside docs/', () => {
  const files = [
    'scripts/delivery_loop.sh',
    'PROOF_PACK_V2_CANARY.md',
    'skills/PROOF_PACK_DELIVERY.md'
  ];
  const result = policy.evaluateChangedFiles(files);
  assert(result.ok === false, 'Expected ok=false for PROOF_PACK outside docs/');
  assert(result.violations.length === 2,
    `Expected 2 violations, got ${result.violations.length}`);
  assert(result.violations.every(v => v.rule === 'forbidden_pattern'),
    'Expected all violations to be forbidden_pattern');
});

// ─── VG-T4: Allows docs/PROOF_PACK_EXAMPLE.md with EXAMPLE marker ───
test('VG-T4: allows docs/ files with EXAMPLE/TEMPLATE marker in name', () => {
  const files = [
    'docs/PROOF_PACK_EXAMPLE.md',
    'docs/PROOF_PACK_TEMPLATE.md',
    'docs/reports/SAMPLE_regression_output.md'
  ];
  const result = policy.evaluateChangedFiles(files);
  assert(result.ok === true,
    `Expected ok=true for docs/ EXAMPLE/TEMPLATE files, got violations: ${JSON.stringify(result.violations)}`);
});

// ─── VG-T5: Produces verification-summary with required fields ───
test('VG-T5: buildSummary produces valid schema', () => {
  const checks = [
    { name: 'evidence_policy', status: 'pass', duration_ms: 42 },
    { name: 'schema_validation', status: 'pass', duration_ms: 150 }
  ];
  const summary = policy.buildSummary({
    run_id: 'test-123',
    commit_sha: 'abc1234',
    checks: checks
  });

  assert(summary.run_id === 'test-123', 'Missing run_id');
  assert(summary.commit_sha === 'abc1234', 'Missing commit_sha');
  assert(typeof summary.timestamp_utc === 'string', 'Missing timestamp_utc');
  assert(Array.isArray(summary.checks), 'checks not an array');
  assert(summary.checks.length === 2, `Expected 2 checks, got ${summary.checks.length}`);
  assert(summary.checks[0].name === 'evidence_policy', 'Wrong check name');
  assert(summary.checks[0].status === 'pass', 'Wrong check status');
  assert(typeof summary.checks[0].duration_ms === 'number', 'duration_ms not number');

  // Verify JSON serializable
  const json = JSON.stringify(summary);
  const parsed = JSON.parse(json);
  assert(parsed.run_id === 'test-123', 'JSON round-trip failed');
});

// ─── VG-T6: Detects committed verification-summary.json ───
test('VG-T6: rejects committed verification-summary.json', () => {
  const files = [
    'scripts/delivery_loop.sh',
    'verification-summary.json'
  ];
  const result = policy.evaluateChangedFiles(files);
  assert(result.ok === false, 'Expected ok=false for committed verification-summary.json');
  assert(result.violations.some(v => v.file === 'verification-summary.json'),
    'Expected violation for verification-summary.json');

  // Also catch it in subdirectories
  const files2 = [
    'tmp/verification-summary.json',
    'outputs/verification-summary.json'
  ];
  const result2 = policy.evaluateChangedFiles(files2);
  assert(result2.ok === false, 'Expected ok=false for nested verification-summary.json');
});

// ─── VG-T7: reports/ is forbidden but docs/reports/ is allowed ───
test('VG-T7: reports/ forbidden, docs/reports/ allowed', () => {
  // Forbidden: top-level reports/
  const files1 = ['reports/scan_result.txt', 'scripts/run.sh'];
  const result1 = policy.evaluateChangedFiles(files1);
  assert(result1.ok === false, 'Expected ok=false for reports/');
  assert(result1.violations.length === 1, `Expected 1 violation, got ${result1.violations.length}`);

  // Allowed: docs/reports/ (normal docs, not evidence)
  const files2 = ['docs/reports/architecture-overview.md', 'scripts/run.sh'];
  const result2 = policy.evaluateChangedFiles(files2);
  assert(result2.ok === true,
    `Expected ok=true for docs/reports/, got violations: ${JSON.stringify(result2.violations)}`);
});

// ─── VG-T8: Handles rename/move edge cases ───
test('VG-T8: handles edge cases in file paths', () => {
  // Empty file list → ok
  const result1 = policy.evaluateChangedFiles([]);
  assert(result1.ok === true, 'Empty file list should be ok');

  // Files with similar names that aren't violations
  const result2 = policy.evaluateChangedFiles([
    'scripts/proof_helper.js',       // "proof" in name but not a proof dir
    'registry/schemas/report.json',  // "report" in name but not reports/ dir
    'skills/test_output_format.md'   // "test_output" in name but it's a skill doc
  ]);
  assert(result2.ok === true,
    `Expected ok for non-violating similar names, got: ${JSON.stringify(result2.violations)}`);

  // Nested forbidden dirs
  const result3 = policy.evaluateChangedFiles([
    'proofs/nested/deep/file.txt',
    'artifacts/bundle/output.json'
  ]);
  assert(result3.ok === false, 'Nested forbidden dirs should fail');
  assert(result3.violations.length === 2, `Expected 2 violations for nested, got ${result3.violations.length}`);

  // SCAN_RESULTS pattern in non-docs location
  const result4 = policy.evaluateChangedFiles([
    'SCAN_RESULTS_2026.txt'
  ]);
  assert(result4.ok === false, 'SCAN_RESULTS pattern should fail outside docs/');

  // docs/ location with matching pattern but no EXAMPLE/TEMPLATE/SAMPLE marker
  const result5 = policy.evaluateChangedFiles([
    'docs/PROOF_PACK_REAL_DEPLOYMENT.md'
  ]);
  assert(result5.ok === false,
    'docs/ with forbidden pattern but no EXAMPLE/TEMPLATE/SAMPLE marker should fail');
});

// ─── VG-T9: Multiple forbidden directories all caught ───
test('VG-T9: all forbidden directories are enforced', () => {
  const forbiddenDirs = ['proofs', 'proof_packs', 'artifacts', 'logs', '_logs', 'outputs'];
  for (const dir of forbiddenDirs) {
    const files = [`${dir}/some_file.txt`];
    const result = policy.evaluateChangedFiles(files);
    assert(result.ok === false, `Expected ok=false for ${dir}/`);
    assert(result.violations[0].rule === 'forbidden_directory',
      `Expected forbidden_directory for ${dir}/, got ${result.violations[0].rule}`);
  }
});

// ─── VG-T10: Forbidden patterns are case-insensitive ───
test('VG-T10: pattern matching is case-insensitive', () => {
  const files = [
    'proof_pack_canary.md',
    'Scan_Results_Latest.txt',
    'TEST_OUTPUT_run1.txt'
  ];
  const result = policy.evaluateChangedFiles(files);
  assert(result.ok === false, 'Case-insensitive patterns should match');
  assert(result.violations.length === 3,
    `Expected 3 violations, got ${result.violations.length}`);
});

// ─── VG-T11: ops/ prefix is allowlisted (deployment proofs) ───
test('VG-T11: ops/ files with PROOF_PACK names are allowed', () => {
  const files = [
    'ops/proofs/PROOF_PACK_PORT16.md',
    'ops/proof-packs/PROOF_PACK.md',
    'ops/public_safe_audit/SCAN_RESULTS.txt',
    'ops/proofs/PROOF_PACK_KILLSWITCH_GUARD.md'
  ];
  const result = policy.evaluateChangedFiles(files);
  assert(result.ok === true,
    `Expected ok=true for ops/ prefix files, got violations: ${JSON.stringify(result.violations)}`);
});

// ─── VG-T12: PROOF_PACK outside ops/ and docs/ is still forbidden ───
test('VG-T12: PROOF_PACK outside ops/ still rejected', () => {
  const files = [
    'skills/PROOF_PACK_DELIVERY.md',
    'PROOF_PACK_ROOT.md'
  ];
  const result = policy.evaluateChangedFiles(files);
  assert(result.ok === false, 'Expected ok=false for PROOF_PACK outside ops/');
  assert(result.violations.length === 2,
    `Expected 2 violations, got ${result.violations.length}`);
});

console.log('');
console.log('============================================');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('============================================');

if (failed > 0) {
  process.exit(1);
}
