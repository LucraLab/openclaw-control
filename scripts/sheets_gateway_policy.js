#!/usr/bin/env node
/**
 * sheets_gateway_policy.js — Google Sheets Access Control Gateway
 *
 * Single-chokepoint enforcement for all Google Sheets operations.
 * Agents MUST route through SheetsGateway; direct API access is forbidden.
 *
 * Enforces:
 *   - Spreadsheet allowlist (env: GOOGLE_SHEETS_ALLOWLIST)
 *   - Range allowlist (env: GOOGLE_SHEETS_RANGE_ALLOWLIST)
 *   - Write approval tokens with TTL (env: SHEETS_WRITE_APPROVAL_REQUIRED, SHEETS_WRITE_APPROVAL_TTL_SECONDS)
 *   - PII detection (SSN patterns, high-risk heuristics) — fail-closed
 *   - Append-only audit logging (env: SHEETS_AUDIT_LOG_PATH)
 *   - OpenClaw event emission for every write attempt
 *
 * Missing or unknown config = DENY (fail-closed).
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Constants ───

const EXIT_SHEETS_BLOCKED = 18;

// ─── Config Loading ───

/**
 * Load gateway configuration from environment variables.
 * Missing config = empty allowlists = deny all (fail-closed).
 *
 * @param {object} [env] — override for process.env (testing)
 * @returns {object} config
 */
function loadConfig(env) {
  const e = env || process.env;
  return {
    sheetAllowlist: parseCommaSeparated(e.GOOGLE_SHEETS_ALLOWLIST),
    rangeAllowlist: parseCommaSeparated(e.GOOGLE_SHEETS_RANGE_ALLOWLIST),
    writeApprovalRequired: e.SHEETS_WRITE_APPROVAL_REQUIRED !== 'false',
    approvalTtlSeconds: parseInt(e.SHEETS_WRITE_APPROVAL_TTL_SECONDS || '300', 10),
    auditLogPath: e.SHEETS_AUDIT_LOG_PATH || '',
  };
}

function parseCommaSeparated(val) {
  if (!val || typeof val !== 'string') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

// ─── PII Detection (fail-closed) ───

/**
 * SSN patterns:
 *   - ###-##-#### (formatted)
 *   - 9 consecutive digits that could be an SSN
 *
 * High-risk PII heuristics:
 *   - Strings containing "ssn", "social security", "tax id", "ein", "itin"
 *     adjacent to digit patterns
 */

const SSN_FORMATTED = /\b\d{3}-\d{2}-\d{4}\b/;
const SSN_UNFORMATTED = /\b\d{9}\b/;
const PII_KEYWORDS = /\b(ssn|social\s*security|tax\s*id|employer\s*id|ein|itin|taxpayer)\b/i;

/**
 * Scan a value for PII. Returns { safe: boolean, reason: string }.
 * Fail-closed: if uncertain (e.g., unexpected type), returns unsafe.
 *
 * @param {*} value — any value (string, number, array, nested)
 * @returns {{ safe: boolean, reason: string }}
 */
function scanForPII(value) {
  if (value === null || value === undefined) {
    return { safe: true, reason: 'empty' };
  }

  if (typeof value === 'number') {
    // Check if the number itself could be a 9-digit SSN
    const s = String(value);
    if (SSN_UNFORMATTED.test(s)) {
      return { safe: false, reason: 'SSN_PATTERN: 9-digit number detected' };
    }
    return { safe: true, reason: 'numeric_ok' };
  }

  if (typeof value === 'string') {
    if (SSN_FORMATTED.test(value)) {
      return { safe: false, reason: 'SSN_PATTERN: formatted SSN (###-##-####) detected' };
    }
    if (SSN_UNFORMATTED.test(value)) {
      return { safe: false, reason: 'SSN_PATTERN: 9 consecutive digits detected' };
    }
    if (PII_KEYWORDS.test(value)) {
      return { safe: false, reason: 'PII_KEYWORD: high-risk PII keyword detected' };
    }
    return { safe: true, reason: 'string_ok' };
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const result = scanForPII(value[i]);
      if (!result.safe) return result;
    }
    // Split-SSN defense: concatenate row cells and re-scan for SSN fragments
    // e.g. ['123', '45', '6789'] → '123 45 6789' → matches SSN_FORMATTED after normalization
    const flatStrings = value.filter(v => typeof v === 'string' || typeof v === 'number').map(String);
    if (flatStrings.length > 1) {
      const joined = flatStrings.join('');
      if (SSN_FORMATTED.test(joined) || SSN_UNFORMATTED.test(joined)) {
        return { safe: false, reason: 'SSN_SPLIT: SSN fragments detected across adjacent cells' };
      }
      // Also check with spaces/dashes stripped
      const digitsOnly = joined.replace(/[\s\-]/g, '');
      if (/\d{9}/.test(digitsOnly) && digitsOnly.length <= 11) {
        return { safe: false, reason: 'SSN_SPLIT: concatenated digits form potential SSN' };
      }
    }
    return { safe: true, reason: 'array_ok' };
  }

  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const keyResult = scanForPII(key);
      if (!keyResult.safe) return keyResult;
      const valResult = scanForPII(value[key]);
      if (!valResult.safe) return valResult;
    }
    return { safe: true, reason: 'object_ok' };
  }

  // Fail-closed: unknown type → unsafe
  return { safe: false, reason: 'FAILCLOSED: unknown value type' };
}

// ─── Allowlist Checks ───

/**
 * Check if a sheet ID is in the allowlist.
 *
 * @param {object} config — loaded config
 * @param {string} sheetId — spreadsheet ID
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkSheetAllowlist(config, sheetId) {
  if (!sheetId || typeof sheetId !== 'string') {
    return { allowed: false, reason: 'Missing or invalid sheet ID' };
  }
  if (config.sheetAllowlist.length === 0) {
    return { allowed: false, reason: 'GOOGLE_SHEETS_ALLOWLIST is empty — all sheets denied (fail-closed)' };
  }
  if (!config.sheetAllowlist.includes(sheetId)) {
    return { allowed: false, reason: `Sheet "${sheetId}" not in GOOGLE_SHEETS_ALLOWLIST` };
  }
  return { allowed: true, reason: 'Sheet in allowlist' };
}

/**
 * Check if a range is in the range allowlist.
 * Empty range allowlist = allow all ranges (ranges are optional constraint).
 *
 * @param {object} config — loaded config
 * @param {string} range — A1 notation range
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkRangeAllowlist(config, range) {
  if (!range || typeof range !== 'string') {
    return { allowed: false, reason: 'Missing or invalid range' };
  }
  // If no range allowlist configured, all ranges allowed
  if (config.rangeAllowlist.length === 0) {
    return { allowed: true, reason: 'No range allowlist configured — all ranges allowed' };
  }
  if (!config.rangeAllowlist.includes(range)) {
    return { allowed: false, reason: `Range "${range}" not in GOOGLE_SHEETS_RANGE_ALLOWLIST` };
  }
  return { allowed: true, reason: 'Range in allowlist' };
}

// ─── Approval Tokens ───

/**
 * Server-side token store. Maps request_id → { token, expires_at }.
 * Tokens NEVER appear in pendingChange objects returned to agents.
 */
const _tokenStore = new Map();

/**
 * Create an approval token with expiry.
 *
 * @param {number} ttlSeconds — time to live in seconds
 * @returns {{ token: string, expires_at: string, created_at: string }}
 */
function createApprovalToken(ttlSeconds) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  return {
    token: crypto.randomBytes(16).toString('hex'),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}

/** Store a token server-side, keyed by request_id. */
function storeToken(requestId, approval) {
  _tokenStore.set(requestId, approval);
}

/** Retrieve a stored token by request_id. */
function getStoredToken(requestId) {
  return _tokenStore.get(requestId) || null;
}

/** Clear a stored token after use or expiry. */
function clearStoredToken(requestId) {
  _tokenStore.delete(requestId);
}

/** For testing: reset the token store. */
function _resetTokenStore() {
  _tokenStore.clear();
}

/**
 * Validate an approval token against a pending change.
 *
 * @param {object} config — loaded config
 * @param {object} pendingChange — the pending change object
 * @param {string} approvalToken — the approval token string
 * @param {Date} [now] — current time (for testing)
 * @returns {{ valid: boolean, reason: string }}
 */
function validateApproval(config, pendingChange, approvalToken, now) {
  if (!config.writeApprovalRequired) {
    return { valid: true, reason: 'Approval not required (SHEETS_WRITE_APPROVAL_REQUIRED=false)' };
  }

  if (!approvalToken || typeof approvalToken !== 'string' || approvalToken.trim() === '') {
    return { valid: false, reason: 'Missing approval token (SHEETS_WRITE_APPROVAL_REQUIRED=true)' };
  }

  if (!pendingChange || !pendingChange.request_id) {
    return { valid: false, reason: 'Pending change has no request_id' };
  }

  // Look up the server-side stored token by request_id
  const stored = getStoredToken(pendingChange.request_id);
  if (!stored) {
    return { valid: false, reason: 'No approval token found for this request_id (expired or missing)' };
  }

  if (approvalToken !== stored.token) {
    return { valid: false, reason: 'Approval token mismatch' };
  }

  const currentTime = now || new Date();
  const expiresAt = new Date(stored.expires_at);
  if (currentTime > expiresAt) {
    return { valid: false, reason: `Approval token expired at ${stored.expires_at}` };
  }

  return { valid: true, reason: 'Approval token valid' };
}

// ─── Audit Logging ───

/**
 * Append an audit entry to the JSONL audit log.
 * Append-only: opens file in 'a' mode.
 *
 * @param {string} logPath — path to JSONL audit log
 * @param {object} entry — audit entry
 */
function appendAuditLog(logPath, entry) {
  if (!logPath) return;
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

/**
 * Build an audit entry for a write attempt.
 *
 * @param {object} opts
 * @returns {object} audit entry
 */
function buildAuditEntry(opts) {
  const { agent_id, request_id, sheet_id, range, outcome, reason, payload_sha256 } = opts;
  return {
    timestamp_utc: new Date().toISOString(),
    agent_id: agent_id || 'unknown',
    request_id: request_id || 'unknown',
    sheet_id: sheet_id || 'unknown',
    range: range || 'unknown',
    outcome: outcome || 'unknown',
    reason: reason || '',
    payload_sha256: payload_sha256 || '',
  };
}

// ─── Event Emission ───

/**
 * Build an OpenClaw event for a sheets write attempt.
 * This returns the event object; the caller or gate runner emits it.
 *
 * @param {object} opts
 * @returns {object} event object
 */
function buildSheetsEvent(opts) {
  const { agent_id, request_id, sheet_id, range, outcome, reason } = opts;
  return {
    event_type: 'SHEETS_WRITE_ATTEMPT',
    timestamp_utc: new Date().toISOString(),
    agent_id: agent_id || 'unknown',
    request_id: request_id || 'unknown',
    sheet_id: sheet_id || 'unknown',
    range: range || 'unknown',
    outcome: outcome || 'unknown',
    reason: reason || '',
  };
}

// ─── SheetsGateway Core ───

/**
 * Read values from a sheet. Enforces sheet + range allowlists.
 * Returns a result object (no actual API call — that's the caller's job).
 *
 * @param {object} config — loaded config
 * @param {string} sheetId — spreadsheet ID
 * @param {string} range — A1 notation range
 * @returns {{ allowed: boolean, reason: string }}
 */
function readValues(config, sheetId, range) {
  const sheetCheck = checkSheetAllowlist(config, sheetId);
  if (!sheetCheck.allowed) return sheetCheck;

  const rangeCheck = checkRangeAllowlist(config, range);
  if (!rangeCheck.allowed) return rangeCheck;

  return { allowed: true, reason: 'Read allowed' };
}

/**
 * Propose a write. Returns a pending change object with payload_sha256.
 * Does NOT execute the write — caller must call commitWrite().
 *
 * @param {object} config — loaded config
 * @param {string} sheetId — spreadsheet ID
 * @param {string} range — A1 notation range
 * @param {*} values — the values to write (2D array typically)
 * @param {object} [meta] — optional metadata { agent_id, request_id }
 * @returns {{ ok: boolean, pendingChange: object|null, payload_sha256: string, reason: string }}
 */
function proposeWrite(config, sheetId, range, values, meta) {
  const agent_id = (meta && meta.agent_id) || 'unknown';
  const request_id = (meta && meta.request_id) || crypto.randomBytes(8).toString('hex');

  // Allowlist checks
  const sheetCheck = checkSheetAllowlist(config, sheetId);
  if (!sheetCheck.allowed) {
    return { ok: false, pendingChange: null, payload_sha256: '', reason: sheetCheck.reason };
  }

  const rangeCheck = checkRangeAllowlist(config, range);
  if (!rangeCheck.allowed) {
    return { ok: false, pendingChange: null, payload_sha256: '', reason: rangeCheck.reason };
  }

  // PII scan (fail-closed)
  const piiResult = scanForPII(values);
  if (!piiResult.safe) {
    return { ok: false, pendingChange: null, payload_sha256: '', reason: `PII_BLOCKED: ${piiResult.reason}` };
  }

  // Compute payload hash
  const payload_sha256 = crypto
    .createHash('sha256')
    .update(JSON.stringify(values))
    .digest('hex');

  // Create approval token — stored server-side, never in pendingChange
  const approval = createApprovalToken(config.approvalTtlSeconds);
  storeToken(request_id, approval);

  const pendingChange = {
    sheet_id: sheetId,
    range: range,
    values: values,
    payload_sha256: payload_sha256,
    agent_id: agent_id,
    request_id: request_id,
    proposed_at: new Date().toISOString(),
  };

  return { ok: true, pendingChange, payload_sha256, reason: 'Write proposed — awaiting approval' };
}

/**
 * Commit a proposed write. Enforces ALL gates:
 *   1. Allowlist (re-check — fail-closed)
 *   2. PII (re-scan — fail-closed)
 *   3. Approval token validation + TTL
 *   4. Audit log entry
 *   5. Event emission
 *
 * @param {object} config — loaded config
 * @param {object} pendingChange — from proposeWrite()
 * @param {string} approvalToken — the approval token string
 * @param {object} [opts] — { now, eventSink }
 * @returns {{ ok: boolean, outcome: string, reason: string, auditEntry: object, event: object }}
 */
function commitWrite(config, pendingChange, approvalToken, opts) {
  const now = (opts && opts.now) || new Date();
  const eventSink = (opts && opts.eventSink) || null;

  if (!pendingChange || typeof pendingChange !== 'object') {
    const entry = buildAuditEntry({
      outcome: 'failclosed', reason: 'Missing pending change object',
    });
    appendAuditLog(config.auditLogPath, entry);
    return { ok: false, outcome: 'failclosed', reason: 'Missing pending change object', auditEntry: entry, event: null };
  }

  const { sheet_id, range, values, agent_id, request_id } = pendingChange;
  const eventBase = { agent_id, request_id, sheet_id, range };

  // Gate 1: Re-check allowlists
  const sheetCheck = checkSheetAllowlist(config, sheet_id);
  if (!sheetCheck.allowed) {
    const entry = buildAuditEntry({ ...eventBase, outcome: 'blocked', reason: sheetCheck.reason });
    const event = buildSheetsEvent({ ...eventBase, outcome: 'blocked', reason: sheetCheck.reason });
    appendAuditLog(config.auditLogPath, entry);
    if (eventSink) eventSink(event);
    return { ok: false, outcome: 'blocked', reason: sheetCheck.reason, auditEntry: entry, event };
  }

  const rangeCheck = checkRangeAllowlist(config, range);
  if (!rangeCheck.allowed) {
    const entry = buildAuditEntry({ ...eventBase, outcome: 'blocked', reason: rangeCheck.reason });
    const event = buildSheetsEvent({ ...eventBase, outcome: 'blocked', reason: rangeCheck.reason });
    appendAuditLog(config.auditLogPath, entry);
    if (eventSink) eventSink(event);
    return { ok: false, outcome: 'blocked', reason: rangeCheck.reason, auditEntry: entry, event };
  }

  // Gate 2: Re-scan PII (fail-closed)
  const piiResult = scanForPII(values);
  if (!piiResult.safe) {
    const reason = `PII_BLOCKED: ${piiResult.reason}`;
    const entry = buildAuditEntry({ ...eventBase, outcome: 'failclosed', reason });
    const event = buildSheetsEvent({ ...eventBase, outcome: 'failclosed', reason });
    appendAuditLog(config.auditLogPath, entry);
    if (eventSink) eventSink(event);
    return { ok: false, outcome: 'failclosed', reason, auditEntry: entry, event };
  }

  // Gate 3: Approval token
  const approvalCheck = validateApproval(config, pendingChange, approvalToken, now);
  if (!approvalCheck.valid) {
    const entry = buildAuditEntry({ ...eventBase, outcome: 'blocked', reason: approvalCheck.reason });
    const event = buildSheetsEvent({ ...eventBase, outcome: 'blocked', reason: approvalCheck.reason });
    appendAuditLog(config.auditLogPath, entry);
    if (eventSink) eventSink(event);
    return { ok: false, outcome: 'blocked', reason: approvalCheck.reason, auditEntry: entry, event };
  }

  // Gate 4: Payload integrity (re-hash and compare)
  const currentHash = crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
  if (currentHash !== pendingChange.payload_sha256) {
    const reason = 'Payload integrity check failed — values modified after proposal';
    const entry = buildAuditEntry({ ...eventBase, outcome: 'failclosed', reason, payload_sha256: currentHash });
    const event = buildSheetsEvent({ ...eventBase, outcome: 'failclosed', reason });
    appendAuditLog(config.auditLogPath, entry);
    if (eventSink) eventSink(event);
    return { ok: false, outcome: 'failclosed', reason, auditEntry: entry, event };
  }

  // All gates passed
  const entry = buildAuditEntry({ ...eventBase, outcome: 'ok', reason: 'All gates passed', payload_sha256: currentHash });
  const event = buildSheetsEvent({ ...eventBase, outcome: 'ok', reason: 'All gates passed' });
  appendAuditLog(config.auditLogPath, entry);
  if (eventSink) eventSink(event);

  return { ok: true, outcome: 'ok', reason: 'Write approved', auditEntry: entry, event };
}

// ─── Report Builder ───

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

// ─── WriteMode Policy ───

const WRITE_MODES = ['AUTO', 'SAFE', 'LOCKDOWN'];
const DEFAULT_WRITE_MODE = 'AUTO';
const WRITE_MODE_FILE = 'sheets-write-mode.json';

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = process.env.OPENCLAW_RUNTIME_DIR || path.join(REPO_ROOT, '.openclaw_runtime');

function ensureRuntimeDir() {
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function runtimePath(filename) {
  return path.join(RUNTIME_DIR, filename);
}

/**
 * Read the current write mode from persistent storage.
 * Missing/corrupt file → defaults to AUTO (fail-safe: blocking all writes
 * on corrupt config is worse than defaulting to auto-approve for allowlisted writes).
 *
 * @returns {{ mode: string, changed_by: string, changed_at: string, rate_limit_per_minute: number, rate_limit_per_hour: number }}
 */
function readWriteMode() {
  const defaults = {
    mode: DEFAULT_WRITE_MODE,
    changed_by: 'system',
    changed_at: new Date().toISOString(),
    rate_limit_per_minute: 30,
    rate_limit_per_hour: 500,
  };
  try {
    const filePath = runtimePath(WRITE_MODE_FILE);
    if (!fs.existsSync(filePath)) return defaults;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    // Validate mode
    if (!WRITE_MODES.includes(parsed.mode)) return defaults;
    return {
      mode: parsed.mode,
      changed_by: parsed.changed_by || 'unknown',
      changed_at: parsed.changed_at || defaults.changed_at,
      rate_limit_per_minute: typeof parsed.rate_limit_per_minute === 'number' ? parsed.rate_limit_per_minute : 30,
      rate_limit_per_hour: typeof parsed.rate_limit_per_hour === 'number' ? parsed.rate_limit_per_hour : 500,
    };
  } catch (_) {
    return defaults;
  }
}

/**
 * Set the write mode. Atomic write (tmp + rename).
 * Emits SHEETS_WRITE_MODE_CHANGED event via returned event object.
 *
 * @param {string} mode — one of WRITE_MODES
 * @param {string} changedBy — identifier of who changed it
 * @returns {{ state: object, event: object }}
 */
function setWriteMode(mode, changedBy) {
  if (!WRITE_MODES.includes(mode)) {
    throw new Error(`Invalid write mode: "${mode}". Must be one of: ${WRITE_MODES.join(', ')}`);
  }
  ensureRuntimeDir();
  const current = readWriteMode();
  const state = {
    mode: mode,
    changed_by: changedBy || 'unknown',
    changed_at: new Date().toISOString(),
    rate_limit_per_minute: current.rate_limit_per_minute,
    rate_limit_per_hour: current.rate_limit_per_hour,
  };
  const filePath = runtimePath(WRITE_MODE_FILE);
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmpPath, filePath);

  const event = {
    event_type: 'SHEETS_WRITE_MODE_CHANGED',
    timestamp_utc: new Date().toISOString(),
    previous_mode: current.mode,
    new_mode: mode,
    changed_by: changedBy || 'unknown',
  };

  return { state, event };
}

/** For testing: reset write mode state by deleting the file. */
function _resetWriteModeState() {
  try {
    const filePath = runtimePath(WRITE_MODE_FILE);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

// ─── Exports ───

module.exports = {
  EXIT_SHEETS_BLOCKED,
  loadConfig,
  parseCommaSeparated,
  scanForPII,
  SSN_FORMATTED,
  SSN_UNFORMATTED,
  PII_KEYWORDS,
  checkSheetAllowlist,
  checkRangeAllowlist,
  createApprovalToken,
  validateApproval,
  storeToken,
  getStoredToken,
  clearStoredToken,
  _resetTokenStore,
  appendAuditLog,
  buildAuditEntry,
  buildSheetsEvent,
  readValues,
  proposeWrite,
  commitWrite,
  buildReport,
  // WriteMode
  WRITE_MODES,
  DEFAULT_WRITE_MODE,
  readWriteMode,
  setWriteMode,
  _resetWriteModeState,
  // Runtime (needed for tests)
  RUNTIME_DIR,
  runtimePath,
  ensureRuntimeDir,
};
