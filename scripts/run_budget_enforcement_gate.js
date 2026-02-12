#!/usr/bin/env node
/**
 * run_budget_enforcement_gate.js — CI gate runner for budget enforcement
 *
 * Verifies that:
 *   1. Budget policy module loads without error
 *   2. All budget types are enforced (smoke test via createTracker + checkBudget)
 *   3. Model escalation guard is functional
 *   4. Proof artifact generation works
 *
 * Produces tmp/budget-enforcement-report.json + tmp/budget-enforcement-report.md
 *
 * Exit codes:
 *   0  = all checks pass
 *   1  = check failure
 *   2  = internal error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_BUDGETS,
  EXPENSIVE_MODELS,
  EXIT_BUDGET_EXCEEDED,
  createTracker,
  recordTokens,
  recordStep,
  recordRetry,
  checkBudget,
  checkModelEscalation,
  generateBreachProof,
  buildReport
} = require('./budget_enforcement_policy.js');

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

  // Check 1: Policy module exports are present
  smokeCheck('policy_module_exports', () => {
    const required = ['createTracker', 'checkBudget', 'checkModelEscalation',
      'generateBreachProof', 'buildReport', 'EXIT_BUDGET_EXCEEDED'];
    for (const name of required) {
      if (typeof require('./budget_enforcement_policy.js')[name] === 'undefined') {
        throw new Error(`Missing export: ${name}`);
      }
    }
  });

  // Check 2: Budget types enforced
  smokeCheck('token_budget_enforced', () => {
    const t = createTracker({ objective_id: 'smoke-1' });
    recordTokens(t, DEFAULT_BUDGETS.max_tokens_total + 1);
    const r = checkBudget(t);
    if (!r.exceeded) throw new Error('Token budget not enforced');
  });

  smokeCheck('step_budget_enforced', () => {
    const t = createTracker({ objective_id: 'smoke-2' });
    for (let i = 0; i <= DEFAULT_BUDGETS.max_steps; i++) recordStep(t);
    const r = checkBudget(t);
    if (!r.exceeded) throw new Error('Step budget not enforced');
  });

  smokeCheck('retry_budget_enforced', () => {
    const t = createTracker({ objective_id: 'smoke-3' });
    for (let i = 0; i <= DEFAULT_BUDGETS.max_retries; i++) recordRetry(t);
    const r = checkBudget(t);
    if (!r.exceeded) throw new Error('Retry budget not enforced');
  });

  smokeCheck('wall_clock_budget_enforced', () => {
    const t = createTracker({ objective_id: 'smoke-4' });
    t.counters.wall_clock_start_ms = Date.now() - (DEFAULT_BUDGETS.max_wall_clock_ms + 1000);
    const r = checkBudget(t);
    if (!r.exceeded) throw new Error('Wall clock budget not enforced');
  });

  // Check 3: Model escalation guard
  smokeCheck('model_escalation_blocks_planning', () => {
    const r = checkModelEscalation({
      model: 'claude-opus-4-6', execution_mode: 'planning', escalation_reason: 'test'
    });
    if (r.allowed) throw new Error('Should block in planning mode');
  });

  smokeCheck('model_escalation_allows_final_with_reason', () => {
    const r = checkModelEscalation({
      model: 'claude-opus-4-6', execution_mode: 'final', escalation_reason: 'safety review'
    });
    if (!r.allowed) throw new Error('Should allow in final mode with reason');
  });

  // Check 4: Proof generation
  smokeCheck('proof_generation', () => {
    const t = createTracker({ objective_id: 'smoke-proof' });
    recordTokens(t, DEFAULT_BUDGETS.max_tokens_total + 1);
    checkBudget(t);
    const proof = generateBreachProof(t);
    if (!proof.md || !proof.json) throw new Error('Proof missing md or json');
    if (proof.json.type !== 'BUDGET_EXCEEDED') throw new Error('Wrong proof type');
  });

  // Check 5: Exit code constant
  smokeCheck('exit_code_defined', () => {
    if (EXIT_BUDGET_EXCEEDED !== 16) throw new Error(`Expected exit code 16, got ${EXIT_BUDGET_EXCEEDED}`);
  });

  return { checksPassed, checksFailed, findings };
}

// ─── Main ───

function main() {
  console.log('Budget Enforcement Gate');
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
    commit_sha: process.env.GITHUB_SHA || 'local'
  });

  const tmpDir = path.join(repoDir, 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const jsonPath = path.join(tmpDir, 'budget-enforcement-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');

  // Generate markdown summary
  const mdLines = [
    '# Budget Enforcement Gate Report',
    '',
    `**Status:** ${status}`,
    `**Checks:** ${checksPassed} passed, ${checksFailed} failed`,
    `**Time:** ${report.timestamp_utc}`,
    '',
    '## Defaults',
    '',
    `- max_tokens_total: ${DEFAULT_BUDGETS.max_tokens_total}`,
    `- max_steps: ${DEFAULT_BUDGETS.max_steps}`,
    `- max_retries: ${DEFAULT_BUDGETS.max_retries}`,
    `- max_wall_clock_ms: ${DEFAULT_BUDGETS.max_wall_clock_ms}`,
    '',
    '## Expensive Models',
    '',
    EXPENSIVE_MODELS.map(m => `- ${m}`).join('\n'),
    '',
    '## Exit Code',
    '',
    `BUDGET_EXCEEDED = ${EXIT_BUDGET_EXCEEDED}`,
    ''
  ];

  if (findings.length > 0) {
    mdLines.push('## Findings', '');
    for (const f of findings) {
      mdLines.push(`- **${f.severity}** [${f.rule}]: ${f.message}`);
    }
    mdLines.push('');
  }

  const mdPath = path.join(tmpDir, 'budget-enforcement-report.md');
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
