#!/usr/bin/env node
/**
 * run_context_budget.js — Runner for context budget enforcement
 *
 * Scans the repo for all budget-tracked artifacts, evaluates them,
 * and produces a JSON report at tmp/context-budget-report.json.
 *
 * Usage:
 *   node scripts/run_context_budget.js [--ci] [--repo-dir <path>]
 *
 * Exit codes:
 *   0 = all budgets within limits (or only WARN violations)
 *   1 = at least one FAIL violation
 *   2 = internal error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_BUDGETS,
  extractRoleBlocks,
  evaluateRoleBudgets,
  evaluateFileBudget,
  buildReport
} = require('./context_budget_policy.js');

// ─── Parse args ───

const args = process.argv.slice(2);
const isCI = args.includes('--ci');
const repoDirIdx = args.indexOf('--repo-dir');
const repoDir = repoDirIdx >= 0 ? args[repoDirIdx + 1] : process.cwd();

// ─── Load overrides ───

function loadOverrides(dir) {
  const overridePath = path.join(dir, '.context-budget-overrides.json');
  if (fs.existsSync(overridePath)) {
    try {
      return JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    } catch (e) {
      console.error(`Warning: Failed to parse ${overridePath}: ${e.message}`);
      return {};
    }
  }
  return {};
}

// ─── Read file safely ───

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// ─── Find skill directories ───

function findSkillDirs(dir) {
  const skillsDir = path.join(dir, 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

// ─── Main ───

function main() {
  console.log('Context Budget Enforcement');
  console.log('='.repeat(50));
  console.log(`Repo: ${repoDir}`);
  console.log(`CI mode: ${isCI}`);
  console.log();

  const overrides = loadOverrides(repoDir);
  const roleOverrides = overrides.roles || {};
  const allViolations = [];
  let filesChecked = 0;
  let rolesChecked = 0;

  // 1. Check ROLE_REGISTRY.yaml per-role blocks
  const registryPath = path.join(repoDir, 'registry', 'ROLE_REGISTRY.yaml');
  const registryText = readFileSafe(registryPath);

  if (registryText) {
    console.log('Checking role blocks in registry/ROLE_REGISTRY.yaml...');
    const blocks = extractRoleBlocks(registryText);
    rolesChecked = blocks.size;
    const rv = evaluateRoleBudgets(registryText, DEFAULT_BUDGETS.role_block, roleOverrides);
    allViolations.push(...rv);
    console.log(`  ${blocks.size} roles checked, ${rv.filter(v => v.severity === 'FAIL').length} FAIL, ${rv.filter(v => v.severity === 'WARN').length} WARN`);
    filesChecked++;
  } else {
    console.log('Warning: registry/ROLE_REGISTRY.yaml not found');
  }

  // 2. Check skill files (SPEC.md, runbook.md)
  const skillDirs = findSkillDirs(repoDir);
  for (const skill of skillDirs) {
    const specPath = path.join(repoDir, 'skills', skill, 'SPEC.md');
    const specText = readFileSafe(specPath);
    const specViolations = evaluateFileBudget(
      `skills/${skill}/SPEC.md`, specText, DEFAULT_BUDGETS.spec_md
    );
    allViolations.push(...specViolations);
    filesChecked++;

    const runbookPath = path.join(repoDir, 'skills', skill, 'runbook.md');
    const runbookText = readFileSafe(runbookPath);
    const runbookViolations = evaluateFileBudget(
      `skills/${skill}/runbook.md`, runbookText, DEFAULT_BUDGETS.runbook_md
    );
    allViolations.push(...runbookViolations);
    filesChecked++;

    const specStatus = specViolations.filter(v => v.severity === 'FAIL').length === 0 ? 'OK' : 'FAIL';
    const runbookStatus = runbookViolations.filter(v => v.severity === 'FAIL').length === 0 ? 'OK' : 'FAIL';
    console.log(`  skills/${skill}/SPEC.md: ${specStatus}`);
    console.log(`  skills/${skill}/runbook.md: ${runbookStatus}`);
  }

  // 3. Check CLAUDE.md (optional)
  const claudePath = path.join(repoDir, 'CLAUDE.md');
  const claudeText = readFileSafe(claudePath);
  const claudeViolations = evaluateFileBudget('CLAUDE.md', claudeText, DEFAULT_BUDGETS.claude_md);
  // Only add non-missing violations to the report (missing CLAUDE.md is fine)
  const claudeReal = claudeViolations.filter(v => v.metric !== 'missing');
  allViolations.push(...claudeViolations);
  filesChecked++;
  if (claudeText === null) {
    console.log('  CLAUDE.md: not present (OK)');
  } else {
    const claudeStatus = claudeReal.filter(v => v.severity === 'FAIL').length === 0 ? 'OK' : 'FAIL';
    console.log(`  CLAUDE.md: ${claudeStatus}`);
  }

  // 4. Check root README.md (warn-only)
  const readmePath = path.join(repoDir, 'README.md');
  const readmeText = readFileSafe(readmePath);
  const readmeViolations = evaluateFileBudget('README.md', readmeText, DEFAULT_BUDGETS.readme_md);
  allViolations.push(...readmeViolations);
  filesChecked++;

  if (readmeText === null) {
    console.log('  README.md: not present');
  } else {
    const warns = readmeViolations.filter(v => v.severity === 'WARN').length;
    console.log(`  README.md: ${warns > 0 ? warns + ' WARN' : 'OK'} (warn-only)`);
  }

  // ─── Summary ───

  const failCount = allViolations.filter(v => v.severity === 'FAIL').length;
  const warnCount = allViolations.filter(v => v.severity === 'WARN').length;
  const status = failCount > 0 ? 'FAIL' : 'PASS';

  console.log();
  console.log('='.repeat(50));
  console.log(`Status: ${status}`);
  console.log(`Files checked: ${filesChecked}`);
  console.log(`Roles checked: ${rolesChecked}`);
  console.log(`Violations: ${failCount} FAIL, ${warnCount} WARN`);

  if (failCount > 0) {
    console.log('\nFAIL violations:');
    for (const v of allViolations.filter(v => v.severity === 'FAIL')) {
      console.log(`  ${v.file} [${v.block}] ${v.metric}: ${v.actual} > ${v.limit}`);
    }
  }

  if (warnCount > 0) {
    console.log('\nWARN violations:');
    for (const v of allViolations.filter(v => v.severity === 'WARN' && v.metric !== 'missing')) {
      console.log(`  ${v.file} [${v.block}] ${v.metric}: ${v.actual} > ${v.limit}`);
    }
  }

  // ─── Write report ───

  const report = buildReport({
    status,
    violations: allViolations,
    files_checked: filesChecked,
    roles_checked: rolesChecked,
    run_id: process.env.GITHUB_RUN_ID || 'local',
    commit_sha: process.env.GITHUB_SHA || 'local'
  });

  const tmpDir = path.join(repoDir, 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const reportPath = path.join(tmpDir, 'context-budget-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nReport: ${reportPath}`);

  process.exit(failCount > 0 ? 1 : 0);
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(2);
}
