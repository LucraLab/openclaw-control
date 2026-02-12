#!/usr/bin/env node
/**
 * fix_pack.js — Safe Autopilot Fix Pack v1 (Port #15)
 *
 * Generates a deterministic, bounded, advisory-only fix pack from an
 * evidence graph. Answers: what's wrong, what to do, how to verify,
 * how to roll back.
 *
 * NEVER executes fixes. Advisory only.
 * No network calls, no LLM by default, no shelling out.
 * Deterministic: same inputs → identical output.
 */

'use strict';

const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════════
// Constants & Enums
// ═══════════════════════════════════════════════════════════════════════════

const FIXPACK_VERSION = 'v1';
const MODES = ['rules-only', 'hybrid'];
const SEVERITY_LEVELS = ['low', 'med', 'high'];
const RISK_LEVELS = ['low', 'med', 'high'];

const REASON_CODES = [
  'KILL_SWITCH', 'QUARANTINE', 'HIGH_RISK', 'LOW_CONFIDENCE',
  'DRIFT_DETECTED', 'BUDGET_EXCEEDED', 'SCHEMA_INVALID', 'FORCED_ZERO',
];

const DIAGNOSIS_CODES = [
  'FP-D-KILL_SWITCH', 'FP-D-QUARANTINE',
  'FP-D-HIGH_RISK', 'FP-D-ELEVATED_RISK',
  'FP-D-LOW_CONFIDENCE', 'FP-D-FORCED_ZERO',
  'FP-D-DRIFT', 'FP-D-BUDGET',
  'FP-D-OVERRIDE', 'FP-D-CLAMP',
];

// ═══════════════════════════════════════════════════════════════════════════
// Command Allowlist
// ═══════════════════════════════════════════════════════════════════════════

var ALLOWED_COMMAND_PATTERNS = [
  /^node scripts\/[\w_]+\.test\.js$/,
  /^node scripts\/run_[\w_]+_gate\.js --ci$/,
  /^git status$/,
  /^git diff$/,
  /^git diff [\w\-\.\/]+$/,
  /^git log --oneline -\d{1,3}$/,
  /^git log -\d{1,3}$/,
  /^git show [0-9a-f]{6,40}$/,
  /^git revert --no-edit [0-9a-f]{6,40}$/,
];

var FORBIDDEN_PATTERNS = [
  /curl\b/i, /wget\b/i, /ssh\b/i, /scp\b/i,
  /npm\s+publish/i, /deploy/i,
  /rm\s+-rf/i, /rm\s+-r\b/i, /rmdir\b/i,
  /mkfs\b/i, /dd\s+if=/i, /shutdown\b/i, /reboot\b/i,
  /chmod\s+777/i, /kill\s+-9/i,
  /https?:\/\//i,
  /\|\s*bash/i, /\beval\s/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// Secret Pattern (same as evidence graph)
// ═══════════════════════════════════════════════════════════════════════════

var SECRET_PATTERN = /sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36,}|pit-[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9_-]{20,}|token=[A-Za-z0-9_-]{20,}|key=[A-Za-z0-9_-]{20,}|password=[^\s&]{8,}|secret=[^\s&]{8,}|-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END/g;

// ═══════════════════════════════════════════════════════════════════════════
// Bounds
// ═══════════════════════════════════════════════════════════════════════════

var LIMITS = {
  max_reason_codes: 8,
  max_diagnosis: 20,
  max_evidence_refs: 10,
  max_proposed_changes: 10,
  max_target_files: 10,
  max_guardrails: 8,
  max_commands: 15,
  max_tests_to_run: 20,
  max_stop_conditions: 10,
  max_rollback_steps: 10,
  max_string_length: 256,
};

var LLM_DEFAULTS = {
  max_input_tokens: 800,
  max_output_tokens: 400,
};

// ═══════════════════════════════════════════════════════════════════════════
// Diagnosis → Remediation Mapping
// ═══════════════════════════════════════════════════════════════════════════

var DIAG_COMMANDS = {
  'FP-D-KILL_SWITCH':    { gate: null, test: 'node scripts/isolation_guard.test.js', git: 'git status' },
  'FP-D-QUARANTINE':     { gate: 'node scripts/run_arbitration_gate.js --ci', test: 'node scripts/arbitration.test.js' },
  'FP-D-HIGH_RISK':      { gate: 'node scripts/run_executive_strategy_gate.js --ci', test: 'node scripts/executive_strategy.test.js' },
  'FP-D-ELEVATED_RISK':  { gate: 'node scripts/run_executive_strategy_gate.js --ci', test: 'node scripts/executive_strategy.test.js' },
  'FP-D-LOW_CONFIDENCE': { gate: 'node scripts/run_evidence_graph_gate.js --ci', test: 'node scripts/evidence_graph.test.js' },
  'FP-D-FORCED_ZERO':    { gate: 'node scripts/run_arbiter_hints_gate.js --ci', test: 'node scripts/arbiter_hints.test.js' },
  'FP-D-DRIFT':          { gate: 'node scripts/run_drift_telemetry_gate.js --ci', test: 'node scripts/drift_telemetry.test.js' },
  'FP-D-BUDGET':         { gate: 'node scripts/run_budget_enforcement_gate.js --ci', test: 'node scripts/budget_enforcement.test.js' },
  'FP-D-OVERRIDE':       { gate: 'node scripts/run_executive_strategy_gate.js --ci', test: 'node scripts/executive_strategy.test.js' },
  'FP-D-CLAMP':          { gate: 'node scripts/run_executive_strategy_gate.js --ci', test: 'node scripts/executive_strategy.test.js' },
};

var DIAG_TARGET_FILES = {
  'FP-D-KILL_SWITCH':    [],
  'FP-D-QUARANTINE':     ['scripts/arbitration.test.js'],
  'FP-D-HIGH_RISK':      ['scripts/executive_strategy_engine.js'],
  'FP-D-ELEVATED_RISK':  ['scripts/executive_strategy_engine.js'],
  'FP-D-LOW_CONFIDENCE': ['scripts/executive_evidence_graph.js'],
  'FP-D-FORCED_ZERO':    ['scripts/executive_strategy_hints.js'],
  'FP-D-DRIFT':          ['scripts/run_drift_telemetry_gate.js'],
  'FP-D-BUDGET':         ['scripts/run_budget_enforcement_gate.js'],
  'FP-D-OVERRIDE':       ['scripts/executive_strategy_engine.js'],
  'FP-D-CLAMP':          ['scripts/executive_strategy_engine.js'],
};

var DIAG_INTENTS = {
  'FP-D-KILL_SWITCH':    'Hold all changes; document evidence for maintainer escalation',
  'FP-D-QUARANTINE':     'Contain scope; verify quarantine boundaries before proceeding',
  'FP-D-HIGH_RISK':      'Reduce risk through targeted mitigation; lower blast radius',
  'FP-D-ELEVATED_RISK':  'Monitor risk level; prepare mitigation if risk increases',
  'FP-D-LOW_CONFIDENCE': 'Increase confidence through additional evidence and testing',
  'FP-D-FORCED_ZERO':    'Review forced-zero conditions; verify safety constraints',
  'FP-D-DRIFT':          'Update drift baselines or fix drifted configuration',
  'FP-D-BUDGET':         'Review budget allocation; reduce scope or adjust thresholds',
  'FP-D-OVERRIDE':       'Verify override conditions are still valid and appropriate',
  'FP-D-CLAMP':          'Review unclamped values; assess if bounds are appropriate',
};

var DEFAULT_GUARDRAILS = [
  'Run full test suite before and after any change',
  'Create backup branch before modifying files',
  'Verify no regressions in gate checks',
  'Keep branch protection enabled at all times',
];

var DEFAULT_STOP_CONDITIONS = [
  'Any test suite failure after change',
  'Any gate check failure after change',
  'Risk score increases after fix attempt',
  'New forced-zero condition appears',
  'Branch protection check count decreases',
];

var DEFAULT_ROLLBACK = [
  'git revert --no-edit <commit_sha>',
  'Run full test regression to confirm revert is clean',
  'Restore branch protection if modified',
];

// ═══════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════

function truncate(str, maxLen) {
  if (typeof str !== 'string') return '';
  maxLen = maxLen || LIMITS.max_string_length;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.replace(new RegExp(SECRET_PATTERN.source, 'g'), '[REDACTED]');
}

function sanitize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (typeof obj === 'object') {
    var result = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      result[keys[i]] = sanitize(obj[keys[i]]);
    }
    return result;
  }
  return obj;
}

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function sortedStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(sortedStringify).join(',') + ']';
  var keys = Object.keys(obj).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    parts.push(JSON.stringify(keys[i]) + ':' + sortedStringify(obj[keys[i]]));
  }
  return '{' + parts.join(',') + '}';
}

// ═══════════════════════════════════════════════════════════════════════════
// Command Allowlist Enforcement
// ═══════════════════════════════════════════════════════════════════════════

function isCommandAllowed(cmd) {
  if (typeof cmd !== 'string') return false;
  var trimmed = cmd.trim();
  if (trimmed.length === 0) return false;
  // Forbidden check first (defense in depth)
  for (var i = 0; i < FORBIDDEN_PATTERNS.length; i++) {
    if (FORBIDDEN_PATTERNS[i].test(trimmed)) return false;
  }
  // Allowed check
  for (var j = 0; j < ALLOWED_COMMAND_PATTERNS.length; j++) {
    if (ALLOWED_COMMAND_PATTERNS[j].test(trimmed)) return true;
  }
  return false; // default deny
}

// ═══════════════════════════════════════════════════════════════════════════
// Objective Selection (deterministic)
// ═══════════════════════════════════════════════════════════════════════════

function selectObjective(objectives, context) {
  if (!Array.isArray(objectives) || objectives.length === 0) return null;
  context = context || {};

  // Kill switch override — highest priority
  if (context.killSwitch) {
    for (var i = 0; i < objectives.length; i++) {
      if (objectives[i].hint && objectives[i].hint.forced_zero_reason === 'KILL_SWITCH') {
        return { objective_id: objectives[i].objective_id, reason_codes: ['KILL_SWITCH'] };
      }
    }
    // No KILL_SWITCH objective → select first by ID (deterministic)
    var byId = objectives.slice().sort(function (a, b) { return a.objective_id.localeCompare(b.objective_id); });
    return { objective_id: byId[0].objective_id, reason_codes: ['KILL_SWITCH'] };
  }

  // Quarantine override
  if (context.quarantine) {
    for (var q = 0; q < objectives.length; q++) {
      if (objectives[q].hint && objectives[q].hint.forced_zero_reason === 'QUARANTINE') {
        return { objective_id: objectives[q].objective_id, reason_codes: ['QUARANTINE'] };
      }
    }
    // No QUARANTINE objective → fall through to default
  }

  // Default: highest risk_score → lowest confidence → objective_id
  var sorted = objectives.slice().sort(function (a, b) {
    var riskA = (a.strategy && typeof a.strategy.risk_score === 'number') ? a.strategy.risk_score : 0;
    var riskB = (b.strategy && typeof b.strategy.risk_score === 'number') ? b.strategy.risk_score : 0;
    if (riskB !== riskA) return riskB - riskA;
    var confA = (a.strategy && typeof a.strategy.confidence === 'number') ? a.strategy.confidence : 1;
    var confB = (b.strategy && typeof b.strategy.confidence === 'number') ? b.strategy.confidence : 1;
    if (confA !== confB) return confA - confB;
    return a.objective_id.localeCompare(b.objective_id);
  });

  var sel = sorted[0];
  var codes = [];
  if (sel.strategy) {
    if (sel.strategy.risk_score >= 90) codes.push('HIGH_RISK');
    if (sel.strategy.confidence < 0.4) codes.push('LOW_CONFIDENCE');
  }
  if (sel.hint && sel.hint.forced_zero_reason && sel.hint.forced_zero_reason !== 'NONE') {
    codes.push('FORCED_ZERO');
  }
  if (codes.length === 0) codes.push('HIGH_RISK'); // default reason
  return { objective_id: sel.objective_id, reason_codes: codes.slice(0, LIMITS.max_reason_codes) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Diagnosis Builder
// ═══════════════════════════════════════════════════════════════════════════

function extractDerivEvidenceRefs(deriv) {
  if (!deriv || !Array.isArray(deriv.evidence)) return [];
  return deriv.evidence.map(function (e) { return e.ref || e.source || ''; }).filter(Boolean);
}

function extractRefsByKind(derivations, kind) {
  var refs = [];
  for (var i = 0; i < derivations.length; i++) {
    if (derivations[i].kind === kind) refs = refs.concat(extractDerivEvidenceRefs(derivations[i]));
  }
  return refs.slice(0, LIMITS.max_evidence_refs);
}

function extractRefsByTarget(derivations, target) {
  var refs = [];
  for (var i = 0; i < derivations.length; i++) {
    if (derivations[i].target === target) refs = refs.concat(extractDerivEvidenceRefs(derivations[i]));
  }
  return refs.slice(0, LIMITS.max_evidence_refs);
}

function hasDiag(diags, code) {
  for (var i = 0; i < diags.length; i++) { if (diags[i].code === code) return true; }
  return false;
}

function buildDiagnosis(objective) {
  var diags = [];
  if (!objective) return diags;

  var strategy = objective.strategy || {};
  var hint = objective.hint || {};
  var derivations = objective.derivations || [];
  var signals = objective.signals || [];

  // From forced_zero_reason
  var fzr = hint.forced_zero_reason;
  if (fzr && fzr !== 'NONE') {
    if (fzr === 'KILL_SWITCH') {
      diags.push({ code: 'FP-D-KILL_SWITCH', severity: 'high', rule_code: 'forced_zero_kill_switch', evidence_refs: extractRefsByKind(derivations, 'OVERRIDE') });
    } else if (fzr === 'QUARANTINE') {
      diags.push({ code: 'FP-D-QUARANTINE', severity: 'high', rule_code: 'forced_zero_quarantine', evidence_refs: extractRefsByKind(derivations, 'OVERRIDE') });
    } else if (fzr === 'HIGH_RISK') {
      diags.push({ code: 'FP-D-HIGH_RISK', severity: 'high', rule_code: 'forced_zero_high_risk', evidence_refs: extractRefsByTarget(derivations, 'risk_score') });
    } else if (fzr === 'LOW_CONFIDENCE') {
      diags.push({ code: 'FP-D-LOW_CONFIDENCE', severity: 'high', rule_code: 'forced_zero_low_confidence', evidence_refs: extractRefsByTarget(derivations, 'confidence') });
    } else {
      diags.push({ code: 'FP-D-FORCED_ZERO', severity: 'high', rule_code: 'forced_zero_' + fzr.toLowerCase(), evidence_refs: [] });
    }
  }

  // From strategy values
  if (typeof strategy.risk_score === 'number' && strategy.risk_score >= 90 && !hasDiag(diags, 'FP-D-HIGH_RISK')) {
    diags.push({ code: 'FP-D-HIGH_RISK', severity: 'high', rule_code: 'risk_score_gte_90', evidence_refs: extractRefsByTarget(derivations, 'risk_score') });
  }
  if (typeof strategy.risk_score === 'number' && strategy.risk_score >= 70 && strategy.risk_score < 90 && !hasDiag(diags, 'FP-D-HIGH_RISK')) {
    diags.push({ code: 'FP-D-ELEVATED_RISK', severity: 'med', rule_code: 'risk_score_gte_70', evidence_refs: extractRefsByTarget(derivations, 'risk_score') });
  }
  if (typeof strategy.confidence === 'number' && strategy.confidence < 0.4 && !hasDiag(diags, 'FP-D-LOW_CONFIDENCE')) {
    diags.push({ code: 'FP-D-LOW_CONFIDENCE', severity: 'high', rule_code: 'confidence_lt_04', evidence_refs: extractRefsByTarget(derivations, 'confidence') });
  }

  // From recommended_action
  if (strategy.recommended_action === 'STOP' && !hasDiag(diags, 'FP-D-KILL_SWITCH')) {
    diags.push({ code: 'FP-D-KILL_SWITCH', severity: 'high', rule_code: 'action_stop', evidence_refs: extractRefsByKind(derivations, 'OVERRIDE') });
  }
  if (strategy.recommended_action === 'HOLD' && !hasDiag(diags, 'FP-D-QUARANTINE')) {
    diags.push({ code: 'FP-D-QUARANTINE', severity: 'high', rule_code: 'action_hold', evidence_refs: extractRefsByKind(derivations, 'OVERRIDE') });
  }

  // From derivations
  for (var i = 0; i < derivations.length; i++) {
    if (derivations[i].kind === 'OVERRIDE' && !hasDiag(diags, 'FP-D-OVERRIDE')) {
      diags.push({ code: 'FP-D-OVERRIDE', severity: 'med', rule_code: 'override_applied', evidence_refs: extractDerivEvidenceRefs(derivations[i]) });
    }
    if (derivations[i].kind === 'CLAMP' && !hasDiag(diags, 'FP-D-CLAMP')) {
      diags.push({ code: 'FP-D-CLAMP', severity: 'low', rule_code: 'value_clamped', evidence_refs: extractDerivEvidenceRefs(derivations[i]) });
    }
  }

  // From signals — detect drift and budget
  for (var j = 0; j < signals.length; j++) {
    var ref = (signals[j].evidence_ref || signals[j].text || '').toLowerCase();
    if (ref.indexOf('drift') >= 0 && !hasDiag(diags, 'FP-D-DRIFT')) {
      diags.push({ code: 'FP-D-DRIFT', severity: signals[j].severity || 'med', rule_code: 'signal_drift', evidence_refs: [signals[j].evidence_ref || 'drift detected'] });
    }
    if (ref.indexOf('budget') >= 0 && !hasDiag(diags, 'FP-D-BUDGET')) {
      diags.push({ code: 'FP-D-BUDGET', severity: signals[j].severity || 'med', rule_code: 'signal_budget', evidence_refs: [signals[j].evidence_ref || 'budget signal'] });
    }
  }

  // Bound and format
  return diags.slice(0, LIMITS.max_diagnosis).map(function (d) {
    return {
      code: truncate(d.code),
      severity: SEVERITY_LEVELS.indexOf(d.severity) >= 0 ? d.severity : 'med',
      rule_code: truncate(d.rule_code),
      evidence_refs: (d.evidence_refs || []).slice(0, LIMITS.max_evidence_refs).map(function (r) { return truncate(String(r)); }),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Proposed Changes Builder
// ═══════════════════════════════════════════════════════════════════════════

function buildProposedChanges(diagnosis) {
  var changes = [];
  var counter = 1;

  for (var i = 0; i < diagnosis.length; i++) {
    var d = diagnosis[i];
    var intent = DIAG_INTENTS[d.code] || 'Review and address ' + d.code;
    var targets = (DIAG_TARGET_FILES[d.code] || []).slice(0, LIMITS.max_target_files);
    var risk = d.severity;

    // Kill switch → hold-only pack
    if (d.code === 'FP-D-KILL_SWITCH') {
      changes.push({
        change_id: 'FP-C' + String(counter).padStart(2, '0'),
        intent: truncate(intent),
        target_files: [],
        guardrails: ['Do not modify any files while kill switch is active', 'Escalate to maintainer'].slice(0, LIMITS.max_guardrails),
        risk: 'high',
      });
      counter++;
      continue;
    }

    changes.push({
      change_id: 'FP-C' + String(counter).padStart(2, '0'),
      intent: truncate(intent),
      target_files: targets.map(function (f) { return truncate(f); }),
      guardrails: DEFAULT_GUARDRAILS.slice(0, LIMITS.max_guardrails),
      risk: RISK_LEVELS.indexOf(risk) >= 0 ? risk : 'med',
    });
    counter++;
  }

  return changes.slice(0, LIMITS.max_proposed_changes);
}

// ═══════════════════════════════════════════════════════════════════════════
// Commands Builder (allowlisted only)
// ═══════════════════════════════════════════════════════════════════════════

function buildCommands(diagnosis) {
  var cmds = [];
  var seen = {};

  // Always start with git status
  cmds.push({ cmd: 'git status', why: 'Verify clean working tree before changes' });
  seen['git status'] = true;

  for (var i = 0; i < diagnosis.length; i++) {
    var mapping = DIAG_COMMANDS[diagnosis[i].code];
    if (!mapping) continue;
    if (mapping.test && !seen[mapping.test]) {
      cmds.push({ cmd: mapping.test, why: 'Run tests for ' + diagnosis[i].code });
      seen[mapping.test] = true;
    }
    if (mapping.gate && !seen[mapping.gate]) {
      cmds.push({ cmd: mapping.gate, why: 'Run gate for ' + diagnosis[i].code });
      seen[mapping.gate] = true;
    }
    if (mapping.git && mapping.git !== 'git status' && !seen[mapping.git]) {
      cmds.push({ cmd: mapping.git, why: 'Check state for ' + diagnosis[i].code });
      seen[mapping.git] = true;
    }
  }

  // Filter to allowed only + bound
  return cmds.filter(function (c) { return isCommandAllowed(c.cmd); })
    .slice(0, LIMITS.max_commands)
    .map(function (c) { return { cmd: truncate(c.cmd), why: truncate(c.why) }; });
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests, Stop Conditions, Rollback
// ═══════════════════════════════════════════════════════════════════════════

function buildTestsToRun(diagnosis) {
  var tests = [];
  var seen = {};
  for (var i = 0; i < diagnosis.length; i++) {
    var mapping = DIAG_COMMANDS[diagnosis[i].code];
    if (mapping && mapping.test && !seen[mapping.test]) {
      tests.push(mapping.test);
      seen[mapping.test] = true;
    }
  }
  return tests.filter(function (t) { return isCommandAllowed(t); })
    .slice(0, LIMITS.max_tests_to_run)
    .map(function (t) { return truncate(t); });
}

function buildStopConditions(diagnosis) {
  var conds = [];
  // Diagnosis-specific first
  for (var i = 0; i < diagnosis.length; i++) {
    if (diagnosis[i].code === 'FP-D-KILL_SWITCH') {
      conds.push('STOP: Kill switch is active — no changes permitted');
    }
    if (diagnosis[i].code === 'FP-D-QUARANTINE') {
      conds.push('STOP: Quarantine active — contain before remediating');
    }
  }
  // Default conditions
  for (var j = 0; j < DEFAULT_STOP_CONDITIONS.length; j++) {
    conds.push(DEFAULT_STOP_CONDITIONS[j]);
  }
  // Deduplicate
  var seen = {};
  var unique = [];
  for (var k = 0; k < conds.length; k++) {
    if (!seen[conds[k]]) { seen[conds[k]] = true; unique.push(conds[k]); }
  }
  return unique.slice(0, LIMITS.max_stop_conditions).map(function (c) { return truncate(c); });
}

function buildRollbackSteps() {
  return DEFAULT_ROLLBACK.slice(0, LIMITS.max_rollback_steps).map(function (s) { return truncate(s); });
}

// ═══════════════════════════════════════════════════════════════════════════
// Failclosed Pack
// ═══════════════════════════════════════════════════════════════════════════

function buildFailclosedPack(reason, timestamp) {
  return {
    version: FIXPACK_VERSION,
    computed_at: timestamp || new Date().toISOString(),
    mode: 'rules-only',
    selected: { objective_id: 'none', reason_codes: [] },
    diagnosis: [],
    proposed_changes: [],
    commands: [],
    tests_to_run: [],
    stop_conditions: ['STOP: Fix pack generation failed — ' + truncate(String(reason || 'unknown'))],
    rollback_steps: [],
    summary: {
      failclosed: true,
      failclosed_reason: truncate(String(reason || 'unknown')),
      sanitized: true,
    },
    events: [{ event: 'FIXPACK_FAILCLOSED', reason: truncate(String(reason || 'unknown')) }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM Assist (OFF by default, bounded, advisory only)
// ═══════════════════════════════════════════════════════════════════════════

function tryLlmAssist(objData, diagnosis, proposedChanges, stopConditions, config) {
  // LLM may only refine: intent, guardrails, stop_conditions
  // Must never change: commands, schema, selection, command allowlist
  if (typeof config.llm_fn !== 'function') return { used: false, reason: 'no_llm_fn' };

  // Trigger conditions: low confidence OR high severity + sparse evidence
  var needsLlm = false;
  if (objData.strategy && typeof objData.strategy.confidence === 'number' && objData.strategy.confidence < 0.5) {
    needsLlm = true;
  }
  if (diagnosis.some(function (d) { return d.severity === 'high'; }) && diagnosis.length < 2) {
    needsLlm = true;
  }
  if (!needsLlm) return { used: false, reason: 'no_trigger' };

  try {
    var llmResult = config.llm_fn({
      objective: objData,
      diagnosis: diagnosis,
      max_input_tokens: LLM_DEFAULTS.max_input_tokens,
      max_output_tokens: LLM_DEFAULTS.max_output_tokens,
    });

    if (!llmResult || typeof llmResult !== 'object') {
      return { used: false, reason: 'invalid_llm_output' };
    }

    // Apply refinements (intent, guardrails, stop_conditions ONLY)
    if (typeof llmResult.refined_intents === 'object' && llmResult.refined_intents !== null) {
      for (var j = 0; j < proposedChanges.length; j++) {
        if (llmResult.refined_intents[proposedChanges[j].change_id]) {
          proposedChanges[j].intent = truncate(String(llmResult.refined_intents[proposedChanges[j].change_id]));
        }
      }
    }
    if (Array.isArray(llmResult.refined_guardrails)) {
      var refinedG = llmResult.refined_guardrails.slice(0, LIMITS.max_guardrails).map(function (g) { return truncate(String(g)); });
      for (var k = 0; k < proposedChanges.length; k++) {
        proposedChanges[k].guardrails = refinedG;
      }
    }
    var refinedStop = stopConditions;
    if (Array.isArray(llmResult.refined_stop_conditions)) {
      refinedStop = llmResult.refined_stop_conditions.slice(0, LIMITS.max_stop_conditions).map(function (s) { return truncate(String(s)); });
    }

    return { used: true, reason: null, stopConditions: refinedStop };
  } catch (_e) {
    return { used: false, reason: 'llm_exception' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Build Function
// ═══════════════════════════════════════════════════════════════════════════

function build(evidenceGraph, context, config) {
  config = config || {};
  context = context || {};
  var events = [];

  try {
    // Validate evidence graph
    if (!evidenceGraph || typeof evidenceGraph !== 'object') {
      return sanitize(buildFailclosedPack('invalid_evidence_graph', config.timestamp));
    }
    if (evidenceGraph.summary && evidenceGraph.summary.failclosed) {
      return sanitize(buildFailclosedPack('upstream_failclosed', config.timestamp));
    }
    if (!Array.isArray(evidenceGraph.objectives) || evidenceGraph.objectives.length === 0) {
      return sanitize(buildFailclosedPack('no_objectives', config.timestamp));
    }

    // Select objective
    var selected = selectObjective(evidenceGraph.objectives, context);
    if (!selected) {
      return sanitize(buildFailclosedPack('selection_failed', config.timestamp));
    }

    // Find full objective data
    var objData = null;
    for (var i = 0; i < evidenceGraph.objectives.length; i++) {
      if (evidenceGraph.objectives[i].objective_id === selected.objective_id) {
        objData = evidenceGraph.objectives[i];
        break;
      }
    }
    if (!objData) {
      return sanitize(buildFailclosedPack('objective_not_found', config.timestamp));
    }

    // Build all sections
    var diagnosis = buildDiagnosis(objData);
    var proposedChanges = buildProposedChanges(diagnosis);
    var commands = buildCommands(diagnosis);
    var testsToRun = buildTestsToRun(diagnosis);
    var stopConditions = buildStopConditions(diagnosis);
    var rollbackSteps = buildRollbackSteps();

    // Determine mode
    var mode = 'rules-only';

    // LLM assist (OFF by default, never in CI)
    if (config.llm_enabled === true && config.ci_mode !== true) {
      var llmResult = tryLlmAssist(objData, diagnosis, proposedChanges, stopConditions, config);
      if (llmResult.used) {
        mode = 'hybrid';
        if (llmResult.stopConditions) stopConditions = llmResult.stopConditions;
        events.push({ event: 'FIXPACK_LLM_USED' });
      } else {
        events.push({ event: 'FIXPACK_LLM_SKIPPED', reason: llmResult.reason });
      }
    } else {
      events.push({ event: 'FIXPACK_LLM_SKIPPED', reason: config.ci_mode ? 'ci_forbidden' : 'disabled' });
    }

    events.push({ event: 'FIXPACK_COMPUTED', objective_id: selected.objective_id });

    var fixPack = {
      version: FIXPACK_VERSION,
      computed_at: config.timestamp || evidenceGraph.computed_at || new Date().toISOString(),
      mode: mode,
      selected: {
        objective_id: selected.objective_id,
        reason_codes: selected.reason_codes,
      },
      diagnosis: diagnosis,
      proposed_changes: proposedChanges,
      commands: commands,
      tests_to_run: testsToRun,
      stop_conditions: stopConditions,
      rollback_steps: rollbackSteps,
      summary: {
        failclosed: false,
        sanitized: true,
      },
      events: events,
    };

    return sanitize(fixPack);
  } catch (e) {
    return sanitize(buildFailclosedPack('exception: ' + (e.message || 'unknown').slice(0, 100), config.timestamp));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

function validate(fixPack) {
  var errors = [];
  if (!fixPack || typeof fixPack !== 'object') return { valid: false, errors: ['must be an object'] };

  if (fixPack.version !== FIXPACK_VERSION) errors.push('version must be ' + FIXPACK_VERSION);
  if (typeof fixPack.computed_at !== 'string' || !fixPack.computed_at) errors.push('computed_at required');
  if (MODES.indexOf(fixPack.mode) < 0) errors.push('invalid mode: ' + fixPack.mode);

  // selected
  if (!fixPack.selected || typeof fixPack.selected !== 'object') {
    errors.push('selected required');
  } else {
    if (typeof fixPack.selected.objective_id !== 'string') errors.push('selected.objective_id must be string');
    if (!Array.isArray(fixPack.selected.reason_codes)) errors.push('selected.reason_codes must be array');
    else if (fixPack.selected.reason_codes.length > LIMITS.max_reason_codes) errors.push('reason_codes exceeds max');
  }

  // diagnosis
  if (!Array.isArray(fixPack.diagnosis)) {
    errors.push('diagnosis must be array');
  } else {
    if (fixPack.diagnosis.length > LIMITS.max_diagnosis) errors.push('diagnosis exceeds max');
    for (var i = 0; i < fixPack.diagnosis.length; i++) {
      var d = fixPack.diagnosis[i];
      if (typeof d.code !== 'string') errors.push('diagnosis[' + i + '].code must be string');
      if (SEVERITY_LEVELS.indexOf(d.severity) < 0) errors.push('diagnosis[' + i + '].severity invalid: ' + d.severity);
      if (typeof d.rule_code !== 'string') errors.push('diagnosis[' + i + '].rule_code must be string');
      if (!Array.isArray(d.evidence_refs)) errors.push('diagnosis[' + i + '].evidence_refs must be array');
      else if (d.evidence_refs.length > LIMITS.max_evidence_refs) errors.push('diagnosis[' + i + '].evidence_refs exceeds max');
    }
  }

  // proposed_changes
  if (!Array.isArray(fixPack.proposed_changes)) {
    errors.push('proposed_changes must be array');
  } else {
    if (fixPack.proposed_changes.length > LIMITS.max_proposed_changes) errors.push('proposed_changes exceeds max');
    for (var j = 0; j < fixPack.proposed_changes.length; j++) {
      var c = fixPack.proposed_changes[j];
      if (typeof c.change_id !== 'string') errors.push('proposed_changes[' + j + '].change_id must be string');
      if (typeof c.intent !== 'string') errors.push('proposed_changes[' + j + '].intent must be string');
      else if (c.intent.length > LIMITS.max_string_length) errors.push('proposed_changes[' + j + '].intent exceeds max length');
      if (!Array.isArray(c.target_files)) errors.push('proposed_changes[' + j + '].target_files must be array');
      else if (c.target_files.length > LIMITS.max_target_files) errors.push('proposed_changes[' + j + '].target_files exceeds max');
      if (!Array.isArray(c.guardrails)) errors.push('proposed_changes[' + j + '].guardrails must be array');
      else if (c.guardrails.length > LIMITS.max_guardrails) errors.push('proposed_changes[' + j + '].guardrails exceeds max');
      if (RISK_LEVELS.indexOf(c.risk) < 0) errors.push('proposed_changes[' + j + '].risk invalid: ' + c.risk);
    }
  }

  // commands
  if (!Array.isArray(fixPack.commands)) {
    errors.push('commands must be array');
  } else {
    if (fixPack.commands.length > LIMITS.max_commands) errors.push('commands exceeds max');
    for (var k = 0; k < fixPack.commands.length; k++) {
      if (typeof fixPack.commands[k].cmd !== 'string') errors.push('commands[' + k + '].cmd must be string');
      else if (fixPack.commands[k].cmd.length > LIMITS.max_string_length) errors.push('commands[' + k + '].cmd exceeds max length');
      if (typeof fixPack.commands[k].why !== 'string') errors.push('commands[' + k + '].why must be string');
      if (fixPack.commands[k].cmd && !isCommandAllowed(fixPack.commands[k].cmd)) errors.push('commands[' + k + '] not allowlisted: ' + fixPack.commands[k].cmd);
    }
  }

  // arrays with bounds
  if (!Array.isArray(fixPack.tests_to_run)) errors.push('tests_to_run must be array');
  else if (fixPack.tests_to_run.length > LIMITS.max_tests_to_run) errors.push('tests_to_run exceeds max');
  if (!Array.isArray(fixPack.stop_conditions)) errors.push('stop_conditions must be array');
  else if (fixPack.stop_conditions.length > LIMITS.max_stop_conditions) errors.push('stop_conditions exceeds max');
  if (!Array.isArray(fixPack.rollback_steps)) errors.push('rollback_steps must be array');
  else if (fixPack.rollback_steps.length > LIMITS.max_rollback_steps) errors.push('rollback_steps exceeds max');

  // summary
  if (!fixPack.summary || typeof fixPack.summary !== 'object') {
    errors.push('summary required');
  } else {
    if (typeof fixPack.summary.failclosed !== 'boolean') errors.push('summary.failclosed must be boolean');
    if (typeof fixPack.summary.sanitized !== 'boolean') errors.push('summary.sanitized must be boolean');
  }

  return { valid: errors.length === 0, errors: errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// Markdown Renderer
// ═══════════════════════════════════════════════════════════════════════════

function toMarkdown(fixPack) {
  if (!fixPack) return '# Fix Pack\n\n*No fix pack data*\n';
  var lines = [];
  lines.push('# Fix Pack ' + fixPack.version);
  lines.push('');
  lines.push('**Computed:** ' + fixPack.computed_at);
  lines.push('**Mode:** ' + fixPack.mode);
  lines.push('');

  if (fixPack.summary && fixPack.summary.failclosed) {
    lines.push('## FAILCLOSED');
    lines.push('');
    lines.push('Fix pack generation failed: ' + (fixPack.summary.failclosed_reason || 'unknown'));
    lines.push('');
    if (fixPack.stop_conditions && fixPack.stop_conditions.length > 0) {
      lines.push('### Stop Conditions');
      lines.push('');
      for (var s = 0; s < fixPack.stop_conditions.length; s++) lines.push('- ' + fixPack.stop_conditions[s]);
      lines.push('');
    }
    return lines.join('\n');
  }

  lines.push('## Selected Objective');
  lines.push('');
  lines.push('**ID:** ' + fixPack.selected.objective_id);
  lines.push('**Reasons:** ' + (fixPack.selected.reason_codes || []).join(', '));
  lines.push('');

  if (fixPack.diagnosis && fixPack.diagnosis.length > 0) {
    lines.push('## Diagnosis');
    lines.push('');
    lines.push('| Code | Severity | Rule | Evidence |');
    lines.push('|------|----------|------|----------|');
    for (var i = 0; i < fixPack.diagnosis.length; i++) {
      var d = fixPack.diagnosis[i];
      lines.push('| ' + d.code + ' | ' + d.severity + ' | ' + d.rule_code + ' | ' + (d.evidence_refs || []).join('; ') + ' |');
    }
    lines.push('');
  }

  if (fixPack.proposed_changes && fixPack.proposed_changes.length > 0) {
    lines.push('## Proposed Changes');
    lines.push('');
    for (var j = 0; j < fixPack.proposed_changes.length; j++) {
      var ch = fixPack.proposed_changes[j];
      lines.push('### ' + ch.change_id + ' (risk: ' + ch.risk + ')');
      lines.push('');
      lines.push('**Intent:** ' + ch.intent);
      if (ch.target_files && ch.target_files.length > 0) lines.push('**Files:** ' + ch.target_files.join(', '));
      if (ch.guardrails && ch.guardrails.length > 0) {
        lines.push('**Guardrails:**');
        for (var g = 0; g < ch.guardrails.length; g++) lines.push('- ' + ch.guardrails[g]);
      }
      lines.push('');
    }
  }

  if (fixPack.commands && fixPack.commands.length > 0) {
    lines.push('## Verification Commands');
    lines.push('');
    lines.push('```bash');
    for (var ck = 0; ck < fixPack.commands.length; ck++) {
      lines.push('# ' + fixPack.commands[ck].why);
      lines.push(fixPack.commands[ck].cmd);
    }
    lines.push('```');
    lines.push('');
  }

  if (fixPack.tests_to_run && fixPack.tests_to_run.length > 0) {
    lines.push('## Tests to Run');
    lines.push('');
    for (var t = 0; t < fixPack.tests_to_run.length; t++) lines.push('- `' + fixPack.tests_to_run[t] + '`');
    lines.push('');
  }

  if (fixPack.stop_conditions && fixPack.stop_conditions.length > 0) {
    lines.push('## Stop Conditions');
    lines.push('');
    for (var sc = 0; sc < fixPack.stop_conditions.length; sc++) lines.push('- ' + fixPack.stop_conditions[sc]);
    lines.push('');
  }

  if (fixPack.rollback_steps && fixPack.rollback_steps.length > 0) {
    lines.push('## Rollback Steps');
    lines.push('');
    for (var r = 0; r < fixPack.rollback_steps.length; r++) lines.push((r + 1) + '. ' + fixPack.rollback_steps[r]);
    lines.push('');
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  FIXPACK_VERSION: FIXPACK_VERSION,
  MODES: MODES,
  SEVERITY_LEVELS: SEVERITY_LEVELS,
  RISK_LEVELS: RISK_LEVELS,
  REASON_CODES: REASON_CODES,
  DIAGNOSIS_CODES: DIAGNOSIS_CODES,
  LIMITS: LIMITS,
  LLM_DEFAULTS: LLM_DEFAULTS,
  ALLOWED_COMMAND_PATTERNS: ALLOWED_COMMAND_PATTERNS,
  FORBIDDEN_PATTERNS: FORBIDDEN_PATTERNS,
  SECRET_PATTERN: SECRET_PATTERN,
  build: build,
  validate: validate,
  toMarkdown: toMarkdown,
  buildFailclosedPack: buildFailclosedPack,
  isCommandAllowed: isCommandAllowed,
  selectObjective: selectObjective,
  sanitize: sanitize,
  sortedStringify: sortedStringify,
  sha256: sha256,
};
