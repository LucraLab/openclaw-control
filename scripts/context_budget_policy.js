#!/usr/bin/env node
/**
 * context_budget_policy.js — Context budget enforcement for OpenClaw
 *
 * Enforces deterministic chars/words/lines budgets on:
 *   - Per-role blocks in ROLE_REGISTRY.yaml
 *   - Skill SPEC.md files
 *   - Skill runbook.md files
 *   - CLAUDE.md files
 *   - Root README.md (warn-only)
 *
 * Prevents context bloat in agent dispatch by failing CI when
 * any artifact exceeds its budget. Supports grandfathering via
 * per-block overrides so existing content doesn't block merges.
 *
 * Pattern origin: solatis/claude-config CLAUDE.md/README.md token budget
 * Vendored: 2026-02-11, adapted for deterministic CI gate use
 * No runtime dependency on upstream
 */

'use strict';

// ─── Default Budgets ───
// Each budget defines max chars, words, and lines.
// severity: 'FAIL' means violations block the gate.
// severity: 'WARN' means violations are reported but don't block.

const DEFAULT_BUDGETS = {
  role_block: {
    chars: 2200,
    words: 320,
    lines: 40,
    severity: 'FAIL'
  },
  spec_md: {
    chars: 6000,
    words: 900,
    lines: 160,
    severity: 'FAIL'
  },
  runbook_md: {
    chars: 7000,
    words: 1100,
    lines: 180,
    severity: 'FAIL'
  },
  claude_md: {
    chars: 1200,
    words: 220,
    lines: 60,
    severity: 'FAIL'
  },
  readme_md: {
    chars: 3500,
    words: 550,
    lines: 120,
    severity: 'WARN'  // Root README is warn-only per spec
  }
};

/**
 * Measure text metrics.
 * @param {string} text
 * @returns {{ chars: number, words: number, lines: number }}
 */
function measureText(text) {
  if (!text) return { chars: 0, words: 0, lines: 0 };
  const chars = text.length;
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const lines = text.split('\n').length;
  return { chars, words, lines };
}

/**
 * Extract per-role blocks from ROLE_REGISTRY.yaml text.
 * Uses line-based parsing since we control the YAML format.
 *
 * Role blocks start with "  role_name:" (exactly 2-space indent)
 * and end at the next role or end of the roles section.
 *
 * @param {string} registryText - Full YAML text
 * @returns {Map<string, { text: string, startLine: number }>}
 */
function extractRoleBlocks(registryText) {
  const lines = registryText.split('\n');
  const blocks = new Map();

  // Find the 'roles:' section
  let rolesStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^roles:\s*$/.test(lines[i])) {
      rolesStart = i;
      break;
    }
  }

  if (rolesStart === -1) return blocks;

  // Find role block starts (2-space indent + identifier + colon)
  const roleStarts = [];
  for (let i = rolesStart + 1; i < lines.length; i++) {
    const match = lines[i].match(/^  ([a-z_][a-z0-9_]*):\s*$/);
    if (match) {
      roleStarts.push({ name: match[1], line: i });
    }
    // Stop if we hit a top-level key (no indent)
    if (i > rolesStart && /^[a-z]/.test(lines[i])) break;
  }

  // Extract blocks
  for (let idx = 0; idx < roleStarts.length; idx++) {
    const start = roleStarts[idx].line;
    const end = idx + 1 < roleStarts.length
      ? roleStarts[idx + 1].line
      : lines.length;
    const blockText = lines.slice(start, end).join('\n');
    blocks.set(roleStarts[idx].name, {
      text: blockText,
      startLine: start + 1  // 1-indexed
    });
  }

  return blocks;
}

/**
 * Evaluate all role blocks against budget limits.
 *
 * @param {string} registryText - Full YAML text
 * @param {{ chars: number, words: number, lines: number, severity: string }} budget
 * @param {Object} [overrides] - Per-role overrides: { roleName: { chars, words, lines } }
 * @returns {Array<{ file: string, block: string, metric: string, actual: number, limit: number, severity: string }>}
 */
function evaluateRoleBudgets(registryText, budget, overrides) {
  const blocks = extractRoleBlocks(registryText);
  const violations = [];

  for (const [name, { text }] of blocks) {
    const metrics = measureText(text);
    const limits = overrides && overrides[name]
      ? { ...budget, ...overrides[name] }
      : budget;

    for (const metric of ['chars', 'words', 'lines']) {
      if (metrics[metric] > limits[metric]) {
        // If overridden, the severity becomes WARN (grandfathered)
        const sev = (overrides && overrides[name]) ? 'WARN' : budget.severity;
        violations.push({
          file: 'registry/ROLE_REGISTRY.yaml',
          block: name,
          metric,
          actual: metrics[metric],
          limit: limits[metric],
          severity: sev
        });
      }
    }
  }

  return violations;
}

/**
 * Evaluate a single file against its budget.
 *
 * @param {string} filePath - Relative path from repo root
 * @param {string|null} text - File content, or null if missing
 * @param {{ chars: number, words: number, lines: number, severity: string }} budget
 * @returns {Array<{ file: string, block: string, metric: string, actual: number, limit: number, severity: string }>}
 */
function evaluateFileBudget(filePath, text, budget) {
  if (text === null || text === undefined) {
    return [{
      file: filePath,
      block: filePath,
      metric: 'missing',
      actual: 0,
      limit: 0,
      severity: 'WARN'
    }];
  }

  const metrics = measureText(text);
  const violations = [];

  for (const metric of ['chars', 'words', 'lines']) {
    if (metrics[metric] > budget[metric]) {
      violations.push({
        file: filePath,
        block: filePath,
        metric,
        actual: metrics[metric],
        limit: budget[metric],
        severity: budget.severity
      });
    }
  }

  return violations;
}

/**
 * Build a report object for the context budget check.
 *
 * @param {{ status: string, violations: Array, files_checked: number, roles_checked: number, run_id: string, commit_sha: string }} opts
 * @returns {object}
 */
function buildReport({ status, violations, files_checked, roles_checked, run_id, commit_sha }) {
  return {
    run_id: run_id || 'unknown',
    commit_sha: commit_sha || 'unknown',
    timestamp_utc: new Date().toISOString(),
    status,
    violations: violations || [],
    files_checked: typeof files_checked === 'number' ? files_checked : 0,
    roles_checked: typeof roles_checked === 'number' ? roles_checked : 0
  };
}

module.exports = {
  DEFAULT_BUDGETS,
  measureText,
  extractRoleBlocks,
  evaluateRoleBudgets,
  evaluateFileBudget,
  buildReport
};
