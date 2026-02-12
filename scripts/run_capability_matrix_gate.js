#!/usr/bin/env node
/**
 * run_capability_matrix_gate.js — CI gate runner for capability matrix enforcement
 *
 * Verifies that:
 *   1. Capability policy module loads without error
 *   2. Agent profiles are valid and load correctly
 *   3. All chokepoint wrappers enforce capability checks
 *   4. Deny events and proof artifacts work
 *   5. Fail-closed defaults work
 *
 * Produces tmp/capability-matrix-report.json + tmp/capability-matrix-report.md
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
  EXIT_CAPABILITY_DENIED,
  SIDE_EFFECT_CLASSES,
  EXPENSIVE_MODELS,
  DEFAULT_PROFILE,
  loadProfile,
  checkModelCapability,
  checkToolCapability,
  checkWritePath,
  invokeModel,
  invokeTool,
  safeWriteFile,
  generateDenyProof,
  buildReport,
  _resetEventTracking
} = require('./capability_policy.js');

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
    _resetEventTracking();
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
    const required = [
      'invokeModel', 'invokeTool', 'safeWriteFile',
      'loadProfile', 'checkModelCapability', 'checkToolCapability',
      'checkWritePath', 'generateDenyProof', 'buildReport',
      'EXIT_CAPABILITY_DENIED', 'DEFAULT_PROFILE'
    ];
    for (const name of required) {
      if (typeof require('./capability_policy.js')[name] === 'undefined') {
        throw new Error(`Missing export: ${name}`);
      }
    }
  });

  // Check 2: Builder profile loads
  smokeCheck('builder_profile_loads', () => {
    const profilePath = path.join(repoDir, 'capabilities', 'agents', 'builder.json');
    if (!fs.existsSync(profilePath)) throw new Error('builder.json not found');
    const raw = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const profile = loadProfile(raw);
    if (profile.agent_id !== 'builder') throw new Error('Wrong agent_id');
    if (profile.models_allowed.length === 0) throw new Error('No models allowed');
    if (profile.tools_allowed.length === 0) throw new Error('No tools allowed');
  });

  // Check 3: Executor profile loads
  smokeCheck('executor_profile_loads', () => {
    const profilePath = path.join(repoDir, 'capabilities', 'agents', 'executor.json');
    if (!fs.existsSync(profilePath)) throw new Error('executor.json not found');
    const raw = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const profile = loadProfile(raw);
    if (profile.agent_id !== 'executor') throw new Error('Wrong agent_id');
    if (profile.models_denied.length === 0) throw new Error('No models denied');
  });

  // Check 4: Model capability enforced
  smokeCheck('model_capability_enforced', () => {
    const profile = loadProfile({ agent_id: 'test', models_allowed: ['claude-sonnet-4-5'] });
    const r = invokeModel(null, profile, { model: 'gpt-4o' });
    if (r.allowed) throw new Error('Should deny model not in allowlist');
  });

  // Check 5: Tool capability enforced
  smokeCheck('tool_capability_enforced', () => {
    const profile = loadProfile({ agent_id: 'test', tools_allowed: ['read'] });
    const r = invokeTool(null, profile, { tool: 'deploy' });
    if (r.allowed) throw new Error('Should deny tool not in allowlist');
  });

  // Check 6: Write path enforced
  smokeCheck('write_path_enforced', () => {
    const profile = loadProfile({ agent_id: 'test', write_allow: ['tmp/'], write_deny: ['.env'] });
    const r1 = safeWriteFile(null, profile, { filePath: '.env' });
    if (r1.allowed) throw new Error('Should deny write to .env');
    const r2 = safeWriteFile(null, profile, { filePath: 'tmp/test.json' });
    if (!r2.allowed) throw new Error('Should allow write to tmp/');
  });

  // Check 7: Side-effect gating
  smokeCheck('side_effect_gating', () => {
    const profile = loadProfile({
      agent_id: 'test',
      tools_allowed: ['bash'],
      side_effect_approval_required: ['deploy']
    });
    const r = invokeTool(null, profile, { tool: 'bash', sideEffectClass: 'deploy' });
    if (r.allowed) throw new Error('Should deny side-effect without approval');
  });

  // Check 8: Fail-closed defaults
  smokeCheck('fail_closed_defaults', () => {
    const profile = loadProfile(null); // null = default profile
    const m = invokeModel(null, profile, { model: 'claude-sonnet-4-5' });
    if (m.allowed) throw new Error('Default profile should deny all models');
    const t = invokeTool(null, profile, { tool: 'read' });
    if (t.allowed) throw new Error('Default profile should deny all tools');
    const w = safeWriteFile(null, profile, { filePath: 'anything.txt' });
    if (w.allowed) throw new Error('Default profile should deny all writes');
  });

  // Check 9: Deny proof generation
  smokeCheck('deny_proof_generation', () => {
    const profile = loadProfile({ agent_id: 'test', models_allowed: [] });
    const r = invokeModel(null, profile, { model: 'test-model' });
    if (!r.event) throw new Error('Deny should produce event');
    const proof = generateDenyProof(r.event);
    if (!proof.md || proof.md.length === 0) throw new Error('MD proof empty');
    if (proof.json.type !== 'CAPABILITY_DENIED') throw new Error('Wrong proof type');
  });

  // Check 10: Exit code constant
  smokeCheck('exit_code_defined', () => {
    if (EXIT_CAPABILITY_DENIED !== 17) throw new Error(`Expected exit code 17, got ${EXIT_CAPABILITY_DENIED}`);
  });

  // Check 11: Model escalation guard compatible with Port #4
  smokeCheck('model_escalation_guard', () => {
    const profile = loadProfile({ agent_id: 'test', models_allowed: ['claude-opus-4-6'] });
    const r1 = invokeModel(null, profile, {
      model: 'claude-opus-4-6', execution_mode: 'planning', escalation_reason: 'test'
    });
    if (r1.allowed) throw new Error('Should block expensive model in planning mode');
  });

  // Check 12: Profiles have no secrets
  smokeCheck('profiles_contain_no_secrets', () => {
    const profileDir = path.join(repoDir, 'capabilities', 'agents');
    if (!fs.existsSync(profileDir)) throw new Error('Profile directory not found');
    const files = fs.readdirSync(profileDir).filter(f => f.endsWith('.json'));
    const secretPatterns = [/sk-[a-zA-Z0-9_-]{8,}/, /ghp_[a-zA-Z0-9]{8,}/, /AKIA[A-Z0-9]{8,}/];
    for (const file of files) {
      const content = fs.readFileSync(path.join(profileDir, file), 'utf8');
      for (const p of secretPatterns) {
        if (p.test(content)) {
          throw new Error(`Secret pattern found in ${file}`);
        }
      }
    }
  });

  return { checksPassed, checksFailed, findings };
}

// ─── Main ───

function main() {
  console.log('Capability Matrix Gate');
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

  const jsonPath = path.join(tmpDir, 'capability-matrix-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');

  // Generate markdown summary
  const mdLines = [
    '# Capability Matrix Gate Report',
    '',
    `**Status:** ${status}`,
    `**Checks:** ${checksPassed} passed, ${checksFailed} failed`,
    `**Time:** ${report.timestamp_utc}`,
    '',
    '## Chokepoint Wrappers',
    '',
    '- invokeModel() — model capability + escalation + budget',
    '- invokeTool() — tool capability + side-effect approval',
    '- safeWriteFile() — write path scope',
    '',
    '## Side-Effect Classes',
    '',
    SIDE_EFFECT_CLASSES.map(c => `- ${c}`).join('\n'),
    '',
    '## Expensive Models (escalation-guarded)',
    '',
    EXPENSIVE_MODELS.map(m => `- ${m}`).join('\n'),
    '',
    '## Exit Code',
    '',
    `CAPABILITY_DENIED = ${EXIT_CAPABILITY_DENIED}`,
    ''
  ];

  if (findings.length > 0) {
    mdLines.push('## Findings', '');
    for (const f of findings) {
      mdLines.push(`- **${f.severity}** [${f.rule}]: ${f.message}`);
    }
    mdLines.push('');
  }

  const mdPath = path.join(tmpDir, 'capability-matrix-report.md');
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
