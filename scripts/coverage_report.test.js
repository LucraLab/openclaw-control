#!/usr/bin/env node
/**
 * coverage_report.test.js — Tests for Bundle Coverage Report Tool
 *
 * Usage: node scripts/coverage_report.test.js
 * Exit 0 = all tests pass, Exit 1 = failures
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT = path.join(__dirname, 'coverage_report.js');
const BUNDLES_DIR = path.join(__dirname, '..', 'dist', 'bundles');
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

console.log('Coverage Report Tests');
console.log('=====================');
console.log('');

// Helper: run script, allow exit 0 or 1 (1 = critical gaps, which is valid output)
function runScript(extraArgs) {
  try {
    return execSync(`node "${SCRIPT}" ${extraArgs || ''}`, { encoding: 'utf8', timeout: 10000 });
  } catch (e) {
    // Exit 1 means critical gaps found — still valid output
    if (e.status === 1 && e.stdout) return e.stdout;
    throw e;
  }
}

// Test 1: Script runs without error in markdown mode
test('Markdown mode runs without crash', () => {
  const out = runScript();
  assert(out.includes('# Bundle Coverage Report'), 'Missing report header');
  assert(out.includes('## Summary'), 'Missing summary section');
  assert(out.includes('## Role Details'), 'Missing role details');
});

// Test 2: JSON mode produces valid JSON
test('JSON mode produces valid JSON', () => {
  const out = runScript('--json');
  const report = JSON.parse(out);
  assert(report.summary, 'Missing summary');
  assert(typeof report.summary.total_roles === 'number', 'total_roles not a number');
  assert(Array.isArray(report.roles), 'roles not an array');
  assert(Array.isArray(report.tools), 'tools not an array');
});

// Test 3: Report has expected structure
test('Report contains required fields', () => {
  const out = runScript('--json');
  const report = JSON.parse(out);
  const requiredSummary = ['total_roles', 'assigned_roles', 'unassigned_roles', 'coverage_pct', 'total_agents', 'total_tools', 'policy_violations'];
  for (const field of requiredSummary) {
    assert(field in report.summary, `Missing summary.${field}`);
  }
  assert(report.generated, 'Missing generated timestamp');
  assert(report.bundle_version, 'Missing bundle_version');
});

// Test 4: Roles have required fields
test('Each role has required fields', () => {
  const out = runScript('--json');
  const report = JSON.parse(out);
  for (const role of report.roles) {
    assert(role.role, `Role missing name`);
    assert(typeof role.tool_count === 'number', `${role.role} missing tool_count`);
    assert(typeof role.agent_count === 'number', `${role.role} missing agent_count`);
    assert(Array.isArray(role.assigned_agents), `${role.role} missing assigned_agents`);
  }
});

// Test 5: Tools have required fields
test('Each tool has required fields', () => {
  const out = runScript('--json');
  const report = JSON.parse(out);
  for (const tool of report.tools) {
    assert(tool.tool, 'Tool missing name');
    assert(typeof tool.role_count === 'number', `${tool.tool} missing role_count`);
    assert(Array.isArray(tool.roles), `${tool.tool} missing roles array`);
  }
});

// Test 6: No policy violations in current bundles
test('No policy violations in current bundles', () => {
  const out = runScript('--json');
  const report = JSON.parse(out);
  assert(report.violations.length === 0, `Found ${report.violations.length} violations`);
});

// Test 7: Custom bundles-dir flag works
test('--bundles-dir flag works', () => {
  const out = runScript(`--json --bundles-dir "${BUNDLES_DIR}"`);
  const report = JSON.parse(out);
  assert(report.summary.total_roles > 0, 'No roles found with custom dir');
});

// Test 8: Missing bundles dir exits with code 2
test('Missing bundles dir exits with code 2', () => {
  try {
    execSync(`node "${SCRIPT}" --json --bundles-dir /nonexistent/path`, { encoding: 'utf8', timeout: 10000 });
    throw new Error('Should have exited with error');
  } catch (e) {
    if (e.status === undefined) throw e; // rethrow if not exec error
    assert(e.status === 2, `Expected exit 2, got ${e.status}`);
  }
});

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
