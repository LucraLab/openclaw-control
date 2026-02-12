#!/usr/bin/env node
/**
 * executive_strategy_hints.js — Hints generation for Strategy-to-Arbiter bridge (Port #13)
 *
 * Generates `executive-strategy-hints.json` from an executive strategy report.
 * The arbiter reads this artifact to optionally adjust objective ranking.
 *
 * Safety guarantees:
 *   - rank_delta_hint clamped to [-10, +10]
 *   - Kill switch / quarantine / low confidence / high risk → delta=0
 *   - Fail closed: returns null on error (never crashes)
 *   - Advisory only: hints never mutate objectives or execute code
 */

'use strict';

// --- Enums ---

const RECOMMENDATION_MAP = {
  STOP: 'STOP',
  HOLD: 'HOLD',
  INVESTIGATE: 'INVESTIGATE',
  RETRY: 'PLAN',
  PROCEED: 'FOCUS',
  DEPRIORITIZE: 'CONTAIN',
};

const VALID_RECOMMENDATION_CODES = Object.values(RECOMMENDATION_MAP);

const WHY_CODES = [
  'high_risk',
  'low_risk',
  'high_impact',
  'low_impact',
  'ci_failures',
  'repeated_failures',
  'budget_breach',
  'budget_near_breach',
  'quarantined',
  'kill_switch',
  'overdue',
  'approaching_deadline',
  'low_confidence',
  'high_confidence',
  'missing_metadata',
  'model_escalation_blocked',
  'drift_failure',
  'lock_contention',
];

const HINTS_VERSION = '1.0.0';

// --- Computation ---

/**
 * Compute rank_delta_hint from priority_score.
 * Formula: clamp(round((priority_score - 50) / 5), -10, 10)
 */
function computeRankDelta(priorityScore) {
  const raw = Math.round((priorityScore - 50) / 5);
  return Math.max(-10, Math.min(10, raw));
}

/**
 * Check if safety override applies (forces delta=0).
 * Returns true if delta must be zeroed.
 */
function isSafetyOverride(objResult) {
  if (objResult.recommended_action === 'STOP') return true;
  if (objResult.recommended_action === 'HOLD') return true;
  if (objResult.confidence < 0.4) return true;
  if (objResult.risk_score >= 90) return true;
  return false;
}

/**
 * Extract why_codes from an objective result's lens signals.
 * Max 5 codes.
 */
function extractWhyCodes(objResult) {
  const codes = [];

  // Score-based codes
  if (objResult.risk_score >= 70) codes.push('high_risk');
  else if (objResult.risk_score < 30) codes.push('low_risk');

  if (objResult.priority_score >= 70) codes.push('high_impact');
  else if (objResult.priority_score < 30) codes.push('low_impact');

  if (objResult.confidence >= 0.8) codes.push('high_confidence');
  else if (objResult.confidence < 0.5) codes.push('low_confidence');

  // Lens signal-based codes
  const lenses = objResult.lenses || {};
  const allSignals = [];
  for (const lens of Object.values(lenses)) {
    if (lens && Array.isArray(lens.signals)) {
      allSignals.push(...lens.signals);
    }
  }

  const signalText = allSignals.join(' ').toLowerCase();

  if (signalText.includes('ci fail') || signalText.includes('gate fail')) {
    codes.push('ci_failures');
  }
  if (signalText.includes('retry') || signalText.includes('churn') || signalText.includes('repeated')) {
    codes.push('repeated_failures');
  }
  if (signalText.includes('budget breach') && !signalText.includes('near')) {
    codes.push('budget_breach');
  }
  if (signalText.includes('near-breach') || signalText.includes('near breach')) {
    codes.push('budget_near_breach');
  }
  if (signalText.includes('quarantin')) {
    codes.push('quarantined');
  }
  if (signalText.includes('kill switch')) {
    codes.push('kill_switch');
  }
  if (signalText.includes('overdue')) {
    codes.push('overdue');
  }
  if (signalText.includes('deadline') || signalText.includes('due soon') || signalText.includes('days until due')) {
    codes.push('approaching_deadline');
  }
  if (signalText.includes('missing') && signalText.includes('metadata')) {
    codes.push('missing_metadata');
  }
  if (signalText.includes('escalation') && signalText.includes('block')) {
    codes.push('model_escalation_blocked');
  }
  if (signalText.includes('drift')) {
    codes.push('drift_failure');
  }
  if (signalText.includes('contention') || signalText.includes('lock')) {
    codes.push('lock_contention');
  }

  // Deduplicate and filter to valid codes
  const seen = new Set();
  const result = [];
  for (const code of codes) {
    if (WHY_CODES.includes(code) && !seen.has(code)) {
      seen.add(code);
      result.push(code);
      if (result.length >= 5) break;
    }
  }

  return result;
}

// --- Generation ---

/**
 * Generate hints artifact from an executive strategy report.
 *
 * @param {object} report - Executive strategy report from engine.run()
 * @returns {object|null} Hints artifact or null on error
 */
function generateHints(report) {
  try {
    if (!report || report.status === 'FAILCLOSED') {
      return null;
    }

    if (!Array.isArray(report.objectives) || report.objectives.length === 0) {
      return {
        version: HINTS_VERSION,
        computed_at: report.timestamp || new Date().toISOString(),
        source_engine_version: report.engine_version || 'unknown',
        hints: [],
      };
    }

    const hints = [];
    for (const obj of report.objectives) {
      let delta = computeRankDelta(obj.priority_score);

      if (isSafetyOverride(obj)) {
        delta = 0;
      }

      hints.push({
        objective_id: obj.objective_id,
        priority_score: obj.priority_score,
        risk_score: obj.risk_score,
        confidence: obj.confidence,
        recommendation_code: RECOMMENDATION_MAP[obj.recommended_action] || 'FOCUS',
        rank_delta_hint: delta,
        why_codes: extractWhyCodes(obj),
      });
    }

    return {
      version: HINTS_VERSION,
      computed_at: report.timestamp || new Date().toISOString(),
      source_engine_version: report.engine_version || 'unknown',
      hints,
    };
  } catch (_e) {
    // Fail closed: never crash, return null
    return null;
  }
}

// --- Validation ---

/**
 * Validate a hints artifact.
 *
 * @param {object} data - Hints data to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateHints(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['data must be an object'] };
  }

  if (data.version !== HINTS_VERSION) {
    errors.push(`version must be '${HINTS_VERSION}', got '${data.version}'`);
  }
  if (typeof data.computed_at !== 'string' || !data.computed_at) {
    errors.push('computed_at must be a non-empty string');
  }
  if (!Array.isArray(data.hints)) {
    errors.push('hints must be an array');
    return { valid: false, errors };
  }

  for (let i = 0; i < data.hints.length; i++) {
    const h = data.hints[i];
    const prefix = `hints[${i}]`;

    if (!h || typeof h !== 'object') {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (typeof h.objective_id !== 'string' || !h.objective_id) {
      errors.push(`${prefix}.objective_id must be a non-empty string`);
    }
    if (typeof h.priority_score !== 'number' || h.priority_score < 0 || h.priority_score > 100) {
      errors.push(`${prefix}.priority_score must be 0-100`);
    }
    if (typeof h.risk_score !== 'number' || h.risk_score < 0 || h.risk_score > 100) {
      errors.push(`${prefix}.risk_score must be 0-100`);
    }
    if (typeof h.confidence !== 'number' || h.confidence < 0 || h.confidence > 1) {
      errors.push(`${prefix}.confidence must be 0-1`);
    }
    if (!VALID_RECOMMENDATION_CODES.includes(h.recommendation_code)) {
      errors.push(`${prefix}.recommendation_code must be one of: ${VALID_RECOMMENDATION_CODES.join(', ')}`);
    }
    if (typeof h.rank_delta_hint !== 'number' || h.rank_delta_hint < -10 || h.rank_delta_hint > 10) {
      errors.push(`${prefix}.rank_delta_hint must be -10 to 10`);
    }
    if (!Array.isArray(h.why_codes) || h.why_codes.length > 5) {
      errors.push(`${prefix}.why_codes must be array of max 5`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  RECOMMENDATION_MAP,
  VALID_RECOMMENDATION_CODES,
  WHY_CODES,
  HINTS_VERSION,
  computeRankDelta,
  isSafetyOverride,
  extractWhyCodes,
  generateHints,
  validateHints,
};
