#!/usr/bin/env node
/**
 * run_executive_strategy_gate.js — CI gate for Executive Strategy Engine (Port #12)
 *
 * Usage: node scripts/run_executive_strategy_gate.js [--ci]
 *
 * Smoke checks:
 *   ES1:  Schema module loads with required exports
 *   ES2:  Engine module loads with required exports
 *   ES3:  Dev intel lens module loads
 *   ES4:  Ops intel lens module loads
 *   ES5:  Business intel lens module loads
 *   ES6:  LLM assist module loads (disabled by default)
 *   ES7:  Engine produces valid report from fixtures
 *   ES8:  Report contains required fields
 *   ES9:  LLM assist is OFF by default
 *   ES10: Quarantined objective gets HOLD action
 *   ES11: Kill switch forces STOP action
 *   ES12: Artifacts are sanitized (no secrets)
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
console.log('  Executive Strategy — Gate Runner');
console.log(`  ${new Date().toISOString()}`);
console.log('============================================');
console.log('');

// --- ES1: Schema module ---
check('ES1_schema_module', () => {
  const schema = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_schema'));
  assert(typeof schema.validateObjectiveResult === 'function', 'validateObjectiveResult missing');
  assert(typeof schema.validateStrategyReport === 'function', 'validateStrategyReport missing');
  assert(typeof schema.makeDefaultResult === 'function', 'makeDefaultResult missing');
  assert(Array.isArray(schema.RECOMMENDED_ACTIONS), 'RECOMMENDED_ACTIONS missing');
  return `${schema.RECOMMENDED_ACTIONS.length} actions defined`;
});

// --- ES2: Engine module ---
check('ES2_engine_module', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  assert(typeof engine.run === 'function', 'run function missing');
  assert(typeof engine.scoreObjective === 'function', 'scoreObjective missing');
  assert(typeof engine.ENGINE_VERSION === 'string', 'ENGINE_VERSION missing');
  return `v${engine.ENGINE_VERSION}`;
});

// --- ES3: Dev intel module ---
check('ES3_dev_intel_module', () => {
  const mod = require(path.join(REPO_ROOT, 'scripts', 'modules', 'dev_intel'));
  assert(typeof mod.analyze === 'function', 'analyze function missing');
  return 'dev_intel.analyze loaded';
});

// --- ES4: Ops intel module ---
check('ES4_ops_intel_module', () => {
  const mod = require(path.join(REPO_ROOT, 'scripts', 'modules', 'ops_intel'));
  assert(typeof mod.analyze === 'function', 'analyze function missing');
  return 'ops_intel.analyze loaded';
});

// --- ES5: Business intel module ---
check('ES5_business_intel_module', () => {
  const mod = require(path.join(REPO_ROOT, 'scripts', 'modules', 'business_intel'));
  assert(typeof mod.analyze === 'function', 'analyze function missing');
  return 'business_intel.analyze loaded';
});

// --- ES6: LLM assist module ---
check('ES6_llm_assist_module', () => {
  const mod = require(path.join(REPO_ROOT, 'scripts', 'executive_llm_assist'));
  assert(typeof mod.assist === 'function', 'assist function missing');
  assert(typeof mod.MAX_INPUT_TOKENS === 'number', 'MAX_INPUT_TOKENS missing');
  assert(typeof mod.MAX_OUTPUT_TOKENS === 'number', 'MAX_OUTPUT_TOKENS missing');
  assert(mod.MAX_INPUT_TOKENS === 800, 'MAX_INPUT_TOKENS must be 800');
  assert(mod.MAX_OUTPUT_TOKENS === 400, 'MAX_OUTPUT_TOKENS must be 400');
  return 'LLM assist loaded with token limits 800/400';
});

// --- ES7: Engine produces valid report from fixtures ---
check('ES7_engine_fixtures_report', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const fixturesDir = path.join(REPO_ROOT, 'scripts', 'fixtures', 'executive_strategy');

  const objectives = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'objectives.json'), 'utf8'));
  const eventsRaw = fs.readFileSync(path.join(fixturesDir, 'events.jsonl'), 'utf8').trim();
  const events = eventsRaw.split('\n').map(l => JSON.parse(l));
  const gateReports = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'gate_reports.json'), 'utf8'));
  const quarantine = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'quarantine.json'), 'utf8'));

  const context = {
    events,
    gateReports,
    objectives,
    quarantine,
    killSwitch: false,
    commitSha: 'fixture-test',
  };

  const report = engine.run(context, { fixtures_mode: true });
  assert(report.status === 'OK', `Expected OK, got ${report.status}`);
  assert(report.objectives.length === 5, `Expected 5 objectives, got ${report.objectives.length}`);
  return `${report.objectives.length} objectives scored`;
});

// --- ES8: Report contains required fields ---
check('ES8_report_fields', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const schema = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_schema'));
  const fixturesDir = path.join(REPO_ROOT, 'scripts', 'fixtures', 'executive_strategy');

  const objectives = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'objectives.json'), 'utf8'));
  const events = fs.readFileSync(path.join(fixturesDir, 'events.jsonl'), 'utf8').trim()
    .split('\n').map(l => JSON.parse(l));
  const gateReports = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'gate_reports.json'), 'utf8'));
  const quarantine = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'quarantine.json'), 'utf8'));

  const report = engine.run(
    { events, gateReports, objectives, quarantine, killSwitch: false, commitSha: 'test' },
    { fixtures_mode: true }
  );

  // Check report envelope
  const rv = schema.validateStrategyReport(report);
  assert(rv.valid, `Report validation failed: ${rv.errors.join(', ')}`);

  // Check each objective result
  for (const obj of report.objectives) {
    const ov = schema.validateObjectiveResult(obj);
    assert(ov.valid, `Objective ${obj.objective_id} validation: ${ov.errors.join(', ')}`);
  }

  return 'All report fields valid';
});

// --- ES9: LLM assist OFF by default ---
check('ES9_llm_off_by_default', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const report = engine.run(
    { events: [], gateReports: {}, objectives: { 'obj-1': { objective_id: 'obj-1' } }, quarantine: {}, killSwitch: false, commitSha: 'test' },
    {}
  );
  assert(report.llm_used === false, 'LLM should not be used by default');
  assert(report.llm_enabled === false, 'LLM should not be enabled by default');
  const skipEvent = report.events.find(e => e.event === 'EXEC_STRATEGY_LLM_SKIPPED');
  assert(skipEvent, 'EXEC_STRATEGY_LLM_SKIPPED event missing');
  assert(skipEvent.reason === 'disabled', `Expected reason=disabled, got ${skipEvent.reason}`);
  return 'LLM assist confirmed OFF';
});

// --- ES10: Quarantined objective gets HOLD ---
check('ES10_quarantine_hold', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const report = engine.run(
    {
      events: [],
      gateReports: {},
      objectives: { 'obj-q': { objective_id: 'obj-q', tags: [] } },
      quarantine: { 'obj-q': { quarantined: true, reason: 'repeated_failure' } },
      killSwitch: false,
      commitSha: 'test',
    },
    { fixtures_mode: true }
  );
  const obj = report.objectives.find(o => o.objective_id === 'obj-q');
  assert(obj, 'obj-q not found');
  assert(obj.recommended_action === 'HOLD', `Expected HOLD, got ${obj.recommended_action}`);
  return 'Quarantined → HOLD confirmed';
});

// --- ES11: Kill switch forces STOP ---
check('ES11_kill_switch_stop', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const report = engine.run(
    {
      events: [],
      gateReports: {},
      objectives: { 'obj-k': { objective_id: 'obj-k', tags: ['revenue'] } },
      quarantine: {},
      killSwitch: true,
      commitSha: 'test',
    },
    { fixtures_mode: true }
  );
  const obj = report.objectives.find(o => o.objective_id === 'obj-k');
  assert(obj, 'obj-k not found');
  assert(obj.recommended_action === 'STOP', `Expected STOP, got ${obj.recommended_action}`);
  return 'Kill switch → STOP confirmed';
});

// --- ES12: Artifacts sanitized ---
check('ES12_sanitized_output', () => {
  const engine = require(path.join(REPO_ROOT, 'scripts', 'executive_strategy_engine'));
  const report = engine.run(
    {
      events: [{ event: 'TEST', objective_id: 'obj-s', token: 'sk-secret12345abc' }],
      gateReports: {},
      objectives: { 'obj-s': { objective_id: 'obj-s', tags: [] } },
      quarantine: {},
      killSwitch: false,
      commitSha: 'test',
    },
    { fixtures_mode: true }
  );
  const reportStr = JSON.stringify(report);
  assert(!reportStr.includes('sk-secret12345abc'), 'Secret should be redacted');
  return 'No secrets in output';
});

// --- Summary ---
console.log('');
const total = passed + failed;
console.log(`Executive Strategy Gate: ${passed}/${total} checks passed`);

if (failed > 0) {
  console.log(`GATE FAIL: ${failed} check(s) failed`);
}

// --- Artifact generation ---
const report = {
  gate: 'executive-strategy',
  timestamp: new Date().toISOString(),
  status: failed === 0 ? 'PASS' : 'FAIL',
  passed,
  failed,
  total,
  findings,
  config: {
    llm_enabled_default: false,
    llm_max_input_tokens: 800,
    llm_max_output_tokens: 400,
    lenses: ['dev_intel', 'ops_intel', 'business_intel'],
  },
};

for (const dir of ['artifacts', 'tmp']) {
  const outDir = path.join(REPO_ROOT, dir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'executive-strategy-report.json'),
    JSON.stringify(report, null, 2) + '\n'
  );

  const md = `# Executive Strategy Gate Report

**Date:** ${report.timestamp}
**Status:** ${report.status}
**Checks:** ${passed}/${total}

## Engine
- Version: 1.0.0
- LLM assist: OFF by default
- Lenses: dev_intel, ops_intel, business_intel

## Checks
${findings.map(f => `- ${f.status}: ${f.check}${f.detail ? ' — ' + f.detail : ''}`).join('\n')}
`;
  fs.writeFileSync(path.join(outDir, 'executive-strategy-report.md'), md);
}

process.exit(failed > 0 ? 1 : 0);
