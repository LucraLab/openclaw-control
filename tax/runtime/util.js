#!/usr/bin/env node
/**
 * util.js - Deterministic utility functions for Tax Pod runtime
 *
 * NO NETWORK, NO ENV VARS, NO I/O except through explicit parameters.
 * All outputs must be deterministic (same input => same output).
 */

'use strict';

const crypto = require('crypto');

/**
 * Stable JSON stringification (sorted keys)
 * @param {*} obj - Object to stringify
 * @returns {string} - Deterministic JSON string
 */
function stableJsonStringify(obj) {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }

  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(stableJsonStringify).join(',') + ']';
  }

  // Sort object keys for determinism
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => {
    return JSON.stringify(k) + ':' + stableJsonStringify(obj[k]);
  });

  return '{' + pairs.join(',') + '}';
}

/**
 * SHA256 hex hash
 * @param {string} str - String to hash
 * @returns {string} - Hex-encoded SHA256 hash
 */
function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Generate deterministic safe ID
 * @param {string} prefix - ID prefix (e.g., 'case', 'agent')
 * @param {string} input - Input string to hash
 * @returns {string} - Deterministic ID (prefix-HASH_SHORT)
 */
function safeId(prefix, input) {
  const hash = sha256Hex(input);
  const short = hash.substring(0, 12);
  return `${prefix}-${short}`;
}

/**
 * Sanitize PII for evidence records
 * @param {string} text - Text potentially containing PII
 * @returns {string} - Sanitized text
 */
function sanitizePII(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let sanitized = text;

  // SSN patterns (full 9-digit)
  sanitized = sanitized.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN-REDACTED]');
  sanitized = sanitized.replace(/\b\d{9}\b/g, '[SSN-REDACTED]');

  // Phone numbers
  sanitized = sanitized.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE-REDACTED]');

  // Email addresses
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL-REDACTED]');

  return sanitized;
}

/**
 * Normalize intake for deterministic case ID generation
 * @param {object} intake - Raw intake object
 * @returns {string} - Normalized string for hashing
 */
function normalizeIntakeForId(intake) {
  // Extract stable fields only (not timestamps or random data)
  const stable = {
    filer_type: intake.filer_type || 'unknown',
    tax_years: (intake.tax_years || []).sort(),
    balance_estimate_range: intake.balance_estimate_range || 'unknown',
    filing_status: intake.filing_status || 'unknown',
    state: intake.state || 'unknown'
  };

  return stableJsonStringify(stable);
}

module.exports = {
  stableJsonStringify,
  sha256Hex,
  safeId,
  sanitizePII,
  normalizeIntakeForId
};
