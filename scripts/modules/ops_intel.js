#!/usr/bin/env node
/**
 * ops_intel.js — Operations Intelligence Lens
 *
 * Scores objectives based on drift failures, lock contention, budget near-breaches,
 * and repeated stalls. Uses only local, inspectable inputs.
 *
 * Returns: { score_delta, risk_delta, confidence_delta, signals[] }
 */

'use strict';

/**
 * Analyze operations signals for an objective.
 *
 * @param {string} objId - Objective ID
 * @param {object} context - { events[], gateReports{}, quarantine{}, killSwitch: bool }
 * @returns {{ score_delta: number, risk_delta: number, confidence_delta: number, signals: string[] }}
 */
function analyze(objId, context) {
  const events = context.events || [];
  const gateReports = context.gateReports || {};
  const quarantine = context.quarantine || {};
  const killSwitch = !!context.killSwitch;

  let scoreDelta = 0;
  let riskDelta = 0;
  let confidenceDelta = 0;
  const signals = [];

  // --- Signal 1: Drift telemetry failures ---
  const driftReport = gateReports['drift-telemetry'] || {};
  const driftFailed = driftReport.failed ||
    ((driftReport.checks_total || 0) - (driftReport.checks_passed || 0)) || 0;
  if (driftFailed > 0) {
    scoreDelta += 10;
    riskDelta += 20;
    confidenceDelta -= 0.1;
    signals.push(`drift-telemetry: ${driftFailed} check(s) failing — config drift detected`);
  }

  // --- Signal 2: Lock contention (arbitration blocks) ---
  const arbBlocks = events.filter(
    e => e.event === 'ARBITRATION_BLOCKED' && e.objective_id === objId
  );
  if (arbBlocks.length >= 5) {
    scoreDelta += 10;
    riskDelta += 15;
    confidenceDelta -= 0.1;
    signals.push(`${arbBlocks.length} arbitration blocks — severe contention`);
  } else if (arbBlocks.length >= 2) {
    scoreDelta += 5;
    riskDelta += 5;
    signals.push(`${arbBlocks.length} arbitration blocks — moderate contention`);
  }

  // --- Signal 3: Budget near-breaches and breaches ---
  const budgetBreaches = events.filter(
    e => e.event === 'BUDGET_BREACH' && e.objective_id === objId
  );
  const budgetNear = events.filter(
    e => e.event === 'BUDGET_NEAR_BREACH' && e.objective_id === objId
  );
  if (budgetBreaches.length > 0) {
    scoreDelta += 5;
    riskDelta += 25;
    confidenceDelta -= 0.15;
    signals.push(`${budgetBreaches.length} budget breach(es) — cost/context limit hit`);
  }
  if (budgetNear.length > 0) {
    riskDelta += 10;
    signals.push(`${budgetNear.length} budget near-breach(es) — approaching limits`);
  }

  // --- Signal 4: Quarantine status ---
  const objQuarantine = quarantine[objId];
  if (objQuarantine && objQuarantine.quarantined) {
    riskDelta += 30;
    confidenceDelta -= 0.2;
    signals.push(`QUARANTINED: ${objQuarantine.reason || 'unknown reason'}`);
  }

  // --- Signal 5: Kill switch ---
  if (killSwitch) {
    riskDelta += 50;
    confidenceDelta -= 0.3;
    signals.push('KILL SWITCH ENGAGED — all operations halted');
  }

  // --- Signal 6: Ops hardening failures ---
  const opsReport = gateReports['ops-hardening'] || {};
  const opsFailed = opsReport.failed || 0;
  if (opsFailed > 0) {
    riskDelta += 15;
    confidenceDelta -= 0.1;
    signals.push(`ops-hardening: ${opsFailed} check(s) failing`);
  }

  // --- Signal 7: Budget enforcement report failures ---
  const budgetReport = gateReports['budget-enforcement'] || {};
  if (budgetReport.status === 'FAIL') {
    riskDelta += 15;
    signals.push('budget-enforcement gate FAILING');
  }

  return {
    score_delta: scoreDelta,
    risk_delta: riskDelta,
    confidence_delta: confidenceDelta,
    signals,
  };
}

module.exports = { analyze };
