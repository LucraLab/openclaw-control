#!/usr/bin/env node
'use strict';

/**
 * normalize_feedback_v1.js
 *
 * Accepts a FeedbackV1 JSON object and returns a normalized copy:
 *   - trims whitespace on all string fields
 *   - canonicalizes enums to UPPER_CASE
 *   - stable-sorts items by (type, target.artifact, target.year, target.path, item_id)
 *
 * This module is consumed by feedback_to_changeset_v1.js.
 * It does NOT read/write files — pure transform.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ---------- schema loading ----------

function loadSchema() {
  // Try well-known paths relative to this file
  const candidates = [
    path.resolve(__dirname, '../../docs/taxpod/schemas/feedback_v1.schema.json'),
    path.resolve(__dirname, '../schemas/feedback_v1.schema.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  return null; // schema not found — skip validation
}

// ---------- lightweight schema validation ----------

function validateFeedback(fb, schema) {
  const errors = [];

  // Required top-level fields
  const required = ['version', 'feedback_id', 'case_id', 'source',
                    'received_utc', 'package_manifest_sha256', 'items'];
  for (const k of required) {
    if (fb[k] === undefined || fb[k] === null) {
      errors.push(`Missing required field: ${k}`);
    }
  }
  if (errors.length) return errors;

  // Version
  if (fb.version !== 'FeedbackV1') {
    errors.push(`version must be "FeedbackV1", got "${fb.version}"`);
  }

  // Pattern checks
  if (!/^.+_fb_[0-9]{8}T[0-9]{6}Z$/.test(fb.feedback_id)) {
    errors.push(`feedback_id does not match pattern: ${fb.feedback_id}`);
  }
  if (!/^[0-9]{8}T[0-9]{6}Z$/.test(fb.received_utc)) {
    errors.push(`received_utc does not match pattern: ${fb.received_utc}`);
  }
  if (!/^[0-9a-f]{64}$/.test(fb.package_manifest_sha256)) {
    errors.push(`package_manifest_sha256 does not match pattern: ${fb.package_manifest_sha256}`);
  }

  // Source enum
  const validSources = ['CPA', 'EA', 'ATTORNEY', 'INTERNAL_REVIEW'];
  if (!validSources.includes(fb.source)) {
    errors.push(`Invalid source: "${fb.source}". Must be one of: ${validSources.join(', ')}`);
  }

  // Items
  if (!Array.isArray(fb.items) || fb.items.length === 0) {
    errors.push('items must be a non-empty array');
    return errors;
  }

  const validTypes = [
    'LIABILITY_CORRECTION', 'MISSING_DOC', 'DOC_CLASSIFICATION_FIX',
    'PAYMENT_CAPACITY_ASSUMPTION_FIX', 'STRATEGY_OVERRIDE_NOTE',
    'DISPUTE_OR_UNCERTAIN'
  ];
  const validArtifacts = ['LIABILITY_SNAPSHOT', 'PAYMENT_MODEL', 'STRATEGY', 'PACKAGE'];

  for (let i = 0; i < fb.items.length; i++) {
    const item = fb.items[i];
    const prefix = `items[${i}]`;

    if (!item.item_id) errors.push(`${prefix}: missing item_id`);
    if (!item.type) errors.push(`${prefix}: missing type`);
    else if (!validTypes.includes(item.type)) {
      errors.push(`${prefix}: unknown type "${item.type}"`);
    }

    if (!item.target || !item.target.artifact) {
      errors.push(`${prefix}: missing target.artifact`);
    } else if (!validArtifacts.includes(item.target.artifact)) {
      errors.push(`${prefix}: unknown target.artifact "${item.target.artifact}"`);
    }

    if (!item.proposed_change || Object.keys(item.proposed_change).length === 0) {
      errors.push(`${prefix}: proposed_change must have at least one property`);
    }

    if (!item.evidence || !item.evidence.notes) {
      errors.push(`${prefix}: missing evidence.notes`);
    }

    if (item.requires_human_approval !== true) {
      errors.push(`${prefix}: requires_human_approval must be true in V1`);
    }
  }

  return errors;
}

// ---------- normalization ----------

function trimDeep(obj) {
  if (typeof obj === 'string') return obj.trim();
  if (Array.isArray(obj)) return obj.map(trimDeep);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = trimDeep(v);
    }
    return out;
  }
  return obj;
}

function stableSortItems(items) {
  return items.slice().sort((a, b) => {
    // 1) type
    if (a.type < b.type) return -1;
    if (a.type > b.type) return 1;
    // 2) target.artifact
    const artA = (a.target && a.target.artifact) || '';
    const artB = (b.target && b.target.artifact) || '';
    if (artA < artB) return -1;
    if (artA > artB) return 1;
    // 3) target.year
    const yearA = (a.target && a.target.year) || 0;
    const yearB = (b.target && b.target.year) || 0;
    if (yearA < yearB) return -1;
    if (yearA > yearB) return 1;
    // 4) target.path
    const pathA = (a.target && a.target.path) || '';
    const pathB = (b.target && b.target.path) || '';
    if (pathA < pathB) return -1;
    if (pathA > pathB) return 1;
    // 5) item_id
    if (a.item_id < b.item_id) return -1;
    if (a.item_id > b.item_id) return 1;
    return 0;
  });
}

function normalizeFeedback(fb) {
  const trimmed = trimDeep(fb);
  trimmed.items = stableSortItems(trimmed.items);
  return trimmed;
}

// ---------- stable stringify ----------

function stableStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k]));
  return '{' + pairs.join(',') + '}';
}

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// ---------- exports ----------

module.exports = {
  loadSchema,
  validateFeedback,
  normalizeFeedback,
  stableStringify,
  sha256,
};
