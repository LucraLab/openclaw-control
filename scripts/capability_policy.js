#!/usr/bin/env node
/**
 * capability_policy.js — Capability Matrix Enforcement for OpenClaw
 *
 * Single-chokepoint enforcement for model calls, tool calls, and filesystem writes.
 *
 * Every model/tool/write must route through the wrapper functions:
 *   invokeModel()   — capability allowlist + escalation + budget accounting
 *   invokeTool()    — capability allowlist + side-effect approval
 *   safeWriteFile() — path scope enforcement
 *
 * Missing or unknown profile/action = DENY (fail-closed).
 *
 * Deny events:
 *   - CAPABILITY_DENIED event appended (monotonic event_seq)
 *   - Proof artifact generated (MD + JSON, sanitized)
 *   - Exactly one event per denied action (no spam)
 */

'use strict';

const path = require('path');

// ─── Constants ───

const EXIT_CAPABILITY_DENIED = 17;

const SIDE_EFFECT_CLASSES = ['send', 'deploy', 'delete', 'rotate', 'firewall'];

const EXPENSIVE_MODELS = [
  'claude-opus-4-6', 'claude-opus-4-5-20250514',
  'gpt-4o', 'o1-preview', 'o1', 'o3'
];

// ─── Default Profile (fail-closed) ───

const DEFAULT_PROFILE = {
  agent_id: 'unknown',
  models_allowed: [],
  models_denied: [],
  tools_allowed: [],
  tools_denied: [],
  side_effect_approval_required: SIDE_EFFECT_CLASSES.slice(),
  write_allow: [],
  write_deny: ['**']
};

// ─── Profile Loading ───

/**
 * Load and validate an agent capability profile.
 * Missing fields inherit fail-closed defaults.
 *
 * @param {object} profileData — raw profile object (from JSON)
 * @returns {object} validated profile with defaults applied
 */
function loadProfile(profileData) {
  if (!profileData || typeof profileData !== 'object') {
    return Object.assign({}, DEFAULT_PROFILE);
  }

  return {
    agent_id: profileData.agent_id || DEFAULT_PROFILE.agent_id,
    models_allowed: Array.isArray(profileData.models_allowed)
      ? profileData.models_allowed : DEFAULT_PROFILE.models_allowed,
    models_denied: Array.isArray(profileData.models_denied)
      ? profileData.models_denied : DEFAULT_PROFILE.models_denied,
    tools_allowed: Array.isArray(profileData.tools_allowed)
      ? profileData.tools_allowed : DEFAULT_PROFILE.tools_allowed,
    tools_denied: Array.isArray(profileData.tools_denied)
      ? profileData.tools_denied : DEFAULT_PROFILE.tools_denied,
    side_effect_approval_required: Array.isArray(profileData.side_effect_approval_required)
      ? profileData.side_effect_approval_required : DEFAULT_PROFILE.side_effect_approval_required,
    write_allow: Array.isArray(profileData.write_allow)
      ? profileData.write_allow : DEFAULT_PROFILE.write_allow,
    write_deny: Array.isArray(profileData.write_deny)
      ? profileData.write_deny : DEFAULT_PROFILE.write_deny
  };
}

// ─── Event Tracking ───

let _eventSeq = 0;
const _denyLog = new Map(); // key → true (dedup)

/**
 * Reset event tracking (for tests only).
 */
function _resetEventTracking() {
  _eventSeq = 0;
  _denyLog.clear();
}

/**
 * Get current event sequence number.
 */
function getEventSeq() {
  return _eventSeq;
}

/**
 * Create a CAPABILITY_DENIED event.
 * Returns null if this exact deny was already logged (no spam).
 *
 * @param {string} action — 'model'|'tool'|'write'
 * @param {string} target — model name, tool name, or file path
 * @param {string} reason — why denied
 * @param {string} agentId — agent that attempted the action
 * @returns {object|null} event object or null if duplicate
 */
function createDenyEvent(action, target, reason, agentId) {
  const dedupeKey = `${action}:${target}:${agentId}`;

  if (_denyLog.has(dedupeKey)) {
    return null; // already logged — no spam
  }

  _denyLog.set(dedupeKey, true);
  _eventSeq++;

  return {
    event_seq: _eventSeq,
    event_type: 'CAPABILITY_DENIED',
    timestamp_utc: new Date().toISOString(),
    agent_id: agentId,
    action,
    target: sanitizeTarget(target),
    reason,
    exit_code: EXIT_CAPABILITY_DENIED
  };
}

/**
 * Sanitize a target string to remove potential secrets.
 */
function sanitizeTarget(target) {
  if (!target || typeof target !== 'string') return 'unknown';
  // Truncate long targets, mask anything that looks like a token
  let s = target.substring(0, 200);
  s = s.replace(/sk-[a-zA-Z0-9_-]{4,}/g, 'sk-***');
  s = s.replace(/ghp_[a-zA-Z0-9]{4,}/g, 'ghp_***');
  s = s.replace(/AKIA[A-Z0-9]{4,}/g, 'AKIA***');
  s = s.replace(/pit-[a-zA-Z0-9]{4,}/g, 'pit-***');
  s = s.replace(/xoxb-[0-9]+-[a-zA-Z0-9]+/g, 'xoxb-***');
  return s;
}

// ─── Capability Checks (pure, no side effects) ───

/**
 * Check if a model is allowed by the profile.
 *
 * @param {object} profile — loaded agent profile
 * @param {string} model — model identifier
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkModelCapability(profile, model) {
  if (!profile || !model) {
    return { allowed: false, reason: 'Missing profile or model identifier' };
  }

  // Explicit deny takes priority
  if (profile.models_denied.includes(model)) {
    return { allowed: false, reason: `Model "${model}" is explicitly denied for agent "${profile.agent_id}"` };
  }

  // Must be in allowlist
  if (!profile.models_allowed.includes(model)) {
    return { allowed: false, reason: `Model "${model}" not in allowlist for agent "${profile.agent_id}"` };
  }

  return { allowed: true, reason: 'Model allowed by capability profile' };
}

/**
 * Check if a tool is allowed by the profile.
 *
 * @param {object} profile — loaded agent profile
 * @param {string} tool — tool identifier
 * @param {string|null} sideEffectClass — side-effect class if applicable
 * @param {string|null} approvalToken — approval token for side-effect tools
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkToolCapability(profile, tool, sideEffectClass, approvalToken) {
  if (!profile || !tool) {
    return { allowed: false, reason: 'Missing profile or tool identifier' };
  }

  // Explicit deny takes priority
  if (profile.tools_denied.includes(tool)) {
    return { allowed: false, reason: `Tool "${tool}" is explicitly denied for agent "${profile.agent_id}"` };
  }

  // Must be in allowlist
  if (!profile.tools_allowed.includes(tool)) {
    return { allowed: false, reason: `Tool "${tool}" not in allowlist for agent "${profile.agent_id}"` };
  }

  // Side-effect class gating
  if (sideEffectClass && profile.side_effect_approval_required.includes(sideEffectClass)) {
    if (!approvalToken || typeof approvalToken !== 'string' || approvalToken.trim() === '') {
      return {
        allowed: false,
        reason: `Tool "${tool}" requires approval token for side-effect class "${sideEffectClass}"`
      };
    }
  }

  return { allowed: true, reason: 'Tool allowed by capability profile' };
}

/**
 * Check if a file path is allowed for writing.
 *
 * @param {object} profile — loaded agent profile
 * @param {string} filePath — target file path
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkWritePath(profile, filePath) {
  if (!profile || !filePath) {
    return { allowed: false, reason: 'Missing profile or file path' };
  }

  const normalized = filePath.replace(/\\/g, '/');

  // Check deny list first (deny takes priority)
  for (const denyPattern of profile.write_deny) {
    if (pathMatches(normalized, denyPattern)) {
      return { allowed: false, reason: `Path "${sanitizeTarget(filePath)}" matches deny pattern "${denyPattern}"` };
    }
  }

  // Must match at least one allow pattern
  const allowed = profile.write_allow.some(allowPattern => pathMatches(normalized, allowPattern));

  if (!allowed) {
    return { allowed: false, reason: `Path "${sanitizeTarget(filePath)}" not in any write_allow pattern for agent "${profile.agent_id}"` };
  }

  return { allowed: true, reason: 'Write path allowed by capability profile' };
}

/**
 * Simple path prefix matching.
 * Supports:
 *   - Exact match: ".env" matches ".env"
 *   - Prefix match: "scripts/" matches "scripts/foo.js"
 *   - Wildcard: "**" matches everything
 *
 * @param {string} filePath — normalized file path
 * @param {string} pattern — pattern to match
 * @returns {boolean}
 */
function pathMatches(filePath, pattern) {
  if (pattern === '**') return true;
  if (filePath === pattern) return true;
  if (pattern.endsWith('/') && filePath.startsWith(pattern)) return true;
  // Also match if pattern is a filename and path ends with it
  if (!pattern.includes('/') && (filePath === pattern || filePath.endsWith('/' + pattern))) return true;
  return false;
}

// ─── Chokepoint Wrappers ───

/**
 * Chokepoint wrapper for model invocations.
 * Enforces: capability allowlist + model escalation + budget compatibility.
 *
 * @param {object} tracker — Port #4 budget tracker (optional, for accounting)
 * @param {object} profile — loaded agent capability profile
 * @param {{ model: string, execution_mode: string, escalation_reason: string }} opts
 * @returns {{ allowed: boolean, reason: string, event: object|null }}
 */
function invokeModel(tracker, profile, opts) {
  const { model, execution_mode, escalation_reason } = opts || {};

  // Phase 1: Capability check
  const capCheck = checkModelCapability(profile, model);
  if (!capCheck.allowed) {
    const event = createDenyEvent('model', model, capCheck.reason, profile ? profile.agent_id : 'unknown');
    return { allowed: false, reason: capCheck.reason, event };
  }

  // Phase 2: Expensive model escalation guard (Port #4 compat)
  if (EXPENSIVE_MODELS.includes(model)) {
    if (execution_mode !== 'final') {
      const reason = `Expensive model "${model}" blocked: execution_mode must be "final" (got "${execution_mode}")`;
      const event = createDenyEvent('model', model, reason, profile.agent_id);
      return { allowed: false, reason, event };
    }
    if (!escalation_reason || typeof escalation_reason !== 'string' || escalation_reason.trim() === '') {
      const reason = `Expensive model "${model}" blocked: escalation_reason required`;
      const event = createDenyEvent('model', model, reason, profile.agent_id);
      return { allowed: false, reason, event };
    }
  }

  // Phase 3: Budget accounting (if tracker provided)
  if (tracker && typeof tracker === 'object' && tracker.counters) {
    tracker.counters.steps = (tracker.counters.steps || 0) + 1;
  }

  return { allowed: true, reason: 'Model invocation allowed', event: null };
}

/**
 * Chokepoint wrapper for tool invocations.
 * Enforces: capability allowlist + side-effect approval.
 *
 * @param {object} tracker — Port #4 budget tracker (optional, for accounting)
 * @param {object} profile — loaded agent capability profile
 * @param {{ tool: string, sideEffectClass: string|null, approvalToken: string|null }} opts
 * @returns {{ allowed: boolean, reason: string, event: object|null }}
 */
function invokeTool(tracker, profile, opts) {
  const { tool, sideEffectClass, approvalToken } = opts || {};

  const capCheck = checkToolCapability(profile, tool, sideEffectClass, approvalToken);
  if (!capCheck.allowed) {
    const event = createDenyEvent('tool', tool, capCheck.reason, profile ? profile.agent_id : 'unknown');
    return { allowed: false, reason: capCheck.reason, event };
  }

  // Budget accounting (if tracker provided)
  if (tracker && typeof tracker === 'object' && tracker.counters) {
    tracker.counters.steps = (tracker.counters.steps || 0) + 1;
  }

  return { allowed: true, reason: 'Tool invocation allowed', event: null };
}

/**
 * Chokepoint wrapper for filesystem writes.
 * Enforces: path scope via write_allow / write_deny.
 *
 * @param {object} tracker — Port #4 budget tracker (optional, for accounting)
 * @param {object} profile — loaded agent capability profile
 * @param {{ filePath: string }} opts
 * @returns {{ allowed: boolean, reason: string, event: object|null }}
 */
function safeWriteFile(tracker, profile, opts) {
  const { filePath } = opts || {};

  const pathCheck = checkWritePath(profile, filePath);
  if (!pathCheck.allowed) {
    const event = createDenyEvent('write', filePath, pathCheck.reason, profile ? profile.agent_id : 'unknown');
    return { allowed: false, reason: pathCheck.reason, event };
  }

  // Budget accounting (if tracker provided)
  if (tracker && typeof tracker === 'object' && tracker.counters) {
    tracker.counters.steps = (tracker.counters.steps || 0) + 1;
  }

  return { allowed: true, reason: 'File write allowed', event: null };
}

// ─── Deny Proof Artifacts ───

/**
 * Generate proof artifacts for a deny event.
 *
 * @param {object} event — CAPABILITY_DENIED event
 * @returns {{ md: string, json: object }}
 */
function generateDenyProof(event) {
  if (!event) return { md: '', json: {} };

  const json = {
    type: 'CAPABILITY_DENIED',
    event_seq: event.event_seq,
    timestamp_utc: event.timestamp_utc,
    agent_id: event.agent_id,
    action: event.action,
    target: event.target,
    reason: event.reason,
    exit_code: event.exit_code
  };

  const md = [
    '# Capability Denied Proof',
    '',
    `**Event Seq:** ${event.event_seq}`,
    `**Time:** ${event.timestamp_utc}`,
    `**Agent:** ${event.agent_id}`,
    `**Action:** ${event.action}`,
    `**Target:** ${event.target}`,
    `**Reason:** ${event.reason}`,
    `**Exit Code:** ${event.exit_code}`,
    ''
  ].join('\n');

  return { md, json };
}

// ─── Report Builder ───

/**
 * Build a gate report for CI.
 *
 * @param {{ status: string, findings: Array, run_id: string, commit_sha: string }} opts
 * @returns {object}
 */
function buildReport({ status, findings, run_id, commit_sha }) {
  return {
    run_id: run_id || 'unknown',
    commit_sha: commit_sha || 'unknown',
    timestamp_utc: new Date().toISOString(),
    status: status || 'UNKNOWN',
    findings: findings || [],
    exit_code: status === 'PASS' ? 0 : 1
  };
}

// ─── Exports ───

module.exports = {
  EXIT_CAPABILITY_DENIED,
  SIDE_EFFECT_CLASSES,
  EXPENSIVE_MODELS,
  DEFAULT_PROFILE,
  loadProfile,
  checkModelCapability,
  checkToolCapability,
  checkWritePath,
  pathMatches,
  invokeModel,
  invokeTool,
  safeWriteFile,
  createDenyEvent,
  sanitizeTarget,
  generateDenyProof,
  buildReport,
  getEventSeq,
  _resetEventTracking
};
