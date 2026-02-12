#!/usr/bin/env node
/**
 * budget_enforcement_policy.js — Budget enforcement for Delivery OS runs
 *
 * Prevents runaway loops by enforcing hard limits on:
 *   - max_tokens_total: total token spend across all model calls
 *   - max_steps: total execution steps in a run
 *   - max_retries: total retry attempts for a run
 *   - max_wall_clock_ms: total elapsed wall-clock time
 *
 * On breach:
 *   - Execution stops immediately (fail-closed)
 *   - Objective status → BUDGET_EXCEEDED
 *   - Event appended to ledger (monotonic event_seq preserved)
 *   - Proof artifact written (MD + JSON, no secrets)
 *   - No further retries allowed
 *
 * Model escalation guard:
 *   - Expensive model use blocked unless execution_mode === "final"
 *     AND an escalation_reason is provided
 *
 * Exit code 16 = BUDGET_EXCEEDED (fail-closed, dedicated code)
 *
 * Pattern origin: Port #4 from V1_PORT_SCOPE — cost/spend controls
 * No runtime dependency on upstream
 */

'use strict';

// ─── Exit Codes ───

const EXIT_BUDGET_EXCEEDED = 16;

// ─── Default Budgets ───

const DEFAULT_BUDGETS = {
  max_tokens_total: 500_000,
  max_steps: 50,
  max_retries: 5,
  max_wall_clock_ms: 600_000  // 10 minutes
};

// ─── Expensive Models ───
// Models that cost >$10/M tokens or are otherwise "premium"

const EXPENSIVE_MODELS = [
  'claude-opus-4-6',
  'claude-opus-4-5-20250514',
  'gpt-4o',
  'o1-preview',
  'o1',
  'o3'
];

// ─── Budget Tracker ───

/**
 * Create a new budget tracker for an objective run.
 *
 * @param {{ objective_id: string, budgets?: object }} opts
 * @returns {BudgetTracker}
 */
function createTracker({ objective_id, budgets }) {
  const limits = { ...DEFAULT_BUDGETS, ...(budgets || {}) };

  return {
    objective_id,
    limits,
    counters: {
      tokens_total: 0,
      steps: 0,
      retries: 0,
      wall_clock_start_ms: Date.now(),
      budget_exceeded: false,
      exceeded_reason: null,
      exceeded_at: null,
      events: []
    }
  };
}

/**
 * Record token usage for a model call.
 *
 * @param {BudgetTracker} tracker
 * @param {number} tokens
 */
function recordTokens(tracker, tokens) {
  if (typeof tokens !== 'number' || tokens < 0) return;
  tracker.counters.tokens_total += tokens;
}

/**
 * Increment the step counter.
 *
 * @param {BudgetTracker} tracker
 */
function recordStep(tracker) {
  tracker.counters.steps += 1;
}

/**
 * Increment the retry counter.
 *
 * @param {BudgetTracker} tracker
 */
function recordRetry(tracker) {
  tracker.counters.retries += 1;
}

/**
 * Check if ANY budget limit has been exceeded.
 * If exceeded, marks the tracker as breached and returns the breach info.
 * Once breached, all subsequent checks return the same breach (fail-closed).
 *
 * @param {BudgetTracker} tracker
 * @returns {{ exceeded: boolean, reason: string|null, snapshot: object }}
 */
function checkBudget(tracker) {
  // Once exceeded, always exceeded (no further retries)
  if (tracker.counters.budget_exceeded) {
    return {
      exceeded: true,
      reason: tracker.counters.exceeded_reason,
      snapshot: getSnapshot(tracker)
    };
  }

  const c = tracker.counters;
  const l = tracker.limits;

  // Check each budget type
  if (c.tokens_total > l.max_tokens_total) {
    return _markExceeded(tracker, 'tokens_total',
      `Token budget exceeded: ${c.tokens_total} > ${l.max_tokens_total}`);
  }

  if (c.steps > l.max_steps) {
    return _markExceeded(tracker, 'steps',
      `Step budget exceeded: ${c.steps} > ${l.max_steps}`);
  }

  if (c.retries > l.max_retries) {
    return _markExceeded(tracker, 'retries',
      `Retry budget exceeded: ${c.retries} > ${l.max_retries}`);
  }

  const elapsed = Date.now() - c.wall_clock_start_ms;
  if (elapsed > l.max_wall_clock_ms) {
    return _markExceeded(tracker, 'wall_clock_ms',
      `Wall clock budget exceeded: ${elapsed}ms > ${l.max_wall_clock_ms}ms`);
  }

  return { exceeded: false, reason: null, snapshot: getSnapshot(tracker) };
}

/**
 * Check budget and throw if exceeded. For use in execution loops.
 *
 * @param {BudgetTracker} tracker
 * @throws {BudgetExceededError}
 */
function checkOrThrowBudgetExceeded(tracker) {
  const result = checkBudget(tracker);
  if (result.exceeded) {
    const err = new Error(result.reason);
    err.code = 'BUDGET_EXCEEDED';
    err.exitCode = EXIT_BUDGET_EXCEEDED;
    err.snapshot = result.snapshot;
    throw err;
  }
}

/**
 * Check if an expensive model can be used.
 *
 * @param {{ model: string, execution_mode: string, escalation_reason?: string }} opts
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkModelEscalation({ model, execution_mode, escalation_reason }) {
  const isExpensive = EXPENSIVE_MODELS.some(m =>
    model.toLowerCase().includes(m.toLowerCase())
  );

  if (!isExpensive) {
    return { allowed: true, reason: 'Model is not in expensive list' };
  }

  if (execution_mode !== 'final') {
    return {
      allowed: false,
      reason: `Expensive model "${model}" blocked: execution_mode="${execution_mode}" (must be "final")`
    };
  }

  if (!escalation_reason || escalation_reason.trim().length === 0) {
    return {
      allowed: false,
      reason: `Expensive model "${model}" blocked: no escalation_reason provided (required in final mode)`
    };
  }

  return {
    allowed: true,
    reason: `Expensive model "${model}" allowed: execution_mode=final, reason="${escalation_reason}"`
  };
}

/**
 * Get a normalized budget snapshot (safe for logging, no secrets).
 *
 * @param {BudgetTracker} tracker
 * @returns {object}
 */
function getSnapshot(tracker) {
  const elapsed = Date.now() - tracker.counters.wall_clock_start_ms;
  return {
    objective_id: tracker.objective_id,
    limits: { ...tracker.limits },
    counters: {
      tokens_total: tracker.counters.tokens_total,
      steps: tracker.counters.steps,
      retries: tracker.counters.retries,
      wall_clock_ms: elapsed
    },
    budget_exceeded: tracker.counters.budget_exceeded,
    exceeded_reason: tracker.counters.exceeded_reason,
    exceeded_at: tracker.counters.exceeded_at,
    event_count: tracker.counters.events.length
  };
}

/**
 * Append an event to the tracker's event log (monotonic sequence).
 *
 * @param {BudgetTracker} tracker
 * @param {string} eventName
 * @param {object} [extra]
 * @returns {object} The event object
 */
function appendEvent(tracker, eventName, extra) {
  const seq = tracker.counters.events.length + 1;
  const event = {
    event_seq: seq,
    event: eventName,
    timestamp: new Date().toISOString(),
    objective_id: tracker.objective_id,
    ...getSnapshot(tracker),
    ...(extra || {})
  };
  tracker.counters.events.push(event);
  return event;
}

/**
 * Generate proof artifact content for a budget breach.
 *
 * @param {BudgetTracker} tracker
 * @returns {{ md: string, json: object }}
 */
function generateBreachProof(tracker) {
  const snapshot = getSnapshot(tracker);
  const ts = new Date().toISOString().replace(/[:.]/g, '');

  const json = {
    type: 'BUDGET_EXCEEDED',
    objective_id: tracker.objective_id,
    timestamp_utc: new Date().toISOString(),
    snapshot,
    events: tracker.counters.events
  };

  const md = [
    '# Budget Exceeded — Proof Artifact',
    '',
    `**Objective:** ${tracker.objective_id}`,
    `**Timestamp:** ${new Date().toISOString()}`,
    `**Reason:** ${tracker.counters.exceeded_reason || 'unknown'}`,
    '',
    '## Budget Snapshot',
    '',
    '| Metric | Value | Limit | Status |',
    '|--------|-------|-------|--------|',
    `| Tokens | ${snapshot.counters.tokens_total} | ${snapshot.limits.max_tokens_total} | ${snapshot.counters.tokens_total > snapshot.limits.max_tokens_total ? 'EXCEEDED' : 'OK'} |`,
    `| Steps | ${snapshot.counters.steps} | ${snapshot.limits.max_steps} | ${snapshot.counters.steps > snapshot.limits.max_steps ? 'EXCEEDED' : 'OK'} |`,
    `| Retries | ${snapshot.counters.retries} | ${snapshot.limits.max_retries} | ${snapshot.counters.retries > snapshot.limits.max_retries ? 'EXCEEDED' : 'OK'} |`,
    `| Wall Clock | ${snapshot.counters.wall_clock_ms}ms | ${snapshot.limits.max_wall_clock_ms}ms | ${snapshot.counters.wall_clock_ms > snapshot.limits.max_wall_clock_ms ? 'EXCEEDED' : 'OK'} |`,
    '',
    '## Events',
    '',
    '```json',
    JSON.stringify(tracker.counters.events, null, 2),
    '```',
    '',
    '---',
    '*Generated by budget_enforcement_policy.js — no secrets included.*',
    ''
  ].join('\n');

  return { md, json };
}

/**
 * Build a report for the CI gate runner.
 *
 * @param {object} opts
 * @returns {object}
 */
function buildReport({ status, findings, run_id, commit_sha }) {
  return {
    run_id: run_id || 'unknown',
    commit_sha: commit_sha || 'unknown',
    timestamp_utc: new Date().toISOString(),
    status,
    findings: findings || [],
    exit_code: status === 'FAIL' ? EXIT_BUDGET_EXCEEDED : 0
  };
}

// ─── Internal helpers ───

function _markExceeded(tracker, metric, reason) {
  tracker.counters.budget_exceeded = true;
  tracker.counters.exceeded_reason = reason;
  tracker.counters.exceeded_at = new Date().toISOString();

  // Auto-append breach event
  appendEvent(tracker, 'BUDGET_EXCEEDED', { breached_metric: metric });

  return {
    exceeded: true,
    reason,
    snapshot: getSnapshot(tracker)
  };
}

module.exports = {
  EXIT_BUDGET_EXCEEDED,
  DEFAULT_BUDGETS,
  EXPENSIVE_MODELS,
  createTracker,
  recordTokens,
  recordStep,
  recordRetry,
  checkBudget,
  checkOrThrowBudgetExceeded,
  checkModelEscalation,
  getSnapshot,
  appendEvent,
  generateBreachProof,
  buildReport
};
