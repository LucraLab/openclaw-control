#!/usr/bin/env node
/**
 * verification_gate_policy.js — Evidence artifact policy for OpenClaw
 *
 * Prevents committed "proof" artifacts from bypassing real CI verification.
 * Used by run_verification_gate.js and verification_gate.test.js.
 *
 * Pattern origin: obra/superpowers verification-before-completion
 * Vendored: 2026-02-11, adapted for deterministic CI gate use
 * No runtime dependency on upstream
 */

'use strict';

const path = require('path');

// ─── Forbidden directories ───
// Files under these top-level directories are evidence artifacts,
// not source code. They must never be committed to bypass CI.
const FORBIDDEN_DIRECTORIES = [
  'proofs',
  'proof_packs',
  'artifacts',
  'logs',
  '_logs',
  'outputs',
  'reports'
];

// ─── Forbidden filename patterns (case-insensitive) ───
// PROOF_PACK and SCAN_RESULTS match any extension (always evidence names).
// regression and test_output match only generated-output extensions
// (.txt, .json, .log, .xml, .csv) to avoid flagging documentation .md files.
// verification-summary.json is an exact basename match.
const FORBIDDEN_PATTERNS = [
  { regex: /PROOF_PACK/i, extensions: null },
  { regex: /SCAN_RESULTS/i, extensions: null },
  { regex: /regression/i, extensions: ['.txt', '.json', '.log', '.xml', '.csv'] },
  { regex: /test_output/i, extensions: ['.txt', '.json', '.log', '.xml', '.csv'] },
  { regex: /^verification-summary\.json$/i, extensions: null }
];

// ─── Allowlist markers ───
// Files under docs/ are allowed IF their path contains one of these markers
// (case-insensitive). This lets people document formats without creating
// actual evidence artifacts.
const ALLOWLIST_MARKERS = ['EXAMPLE', 'TEMPLATE', 'SAMPLE'];

// ─── Allowlisted prefixes ───
// Files under these directories are operational records (deployment proofs,
// audit results) that are meant to be committed. They are NOT CI-bypass
// artifacts — they document VPS deployments and security audits.
const ALLOWLISTED_PREFIXES = ['ops/'];

/**
 * Check if a file path starts with a forbidden directory.
 * @param {string} filePath - Relative file path from repo root
 * @returns {{ forbidden: boolean, dir: string|null }}
 */
function checkForbiddenDirectory(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const dir of FORBIDDEN_DIRECTORIES) {
    if (normalized.startsWith(dir + '/') || normalized === dir) {
      return { forbidden: true, dir };
    }
  }
  return { forbidden: false, dir: null };
}

/**
 * Check if a filename matches a forbidden evidence pattern.
 * @param {string} filePath - Relative file path from repo root
 * @returns {{ forbidden: boolean, pattern: string|null }}
 */
function checkForbiddenPattern(filePath) {
  const basename = filePath.replace(/\\/g, '/').split('/').pop();
  const ext = path.extname(basename).toLowerCase();
  for (const { regex, extensions } of FORBIDDEN_PATTERNS) {
    if (!regex.test(basename)) continue;
    // If extensions is null, match any extension
    if (extensions === null || extensions.includes(ext)) {
      return { forbidden: true, pattern: regex.toString() };
    }
  }
  return { forbidden: false, pattern: null };
}

/**
 * Check if a file is in the docs/ allowlist (has EXAMPLE/TEMPLATE/SAMPLE marker).
 * @param {string} filePath - Relative file path from repo root
 * @returns {boolean}
 */
function isDocsAllowlisted(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  // Must be under docs/
  if (!normalized.startsWith('docs/')) {
    return false;
  }

  // Path must contain an allowlist marker (case-insensitive)
  const upper = normalized.toUpperCase();
  return ALLOWLIST_MARKERS.some(marker => upper.includes(marker));
}

/**
 * Evaluate a list of changed files against the evidence artifact policy.
 *
 * @param {string[]} changedFiles - List of relative file paths from repo root
 * @returns {{ ok: boolean, violations: Array<{ file: string, rule: string, reason: string }> }}
 */
function evaluateChangedFiles(changedFiles) {
  const violations = [];

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');

    // Skip docs/ allowlisted files entirely
    if (isDocsAllowlisted(normalized)) {
      continue;
    }

    // Skip files under allowlisted operational prefixes (ops/, etc.)
    if (ALLOWLISTED_PREFIXES.some(p => normalized.startsWith(p))) {
      continue;
    }

    // Check 1: Forbidden directory
    const dirCheck = checkForbiddenDirectory(normalized);
    if (dirCheck.forbidden) {
      violations.push({
        file: normalized,
        rule: 'forbidden_directory',
        reason: `File is under forbidden evidence directory '${dirCheck.dir}/'`
      });
      continue; // Don't double-report
    }

    // Check 2: Forbidden filename pattern
    const patternCheck = checkForbiddenPattern(normalized);
    if (patternCheck.forbidden) {
      // Files under docs/ without allowlist marker still fail
      violations.push({
        file: normalized,
        rule: 'forbidden_pattern',
        reason: `Filename matches evidence artifact pattern ${patternCheck.pattern}`
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations
  };
}

/**
 * Build a verification summary object.
 *
 * @param {{ run_id: string, commit_sha: string, checks: Array<{ name: string, status: string, duration_ms: number }> }} opts
 * @returns {object} Verification summary with all required fields
 */
function buildSummary({ run_id, commit_sha, checks }) {
  return {
    run_id: run_id || 'unknown',
    commit_sha: commit_sha || 'unknown',
    timestamp_utc: new Date().toISOString(),
    checks: checks.map(c => ({
      name: c.name,
      status: c.status,
      duration_ms: typeof c.duration_ms === 'number' ? c.duration_ms : 0
    }))
  };
}

module.exports = {
  FORBIDDEN_DIRECTORIES,
  FORBIDDEN_PATTERNS,
  ALLOWLIST_MARKERS,
  ALLOWLISTED_PREFIXES,
  evaluateChangedFiles,
  buildSummary,
  checkForbiddenDirectory,
  checkForbiddenPattern,
  isDocsAllowlisted
};
