#!/usr/bin/env node
/**
 * email_draft_policy.js — Email Draft Assistant policy module
 *
 * Provides: intent validation, allowlist checking, rate limiting,
 * one-clarifier policy, RFC822 message building, sanitization,
 * and draft creation via Gmail API.
 *
 * Safety model:
 *   - Draft-only. NO send endpoint, NO send scope.
 *   - Fail closed: missing auth, bad recipient, rate limit, ambiguous intent -> block.
 *   - All outputs sanitized (tokens, keys, PII patterns redacted).
 *   - Rate limited: 5 drafts/day default, override requires explicit flag.
 *
 * OAuth scope MUST be: https://www.googleapis.com/auth/gmail.compose
 * NEVER request send, modify, or broad read scopes.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

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

// ─── Sanitization (reuse autonomy_runtime patterns + add email-specific) ───
const SECRET_PATTERNS = /(?:sk-|ghp_|github_pat_|AKIA|Bearer |eyJ|pit-)[A-Za-z0-9_\-./+=]{8,}/g;
const TELEGRAM_TOKEN = /\d{8,}:[A-Za-z0-9_-]{30,}/g;
const PRIVATE_KEY = /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g;
const OAUTH_REFRESH = /1\/\/[A-Za-z0-9_-]{20,}/g;
const OAUTH_ACCESS = /ya29\.[A-Za-z0-9_-]{20,}/g;

function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(SECRET_PATTERNS, '[REDACTED]')
    .replace(TELEGRAM_TOKEN, '[REDACTED]')
    .replace(PRIVATE_KEY, '[REDACTED]')
    .replace(OAUTH_REFRESH, '[REDACTED]')
    .replace(OAUTH_ACCESS, '[REDACTED]');
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

// ─── Event emission (matches autonomy_runtime.js pattern) ───
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

// ─── EmailIntent JSON schema (strict) ───
const REQUIRED_INTENT_FIELDS = ['to', 'subject', 'body_markdown', 'requested_by'];
const VALID_REQUESTED_BY = ['autopilot', 'telegram', 'workflow'];
const VALID_CONTEXT_TAGS = ['sales', 'ops', 'personal', 'billing', 'support', 'follow-up', 'scheduling'];

/**
 * Validate an EmailIntent object.
 * @param {object} intent
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateIntent(intent) {
  const errors = [];

  if (!intent || typeof intent !== 'object') {
    return { valid: false, errors: ['Intent must be a non-null object'] };
  }

  // Required fields
  for (const field of REQUIRED_INTENT_FIELDS) {
    if (intent[field] === undefined || intent[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // to: string[] (non-empty)
  if (intent.to !== undefined) {
    if (!Array.isArray(intent.to) || intent.to.length === 0) {
      errors.push('"to" must be a non-empty array of email addresses');
    } else {
      for (const addr of intent.to) {
        if (typeof addr !== 'string' || !addr.includes('@')) {
          errors.push(`Invalid email in "to": ${sanitize(String(addr))}`);
        }
      }
    }
  }

  // cc/bcc: optional string[]
  for (const field of ['cc', 'bcc']) {
    if (intent[field] !== undefined) {
      if (!Array.isArray(intent[field])) {
        errors.push(`"${field}" must be an array of email addresses`);
      } else {
        for (const addr of intent[field]) {
          if (typeof addr !== 'string' || !addr.includes('@')) {
            errors.push(`Invalid email in "${field}": ${sanitize(String(addr))}`);
          }
        }
      }
    }
  }

  // subject: string (non-empty)
  if (intent.subject !== undefined && (typeof intent.subject !== 'string' || intent.subject.trim() === '')) {
    errors.push('"subject" must be a non-empty string');
  }

  // body_markdown: string (non-empty)
  if (intent.body_markdown !== undefined && (typeof intent.body_markdown !== 'string' || intent.body_markdown.trim() === '')) {
    errors.push('"body_markdown" must be a non-empty string');
  }

  // requested_by: enum
  if (intent.requested_by !== undefined && !VALID_REQUESTED_BY.includes(intent.requested_by)) {
    errors.push(`"requested_by" must be one of: ${VALID_REQUESTED_BY.join(', ')}`);
  }

  // context_tags: optional string[]
  if (intent.context_tags !== undefined) {
    if (!Array.isArray(intent.context_tags)) {
      errors.push('"context_tags" must be an array');
    }
  }

  // approval_required: must be true
  if (intent.approval_required !== undefined && intent.approval_required !== true) {
    errors.push('"approval_required" must be true (draft-only safety)');
  }

  // override_rate_limit: optional boolean
  if (intent.override_rate_limit !== undefined && typeof intent.override_rate_limit !== 'boolean') {
    errors.push('"override_rate_limit" must be a boolean');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Recipient allowlist ───
const DEFAULT_ALLOW_DOMAINS = [];
const DEFAULT_ALLOW_EXACT = [];

function getAllowDomains() {
  const env = process.env.OPENCLAW_EMAIL_ALLOW_DOMAINS || '';
  const fromEnv = env.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOW_DOMAINS;
}

function getAllowExact() {
  const env = process.env.OPENCLAW_EMAIL_ALLOW_EXACT || '';
  const fromEnv = env.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOW_EXACT;
}

/**
 * Check if all recipients are allowed.
 * @param {{ to: string[], cc?: string[], bcc?: string[] }} recipients
 * @returns {{ allowed: boolean, blocked: string[] }}
 */
function recipientAllowlistCheck(recipients) {
  const domains = getAllowDomains();
  const exact = getAllowExact();
  const blocked = [];

  const allAddrs = [
    ...(recipients.to || []),
    ...(recipients.cc || []),
    ...(recipients.bcc || [])
  ];

  // If no allowlist configured at all -> fail closed
  if (domains.length === 0 && exact.length === 0) {
    return {
      allowed: false,
      blocked: allAddrs,
      reason: 'No allowlist configured (OPENCLAW_EMAIL_ALLOW_DOMAINS and OPENCLAW_EMAIL_ALLOW_EXACT both empty). Fail closed.'
    };
  }

  for (const addr of allAddrs) {
    const lower = addr.toLowerCase();
    const domain = lower.split('@')[1] || '';

    const domainAllowed = domains.some(d => domain === d || domain.endsWith('.' + d));
    const exactAllowed = exact.includes(lower);

    if (!domainAllowed && !exactAllowed) {
      blocked.push(addr);
    }
  }

  return {
    allowed: blocked.length === 0,
    blocked,
    ...(blocked.length > 0 ? { reason: `Blocked recipients: ${blocked.map(b => sanitize(b)).join(', ')}` } : {})
  };
}

// ─── Rate limiting ───
const DEFAULT_RATE_LIMIT = 5;
const RATE_LEDGER_FILE = 'email-draft-ledger.jsonl';

function getRateLimit() {
  return parseInt(process.env.OPENCLAW_EMAIL_RATE_LIMIT || String(DEFAULT_RATE_LIMIT), 10) || DEFAULT_RATE_LIMIT;
}

function readRateLedger() {
  const ledgerPath = runtimePath(RATE_LEDGER_FILE);
  if (!fs.existsSync(ledgerPath)) return [];

  const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch { /* skip corrupt lines */ }
  }
  return entries;
}

function appendRateLedger(entry) {
  ensureRuntimeDir();
  const ledgerPath = runtimePath(RATE_LEDGER_FILE);
  fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\n');
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getTodayDraftCount() {
  const today = todayDateString();
  const entries = readRateLedger();
  return entries.filter(e => e.date === today && e.status === 'created').length;
}

/**
 * Check rate limit.
 * @param {{ override_rate_limit?: boolean }} options
 * @returns {{ allowed: boolean, count: number, limit: number, remaining: number }}
 */
function rateLimitCheck(options) {
  const limit = getRateLimit();
  const count = getTodayDraftCount();
  const override = options && options.override_rate_limit === true;

  if (override) {
    return { allowed: true, count, limit, remaining: Math.max(0, limit - count), overridden: true };
  }

  return {
    allowed: count < limit,
    count,
    limit,
    remaining: Math.max(0, limit - count)
  };
}

// ─── One clarifier policy ───

/**
 * Check if intent has minimum required info for drafting.
 * If missing, return exactly ONE question.
 * @param {object} intent
 * @returns {{ ready: boolean, question?: string, missing_field?: string }}
 */
function oneClarifierPolicy(intent) {
  if (!intent || typeof intent !== 'object') {
    return { ready: false, question: 'Who should this email be sent to?', missing_field: 'to' };
  }

  if (!intent.to || !Array.isArray(intent.to) || intent.to.length === 0) {
    return { ready: false, question: 'Who should this email be sent to?', missing_field: 'to' };
  }

  if (!intent.subject || typeof intent.subject !== 'string' || intent.subject.trim() === '') {
    return { ready: false, question: 'What should the subject line be?', missing_field: 'subject' };
  }

  if (!intent.body_markdown || typeof intent.body_markdown !== 'string' || intent.body_markdown.trim() === '') {
    return { ready: false, question: 'What should the email say?', missing_field: 'body_markdown' };
  }

  return { ready: true };
}

// ─── RFC822 message building ───
const MIME_BOUNDARY_PREFIX = 'oc-email-draft-';

/**
 * Build an RFC822 raw message (base64url-encoded for Gmail API).
 * @param {{ from?: string, to: string[], cc?: string[], bcc?: string[], subject: string, body_markdown: string }} params
 * @returns {{ raw: string, headers: object }}
 */
function buildRFC822Message(params) {
  const messageId = `<${crypto.randomUUID()}@openclaw.local>`;
  const boundary = MIME_BOUNDARY_PREFIX + crypto.randomBytes(8).toString('hex');
  const date = new Date().toUTCString();

  const from = params.from || process.env.OPENCLAW_EMAIL_FROM || 'OpenClaw Assistant <assistant@openclaw.local>';

  const headers = {
    'From': from,
    'To': params.to.join(', '),
    'Subject': params.subject,
    'Date': date,
    'Message-ID': messageId,
    'MIME-Version': '1.0',
    'Content-Type': `multipart/alternative; boundary="${boundary}"`
  };

  if (params.cc && params.cc.length > 0) {
    headers['Cc'] = params.cc.join(', ');
  }
  if (params.bcc && params.bcc.length > 0) {
    headers['Bcc'] = params.bcc.join(', ');
  }

  // Build header string
  const headerStr = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');

  // Plain text body
  const textBody = params.body_markdown;

  // Simple HTML body (minimal conversion: newlines -> <br>, preserve structure)
  const htmlBody = `<html><body><div style="font-family:sans-serif;font-size:14px;line-height:1.5">`
    + params.body_markdown
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>\n')
    + `</div></body></html>`;

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    htmlBody,
    '',
    `--${boundary}--`
  ].join('\r\n');

  const fullMessage = headerStr + '\r\n\r\n' + body;

  // Base64url encode for Gmail API
  const raw = Buffer.from(fullMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return { raw, headers, messageId, boundary };
}

// ─── Gmail Auth ───
const GMAIL_SECRETS_DIR = 'gmail-secrets';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';

function gmailSecretsDir() {
  return runtimePath(GMAIL_SECRETS_DIR);
}

function readClientCredentials() {
  const credPath = path.join(gmailSecretsDir(), 'client_credentials.json');
  if (!fs.existsSync(credPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(credPath, 'utf8'));
  } catch {
    return null;
  }
}

function readTokens() {
  const tokenPath = path.join(gmailSecretsDir(), 'tokens.json');
  if (!fs.existsSync(tokenPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeTokens(tokens) {
  ensureRuntimeDir();
  const dir = gmailSecretsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify(tokens, null, 2));
}

/**
 * Generate the Google OAuth consent URL.
 * @returns {{ url: string } | { error: string }}
 */
function generateAuthUrl() {
  const creds = readClientCredentials();
  if (!creds) {
    return { error: 'No client_credentials.json found. Place it in: ' + gmailSecretsDir() };
  }

  const installed = creds.installed || creds.web || creds;
  const clientId = installed.client_id;
  const redirectUri = (installed.redirect_uris && installed.redirect_uris[0]) || 'urn:ietf:wg:oauth:2.0:oob';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent'
  });

  return { url: `https://accounts.google.com/o/oauth2/auth?${params.toString()}` };
}

/**
 * Exchange auth code for tokens (makes HTTPS call to Google).
 * @param {string} code
 * @returns {Promise<{ tokens?: object, error?: string }>}
 */
function exchangeAuthCode(code) {
  const creds = readClientCredentials();
  if (!creds) {
    return Promise.resolve({ error: 'No client_credentials.json found' });
  }

  const installed = creds.installed || creds.web || creds;
  const clientId = installed.client_id;
  const clientSecret = installed.client_secret;
  const redirectUri = (installed.redirect_uris && installed.redirect_uris[0]) || 'urn:ietf:wg:oauth:2.0:oob';

  const postData = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  }).toString();

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const tokens = JSON.parse(body);
          if (tokens.error) {
            resolve({ error: `Google OAuth error: ${tokens.error_description || tokens.error}` });
          } else {
            tokens.obtained_at = isoNow();
            writeTokens(tokens);
            resolve({ tokens: { scope: tokens.scope, expires_in: tokens.expires_in, token_type: tokens.token_type } });
          }
        } catch (e) {
          resolve({ error: `Failed to parse token response: ${e.message}` });
        }
      });
    });
    req.on('error', (e) => resolve({ error: `Network error: ${e.message}` }));
    req.write(postData);
    req.end();
  });
}

/**
 * Refresh access token using refresh token.
 * @returns {Promise<{ access_token?: string, error?: string }>}
 */
function refreshAccessToken() {
  const creds = readClientCredentials();
  const tokens = readTokens();
  if (!creds) return Promise.resolve({ error: 'No client_credentials.json' });
  if (!tokens || !tokens.refresh_token) return Promise.resolve({ error: 'No refresh token. Run auth-init.' });

  const installed = creds.installed || creds.web || creds;
  const postData = new URLSearchParams({
    client_id: installed.client_id,
    client_secret: installed.client_secret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token'
  }).toString();

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.error) {
            resolve({ error: `Refresh error: ${data.error_description || data.error}` });
          } else {
            tokens.access_token = data.access_token;
            tokens.expires_in = data.expires_in;
            tokens.refreshed_at = isoNow();
            writeTokens(tokens);
            resolve({ access_token: data.access_token });
          }
        } catch (e) {
          resolve({ error: `Failed to parse refresh response: ${e.message}` });
        }
      });
    });
    req.on('error', (e) => resolve({ error: `Network error: ${e.message}` }));
    req.write(postData);
    req.end();
  });
}

/**
 * Get a valid access token (refresh if needed).
 * @returns {Promise<{ access_token?: string, error?: string }>}
 */
async function getAccessToken() {
  const tokens = readTokens();
  if (!tokens) return { error: 'No tokens found. Run auth-init.' };
  if (!tokens.access_token) return refreshAccessToken();

  // If token was refreshed less than 50 minutes ago, reuse it
  if (tokens.refreshed_at || tokens.obtained_at) {
    const ts = new Date(tokens.refreshed_at || tokens.obtained_at).getTime();
    const age = Date.now() - ts;
    const expiresIn = (tokens.expires_in || 3600) * 1000;
    if (age < expiresIn - 600000) { // 10 min buffer
      return { access_token: tokens.access_token };
    }
  }

  return refreshAccessToken();
}

/**
 * Get sanitized auth status.
 * @returns {{ authenticated: boolean, scope?: string, has_refresh: boolean, error?: string }}
 */
function authStatus() {
  const creds = readClientCredentials();
  const tokens = readTokens();

  if (!creds) {
    return { authenticated: false, has_refresh: false, error: 'No client_credentials.json' };
  }
  if (!tokens) {
    return { authenticated: false, has_refresh: false, error: 'No tokens. Run auth-init.' };
  }

  return {
    authenticated: !!tokens.access_token,
    scope: tokens.scope || 'unknown',
    has_refresh: !!tokens.refresh_token,
    refreshed_at: tokens.refreshed_at || tokens.obtained_at || 'unknown'
  };
}

// ─── Gmail Draft API ───

/**
 * Create a draft via Gmail API (users.drafts.create).
 * @param {string} raw Base64url-encoded RFC822 message
 * @param {string} accessToken
 * @returns {Promise<{ draftId?: string, gmailMessageId?: string, webLink?: string, error?: string }>}
 */
function createGmailDraft(raw, accessToken) {
  const postData = JSON.stringify({ message: { raw } });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'gmail.googleapis.com',
      path: '/gmail/v1/users/me/drafts',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.error) {
            resolve({ error: `Gmail API error: ${data.error.message || JSON.stringify(data.error)}` });
          } else {
            resolve({
              draftId: data.id,
              gmailMessageId: data.message && data.message.id,
              threadId: data.message && data.message.threadId,
              webLink: `https://mail.google.com/mail/#drafts/${data.message && data.message.id}`
            });
          }
        } catch (e) {
          resolve({ error: `Failed to parse Gmail response: ${e.message}` });
        }
      });
    });
    req.on('error', (e) => resolve({ error: `Network error: ${e.message}` }));
    req.write(postData);
    req.end();
  });
}

// ─── Telegram notification formatting ───

/**
 * Format a Telegram notification for a draft event.
 * @param {string} eventType
 * @param {object} details
 * @returns {string}
 */
function formatTelegramNotification(eventType, details) {
  const lines = [];

  switch (eventType) {
    case 'EMAIL_DRAFT_CREATED': {
      lines.push('Draft created in Gmail:');
      lines.push(`To: ${sanitize((details.to || []).join(', '))}`);
      lines.push(`Subject: ${sanitize(details.subject || '(none)')}`);
      lines.push('');
      lines.push('Summary:');
      const bullets = generateBulletSummary(details);
      bullets.forEach(b => lines.push(`- ${b}`));
      lines.push('');
      lines.push(`Draft ID: ${details.draftId || '(unknown)'}`);
      if (details.webLink) {
        lines.push(`Link: ${details.webLink}`);
      }
      lines.push('');
      lines.push('Reply: APPROVE / EDIT / DISCARD');
      break;
    }
    case 'EMAIL_DRAFT_SKIPPED_NEEDS_CLARIFIER': {
      lines.push('Draft skipped (need more info):');
      lines.push(`Question: ${sanitize(details.question || '(none)')}`);
      lines.push(`Missing: ${details.missing_field || '(unknown)'}`);
      break;
    }
    case 'EMAIL_DRAFT_BLOCKED_ALLOWLIST': {
      lines.push('Draft BLOCKED (recipient not allowed):');
      lines.push(`Blocked: ${sanitize((details.blocked || []).join(', '))}`);
      lines.push(`Reason: ${sanitize(details.reason || 'allowlist check failed')}`);
      break;
    }
    case 'EMAIL_DRAFT_BLOCKED_RATELIMIT': {
      lines.push('Draft BLOCKED (rate limit):');
      lines.push(`Today: ${details.count || 0}/${details.limit || 5} drafts used`);
      lines.push('Override: ask James to say "override"');
      break;
    }
    case 'EMAIL_DRAFT_FAILCLOSED': {
      lines.push('Draft BLOCKED (fail closed):');
      lines.push(`Reason: ${sanitize(details.reason || 'unknown')}`);
      break;
    }
    default:
      lines.push(`Email event: ${eventType}`);
      lines.push(`Detail: ${sanitize(JSON.stringify(details))}`);
  }

  return lines.join('\n');
}

/**
 * Generate 3 bullet points summarizing the draft intent.
 * Deterministic (no LLM).
 * @param {object} details
 * @returns {string[]}
 */
function generateBulletSummary(details) {
  const bullets = [];

  // Bullet 1: Type/context
  const tags = details.context_tags || [];
  if (tags.length > 0) {
    bullets.push(`Context: ${tags.join(', ')}`);
  } else {
    bullets.push(`Type: ${details.requested_by || 'manual'} email`);
  }

  // Bullet 2: Body preview (first 80 chars, sanitized)
  const bodyPreview = sanitize((details.body_markdown || '').trim());
  if (bodyPreview.length > 80) {
    bullets.push(`Preview: "${bodyPreview.substring(0, 80)}..."`);
  } else if (bodyPreview) {
    bullets.push(`Preview: "${bodyPreview}"`);
  } else {
    bullets.push('Preview: (empty body)');
  }

  // Bullet 3: Recipient count
  const recipientCount = (details.to || []).length + (details.cc || []).length + (details.bcc || []).length;
  bullets.push(`Recipients: ${recipientCount} total`);

  return bullets.slice(0, 3);
}

// ─── Main draft flow ───

/**
 * Full draft flow: validate -> clarify -> allowlist -> rate limit -> auth -> draft -> notify.
 * @param {object} intent EmailIntent object
 * @returns {Promise<{ status: string, event: string, detail: object }>}
 */
async function draftEmail(intent) {
  // 1. Validate intent schema
  const validation = validateIntent(intent);
  if (!validation.valid) {
    const result = { status: 'error', event: 'EMAIL_DRAFT_FAILCLOSED', detail: { reason: `Validation failed: ${validation.errors.join('; ')}` } };
    emitEvent(result.event, result.detail);
    return result;
  }

  // 2. One clarifier check
  const clarifier = oneClarifierPolicy(intent);
  if (!clarifier.ready) {
    const result = { status: 'needs_clarifier', event: 'EMAIL_DRAFT_SKIPPED_NEEDS_CLARIFIER', detail: { question: clarifier.question, missing_field: clarifier.missing_field } };
    emitEvent(result.event, result.detail);
    return result;
  }

  // 3. Allowlist check
  const allowlist = recipientAllowlistCheck(intent);
  if (!allowlist.allowed) {
    const result = { status: 'blocked', event: 'EMAIL_DRAFT_BLOCKED_ALLOWLIST', detail: { blocked: allowlist.blocked, reason: allowlist.reason } };
    emitEvent(result.event, result.detail);
    return result;
  }

  // 4. Rate limit check
  const rate = rateLimitCheck(intent);
  if (!rate.allowed) {
    const result = { status: 'blocked', event: 'EMAIL_DRAFT_BLOCKED_RATELIMIT', detail: { count: rate.count, limit: rate.limit, remaining: rate.remaining } };
    emitEvent(result.event, result.detail);
    return result;
  }

  // 5. Auth check
  let accessToken;
  try {
    const auth = await getAccessToken();
    if (auth.error) {
      const result = { status: 'error', event: 'EMAIL_DRAFT_FAILCLOSED', detail: { reason: `Auth failed: ${sanitize(auth.error)}` } };
      emitEvent(result.event, result.detail);
      return result;
    }
    accessToken = auth.access_token;
  } catch (e) {
    const result = { status: 'error', event: 'EMAIL_DRAFT_FAILCLOSED', detail: { reason: `Auth exception: ${sanitize(e.message)}` } };
    emitEvent(result.event, result.detail);
    return result;
  }

  // 6. Build RFC822 message
  const { raw, messageId } = buildRFC822Message({
    to: intent.to,
    cc: intent.cc,
    bcc: intent.bcc,
    subject: intent.subject,
    body_markdown: intent.body_markdown
  });

  // 7. Create draft via Gmail API
  let gmailResult;
  try {
    gmailResult = await createGmailDraft(raw, accessToken);
    if (gmailResult.error) {
      const result = { status: 'error', event: 'EMAIL_DRAFT_FAILCLOSED', detail: { reason: `Gmail API: ${sanitize(gmailResult.error)}` } };
      emitEvent(result.event, result.detail);
      return result;
    }
  } catch (e) {
    const result = { status: 'error', event: 'EMAIL_DRAFT_FAILCLOSED', detail: { reason: `Gmail exception: ${sanitize(e.message)}` } };
    emitEvent(result.event, result.detail);
    return result;
  }

  // 8. Record in rate ledger
  appendRateLedger({
    date: todayDateString(),
    status: 'created',
    draftId: gmailResult.draftId,
    to: intent.to.map(a => sanitize(a)),
    subject: sanitize(intent.subject),
    requested_by: intent.requested_by,
    ts: isoNow()
  });

  // 9. Emit success event
  const detail = {
    draftId: gmailResult.draftId,
    gmailMessageId: gmailResult.gmailMessageId,
    threadId: gmailResult.threadId,
    webLink: gmailResult.webLink,
    to: intent.to,
    subject: intent.subject,
    body_markdown: intent.body_markdown,
    context_tags: intent.context_tags,
    requested_by: intent.requested_by,
    messageId
  };

  emitEvent('EMAIL_DRAFT_CREATED', detail);

  return {
    status: 'created',
    event: 'EMAIL_DRAFT_CREATED',
    detail
  };
}

// ─── Exports ───
module.exports = {
  // Schema & validation
  REQUIRED_INTENT_FIELDS,
  VALID_REQUESTED_BY,
  VALID_CONTEXT_TAGS,
  validateIntent,

  // Policy controls
  recipientAllowlistCheck,
  rateLimitCheck,
  oneClarifierPolicy,
  getAllowDomains,
  getAllowExact,
  getRateLimit,
  getTodayDraftCount,

  // RFC822 building
  buildRFC822Message,
  MIME_BOUNDARY_PREFIX,

  // Auth
  GMAIL_SCOPE,
  generateAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  getAccessToken,
  authStatus,
  readClientCredentials,
  readTokens,
  writeTokens,
  gmailSecretsDir,

  // Gmail API
  createGmailDraft,

  // Telegram
  formatTelegramNotification,
  generateBulletSummary,

  // Sanitization
  sanitize,
  sanitizeObj,

  // Events
  emitEvent,

  // Rate ledger
  readRateLedger,
  appendRateLedger,
  todayDateString,
  RATE_LEDGER_FILE,

  // Main flow
  draftEmail,

  // Runtime
  RUNTIME_DIR,
  runtimePath,
  ensureRuntimeDir
};
