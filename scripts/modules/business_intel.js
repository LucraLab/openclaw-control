#!/usr/bin/env node
/**
 * business_intel.js — Business Intelligence Lens
 *
 * Scores objectives based on impact tags (revenue, customer_blocking),
 * SLA urgency, and ROI likelihood. Uses only objective metadata tags.
 *
 * Returns: { score_delta, risk_delta, confidence_delta, signals[] }
 */

'use strict';

// Impact tag weights for priority scoring
const IMPACT_WEIGHTS = {
  revenue: 20,
  customer_blocking: 25,
  sla_critical: 20,
  compliance: 15,
  internal_tooling: 5,
  nice_to_have: -10,
};

// ROI likelihood multipliers
const ROI_WEIGHTS = {
  high: 1.3,
  medium: 1.0,
  low: 0.7,
};

/**
 * Analyze business signals for an objective.
 *
 * @param {string} objId - Objective ID
 * @param {object} context - { objectives{} }
 * @returns {{ score_delta: number, risk_delta: number, confidence_delta: number, signals: string[] }}
 */
function analyze(objId, context) {
  const objMeta = (context.objectives || {})[objId] || {};
  const tags = objMeta.tags || [];
  const roi = objMeta.roi_likelihood || 'medium';

  let scoreDelta = 0;
  let riskDelta = 0;
  let confidenceDelta = 0;
  const signals = [];

  // --- Signal 1: Impact tags ---
  for (const tag of tags) {
    const weight = IMPACT_WEIGHTS[tag];
    if (weight !== undefined) {
      scoreDelta += weight;
      signals.push(`tag:${tag} → priority ${weight > 0 ? '+' : ''}${weight}`);

      // Customer-blocking and SLA-critical raise risk
      if (tag === 'customer_blocking') {
        riskDelta += 15;
        signals.push('customer-blocking → elevated risk');
      }
      if (tag === 'sla_critical') {
        riskDelta += 10;
        signals.push('SLA-critical → time-sensitive risk');
      }
    }
  }

  // --- Signal 2: ROI likelihood multiplier ---
  const roiMult = ROI_WEIGHTS[roi] || 1.0;
  if (roiMult !== 1.0) {
    const beforeDelta = scoreDelta;
    scoreDelta = Math.round(scoreDelta * roiMult);
    signals.push(`ROI:${roi} → score adjusted ${beforeDelta} → ${scoreDelta}`);
  }

  // --- Signal 3: Urgency from due_date ---
  if (objMeta.due_date) {
    const dueMs = new Date(objMeta.due_date).getTime();
    const nowMs = Date.now();
    const daysUntilDue = (dueMs - nowMs) / (1000 * 60 * 60 * 24);

    if (daysUntilDue < 0) {
      scoreDelta += 20;
      riskDelta += 20;
      signals.push(`OVERDUE by ${Math.abs(Math.round(daysUntilDue))}d`);
    } else if (daysUntilDue <= 2) {
      scoreDelta += 15;
      riskDelta += 10;
      signals.push(`Due in ${Math.round(daysUntilDue)}d — urgent`);
    } else if (daysUntilDue <= 7) {
      scoreDelta += 5;
      signals.push(`Due in ${Math.round(daysUntilDue)}d`);
    }
  }

  // --- Signal 4: Missing evidence → lower confidence ---
  if (tags.length === 0 && !objMeta.due_date && !objMeta.roi_likelihood) {
    confidenceDelta -= 0.15;
    signals.push('No business metadata — low confidence in prioritization');
  } else {
    confidenceDelta += 0.1;
  }

  return {
    score_delta: scoreDelta,
    risk_delta: riskDelta,
    confidence_delta: confidenceDelta,
    signals,
  };
}

module.exports = { analyze };
