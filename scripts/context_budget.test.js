#!/usr/bin/env node
/**
 * context_budget.test.js — Tests for context budget enforcement
 *
 * 10 test cases covering all policy rules:
 *   CB-T1:  All within limits -> PASS
 *   CB-T2:  Role block over chars limit -> FAIL
 *   CB-T3:  Role block over words limit -> FAIL
 *   CB-T4:  Role block over lines limit -> FAIL
 *   CB-T5:  SPEC.md over word budget -> FAIL
 *   CB-T6:  Missing optional CLAUDE.md -> WARN only, gate passes
 *   CB-T7:  Multiple violations reported together
 *   CB-T8:  Grandfathered override makes over-limit WARN not FAIL
 *   CB-T9:  Root README over budget -> WARN only (never FAIL)
 *   CB-T10: Report JSON has correct schema
 *
 * Pattern origin: solatis/claude-config CLAUDE.md/README.md token budget
 * Vendored: 2026-02-11, adapted for deterministic CI gate use
 * No runtime dependency on upstream
 */

'use strict';

const {
  DEFAULT_BUDGETS,
  measureText,
  extractRoleBlocks,
  evaluateRoleBudgets,
  evaluateFileBudget,
  buildReport
} = require('./context_budget_policy.js');

// ─── Minimal test harness (same pattern as verification_gate.test.js) ───

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

// A small role block well within limits
const SMALL_ROLE_YAML = `---
registry_version: "1.0.0"
generated: "2026-01-01T00:00:00Z"
platform: "Test"
hosts: {}

roles:

  test_role:
    purpose: >
      A test role for unit testing.
    responsibilities:
      - Do testing
      - Write tests
    allowed_tools:
      - read
      - write
`;

// A role block that exceeds chars limit (>2200 chars)
function makeOverCharsRole() {
  const filler = 'x'.repeat(200);
  let lines = `---
registry_version: "1.0.0"
generated: "2026-01-01T00:00:00Z"
platform: "Test"
hosts: {}

roles:

  bloated_role:
    purpose: >
      ${filler}
    responsibilities:
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
    allowed_tools:
      - read
`;
  return lines;
}

// A role block that exceeds words limit (>320 words)
function makeOverWordsRole() {
  const manyWords = Array(50).fill('word1 word2 word3 word4 word5 word6 word7').join(' ');
  return `---
registry_version: "1.0.0"
generated: "2026-01-01T00:00:00Z"
platform: "Test"
hosts: {}

roles:

  wordy_role:
    purpose: >
      ${manyWords}
    responsibilities:
      - One
    allowed_tools:
      - read
`;
}

// A role block that exceeds lines limit (>40 lines)
function makeOverLinesRole() {
  const manyItems = Array(45).fill('      - item').join('\n');
  return `---
registry_version: "1.0.0"
generated: "2026-01-01T00:00:00Z"
platform: "Test"
hosts: {}

roles:

  tall_role:
    purpose: >
      A role with many lines.
    responsibilities:
${manyItems}
    allowed_tools:
      - read
`;
}

// Two roles, both over limits
function makeMultiViolation() {
  const filler = 'x'.repeat(200);
  const manyWords = Array(50).fill('word1 word2 word3 word4 word5 word6 word7').join(' ');
  return `---
registry_version: "1.0.0"
generated: "2026-01-01T00:00:00Z"
platform: "Test"
hosts: {}

roles:

  bloated_a:
    purpose: >
      ${filler}
    responsibilities:
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
      - ${filler}
    allowed_tools:
      - read

  wordy_b:
    purpose: >
      ${manyWords}
    responsibilities:
      - One
    allowed_tools:
      - read
`;
}

// ─── Tests ───

console.log('\nContext Budget Tests');
console.log('='.repeat(50));

test('CB-T1: All within limits -> PASS', () => {
  const blocks = extractRoleBlocks(SMALL_ROLE_YAML);
  assert(blocks.size >= 1, 'Should extract at least 1 role');

  const violations = evaluateRoleBudgets(SMALL_ROLE_YAML, DEFAULT_BUDGETS.role_block);
  const fails = violations.filter(v => v.severity === 'FAIL');
  assertEqual(fails.length, 0, 'Should have 0 FAIL violations');
});

test('CB-T2: Role block over chars limit -> FAIL', () => {
  const yaml = makeOverCharsRole();
  const violations = evaluateRoleBudgets(yaml, DEFAULT_BUDGETS.role_block);
  const charViolations = violations.filter(v => v.metric === 'chars' && v.severity === 'FAIL');
  assert(charViolations.length >= 1, 'Should flag chars violation');
  assert(charViolations[0].actual > DEFAULT_BUDGETS.role_block.chars,
    `Actual chars ${charViolations[0].actual} should exceed limit ${DEFAULT_BUDGETS.role_block.chars}`);
});

test('CB-T3: Role block over words limit -> FAIL', () => {
  const yaml = makeOverWordsRole();
  const violations = evaluateRoleBudgets(yaml, DEFAULT_BUDGETS.role_block);
  const wordViolations = violations.filter(v => v.metric === 'words' && v.severity === 'FAIL');
  assert(wordViolations.length >= 1, 'Should flag words violation');
});

test('CB-T4: Role block over lines limit -> FAIL', () => {
  const yaml = makeOverLinesRole();
  const violations = evaluateRoleBudgets(yaml, DEFAULT_BUDGETS.role_block);
  const lineViolations = violations.filter(v => v.metric === 'lines' && v.severity === 'FAIL');
  assert(lineViolations.length >= 1, 'Should flag lines violation');
});

test('CB-T5: SPEC.md over word budget -> FAIL', () => {
  // 1000 words exceeds 900 word limit
  const bigSpec = Array(1000).fill('specification').join(' ');
  const result = evaluateFileBudget('skills/test/SPEC.md', bigSpec, DEFAULT_BUDGETS.spec_md);
  const wordFails = result.filter(v => v.metric === 'words' && v.severity === 'FAIL');
  assert(wordFails.length >= 1, 'Should flag SPEC.md word violation');
});

test('CB-T6: Missing optional CLAUDE.md -> WARN only, gate passes', () => {
  // evaluateFileBudget with null text = missing file
  const result = evaluateFileBudget('CLAUDE.md', null, DEFAULT_BUDGETS.claude_md);
  assert(result.length === 1, 'Should return exactly 1 entry');
  assertEqual(result[0].severity, 'WARN', 'Missing optional file should WARN not FAIL');
  assertEqual(result[0].metric, 'missing', 'Should be a missing-file warning');
});

test('CB-T7: Multiple violations reported together', () => {
  const yaml = makeMultiViolation();
  const violations = evaluateRoleBudgets(yaml, DEFAULT_BUDGETS.role_block);
  const failViolations = violations.filter(v => v.severity === 'FAIL');
  assert(failViolations.length >= 2, `Should report 2+ violations, got ${failViolations.length}`);

  // Both roles should appear
  const roleNames = [...new Set(failViolations.map(v => v.block))];
  assert(roleNames.length >= 2, `Should flag 2+ distinct roles, got ${roleNames.join(', ')}`);
});

test('CB-T8: Grandfathered override makes over-limit WARN not FAIL', () => {
  const yaml = makeOverCharsRole();
  const overrides = {
    'bloated_role': { chars: 9999, words: 9999, lines: 9999 }
  };
  const violations = evaluateRoleBudgets(yaml, DEFAULT_BUDGETS.role_block, overrides);
  const fails = violations.filter(v => v.severity === 'FAIL');
  assertEqual(fails.length, 0, 'Grandfathered role should have no FAIL violations');
});

test('CB-T9: Root README over budget -> WARN only (never FAIL)', () => {
  // README budget is warn-only per spec
  const bigReadme = Array(600).fill('readme').join(' ');
  const result = evaluateFileBudget('README.md', bigReadme, DEFAULT_BUDGETS.readme_md);
  const fails = result.filter(v => v.severity === 'FAIL');
  const warns = result.filter(v => v.severity === 'WARN');
  assertEqual(fails.length, 0, 'README violations should never be FAIL');
  assert(warns.length >= 1, 'Should have WARN for over-budget README');
});

test('CB-T10: Report JSON has correct schema', () => {
  const report = buildReport({
    status: 'PASS',
    violations: [],
    files_checked: 3,
    roles_checked: 2,
    run_id: 'test-123',
    commit_sha: 'abc123'
  });

  assert(report.run_id === 'test-123', 'run_id should match');
  assert(report.commit_sha === 'abc123', 'commit_sha should match');
  assert(typeof report.timestamp_utc === 'string', 'timestamp_utc should be string');
  assert(report.status === 'PASS', 'status should be PASS');
  assert(Array.isArray(report.violations), 'violations should be array');
  assert(typeof report.files_checked === 'number', 'files_checked should be number');
  assert(typeof report.roles_checked === 'number', 'roles_checked should be number');
});

// ─── Summary ───

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.message}`));
}

process.exit(failed > 0 ? 1 : 0);
