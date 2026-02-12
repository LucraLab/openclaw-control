#!/usr/bin/env node
/**
 * two_stage_pr_review.test.js — Tests for two-stage PR review gate
 *
 * 14 test cases covering Stage 1 (spec compliance) and Stage 2 (quality):
 *   PR-T1:  PASS: PR body has obj + task + risk + DoD + valid plan
 *   PR-T2:  FAIL: missing objective id
 *   PR-T3:  FAIL: missing task id
 *   PR-T4:  FAIL: plan referenced but file missing from diff
 *   PR-T5:  FAIL: plan exists but missing required headings
 *   PR-T6:  FAIL: risk high without risk-accepted label
 *   PR-T7:  FAIL: added file >1MB outside allowlist (Stage 2 MUST)
 *   PR-T8:  FAIL: secret-like pattern in diff (Stage 2 MUST)
 *   PR-T9:  WARN: temporal claim without CI artifact reference
 *   PR-T10: WARN: large diff but no test files changed
 *   PR-T11: PASS: risk high WITH risk-accepted label
 *   PR-T12: Report JSON has correct schema
 *   PR-T13: PASS: ops/ files exempt from public-safe scanning
 *   PR-T14: FAIL: non-ops/ files still trigger public-safe violations
 *
 * Pattern origin: obra/superpowers subagent-driven-development
 *   + solatis/claude-config QR agent (MUST/SHOULD/COULD severity)
 * Vendored: 2026-02-11, adapted for deterministic CI gate use
 * No runtime dependency on upstream
 */

'use strict';

const {
  checkSpecCompliance,
  scanQualityIssues,
  buildReport,
  STAGE1_RULES,
  STAGE2_MUST_PATTERNS,
  PLAN_REQUIRED_HEADINGS
} = require('./two_stage_pr_review_policy.js');

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

const VALID_PR_BODY = `## Summary
Implements feature X.

Objective: obj-42
Task: task-101
Risk: low
DoD: tests + schema + verification-gate pass
Plan: plans/obj-42/task-101.md
`;

const VALID_PLAN_CONTENT = `# Task 101 Plan

## Scope
Add feature X to the system.

## Verification
- Run tests: node scripts/test.js
- Check CI gates pass

## Rollback
- Revert commit: git revert HEAD
- Restore from backup
`;

const PLAN_MISSING_HEADINGS = `# Task 101 Plan

## Scope
Add feature X.

## Notes
Some notes here.
`;

// ─── Tests ───

console.log('\nTwo-Stage PR Review Tests');
console.log('='.repeat(50));

test('PR-T1: PASS: full spec compliance with valid plan', () => {
  const result = checkSpecCompliance({
    prBody: VALID_PR_BODY,
    commitMessages: ['feat: add feature X\n\nobj-42 task-101'],
    changedFiles: ['scripts/feature.js', 'plans/obj-42/task-101.md'],
    planContents: { 'plans/obj-42/task-101.md': VALID_PLAN_CONTENT },
    labels: []
  });

  assertEqual(result.stage1.status, 'PASS', 'Stage 1 should pass');
  const mustFindings = result.stage1.findings.filter(f => f.severity === 'MUST');
  assertEqual(mustFindings.length, 0, 'Should have 0 MUST findings');
});

test('PR-T2: FAIL: missing objective id', () => {
  const body = `## Summary\nTask: task-101\nRisk: low\nDoD: tests + schema pass\nPlan: plans/feature-x/impl.md`;
  const result = checkSpecCompliance({
    prBody: body,
    commitMessages: ['feat: something'],
    changedFiles: ['scripts/x.js', 'plans/feature-x/impl.md'],
    planContents: { 'plans/feature-x/impl.md': VALID_PLAN_CONTENT },
    labels: []
  });

  assertEqual(result.stage1.status, 'FAIL', 'Stage 1 should fail');
  const objFindings = result.stage1.findings.filter(f => f.rule === 'objective_id_required');
  assert(objFindings.length >= 1, 'Should flag missing objective id');
});

test('PR-T3: FAIL: missing task id', () => {
  const body = `## Summary\nObjective: obj-42\nRisk: low\nDoD: tests + schema pass\nPlan: plans/obj-42/impl.md`;
  const result = checkSpecCompliance({
    prBody: body,
    commitMessages: ['feat: something'],
    changedFiles: ['scripts/x.js', 'plans/obj-42/impl.md'],
    planContents: { 'plans/obj-42/impl.md': VALID_PLAN_CONTENT },
    labels: []
  });

  assertEqual(result.stage1.status, 'FAIL', 'Stage 1 should fail');
  const taskFindings = result.stage1.findings.filter(f => f.rule === 'task_id_required');
  assert(taskFindings.length >= 1, 'Should flag missing task id');
});

test('PR-T4: FAIL: plan referenced but file missing from diff', () => {
  const body = VALID_PR_BODY;
  const result = checkSpecCompliance({
    prBody: body,
    commitMessages: [],
    changedFiles: ['scripts/x.js'],  // plan file NOT in changed files
    planContents: {},                  // plan file does not exist
    labels: []
  });

  assertEqual(result.stage1.status, 'FAIL', 'Stage 1 should fail');
  const planFindings = result.stage1.findings.filter(f => f.rule === 'plan_file_exists');
  assert(planFindings.length >= 1, 'Should flag missing plan file');
});

test('PR-T5: FAIL: plan exists but missing required headings', () => {
  const body = VALID_PR_BODY;
  const result = checkSpecCompliance({
    prBody: body,
    commitMessages: [],
    changedFiles: ['scripts/x.js', 'plans/obj-42/task-101.md'],
    planContents: { 'plans/obj-42/task-101.md': PLAN_MISSING_HEADINGS },
    labels: []
  });

  assertEqual(result.stage1.status, 'FAIL', 'Stage 1 should fail');
  const headingFindings = result.stage1.findings.filter(f => f.rule === 'plan_required_headings');
  assert(headingFindings.length >= 1, 'Should flag missing plan headings');
});

test('PR-T6: FAIL: risk high without risk-accepted label', () => {
  const body = VALID_PR_BODY.replace('Risk: low', 'Risk: high');
  const result = checkSpecCompliance({
    prBody: body,
    commitMessages: [],
    changedFiles: ['scripts/x.js', 'plans/obj-42/task-101.md'],
    planContents: { 'plans/obj-42/task-101.md': VALID_PLAN_CONTENT },
    labels: []  // no risk-accepted label
  });

  assertEqual(result.stage1.status, 'FAIL', 'Stage 1 should fail');
  const riskFindings = result.stage1.findings.filter(f => f.rule === 'high_risk_requires_label');
  assert(riskFindings.length >= 1, 'Should flag high risk without label');
});

test('PR-T7: FAIL: added file >1MB outside allowlist (Stage 2)', () => {
  const result = scanQualityIssues({
    changedFiles: ['scripts/huge_binary.dat'],
    fileStats: { 'scripts/huge_binary.dat': { size: 2_000_000, binary: true } },
    fileContents: {},
    prBody: VALID_PR_BODY
  });

  const mustFindings = result.findings.filter(f => f.severity === 'MUST');
  assert(mustFindings.length >= 1, 'Should flag oversized binary file');
  assert(mustFindings.some(f => f.rule === 'binary_or_oversized'), 'Should be binary_or_oversized rule');
});

test('PR-T8: FAIL: secret-like pattern in diff (Stage 2)', () => {
  const result = scanQualityIssues({
    changedFiles: ['config/settings.js'],
    fileStats: { 'config/settings.js': { size: 500, binary: false } },
    fileContents: { 'config/settings.js': 'const key = "sk-proj-abc123def456ghi789jkl012mno345pqr678";\n' },
    prBody: VALID_PR_BODY
  });

  const mustFindings = result.findings.filter(f => f.severity === 'MUST');
  assert(mustFindings.length >= 1, 'Should flag secret pattern');
  assert(mustFindings.some(f => f.rule === 'secret_pattern_detected'), 'Should be secret_pattern_detected rule');
});

test('PR-T9: WARN: temporal claim without CI artifact reference', () => {
  const bodyWithClaim = VALID_PR_BODY + '\nAlready verified on VPS. Works fine.\n';
  const result = scanQualityIssues({
    changedFiles: ['scripts/x.js'],
    fileStats: { 'scripts/x.js': { size: 100, binary: false } },
    fileContents: {},
    prBody: bodyWithClaim
  });

  const shouldFindings = result.findings.filter(f => f.severity === 'SHOULD');
  assert(shouldFindings.some(f => f.rule === 'temporal_claim_without_artifact'),
    'Should warn about temporal claim');
  // Must NOT be a MUST finding
  const mustFindings = result.findings.filter(f => f.severity === 'MUST' && f.rule === 'temporal_claim_without_artifact');
  assertEqual(mustFindings.length, 0, 'Temporal claims should WARN, not FAIL');
});

test('PR-T10: WARN: large diff but no test files changed', () => {
  // 15 changed source files but no test file
  const files = Array.from({ length: 15 }, (_, i) => `scripts/file${i}.js`);
  const stats = {};
  files.forEach(f => { stats[f] = { size: 200, binary: false }; });

  const result = scanQualityIssues({
    changedFiles: files,
    fileStats: stats,
    fileContents: {},
    prBody: VALID_PR_BODY
  });

  const shouldFindings = result.findings.filter(f => f.severity === 'SHOULD');
  assert(shouldFindings.some(f => f.rule === 'no_tests_for_code_changes'),
    'Should warn about missing tests');
});

test('PR-T11: PASS: risk high WITH risk-accepted label', () => {
  const body = VALID_PR_BODY.replace('Risk: low', 'Risk: high');
  const result = checkSpecCompliance({
    prBody: body,
    commitMessages: [],
    changedFiles: ['scripts/x.js', 'plans/obj-42/task-101.md'],
    planContents: { 'plans/obj-42/task-101.md': VALID_PLAN_CONTENT },
    labels: ['risk-accepted']
  });

  const riskFindings = result.stage1.findings.filter(
    f => f.rule === 'high_risk_requires_label' && f.severity === 'MUST'
  );
  assertEqual(riskFindings.length, 0, 'Should NOT flag high risk when label present');
});

test('PR-T12: Report JSON has correct schema', () => {
  const report = buildReport({
    stage1: { status: 'PASS', findings: [] },
    stage2: { status: 'WARN', findings: [{ severity: 'SHOULD', rule: 'test', message: 'x', file: null }] },
    run_id: 'test-run',
    commit_sha: 'abc123',
    pr_number: 99
  });

  assert(report.run_id === 'test-run', 'run_id should match');
  assert(report.commit_sha === 'abc123', 'commit_sha should match');
  assert(typeof report.timestamp_utc === 'string', 'timestamp should be string');
  assert(report.pr_number === 99, 'pr_number should match');
  assert(report.stage1.status === 'PASS', 'stage1 status');
  assert(report.stage2.status === 'WARN', 'stage2 status');
  assert(Array.isArray(report.stage2.findings), 'stage2 findings should be array');
  assertEqual(report.combined_status, 'WARN', 'combined should be WARN (no MUST fails)');

  // Test with a MUST fail
  const failReport = buildReport({
    stage1: { status: 'FAIL', findings: [{ severity: 'MUST', rule: 'x', message: 'y', file: null }] },
    stage2: { status: 'PASS', findings: [] },
    run_id: 'r2',
    commit_sha: 'def',
    pr_number: 100
  });
  assertEqual(failReport.combined_status, 'FAIL', 'combined should be FAIL if stage1 fails');
});

test('PR-T13: PASS: ops/ files exempt from public-safe scanning', () => {
  const result = scanQualityIssues({
    changedFiles: ['ops/proofs/PROOF_PACK_DEPLOYMENT.md'],
    fileStats: { 'ops/proofs/PROOF_PACK_DEPLOYMENT.md': { size: 5000, binary: false } },
    fileContents: { 'ops/proofs/PROOF_PACK_DEPLOYMENT.md': 'ssh root@srv853172.hstgr.cloud\nIP: 31.97.106.33\n' },
    prBody: ''
  });

  const mustFindings = result.findings.filter(f => f.severity === 'MUST');
  assertEqual(mustFindings.length, 0, 'ops/ files should not trigger public-safe violations');
});

test('PR-T14: FAIL: non-ops/ files still trigger public-safe violations', () => {
  const result = scanQualityIssues({
    changedFiles: ['scripts/config.js'],
    fileStats: { 'scripts/config.js': { size: 200, binary: false } },
    fileContents: { 'scripts/config.js': 'const host = "31.97.106.33";\n' },
    prBody: ''
  });

  const mustFindings = result.findings.filter(f => f.severity === 'MUST');
  assert(mustFindings.length >= 1, 'Non-ops/ files should still trigger public-safe');
  assert(mustFindings.some(f => f.rule === 'public_safe_violation'), 'Should be public_safe_violation');
});

// ─── Summary ───

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.message}`));
}

process.exit(failed > 0 ? 1 : 0);
