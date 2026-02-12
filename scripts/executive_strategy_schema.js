#!/usr/bin/env node
/**
 * executive_strategy_schema.js — Schema definitions for Executive Strategy Engine
 *
 * Defines the data contracts for:
 *   - Objective scoring output
 *   - Lens module deltas
 *   - LLM assist output
 *   - Strategy report envelope
 */

'use strict';

// --- Enums ---
const RECOMMENDED_ACTIONS = [
  'PROCEED',      // Safe to continue delivery
  'HOLD',         // Quarantined or blocked — wait
  'STOP',         // Kill switch engaged — halt everything
  'INVESTIGATE',  // High risk or low confidence — needs human look
  'RETRY',        // Previous failure, conditions may have changed
  'DEPRIORITIZE', // Low impact, defer
];

// --- Validators ---

function validateScore(score, field) {
  if (typeof score !== 'number' || score < 0 || score > 100) {
    throw new Error(`${field} must be number 0-100, got ${typeof score}: ${score}`);
  }
}

function validateConfidence(conf, field) {
  if (typeof conf !== 'number' || conf < 0 || conf > 1) {
    throw new Error(`${field} must be number 0-1, got ${typeof conf}: ${conf}`);
  }
}

function validateObjectiveResult(result) {
  const errors = [];
  const r = result || {};

  if (!r.objective_id || typeof r.objective_id !== 'string') {
    errors.push('objective_id must be a non-empty string');
  }
  if (typeof r.priority_score !== 'number' || r.priority_score < 0 || r.priority_score > 100) {
    errors.push('priority_score must be 0-100');
  }
  if (typeof r.risk_score !== 'number' || r.risk_score < 0 || r.risk_score > 100) {
    errors.push('risk_score must be 0-100');
  }
  if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
    errors.push('confidence must be 0-1');
  }
  if (!RECOMMENDED_ACTIONS.includes(r.recommended_action)) {
    errors.push(`recommended_action must be one of: ${RECOMMENDED_ACTIONS.join(', ')}`);
  }
  if (!Array.isArray(r.why) || r.why.length > 5) {
    errors.push('why must be array of max 5 strings');
  }
  if (!Array.isArray(r.next_steps) || r.next_steps.length > 3) {
    errors.push('next_steps must be array of max 3 strings');
  }
  if (!Array.isArray(r.blocks) || r.blocks.length > 5) {
    errors.push('blocks must be array of max 5 items');
  }

  return { valid: errors.length === 0, errors };
}

function validateLensDelta(delta) {
  const errors = [];
  const d = delta || {};

  if (typeof d.score_delta !== 'number') errors.push('score_delta must be a number');
  if (typeof d.risk_delta !== 'number') errors.push('risk_delta must be a number');
  if (typeof d.confidence_delta !== 'number') errors.push('confidence_delta must be a number');
  if (!Array.isArray(d.signals)) errors.push('signals must be an array');

  return { valid: errors.length === 0, errors };
}

function validateLLMOutput(output) {
  const errors = [];
  const o = output || {};

  if (!o.root_cause_category || typeof o.root_cause_category !== 'string') {
    errors.push('root_cause_category must be a non-empty string');
  }
  if (!Array.isArray(o.suggestions)) {
    errors.push('suggestions must be an array');
  }
  if (typeof o.confidence_adjustment !== 'number') {
    errors.push('confidence_adjustment must be a number');
  }

  return { valid: errors.length === 0, errors };
}

function validateStrategyReport(report) {
  const errors = [];
  const r = report || {};

  if (!r.engine_version) errors.push('engine_version required');
  if (!r.timestamp) errors.push('timestamp required');
  if (!r.commit_sha) errors.push('commit_sha required');
  if (!Array.isArray(r.objectives)) errors.push('objectives must be array');
  if (typeof r.llm_used !== 'boolean') errors.push('llm_used must be boolean');
  if (typeof r.llm_enabled !== 'boolean') errors.push('llm_enabled must be boolean');
  if (!r.config) errors.push('config required');

  return { valid: errors.length === 0, errors };
}

// --- Default objective result ---
function makeDefaultResult(objectiveId) {
  return {
    objective_id: objectiveId,
    priority_score: 50,
    risk_score: 50,
    confidence: 0.5,
    recommended_action: 'PROCEED',
    why: [],
    next_steps: [],
    blocks: [],
    lenses: { dev: null, ops: null, business: null },
    llm_assist: null,
  };
}

// --- Clamp helpers ---
function clampScore(v) { return Math.max(0, Math.min(100, Math.round(v))); }
function clampConfidence(v) { return Math.max(0, Math.min(1, parseFloat(v.toFixed(3)))); }

module.exports = {
  RECOMMENDED_ACTIONS,
  validateScore,
  validateConfidence,
  validateObjectiveResult,
  validateLensDelta,
  validateLLMOutput,
  validateStrategyReport,
  makeDefaultResult,
  clampScore,
  clampConfidence,
};
