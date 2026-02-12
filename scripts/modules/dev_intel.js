#!/usr/bin/env node
/**
 * dev_intel.js — Development Intelligence Lens
 *
 * Scores objectives based on CI churn, PR complexity, repeated gate failures,
 * and large diffs. Uses only local, inspectable inputs (fixture-driven in CI).
 *
 * Returns: { score_delta, risk_delta, confidence_delta, signals[] }
 */

'use strict';

/**
 * Analyze development signals for an objective.
 *
 * @param {string} objId - Objective ID
 * @param {object} context - { events[], gateReports{}, objectives{} }
 * @returns {{ score_delta: number, risk_delta: number, confidence_delta: number, signals: string[] }}
 */
function analyze(objId, context) {
  const events = context.events || [];
  const gateReports = context.gateReports || {};
  const objMeta = (context.objectives || {})[objId] || {};

  let scoreDelta = 0;
  let riskDelta = 0;
  let confidenceDelta = 0;
  const signals = [];

  // --- Signal 1: Repeated delivery failures ---
  const failures = events.filter(
    e => e.event === 'DELIVERY_FAILED' && e.objective_id === objId
  );
  if (failures.length >= 3) {
    scoreDelta += 15;  // Raise priority — needs attention
    riskDelta += 20;
    confidenceDelta -= 0.15;
    signals.push(`${failures.length} delivery failures — repeated CI breakage`);
  } else if (failures.length >= 1) {
    scoreDelta += 5;
    riskDelta += 5;
    signals.push(`${failures.length} delivery failure(s)`);
  }

  // --- Signal 2: Retries indicate churn ---
  const retries = events.filter(
    e => e.event === 'DELIVERY_RETRY' && e.objective_id === objId
  );
  if (retries.length >= 3) {
    scoreDelta += 10;
    riskDelta += 15;
    confidenceDelta -= 0.1;
    signals.push(`${retries.length} retries — high CI churn`);
  } else if (retries.length >= 1) {
    scoreDelta += 3;
    signals.push(`${retries.length} retry attempt(s)`);
  }

  // --- Signal 3: Gate failures in reports ---
  let totalGateFails = 0;
  for (const [gateName, report] of Object.entries(gateReports)) {
    const failed = report.failed || (report.checks_total - report.checks_passed) || 0;
    if (failed > 0) {
      totalGateFails += failed;
      signals.push(`${gateName}: ${failed} check(s) failing`);
    }
  }
  if (totalGateFails > 0) {
    scoreDelta += Math.min(totalGateFails * 3, 15);
    riskDelta += Math.min(totalGateFails * 5, 25);
    confidenceDelta -= 0.05;
  }

  // --- Signal 4: Model escalation blocks (complexity indicator) ---
  const escalationBlocks = events.filter(
    e => e.event === 'MODEL_ESCALATION_BLOCKED' && e.objective_id === objId
  );
  if (escalationBlocks.length > 0) {
    riskDelta += 10;
    confidenceDelta -= 0.05;
    signals.push(`${escalationBlocks.length} model escalation(s) blocked — high complexity`);
  }

  // --- Signal 5: Objective age (stale = needs attention) ---
  if (objMeta.created_at) {
    const ageMs = Date.now() - new Date(objMeta.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > 7) {
      scoreDelta += 10;
      signals.push(`Objective age ${Math.round(ageDays)}d — may be stale`);
    } else if (ageDays > 3) {
      scoreDelta += 5;
      signals.push(`Objective age ${Math.round(ageDays)}d`);
    }
  }

  return {
    score_delta: scoreDelta,
    risk_delta: riskDelta,
    confidence_delta: confidenceDelta,
    signals,
  };
}

module.exports = { analyze };
