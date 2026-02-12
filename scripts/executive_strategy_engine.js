#!/usr/bin/env node
/**
 * executive_strategy_engine.js — Executive Strategy Engine v1
 *
 * Deterministic "executive brain" that ranks objectives and recommends actions.
 * Hybrid: rules-first, optional bounded LLM assist when uncertainty triggers.
 * Advisory only: produces JSON + MD artifacts, never mutates objectives/repos.
 *
 * Usage:
 *   const engine = require('./executive_strategy_engine');
 *   const report = engine.run(context);
 */

'use strict';

const schema = require('./executive_strategy_schema');
const devIntel = require('./modules/dev_intel');
const opsIntel = require('./modules/ops_intel');
const businessIntel = require('./modules/business_intel');
const llmAssist = require('./executive_llm_assist');
const hintsModule = require("./executive_strategy_hints");
const evidenceModule = require("./executive_evidence_graph");

const ENGINE_VERSION = '1.0.0';

// --- Sanitization ---
const SECRET_PATTERN = /(sk-[a-zA-Z0-9]{10,}|ghp_[a-zA-Z0-9]{20,}|pit-[a-zA-Z0-9]{10,}|AKIA[A-Z0-9]{10,}|eyJ[a-zA-Z0-9._-]{20,}|Bearer\s+\S{10,}|token=[^\s&]{10,}|key=[^\s&]{10,}|password=[^\s&]+|secret=[^\s&]+)/gi;

function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(SECRET_PATTERN, '[REDACTED]');
}

function sanitizeObj(obj) {
  return JSON.parse(sanitize(JSON.stringify(obj)));
}

/**
 * Determine recommended action based on scores and state.
 */
function determineAction(result, context) {
  const quarantine = context.quarantine || {};
  const killSwitch = !!context.killSwitch;

  // Kill switch → STOP (absolute override)
  if (killSwitch) {
    result.recommended_action = 'STOP';
    result.blocks.push({ type: 'kill_switch', detail: 'Kill switch engaged' });
    return;
  }

  // Quarantined → HOLD
  const objQ = quarantine[result.objective_id];
  if (objQ && objQ.quarantined) {
    result.recommended_action = 'HOLD';
    result.blocks.push({
      type: 'quarantine',
      detail: `Quarantined: ${objQ.reason || 'unknown'}`,
    });
    return;
  }

  // High risk + low confidence → INVESTIGATE
  if (result.risk_score >= 70 && result.confidence < 0.5) {
    result.recommended_action = 'INVESTIGATE';
    return;
  }

  // Multiple failures → RETRY or INVESTIGATE
  const failures = (context.events || []).filter(
    e => e.event === 'DELIVERY_FAILED' && e.objective_id === result.objective_id
  );
  if (failures.length >= 3) {
    result.recommended_action = result.confidence >= 0.6 ? 'RETRY' : 'INVESTIGATE';
    return;
  }

  // Low priority → DEPRIORITIZE
  if (result.priority_score < 45 && result.risk_score <= 50) {
    result.recommended_action = 'DEPRIORITIZE';
    return;
  }

  // Default: PROCEED
  result.recommended_action = 'PROCEED';
}

/**
 * Check if LLM assist should trigger for a given result.
 * Returns reason string or null.
 */
function shouldTriggerLLM(result, context) {
  const events = context.events || [];

  if (result.confidence < 0.65) {
    return `low_confidence:${result.confidence}`;
  }

  if (result.risk_score >= 70) {
    const objMeta = (context.objectives || {})[result.objective_id] || {};
    const tags = objMeta.tags || [];
    if (tags.length === 0 && !objMeta.due_date) {
      return 'high_risk_missing_evidence';
    }
  }

  const failures = events.filter(
    e => e.event === 'DELIVERY_FAILED' && e.objective_id === result.objective_id
  );
  if (failures.length >= 3) {
    // Check if there are distinct failure reasons (no matching pattern)
    const reasons = new Set(failures.map(f => f.reason || 'unknown'));
    if (reasons.size >= 2) {
      return `repeated_failures_varied:${reasons.size}_distinct`;
    }
  }

  return null;
}

/**
 * Generate "why" bullets from lens signals.
 */
function buildWhy(lenses) {
  const bullets = [];
  for (const [name, delta] of Object.entries(lenses)) {
    if (delta && delta.signals) {
      for (const sig of delta.signals) {
        if (bullets.length < 5) {
          bullets.push(`[${name}] ${sig}`);
        }
      }
    }
  }
  return bullets.slice(0, 5);
}

/**
 * Generate "next_steps" from action and signals.
 */
function buildNextSteps(result) {
  const steps = [];
  switch (result.recommended_action) {
    case 'STOP':
      steps.push('Remove _control/STOP file to resume operations');
      steps.push('Run triage.sh to assess state');
      break;
    case 'HOLD':
      steps.push('Review quarantine reason');
      steps.push('Run unquarantine.sh when root cause resolved');
      break;
    case 'INVESTIGATE':
      steps.push('Review recent failure events for this objective');
      steps.push('Check drift-telemetry and ops-hardening reports');
      break;
    case 'RETRY':
      steps.push('Review last failure reason before retrying');
      steps.push('Check budget limits before next attempt');
      break;
    case 'DEPRIORITIZE':
      steps.push('Defer to higher-priority objectives');
      break;
    case 'PROCEED':
      steps.push('Continue normal delivery');
      break;
  }
  return steps.slice(0, 3);
}

/**
 * Score a single objective.
 *
 * @param {string} objId
 * @param {object} context
 * @param {object} config
 * @returns {object} Scored objective result
 */
function scoreObjective(objId, context, config) {
  const result = schema.makeDefaultResult(objId);

  // --- Run lens modules ---
  const devDelta = devIntel.analyze(objId, context);
  const opsDelta = opsIntel.analyze(objId, context);
  const bizDelta = businessIntel.analyze(objId, context);

  result.lenses = { dev: devDelta, ops: opsDelta, business: bizDelta };

  // --- Merge deltas deterministically ---
  const totalScoreDelta = devDelta.score_delta + opsDelta.score_delta + bizDelta.score_delta;
  const totalRiskDelta = devDelta.risk_delta + opsDelta.risk_delta + bizDelta.risk_delta;
  const totalConfDelta = devDelta.confidence_delta + opsDelta.confidence_delta + bizDelta.confidence_delta;

  result.priority_score = schema.clampScore(result.priority_score + totalScoreDelta);
  result.risk_score = schema.clampScore(result.risk_score + totalRiskDelta);
  result.confidence = schema.clampConfidence(result.confidence + totalConfDelta);

  // --- Determine action ---
  determineAction(result, context);

  // --- Build explanations ---
  result.why = buildWhy(result.lenses);
  result.next_steps = buildNextSteps(result);

  // --- Optional LLM assist ---
  const llmEnabled = config.llm_enabled === true;
  const llmReason = shouldTriggerLLM(result, context);

  if (llmEnabled && llmReason) {
    try {
      const llmResult = llmAssist.assist(result, context, config);
      if (llmResult) {
        result.llm_assist = llmResult;
        // Apply confidence adjustment from LLM
        if (typeof llmResult.confidence_adjustment === 'number') {
          result.confidence = schema.clampConfidence(
            result.confidence + llmResult.confidence_adjustment
          );
        }
        // Append LLM suggestions to next_steps
        if (llmResult.suggestions && result.next_steps.length < 3) {
          for (const s of llmResult.suggestions) {
            if (result.next_steps.length < 3) {
              result.next_steps.push(`[LLM] ${s}`);
            }
          }
        }
      }
    } catch (_e) {
      // LLM failure → fail closed to rules-only
      result.llm_assist = { failed: true, reason: 'exception' };
    }
  }

  return result;
}

/**
 * Run the executive strategy engine.
 *
 * @param {object} context - {
 *   events: array,
 *   gateReports: { 'drift-telemetry': {...}, ... },
 *   objectives: { 'obj-42': { objective_id, status, tags, ... }, ... },
 *   quarantine: { 'obj-42': { quarantined: bool, ... }, ... },
 *   killSwitch: boolean,
 *   commitSha: string
 * }
 * @param {object} [config] - {
 *   llm_enabled: boolean (default false),
 *   llm_max_input_tokens: number (default 800),
 *   llm_max_output_tokens: number (default 400),
 *   fixtures_mode: boolean
 * }
 * @returns {object} Strategy report
 */
function run(context, config) {
  config = config || {};
  const llmEnabled = config.llm_enabled === true;
  let llmUsed = false;
  const events = [];

  // Validate context — fail closed on corrupt
  if (!context || typeof context !== 'object') {
    events.push({ event: 'EXEC_STRATEGY_FAILCLOSED', reason: 'invalid_context' });
    return {
      engine_version: ENGINE_VERSION,
      timestamp: new Date().toISOString(),
      commit_sha: 'unknown',
      status: 'FAILCLOSED',
      objectives: [],
      llm_used: false,
      llm_enabled: llmEnabled,
      config: sanitizeObj(config),
      events,
    };
  }

  const objectiveIds = Object.keys(context.objectives || {});
  const results = [];

  for (const objId of objectiveIds) {
    const result = scoreObjective(objId, context, config);
    if (result.llm_assist && !result.llm_assist.failed) {
      llmUsed = true;
    }
    results.push(result);
  }

  // --- Stable sort: priority_score descending, then objective_id ascending ---
  results.sort((a, b) => {
    if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
    return a.objective_id.localeCompare(b.objective_id);
  });

  // --- Build events ---
  events.push({ event: 'EXEC_STRATEGY_COMPUTED', objective_count: results.length });

  if (llmEnabled && llmUsed) {
    events.push({ event: 'EXEC_STRATEGY_LLM_USED' });
  } else if (llmEnabled && !llmUsed) {
    events.push({ event: 'EXEC_STRATEGY_LLM_SKIPPED', reason: 'no_trigger' });
  } else {
    events.push({ event: 'EXEC_STRATEGY_LLM_SKIPPED', reason: 'disabled' });
  }

  const report = {
    engine_version: ENGINE_VERSION,
    timestamp: new Date().toISOString(),
    commit_sha: context.commitSha || 'unknown',
    status: 'OK',
    objectives: results,
    llm_used: llmUsed,
    llm_enabled: llmEnabled,
    config: {
      llm_enabled: llmEnabled,
      llm_max_input_tokens: config.llm_max_input_tokens || 800,
      llm_max_output_tokens: config.llm_max_output_tokens || 400,
      fixtures_mode: !!config.fixtures_mode,
    },
    events,
  };

  // Validate report
  const validation = schema.validateStrategyReport(report);
  if (!validation.valid) {
    report.status = 'VALIDATION_WARNING';
    report.validation_errors = validation.errors;
  }

  return sanitizeObj(report);
}

module.exports = { run, scoreObjective, shouldTriggerLLM, sanitize, ENGINE_VERSION, generateHints: hintsModule.generateHints, buildEvidenceGraph: evidenceModule.build };
