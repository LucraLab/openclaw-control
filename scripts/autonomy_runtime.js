#!/usr/bin/env node
/**
 * autonomy_runtime.js — Shared library for Autonomy Runtime v1
 *
 * Provides: quarantine, kill switch, spend ledger, canonical artifacts, event emission.
 * All state lives under OPENCLAW_RUNTIME_DIR (default: <repo_root>/.openclaw_runtime).
 * Fail-closed: missing/corrupt files = safe default (blocked/enabled/empty).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Runtime directory ───
const REPO_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = process.env.OPENCLAW_RUNTIME_DIR || path.join(REPO_ROOT, '.openclaw_runtime');

function ensureRuntimeDir() {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

function runtimePath(filename) {
  return path.join(RUNTIME_DIR, filename);
}

function isoNow() {
  return new Date().toISOString();
}

// ─── Sanitization ───
const SECRET_PATTERNS = /(?:sk-|ghp_|github_pat_|AKIA|Bearer |eyJ)[A-Za-z0-9_\-./+=]{8,}/g;
const TELEGRAM_TOKEN = /\d{8,}:[A-Za-z0-9_-]{30,}/g;
const PRIVATE_KEY = /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g;

function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(SECRET_PATTERNS, '[REDACTED]')
    .replace(TELEGRAM_TOKEN, '[REDACTED]')
    .replace(PRIVATE_KEY, '[REDACTED]');
}

function sanitizeObj(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitize(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObj);
  if (typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = sanitizeObj(v);
    }
    return result;
  }
  return obj;
}

// ─── Event emission ───
function emitEvent(eventType, payload) {
  ensureRuntimeDir();
  const line = JSON.stringify({
    ts: isoNow(),
    event: eventType,
    ...sanitizeObj(payload || {})
  });
  const eventsPath = runtimePath('events.jsonl');
  fs.appendFileSync(eventsPath, line + '\n');
  return line;
}

// ─── A) Quarantine ───
const QUARANTINE_FILE = 'quarantine.json';
const MAX_QUARANTINE_AGENTS = 200;

function readQuarantine() {
  try {
    const raw = fs.readFileSync(runtimePath(QUARANTINE_FILE), 'utf8');
    const data = JSON.parse(raw);
    if (data.version !== 'v1' || !Array.isArray(data.agents)) {
      return { version: 'v1', updated_at: isoNow(), agents: [] };
    }
    return data;
  } catch {
    return { version: 'v1', updated_at: isoNow(), agents: [] };
  }
}

function writeQuarantine(data) {
  ensureRuntimeDir();
  data.updated_at = isoNow();
  data.version = 'v1';
  // Enforce max; truncate oldest (end of array) if over limit
  if (data.agents.length > MAX_QUARANTINE_AGENTS) {
    data.agents = data.agents.slice(0, MAX_QUARANTINE_AGENTS);
  }
  const tmp = runtimePath(QUARANTINE_FILE + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, runtimePath(QUARANTINE_FILE));
}

function quarantineAdd(agentId) {
  if (typeof agentId !== 'string' || agentId.length === 0 || agentId.length > 128) {
    throw new Error('Invalid agent_id');
  }
  // Sanitize: only allow alphanumeric, dash, underscore
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    throw new Error('Invalid agent_id characters');
  }
  const q = readQuarantine();
  if (!q.agents.includes(agentId)) {
    q.agents.push(agentId);
    writeQuarantine(q);
    emitEvent('AGENT_QUARANTINED', { agent_id: agentId });
  }
  return q;
}

function quarantineRemove(agentId) {
  const q = readQuarantine();
  const idx = q.agents.indexOf(agentId);
  if (idx !== -1) {
    q.agents.splice(idx, 1);
    writeQuarantine(q);
    emitEvent('AGENT_UNQUARANTINED', { agent_id: agentId });
  }
  return q;
}

function quarantineList() {
  return readQuarantine().agents;
}

function isQuarantined(agentId) {
  return readQuarantine().agents.includes(agentId);
}

/**
 * Pick best agent from candidates, skipping quarantined.
 * Returns first non-quarantined agent (deterministic stable ordering).
 * If all quarantined, returns null + emits AGENT_QUARANTINE_BLOCKED_ASSIGNMENT.
 */
function pickAgentSkipQuarantine(candidates, context) {
  const quarantined = new Set(quarantineList());
  for (const agent of candidates) {
    if (!quarantined.has(agent)) {
      return agent;
    }
  }
  emitEvent('AGENT_QUARANTINE_BLOCKED_ASSIGNMENT', {
    candidates,
    all_quarantined: true,
    context: context || null
  });
  return null;
}

// ─── B) Kill Switch ───
const KILLSWITCH_FILE = 'killswitch.enabled';

function isKillSwitchActive() {
  try {
    return fs.existsSync(runtimePath(KILLSWITCH_FILE));
  } catch {
    // Fail closed: if we can't check, assume active (safer)
    return true;
  }
}

function killSwitchEnable() {
  ensureRuntimeDir();
  fs.writeFileSync(runtimePath(KILLSWITCH_FILE), isoNow());
  emitEvent('KILLSWITCH_ENABLED', {});
}

function killSwitchDisable() {
  try {
    fs.unlinkSync(runtimePath(KILLSWITCH_FILE));
  } catch {
    // Already disabled
  }
  emitEvent('KILLSWITCH_DISABLED', {});
}

function killSwitchStatus() {
  return { active: isKillSwitchActive() };
}

/**
 * Check kill switch at entrypoint. If active, emit event and return true.
 * Caller should exit 0 after this.
 */
function killSwitchGuard(entrypoint) {
  if (isKillSwitchActive()) {
    emitEvent('KILLSWITCH_ACTIVE', { entrypoint: entrypoint || 'unknown' });
    return true;
  }
  return false;
}

// ─── C) Spend / Burn-Rate Alerts ───
const SPEND_LEDGER_FILE = 'spend-ledger.jsonl';
const SPEND_ALERT_STATE_FILE = 'spend-alert-state.json';

// Cost estimation per 1K tokens (conservative defaults in USD)
const MODEL_COSTS = {
  'moonshot/kimi-k2.5': { input: 0.002, output: 0.006 },
  'anthropic/claude-sonnet-4-5': { input: 0.003, output: 0.015 },
  'unknown': { input: 0.003, output: 0.010 }
};

function getThresholds() {
  return {
    dailyCap: parseFloat(process.env.SPEND_ALERT_DAILY_CAP_USD || '20'),
    warnPct: parseFloat(process.env.SPEND_ALERT_WARN_PCT || '50'),
    highPct: parseFloat(process.env.SPEND_ALERT_HIGH_PCT || '80'),
    critPct: parseFloat(process.env.SPEND_ALERT_CRIT_PCT || '95'),
    autoQuarantine: process.env.SPEND_ALERT_AUTO_QUARANTINE === '1',
    autoKillswitch: process.env.SPEND_ALERT_AUTO_KILLSWITCH === '1'
  };
}

function estimateTokens(text) {
  if (typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

function estimateCost(model, tokensIn, tokensOut) {
  const costs = MODEL_COSTS[model] || MODEL_COSTS['unknown'];
  return (tokensIn / 1000) * costs.input + (tokensOut / 1000) * costs.output;
}

function appendSpendEntry(entry) {
  ensureRuntimeDir();
  const sanitized = sanitizeObj({
    ts: entry.ts || isoNow(),
    agent_id: entry.agent_id || 'unknown',
    model: entry.model || 'unknown',
    est_tokens_in: entry.est_tokens_in || 0,
    est_tokens_out: entry.est_tokens_out || 0,
    est_cost_usd: entry.est_cost_usd || 0,
    source: entry.source || 'unknown',
    correlation_id: entry.correlation_id || null
  });
  fs.appendFileSync(runtimePath(SPEND_LEDGER_FILE), JSON.stringify(sanitized) + '\n');
}

function readSpendLedger() {
  try {
    const raw = fs.readFileSync(runtimePath(SPEND_LEDGER_FILE), 'utf8');
    return raw.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function readSpendAlertState() {
  try {
    return JSON.parse(fs.readFileSync(runtimePath(SPEND_ALERT_STATE_FILE), 'utf8'));
  } catch {
    return { last_alerts: {} };
  }
}

function writeSpendAlertState(state) {
  ensureRuntimeDir();
  const tmp = runtimePath(SPEND_ALERT_STATE_FILE + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, runtimePath(SPEND_ALERT_STATE_FILE));
}

function computeDailySpend(entries) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  let total = 0;
  const perAgent = {};
  for (const e of entries) {
    if (e.ts >= todayISO) {
      const cost = e.est_cost_usd || 0;
      total += cost;
      perAgent[e.agent_id] = (perAgent[e.agent_id] || 0) + cost;
    }
  }
  return { total, perAgent };
}

function computeBurnRate(entries) {
  const now = Date.now();
  const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();

  let recentSpend = 0;
  for (const e of entries) {
    if (e.ts >= tenMinAgo) {
      recentSpend += (e.est_cost_usd || 0);
    }
  }
  // Projected daily burn = (spend in 10 min) * 144
  const projectedDaily = recentSpend * 144;
  return { recentSpend, projectedDaily };
}

function evaluateSpendAlerts() {
  const thresholds = getThresholds();
  const entries = readSpendLedger();
  const { total, perAgent } = computeDailySpend(entries);
  const { projectedDaily } = computeBurnRate(entries);
  const alertState = readSpendAlertState();
  const today = new Date().toISOString().slice(0, 10);

  const alerts = [];
  const pct = thresholds.dailyCap > 0 ? (total / thresholds.dailyCap) * 100 : 0;

  const levels = [
    { name: 'SPEND_ALERT_WARN', threshold: thresholds.warnPct },
    { name: 'SPEND_ALERT_HIGH', threshold: thresholds.highPct },
    { name: 'SPEND_ALERT_CRIT', threshold: thresholds.critPct }
  ];

  for (const level of levels) {
    if (pct >= level.threshold) {
      const lastKey = `${level.name}_${today}`;
      if (!alertState.last_alerts[lastKey]) {
        alertState.last_alerts[lastKey] = isoNow();
        emitEvent(level.name, {
          daily_spend_usd: Math.round(total * 10000) / 10000,
          daily_cap_usd: thresholds.dailyCap,
          pct: Math.round(pct * 100) / 100,
          projected_daily_usd: Math.round(projectedDaily * 10000) / 10000,
          per_agent: perAgent
        });
        alerts.push(level.name);
      }
    }
  }

  // On CRIT: find noisiest agent
  if (pct >= thresholds.critPct) {
    const noisiest = Object.entries(perAgent).sort((a, b) => b[1] - a[1])[0];
    if (noisiest) {
      const [agentId] = noisiest;
      if (thresholds.autoQuarantine && !isQuarantined(agentId)) {
        quarantineAdd(agentId);
        emitEvent('SPEND_AUTO_QUARANTINE', { agent_id: agentId, reason: 'crit_threshold' });
        alerts.push('SPEND_AUTO_QUARANTINE');
      }
      if (thresholds.autoKillswitch && !isKillSwitchActive()) {
        killSwitchEnable();
        emitEvent('SPEND_AUTO_KILLSWITCH', { reason: 'crit_threshold' });
        alerts.push('SPEND_AUTO_KILLSWITCH');
      }
    }
  }

  writeSpendAlertState(alertState);
  return { total, pct, projectedDaily, alerts, perAgent };
}

// ─── D) Canonical Artifacts ───

function writeCanonicalArtifact(type, data) {
  ensureRuntimeDir();
  const artifactsDir = runtimePath('artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const sanitized = sanitizeObj(data);
  sanitized.computed_at = isoNow();

  const jsonPath = path.join(artifactsDir, `${type}-${ts}.json`);
  const mdPath = path.join(artifactsDir, `${type}-${ts}.md`);

  // JSON — stable key ordering
  const stableJson = JSON.stringify(sanitized, Object.keys(sanitized).sort(), 2);
  fs.writeFileSync(jsonPath, stableJson);

  // MD — deterministic rendering
  const mdLines = [`# ${type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`, ''];
  mdLines.push(`**Computed at:** ${sanitized.computed_at}`);
  mdLines.push('');

  if (type === 'ops-pulse') {
    mdLines.push('## Status');
    mdLines.push(`- **Gateway:** ${sanitized.gateway || 'unknown'}`);
    mdLines.push(`- **Memory:** ${sanitized.memory || 'unknown'}`);
    mdLines.push(`- **Disk:** ${sanitized.disk || 'unknown'}`);
    mdLines.push(`- **Agents active:** ${sanitized.agents_active || 0}`);
    mdLines.push(`- **Kill switch:** ${sanitized.killswitch_active ? 'ACTIVE' : 'inactive'}`);
    mdLines.push(`- **Quarantined:** ${(sanitized.quarantined_agents || []).join(', ') || 'none'}`);
    emitEvent('OPS_PULSE_WRITTEN', { path: jsonPath });
  } else if (type === 'daily-exec-brief') {
    mdLines.push('## Summary');
    mdLines.push(`- **Objectives scanned:** ${sanitized.objectives_scanned || 0}`);
    mdLines.push(`- **Tasks completed:** ${sanitized.tasks_completed || 0}`);
    mdLines.push(`- **Tasks failed:** ${sanitized.tasks_failed || 0}`);
    mdLines.push(`- **Daily spend:** $${sanitized.daily_spend_usd || 0}`);
    mdLines.push(`- **Alerts fired:** ${(sanitized.alerts || []).join(', ') || 'none'}`);
    emitEvent('DAILY_EXEC_BRIEF_WRITTEN', { path: jsonPath });
  } else {
    // Generic
    for (const [k, v] of Object.entries(sanitized).sort()) {
      if (k !== 'computed_at') {
        mdLines.push(`- **${k}:** ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    }
    emitEvent(`${type.toUpperCase().replace(/-/g, '_')}_WRITTEN`, { path: jsonPath });
  }

  fs.writeFileSync(mdPath, mdLines.join('\n') + '\n');

  return { jsonPath, mdPath };
}

// ─── Exports ───
module.exports = {
  // Config
  RUNTIME_DIR,
  REPO_ROOT,
  ensureRuntimeDir,
  runtimePath,
  isoNow,
  // Sanitization
  sanitize,
  sanitizeObj,
  // Events
  emitEvent,
  // A) Quarantine
  readQuarantine,
  writeQuarantine,
  quarantineAdd,
  quarantineRemove,
  quarantineList,
  isQuarantined,
  pickAgentSkipQuarantine,
  MAX_QUARANTINE_AGENTS,
  // B) Kill switch
  isKillSwitchActive,
  killSwitchEnable,
  killSwitchDisable,
  killSwitchStatus,
  killSwitchGuard,
  // C) Spend
  getThresholds,
  estimateTokens,
  estimateCost,
  appendSpendEntry,
  readSpendLedger,
  computeDailySpend,
  computeBurnRate,
  evaluateSpendAlerts,
  readSpendAlertState,
  writeSpendAlertState,
  MODEL_COSTS,
  // D) Artifacts
  writeCanonicalArtifact
};
