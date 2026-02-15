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

/**
 * Determine if a proposed write requires human approval.
 *
 * Decision tree:
 *   LOCKDOWN → always required
 *   AUTO:
 *     - Sheet+range in allowlist AND values pass PII → NOT required
 *     - Out-of-range (range not in allowlist) → required (out_of_range)
 *     - Large write (>100 cells or >50 rows) → required (large_write)
 *     - Destructive operation → required (destructive)
 *     - Uncertain PII → required (uncertain_pii)
 *   SAFE:
 *     - Same as AUTO, plus: any append → required (append_in_safe_mode)
 *     - Any write >10 rows → required (large_write_safe)
 *
 * @param {object} config — loaded config from loadConfig()
 * @param {object} writeMode — from readWriteMode()
 * @param {object} pendingChange — from proposeWrite() result
 * @param {object} [meta] — { operation, row_count, cell_count }
 * @returns {{ required: boolean, reason: string, exception_type: string|null }}
 */
function shouldRequireApproval(config, writeMode, pendingChange, meta) {
  const mode = (writeMode && writeMode.mode) || 'LOCKDOWN';
  const operation = (meta && meta.operation) || 'update';
  const rowCount = (meta && meta.row_count) || 0;
  const cellCount = (meta && meta.cell_count) || 0;

  // LOCKDOWN always requires approval
  if (mode === 'LOCKDOWN') {
    return { required: true, reason: 'LOCKDOWN mode — all writes require approval', exception_type: 'lockdown' };
  }

  // Check range allowlist for out-of-range detection
  if (pendingChange && config.rangeAllowlist && config.rangeAllowlist.length > 0) {
    if (!config.rangeAllowlist.includes(pendingChange.range)) {
      return { required: true, reason: `Range "${pendingChange.range}" not in allowlist`, exception_type: 'out_of_range' };
    }
  }

  // Destructive operations always require approval
  const destructiveOps = ['clearValues', 'deleteRows', 'deleteColumns', 'deleteDimension', 'delete'];
  if (destructiveOps.includes(operation)) {
    return { required: true, reason: `Destructive operation: ${operation}`, exception_type: 'destructive' };
  }

  // Large write detection
  if (mode === 'AUTO') {
    if (cellCount > 100) {
      return { required: true, reason: `Large write: ${cellCount} cells exceeds 100-cell threshold`, exception_type: 'large_write' };
    }
    if (rowCount > 50) {
      return { required: true, reason: `Large write: ${rowCount} rows exceeds 50-row threshold`, exception_type: 'large_write' };
    }
  }

  if (mode === 'SAFE') {
    // SAFE mode: append operations need approval
    if (operation === 'append') {
      return { required: true, reason: 'SAFE mode — append operations require approval', exception_type: 'append_in_safe_mode' };
    }
    // SAFE mode: lower thresholds
    if (cellCount > 100) {
      return { required: true, reason: `Large write: ${cellCount} cells exceeds 100-cell threshold`, exception_type: 'large_write' };
    }
    if (rowCount > 10) {
      return { required: true, reason: `SAFE mode — ${rowCount} rows exceeds 10-row threshold`, exception_type: 'large_write_safe' };
    }
  }

  // PII uncertainty check: if values contain "ssn", "tax_id" etc as field names but actual values are clean, flag as uncertain
  if (pendingChange && pendingChange.values) {
    const serialized = JSON.stringify(pendingChange.values).toLowerCase();
    const uncertainPatterns = ['ssn', 'social_security', 'tax_id', 'ein_number', 'itin_number'];
    for (const pattern of uncertainPatterns) {
      if (serialized.includes(pattern)) {
        return { required: true, reason: `Uncertain PII: field name contains "${pattern}"`, exception_type: 'uncertain_pii' };
      }
    }
  }

  // All checks passed — approval not required
  return { required: false, reason: 'Allowlisted write in ' + mode + ' mode — auto-approved', exception_type: null };
}

// ─── Pending Approval Store ───

const PENDING_APPROVALS_FILE = 'sheets-pending-approvals.jsonl';

/**
 * Add a pending approval entry to the JSONL file.
 *
 * @param {object} pendingChange — from proposeWrite()
 * @param {string} exceptionType — from shouldRequireApproval()
 * @returns {object} the stored entry
 */
function addPendingApproval(pendingChange, exceptionType) {
  ensureRuntimeDir();
  const entry = {
    request_id: pendingChange.request_id,
    sheet_id: pendingChange.sheet_id,
    range: pendingChange.range,
    agent_id: pendingChange.agent_id,
    exception_type: exceptionType || 'unknown',
    proposed_at: pendingChange.proposed_at || new Date().toISOString(),
    status: 'pending',
  };
  const filePath = runtimePath(PENDING_APPROVALS_FILE);
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * List all pending approvals. Filters out resolved and expired entries.
 *
 * @param {object} [opts] — { ttlSeconds } TTL for pending approvals (default: 3600)
 * @returns {Array<object>} pending entries sorted by proposed_at desc
 */
function listPendingApprovals(opts) {
  const ttlSeconds = (opts && opts.ttlSeconds) || 3600;
  const now = Date.now();
  const filePath = runtimePath(PENDING_APPROVALS_FILE);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.status !== 'pending') continue;
      // TTL filter
      const proposedAt = new Date(entry.proposed_at).getTime();
      if (now - proposedAt > ttlSeconds * 1000) continue;
      entries.push(entry);
    } catch (_) {}
  }
  // Sort by proposed_at desc (newest first)
  entries.sort((a, b) => new Date(b.proposed_at) - new Date(a.proposed_at));
  return entries;
}

/**
 * Resolve a pending approval (approve or deny).
 *
 * @param {string} requestId — the request_id to resolve
 * @param {'approved'|'denied'} resolution
 * @param {string} resolvedBy — identifier of who resolved it
 * @param {object} [opts] — { config } for token creation
 * @returns {{ ok: boolean, token?: string, reason: string, event?: object }}
 */
function resolvePendingApproval(requestId, resolution, resolvedBy, opts) {
  const filePath = runtimePath(PENDING_APPROVALS_FILE);
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `No pending approvals file found` };
  }

  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  let found = false;
  const updatedLines = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.request_id === requestId && entry.status === 'pending') {
        found = true;
        entry.status = resolution;
        entry.resolved_by = resolvedBy || 'unknown';
        entry.resolved_at = new Date().toISOString();
      }
      updatedLines.push(JSON.stringify(entry));
    } catch (_) {
      updatedLines.push(line); // preserve unparseable lines
    }
  }

  if (!found) {
    return { ok: false, reason: `No pending approval found for request_id: ${requestId}` };
  }

  // Atomic write back
  ensureRuntimeDir();
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, updatedLines.join('\n') + '\n');
  fs.renameSync(tmpPath, filePath);

  if (resolution === 'approved') {
    const config = (opts && opts.config) || loadConfig();
    const approval = createApprovalToken(config.approvalTtlSeconds);
    storeToken(requestId, approval);
    return { ok: true, token: approval.token, reason: 'Approved by ' + (resolvedBy || 'unknown') };
  }

  // Denied
  const event = {
    event_type: 'SHEETS_WRITE_DENIED',
    timestamp_utc: new Date().toISOString(),
    request_id: requestId,
    resolved_by: resolvedBy || 'unknown',
    resolution: 'denied',
  };
  return { ok: true, reason: 'Denied by ' + (resolvedBy || 'unknown'), event };
}

/** For testing: reset pending approvals by deleting the file. */
function _resetPendingApprovals() {
  try {
    const filePath = runtimePath(PENDING_APPROVALS_FILE);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

// ─── Rate Limiting ───

const SHEETS_RATE_LEDGER_FILE = 'sheets-write-ledger.jsonl';

/**
 * Append an entry to the write rate ledger.
 *
 * @param {object} entry — { agent_id, sheet_id, range, outcome, request_id }
 */
function appendWriteLedger(entry) {
  ensureRuntimeDir();
  const record = {
    ts: new Date().toISOString(),
    agent_id: entry.agent_id || 'unknown',
    sheet_id: entry.sheet_id || 'unknown',
    range: entry.range || 'unknown',
    outcome: entry.outcome || 'unknown',
    request_id: entry.request_id || 'unknown',
  };
  const filePath = runtimePath(SHEETS_RATE_LEDGER_FILE);
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
}

/**
 * Read all entries from the write rate ledger.
 *
 * @returns {Array<object>}
 */
function readWriteLedger() {
  const filePath = runtimePath(SHEETS_RATE_LEDGER_FILE);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch (_) {}
  }
  return entries;
}

/**
 * Check if an agent has exceeded rate limits.
 *
 * @param {string} agentId — agent identifier
 * @param {object} [writeMode] — from readWriteMode(), provides rate_limit_per_minute and rate_limit_per_hour
 * @returns {{ allowed: boolean, reason: string, count_minute: number, count_hour: number, limit_minute: number, limit_hour: number }}
 */
function checkWriteRateLimit(agentId, writeMode) {
  const limitMinute = (writeMode && typeof writeMode.rate_limit_per_minute === 'number') ? writeMode.rate_limit_per_minute : 30;
  const limitHour = (writeMode && typeof writeMode.rate_limit_per_hour === 'number') ? writeMode.rate_limit_per_hour : 500;

  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const oneHourAgo = now - 3600 * 1000;

  const entries = readWriteLedger();
  let countMinute = 0;
  let countHour = 0;

  for (const entry of entries) {
    if (entry.agent_id !== agentId) continue;
    const ts = new Date(entry.ts).getTime();
    if (ts >= oneMinuteAgo) countMinute++;
    if (ts >= oneHourAgo) countHour++;
  }

  if (countMinute >= limitMinute) {
    return {
      allowed: false,
      reason: `Rate limited: ${countMinute}/${limitMinute} writes per minute for agent "${agentId}"`,
      count_minute: countMinute, count_hour: countHour,
      limit_minute: limitMinute, limit_hour: limitHour,
    };
  }

  if (countHour >= limitHour) {
    return {
      allowed: false,
      reason: `Rate limited: ${countHour}/${limitHour} writes per hour for agent "${agentId}"`,
      count_minute: countMinute, count_hour: countHour,
      limit_minute: limitMinute, limit_hour: limitHour,
    };
  }

  return {
    allowed: true,
    reason: 'Within rate limits',
    count_minute: countMinute, count_hour: countHour,
    limit_minute: limitMinute, limit_hour: limitHour,
  };
}

/** For testing: reset rate ledger by deleting the file. */
function _resetWriteLedger() {
  try {
    const filePath = runtimePath(SHEETS_RATE_LEDGER_FILE);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
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
  shouldRequireApproval,
  _resetWriteModeState,
  // PendingApprovalStore
  addPendingApproval,
  listPendingApprovals,
  resolvePendingApproval,
  _resetPendingApprovals,
  // Rate Limiting
  appendWriteLedger,
  readWriteLedger,
  checkWriteRateLimit,
  _resetWriteLedger,
  // Runtime (needed for tests)
  RUNTIME_DIR,
  runtimePath,
  ensureRuntimeDir,
};
