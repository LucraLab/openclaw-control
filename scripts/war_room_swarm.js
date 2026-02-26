#!/usr/bin/env node
/**
 * war_room_swarm.js — War Room Swarm Orchestrator
 *
 * Sidecar service for Dashboard VPS. Processes @team / /team triggers
 * from Telegram group chats, dispatches to Builder gateway agents via
 * HTTP, and returns consolidated swarm results.
 *
 * Does NOT modify OpenClaw dist bundles. Runs alongside the gateway.
 *
 * Safety: fail-closed on killswitch, missing runtime, corrupt config.
 * Uses Port #16 autonomy_runtime for events, quarantine, killswitch.
 */

'use strict';

const path = require('path');
const crypto = require('crypto');

// ─── Constants ───

const DEFAULT_CAP = 5;
const EXPANDED_CAP = 10;
const EXPAND_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const PER_AGENT_TIMEOUT_MS = 20_000;
const TOTAL_SWARM_TIMEOUT_MS = 45_000;
const MAX_CONCURRENCY = 3;

// Builder host — resolved from env or config at startup (Tailscale)
const BUILDER_HOST = process.env.BUILDER_HOST || process.env.BUILDER2_HOST || 'localhost';

// Full agent roster across both Builders
const AGENT_ROSTER = [
  'pa', 'developer', 'architect', 'debugger', 'ops-1', 'ops-2',
  'finance', 'cs', 'sales', 'insights', 'technical-writer',
  'vault', 'crystal-pa', 'quality-reviewer', 'scrooge', 'rental'
];

// Agent → Builder gateway mapping
const AGENT_GATEWAY_MAP = {
  // Builder1 agents (port 8080, localhost-bound → needs tunnel or rebind)
  'vault':             { host: BUILDER_HOST, port: 8080 },
  'finance':           { host: BUILDER_HOST, port: 8080 },
  'scrooge':           { host: BUILDER_HOST, port: 8080 },
  'ops-1':             { host: BUILDER_HOST, port: 8080 },
  'architect':         { host: BUILDER_HOST, port: 8080 },
  'developer':         { host: BUILDER_HOST, port: 8080 },
  'debugger':          { host: BUILDER_HOST, port: 8080 },
  'quality-reviewer':  { host: BUILDER_HOST, port: 8080 },
  'technical-writer':  { host: BUILDER_HOST, port: 8080 },
  // Builder2 agents (port 8082, Tailscale-bound)
  'pa':                { host: BUILDER_HOST, port: 8082 },
  'sales':             { host: BUILDER_HOST, port: 8082 },
  'cs':                { host: BUILDER_HOST, port: 8082 },
  'rental':            { host: BUILDER_HOST, port: 8082 },
  'insights':          { host: BUILDER_HOST, port: 8082 },
  'crystal-pa':        { host: BUILDER_HOST, port: 8082 },
  'ops-2':             { host: BUILDER_HOST, port: 8082 },
};

// Duplicate agents on both Builders — prefer Builder2 (Tailscale-reachable)
const BUILDER2_PREFERRED = new Set(['pa', 'sales', 'cs', 'rental', 'insights', 'crystal-pa']);

// Secret patterns for output sanitization
const SECRET_PATTERNS = [
  /(?:sk-|ghp_|github_pat_|AKIA|Bearer |eyJ)[A-Za-z0-9_\-./+=]{8,}/g,
  /\d{8,}:[A-Za-z0-9_-]{30,}/g,  // Telegram bot tokens
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
  /ya29\.[A-Za-z0-9_\-./+=]{10,}/g,  // Google OAuth tokens
  /1\/[A-Za-z0-9_\-]{20,}/g,  // OAuth refresh tokens
];

// ─── Mention Parsing ───

/**
 * Parse @team / /team trigger and extract prompt + explicit agent mentions.
 *
 * Supports:
 *   - "@team <prompt>"
 *   - "/team <prompt>"
 *   - "@team @developer @architect <prompt>"
 *   - Reply to a previous swarm result with "@team" = re-run
 *
 * @param {string} text - Message text
 * @param {Array} entities - Telegram message entities (type, offset, length)
 * @returns {null | { prompt: string, explicitAgents: string[], isTeamTrigger: boolean }}
 */
function parseSwarmTrigger(text, entities) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();

  // Check for /team command (bot_command entity or plain text)
  const teamCommandMatch = trimmed.match(/^\/team(?:@\w+)?\s*([\s\S]*)$/i);
  if (teamCommandMatch) {
    const rest = teamCommandMatch[1].trim();
    const { prompt, explicitAgents } = extractAgentMentions(rest, entities);
    return { prompt, explicitAgents, isTeamTrigger: true };
  }

  // Check for @team mention (via entities or text)
  const hasTeamMention = detectTeamMention(text, entities);
  if (hasTeamMention) {
    // Remove @team from text to get prompt
    const cleaned = text.replace(/@team\b/gi, '').trim();
    const { prompt, explicitAgents } = extractAgentMentions(cleaned, entities);
    return { prompt, explicitAgents, isTeamTrigger: true };
  }

  return null;
}

/**
 * Detect @team mention in text or entities.
 */
function detectTeamMention(text, entities) {
  // Check entities for @team mention
  if (Array.isArray(entities)) {
    for (const ent of entities) {
      if (ent.type === 'mention') {
        const mention = text.substring(ent.offset, ent.offset + ent.length);
        if (mention.toLowerCase() === '@team') return true;
      }
    }
  }

  // Fallback: regex match in text
  return /@team\b/i.test(text);
}

/**
 * Extract explicit agent mentions from prompt text.
 * E.g., "@developer @ops-2 fix the bug" → { prompt: "fix the bug", explicitAgents: ["developer", "ops-2"] }
 */
function extractAgentMentions(text, entities) {
  const explicitAgents = [];
  let prompt = text;

  // Extract from entities
  if (Array.isArray(entities)) {
    for (const ent of entities) {
      if (ent.type === 'mention') {
        const mention = text.substring(ent.offset, ent.offset + ent.length);
        const agentId = mention.replace(/^@/, '').toLowerCase();
        if (AGENT_ROSTER.includes(agentId) && !explicitAgents.includes(agentId)) {
          explicitAgents.push(agentId);
        }
      }
    }
  }

  // Also check regex for @agent patterns
  const mentionPattern = /@([a-z0-9][a-z0-9_-]*)/gi;
  let match;
  while ((match = mentionPattern.exec(text)) !== null) {
    const agentId = match[1].toLowerCase();
    if (agentId === 'team') continue; // Already handled
    if (AGENT_ROSTER.includes(agentId) && !explicitAgents.includes(agentId)) {
      explicitAgents.push(agentId);
    }
  }

  // Remove agent mentions from prompt
  for (const agent of explicitAgents) {
    prompt = prompt.replace(new RegExp(`@${agent}\\b`, 'gi'), '').trim();
  }

  // Collapse whitespace
  prompt = prompt.replace(/\s+/g, ' ').trim();

  return { prompt, explicitAgents };
}

/**
 * Parse /expand_squad command.
 * Returns duration in ms if valid, null otherwise.
 */
function parseExpandSquad(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.trim().match(/^\/expand_squad(?:@\w+)?(?:\s+(\d+))?$/i);
  if (!match) return null;
  const minutes = match[1] ? parseInt(match[1], 10) : 10;
  if (minutes < 1 || minutes > 60) return null;
  return minutes * 60 * 1000;
}

// ─── Roster Selection ───

/**
 * Cap state per chat. Tracks /expand_squad activations.
 */
const capOverrides = new Map(); // chatId → { cap: number, expiresAt: number }

/**
 * Get effective cap for a chat.
 */
function getEffectiveCap(chatId) {
  const override = capOverrides.get(chatId);
  if (override && Date.now() < override.expiresAt) {
    return override.cap;
  }
  // Expired or no override
  if (override) capOverrides.delete(chatId);
  return DEFAULT_CAP;
}

/**
 * Set cap override for a chat.
 */
function setCapOverride(chatId, cap, durationMs) {
  capOverrides.set(chatId, {
    cap,
    expiresAt: Date.now() + durationMs
  });
}

/**
 * Select agents for swarm dispatch.
 *
 * @param {Object} params
 * @param {string[]} params.explicitAgents - User-requested agents
 * @param {number} params.cap - Max agents
 * @param {string[]} params.quarantinedAgents - Quarantined agent IDs
 * @returns {{ selected: string[], skippedQuarantine: string[], capped: boolean, requestedCount: number }}
 */
function selectAgents({ explicitAgents = [], cap = DEFAULT_CAP, quarantinedAgents = [] }) {
  const quarantineSet = new Set(quarantinedAgents);
  const skippedQuarantine = [];

  // Start with explicit agents, then fill from roster
  let candidates = [];

  if (explicitAgents.length > 0) {
    // User explicitly requested these agents
    for (const agent of explicitAgents) {
      if (quarantineSet.has(agent)) {
        skippedQuarantine.push(agent);
      } else if (AGENT_ROSTER.includes(agent)) {
        candidates.push(agent);
      }
    }
    // Fill remaining cap from roster (excluding already selected)
    const selected = new Set(candidates);
    for (const agent of AGENT_ROSTER) {
      if (candidates.length >= cap) break;
      if (!selected.has(agent) && !quarantineSet.has(agent)) {
        candidates.push(agent);
        selected.add(agent);
      }
    }
  } else {
    // No explicit agents — pick best N from roster
    for (const agent of AGENT_ROSTER) {
      if (quarantineSet.has(agent)) {
        skippedQuarantine.push(agent);
        continue;
      }
      candidates.push(agent);
    }
  }

  const requestedCount = candidates.length;
  const capped = candidates.length > cap;
  const selected = candidates.slice(0, cap);

  return { selected, skippedQuarantine, capped, requestedCount };
}

// ─── Concurrency Limiter ───

/**
 * Run async tasks with bounded concurrency.
 *
 * @param {Array<() => Promise>} tasks - Array of async task factories
 * @param {number} limit - Max concurrent tasks
 * @returns {Promise<Array>} - Settled results (value or error per task)
 */
async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      try {
        results[idx] = { status: 'fulfilled', value: await tasks[idx]() };
      } catch (err) {
        results[idx] = { status: 'rejected', reason: err };
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ─── HTTP Dispatch ───

/**
 * Build the HTTP request options for a Builder gateway agent call.
 *
 * @param {string} agentId - Target agent ID
 * @param {string} prompt - User prompt
 * @param {string} authToken - Bearer token for gateway
 * @param {Object} gateway - { host, port }
 * @returns {Object} - { url, headers, body }
 */
function buildDispatchRequest(agentId, prompt, authToken, gateway) {
  if (!gateway) {
    throw new Error(`No gateway mapping for agent: ${agentId}`);
  }

  const url = `http://${gateway.host}:${gateway.port}/v1/chat/completions`;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
    'x-openclaw-agent-id': agentId,
  };

  const body = JSON.stringify({
    model: `openclaw:${agentId}`,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1000,
    temperature: 0.7,
  });

  return { url, headers, body };
}

/**
 * Resolve the gateway target for an agent.
 * Prefers Builder2 for agents available on both (Tailscale reachable).
 * Allows config override for Builder1 connectivity.
 */
function resolveGateway(agentId, gatewayMap) {
  const map = gatewayMap || AGENT_GATEWAY_MAP;
  return map[agentId] || null;
}

/**
 * Dispatch a prompt to a single agent via HTTP.
 *
 * @param {Object} params
 * @param {string} params.agentId
 * @param {string} params.prompt
 * @param {string} params.authToken
 * @param {Object} params.gateway - { host, port }
 * @param {number} params.timeoutMs
 * @param {Function} params.httpClient - Injected HTTP client (for testing)
 * @returns {Promise<{ agentId, content, latencyMs, status }>}
 */
async function dispatchToAgent({ agentId, prompt, authToken, gateway, timeoutMs, httpClient }) {
  const startTime = Date.now();

  try {
    const req = buildDispatchRequest(agentId, prompt, authToken, gateway);

    const response = await httpClient(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      timeoutMs: timeoutMs || PER_AGENT_TIMEOUT_MS,
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      return {
        agentId,
        content: null,
        latencyMs,
        status: 'error',
        error: `HTTP ${response.status}: ${response.statusText || 'unknown'}`,
      };
    }

    const data = response.data;
    const content = data?.choices?.[0]?.message?.content || null;

    return {
      agentId,
      content,
      latencyMs,
      status: content ? 'ok' : 'empty',
    };
  } catch (err) {
    return {
      agentId,
      content: null,
      latencyMs: Date.now() - startTime,
      status: 'error',
      error: err.message || String(err),
    };
  }
}

// ─── Output Sanitization ───

/**
 * Sanitize output text by redacting secret patterns.
 */
function sanitizeOutput(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), '[REDACTED]');
  }
  return result;
}

/**
 * Truncate agent response to max lines for Telegram.
 */
function truncateResponse(text, maxLines = 4) {
  if (!text) return '(no response)';
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(0, maxLines).join('\n') + '\n...';
}

// ─── Consolidated Output ───

/**
 * Format swarm results into a consolidated Telegram message.
 *
 * @param {Object} params
 * @param {string} params.prompt - Original prompt
 * @param {Array} params.results - Agent dispatch results
 * @param {boolean} params.capped - Whether cap was applied
 * @param {number} params.requestedCount - Total agents requested before cap
 * @param {number} params.cap - Cap that was applied
 * @param {string[]} params.skippedQuarantine - Agents skipped due to quarantine
 * @returns {string}
 */
function formatSwarmResponse({ prompt, results, capped, requestedCount, cap, skippedQuarantine }) {
  const successResults = results.filter(r => r.status === 'ok');
  const failedResults = results.filter(r => r.status !== 'ok');

  const lines = [];

  // Summary line
  const promptPreview = prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt;
  lines.push(`Swarm (${successResults.length} agents): ${promptPreview}`);

  if (capped) {
    lines.push(`(CAPPED: requested ${requestedCount}, ran ${results.length})`);
  }

  if (skippedQuarantine.length > 0) {
    lines.push(`(QUARANTINED: ${skippedQuarantine.join(', ')})`);
  }

  lines.push('');

  // Per-agent results
  for (const result of results) {
    const statusIcon = result.status === 'ok' ? '' : '[FAILED] ';
    const content = result.status === 'ok'
      ? sanitizeOutput(truncateResponse(result.content))
      : `Error: ${sanitizeOutput(result.error || 'unknown')}`;
    lines.push(`${statusIcon}${result.agentId}: ${content}`);
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ─── Runtime Integration ───

/**
 * Load the autonomy runtime from the repo or deployed path.
 * Returns null if runtime is unavailable (fail-closed).
 */
function loadRuntime(runtimePath) {
  const candidates = [
    runtimePath,
    '/opt/openclaw-runtime/autonomy_runtime.js',
    path.join(__dirname, 'autonomy_runtime.js'),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      return require(p);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Check if the swarm should be blocked (fail-closed checks).
 *
 * @param {Object} runtime - Loaded autonomy_runtime module
 * @returns {{ blocked: boolean, reason: string | null }}
 */
function checkSafetyGates(runtime) {
  if (!runtime) {
    return { blocked: true, reason: 'runtime_unavailable' };
  }

  try {
    if (runtime.killSwitchGuard('war-room-swarm')) {
      return { blocked: true, reason: 'killswitch_active' };
    }
  } catch {
    // Fail closed: if we can't check killswitch, block
    return { blocked: true, reason: 'killswitch_check_failed' };
  }

  return { blocked: false, reason: null };
}

// ─── Swarm Orchestrator ───

/**
 * Execute a full swarm run.
 *
 * @param {Object} params
 * @param {string} params.prompt - User prompt
 * @param {string[]} params.explicitAgents - Explicitly requested agents
 * @param {string} params.chatId - Telegram chat ID
 * @param {string} params.messageId - Triggering message ID
 * @param {string} params.senderId - Telegram sender ID
 * @param {Object} params.authTokens - { builder1: string, builder2: string }
 * @param {Function} params.httpClient - Injected HTTP client
 * @param {Object} [params.runtime] - Injected runtime (for testing)
 * @param {Object} [params.gatewayMap] - Override gateway map (for testing)
 * @param {Object} [params.options] - { perAgentTimeoutMs, totalTimeoutMs, maxConcurrency }
 * @returns {Promise<{ response: string, results: Array, events: Array, blocked: boolean, reason: string|null }>}
 */
async function executeSwarm({
  prompt,
  explicitAgents = [],
  chatId,
  messageId,
  senderId,
  authTokens = {},
  httpClient,
  runtime: injectedRuntime,
  gatewayMap,
  options = {},
}) {
  // Use injected runtime if explicitly provided (even if null = disable).
  // Only auto-load if runtime key is undefined (not provided at all).
  const runtime = injectedRuntime !== undefined ? injectedRuntime : loadRuntime();
  const correlationId = crypto.randomUUID();
  const events = [];

  function emit(eventType, payload) {
    const evt = { event: eventType, ...payload, correlation_id: correlationId };
    events.push(evt);
    if (runtime && runtime.emitEvent) {
      try { runtime.emitEvent(eventType, payload); } catch { /* best effort */ }
    }
  }

  // Emit SWARM_REQUESTED
  emit('SWARM_REQUESTED', {
    chat_id: chatId,
    message_id: messageId,
    sender_id: senderId,
    prompt: prompt?.slice(0, 200), // truncate for event log
    explicit_agents: explicitAgents,
  });

  // Safety gates
  const safety = checkSafetyGates(runtime);
  if (safety.blocked) {
    const blockEvent = safety.reason === 'killswitch_active'
      ? 'SWARM_KILLSWITCH_BLOCKED'
      : 'SWARM_FAILCLOSED';
    emit(blockEvent, { reason: safety.reason });
    return {
      response: `Swarm blocked: ${safety.reason}`,
      results: [],
      events,
      blocked: true,
      reason: safety.reason,
    };
  }

  // Get quarantine list
  let quarantinedAgents = [];
  try {
    quarantinedAgents = runtime.quarantineList ? runtime.quarantineList() : [];
  } catch {
    // Fail open for quarantine read (empty list)
  }

  // Resolve roster
  const cap = getEffectiveCap(chatId);
  const roster = selectAgents({
    explicitAgents,
    cap,
    quarantinedAgents,
  });

  if (roster.skippedQuarantine.length > 0) {
    emit('SWARM_QUARANTINE_SKIPS', {
      skipped: roster.skippedQuarantine,
    });
  }

  if (roster.capped) {
    emit('SWARM_CAPPED', {
      requested: roster.requestedCount,
      cap,
      selected: roster.selected.length,
    });
  }

  if (roster.selected.length === 0) {
    emit('SWARM_FAILCLOSED', { reason: 'no_agents_available' });
    return {
      response: 'Swarm blocked: no agents available (all quarantined or roster empty)',
      results: [],
      events,
      blocked: true,
      reason: 'no_agents_available',
    };
  }

  // Resolve auth tokens per gateway
  function getAuthToken(gateway) {
    if (!gateway) return null;
    if (gateway.port === 8082) return authTokens.builder2;
    if (gateway.port === 8080) return authTokens.builder1;
    return authTokens.builder1; // fallback
  }

  // Build dispatch tasks
  const gMap = gatewayMap || AGENT_GATEWAY_MAP;
  const tasks = [];
  const reachable = [];
  const unreachable = [];

  for (const agentId of roster.selected) {
    const gateway = resolveGateway(agentId, gMap);
    const token = getAuthToken(gateway);
    if (!gateway || !token) {
      unreachable.push(agentId);
      continue;
    }
    reachable.push(agentId);
    tasks.push(() => dispatchToAgent({
      agentId,
      prompt,
      authToken: token,
      gateway,
      timeoutMs: options.perAgentTimeoutMs || PER_AGENT_TIMEOUT_MS,
      httpClient,
    }));
  }

  // Fail closed if NO targets reachable
  if (tasks.length === 0) {
    emit('SWARM_FAILCLOSED', { reason: 'no_reachable_targets', unreachable });
    return {
      response: 'Swarm blocked: no reachable Builder targets',
      results: [],
      events,
      blocked: true,
      reason: 'no_reachable_targets',
    };
  }

  // Emit dispatch event
  emit('SWARM_DISPATCHED', {
    agents: reachable,
    cap,
    unreachable: unreachable.length > 0 ? unreachable : undefined,
  });

  // Execute with concurrency limit + total timeout
  const totalTimeout = options.totalTimeoutMs || TOTAL_SWARM_TIMEOUT_MS;

  const dispatchPromise = runWithConcurrency(tasks, options.maxConcurrency || MAX_CONCURRENCY);

  let settled;
  try {
    settled = await Promise.race([
      dispatchPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SWARM_TOTAL_TIMEOUT')), totalTimeout)
      ),
    ]);
  } catch (err) {
    if (err.message === 'SWARM_TOTAL_TIMEOUT') {
      // Partial results — whatever completed
      settled = await dispatchPromise;
    } else {
      throw err;
    }
  }

  // Collect results
  const results = settled.map((s, i) => {
    if (s.status === 'fulfilled') {
      const result = s.value;
      emit('SWARM_AGENT_RESULT', {
        agent_id: result.agentId,
        status: result.status,
        latency_ms: result.latencyMs,
        content_length: result.content ? result.content.length : 0,
      });
      return result;
    }
    const agentId = reachable[i];
    emit('SWARM_AGENT_RESULT', {
      agent_id: agentId,
      status: 'error',
      latency_ms: 0,
      error: s.reason?.message || String(s.reason),
    });
    return {
      agentId,
      content: null,
      latencyMs: 0,
      status: 'error',
      error: s.reason?.message || String(s.reason),
    };
  });

  // Format response
  const response = formatSwarmResponse({
    prompt,
    results,
    capped: roster.capped,
    requestedCount: roster.requestedCount,
    cap,
    skippedQuarantine: roster.skippedQuarantine,
  });

  // Write canonical artifact
  if (runtime && runtime.writeCanonicalArtifact) {
    try {
      const artifactData = {
        type: 'swarm-run',
        correlation_id: correlationId,
        chat_id: chatId,
        message_id: messageId,
        sender_id: senderId,
        prompt: sanitizeOutput(prompt?.slice(0, 500)),
        cap,
        capped: roster.capped,
        agents_dispatched: reachable,
        agents_quarantined: roster.skippedQuarantine,
        results: results.map(r => ({
          agent_id: r.agentId,
          status: r.status,
          latency_ms: r.latencyMs,
          content_preview: sanitizeOutput(r.content?.slice(0, 200) || null),
        })),
        success_count: results.filter(r => r.status === 'ok').length,
        error_count: results.filter(r => r.status !== 'ok').length,
      };
      runtime.writeCanonicalArtifact('swarm-run', artifactData);
    } catch { /* best effort */ }
  }

  return {
    response,
    results,
    events,
    blocked: false,
    reason: null,
    correlationId,
  };
}

// ─── Exports ───

module.exports = {
  // Constants
  DEFAULT_CAP,
  EXPANDED_CAP,
  EXPAND_DURATION_MS,
  PER_AGENT_TIMEOUT_MS,
  TOTAL_SWARM_TIMEOUT_MS,
  MAX_CONCURRENCY,
  AGENT_ROSTER,
  AGENT_GATEWAY_MAP,
  SECRET_PATTERNS,

  // Parsing
  parseSwarmTrigger,
  detectTeamMention,
  extractAgentMentions,
  parseExpandSquad,

  // Roster
  selectAgents,
  getEffectiveCap,
  setCapOverride,
  capOverrides,

  // Concurrency
  runWithConcurrency,

  // Dispatch
  buildDispatchRequest,
  resolveGateway,
  dispatchToAgent,

  // Output
  sanitizeOutput,
  truncateResponse,
  formatSwarmResponse,

  // Runtime
  loadRuntime,
  checkSafetyGates,

  // Orchestrator
  executeSwarm,
};
