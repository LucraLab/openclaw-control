#!/usr/bin/env node
/**
 * two_stage_pr_review_policy.js — Two-stage PR review gate for OpenClaw
 *
 * Stage 1 — SPEC COMPLIANCE (hard fail):
 *   - Objective ID present (obj-NNN)
 *   - Task ID present (task-NNN)
 *   - Plan file referenced + exists + has required headings
 *   - Definition of Done evidence listed
 *   - Risk tier declared; high risk requires risk-accepted label
 *
 * Stage 2 — QUALITY CHECK:
 *   MUST (hard fail): secrets, binary blobs, public-safe, forbidden paths
 *   SHOULD (warn only): missing tests, temporal claims, large diffs
 *
 * Pattern origin: obra/superpowers subagent-driven-development
 *   + solatis/claude-config QR agent (MUST/SHOULD/COULD severity)
 * Vendored: 2026-02-11, adapted for deterministic CI gate use
 * No runtime dependency on upstream
 */

'use strict';

// ─── Stage 1 Rules ───

const STAGE1_RULES = {
  objective_id: /\bobj-\d+\b/i,
  task_id: /\btask-\d+\b/i,
  risk_tier: /\brisk:\s*(low|medium|high)\b/i,
  dod_keywords: ['tests', 'lint', 'schema', 'gate', 'smoke', 'verification'],
  plan_path_pattern: /\bplans\/[^\s]+\.md\b/i
};

const PLAN_REQUIRED_HEADINGS = ['scope', 'verification', 'rollback'];

// ─── Stage 2 Patterns ───

const STAGE2_MUST_PATTERNS = {
  // Secret patterns (quick second net — not replacing gate-secrets)
  secrets: [
    /sk-[a-zA-Z0-9_-]{20,}/,
    /ghp_[a-zA-Z0-9]{36}/,
    /AKIA[A-Z0-9]{16}/,
    /xoxb-[0-9]+-[a-zA-Z0-9]+/,
    /pit-[a-zA-Z0-9]{20,}/
  ],
  // Public-safe patterns (quick second net — not replacing gate-publicsafe)
  public_safe: [
    /\bssh\s+\w+@[\w.-]+/,
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    /hstgr\.cloud/i,
    /srv\d+/i
  ],
  // Forbidden paths (defense-in-depth with verification-gate)
  forbidden_paths: [
    /^\/home\/openclaw\//,
    /^workspaces\//,
    /^proofs\//
  ]
};

// Binary/oversized allowlist paths
const BINARY_ALLOWLIST = ['docs/images/', 'assets/', 'bundles/'];
const MAX_FILE_SIZE = 1_000_000; // 1 MB

// Operational record prefixes — exempt from public-safe and secret scanning.
// Files under ops/ are deployment proofs that legitimately contain IP addresses,
// SSH commands, and hostnames documenting what happened on VPS infrastructure.
const OPS_SAFE_PREFIXES = ['ops/'];

// Temporal claim patterns
const TEMPORAL_CLAIMS = [
  /already\s+(?:verified|tested|checked)\b/i,
  /\bverified\s+on\s+(?:VPS|server|prod)/i,
  /\bworks?\s+(?:fine|correctly|great)\s+(?:on|in)\b/i,
  /\bmanually\s+(?:tested|verified|confirmed)\b/i
];

// ─── Stage 1: Spec Compliance ───

/**
 * Check PR for spec compliance.
 *
 * @param {{ prBody: string, commitMessages: string[], changedFiles: string[],
 *           planContents: Object<string,string>, labels: string[] }} input
 * @returns {{ stage1: { status: string, findings: Array } }}
 */
function checkSpecCompliance({ prBody, commitMessages, changedFiles, planContents, labels }) {
  const findings = [];
  const allText = [prBody, ...commitMessages].join('\n');

  // 1. Objective ID
  if (!STAGE1_RULES.objective_id.test(allText)) {
    findings.push({
      severity: 'MUST',
      rule: 'objective_id_required',
      message: 'No objective ID found (expected pattern: obj-NNN)',
      file: null
    });
  }

  // 2. Task ID
  if (!STAGE1_RULES.task_id.test(allText)) {
    findings.push({
      severity: 'MUST',
      rule: 'task_id_required',
      message: 'No task ID found (expected pattern: task-NNN)',
      file: null
    });
  }

  // 3. Risk tier
  const riskMatch = allText.match(STAGE1_RULES.risk_tier);
  if (!riskMatch) {
    findings.push({
      severity: 'MUST',
      rule: 'risk_tier_required',
      message: 'No risk tier declared (expected: risk: low|medium|high)',
      file: null
    });
  } else if (riskMatch[1].toLowerCase() === 'high') {
    if (!labels.includes('risk-accepted')) {
      findings.push({
        severity: 'MUST',
        rule: 'high_risk_requires_label',
        message: 'Risk is high but PR does not have risk-accepted label',
        file: null
      });
    }
  }

  // 4. Definition of Done
  const dodLine = allText.toLowerCase();
  const dodMatches = STAGE1_RULES.dod_keywords.filter(kw => dodLine.includes(kw));
  if (dodMatches.length < 2) {
    findings.push({
      severity: 'MUST',
      rule: 'dod_evidence_required',
      message: `DoD must mention at least 2 of: ${STAGE1_RULES.dod_keywords.join(', ')}. Found: ${dodMatches.join(', ') || 'none'}`,
      file: null
    });
  }

  // 5. Plan file
  const planPathMatch = allText.match(STAGE1_RULES.plan_path_pattern);
  if (!planPathMatch) {
    findings.push({
      severity: 'MUST',
      rule: 'plan_file_referenced',
      message: 'No plan file referenced (expected: plans/<objective>/<task>.md)',
      file: null
    });
  } else {
    const planPath = planPathMatch[0];

    // Check plan file exists in changed files or repo
    const planExists = changedFiles.includes(planPath) ||
      Object.keys(planContents).includes(planPath);

    if (!planExists) {
      findings.push({
        severity: 'MUST',
        rule: 'plan_file_exists',
        message: `Plan file referenced (${planPath}) but not found in diff or repo`,
        file: planPath
      });
    } else {
      // Check plan content for required headings
      const content = planContents[planPath] || '';
      if (content) {
        const headingsFound = PLAN_REQUIRED_HEADINGS.filter(h => {
          const regex = new RegExp(`^##\\s+${h}`, 'im');
          return regex.test(content);
        });
        const missing = PLAN_REQUIRED_HEADINGS.filter(h => !headingsFound.includes(h));

        if (missing.length > 0) {
          findings.push({
            severity: 'MUST',
            rule: 'plan_required_headings',
            message: `Plan file missing required headings: ${missing.join(', ')}`,
            file: planPath
          });
        }
      }
    }
  }

  const hasMust = findings.some(f => f.severity === 'MUST');
  return {
    stage1: {
      status: hasMust ? 'FAIL' : 'PASS',
      findings
    }
  };
}

// ─── Stage 2: Quality Check ───

/**
 * Scan changed files for quality issues.
 *
 * @param {{ changedFiles: string[], fileStats: Object, fileContents: Object, prBody: string }} input
 * @returns {{ status: string, findings: Array }}
 */
function scanQualityIssues({ changedFiles, fileStats, fileContents, prBody }) {
  const findings = [];

  for (const file of changedFiles) {
    const stat = fileStats[file] || {};

    // MUST: Binary/oversized
    if (stat.size > MAX_FILE_SIZE) {
      const allowed = BINARY_ALLOWLIST.some(p => file.startsWith(p));
      if (!allowed) {
        findings.push({
          severity: 'MUST',
          rule: 'binary_or_oversized',
          message: `File exceeds 1MB (${Math.round(stat.size / 1024)}KB) and is not in allowlist`,
          file
        });
      }
    }

    if (stat.binary && !BINARY_ALLOWLIST.some(p => file.startsWith(p))) {
      findings.push({
        severity: 'MUST',
        rule: 'binary_or_oversized',
        message: 'Binary file detected outside allowlist',
        file
      });
    }

    // MUST: Forbidden paths
    for (const pattern of STAGE2_MUST_PATTERNS.forbidden_paths) {
      if (pattern.test(file)) {
        findings.push({
          severity: 'MUST',
          rule: 'forbidden_path',
          message: `File under forbidden path: ${file}`,
          file
        });
      }
    }

    // Skip secret + public-safe scanning for operational record files (ops/)
    const isOpsSafe = OPS_SAFE_PREFIXES.some(p => file.startsWith(p));

    // MUST: Secret patterns in file content
    const content = fileContents[file] || '';
    if (content && !isOpsSafe) {
      for (const pattern of STAGE2_MUST_PATTERNS.secrets) {
        if (pattern.test(content)) {
          findings.push({
            severity: 'MUST',
            rule: 'secret_pattern_detected',
            message: `Potential secret pattern found (${pattern.source.substring(0, 20)}...)`,
            file
          });
          break; // one finding per file for secrets
        }
      }

      // MUST: Public-safe patterns in file content
      for (const pattern of STAGE2_MUST_PATTERNS.public_safe) {
        if (pattern.test(content)) {
          findings.push({
            severity: 'MUST',
            rule: 'public_safe_violation',
            message: `Public-safe pattern found (${pattern.source.substring(0, 20)}...)`,
            file
          });
          break;
        }
      }
    }
  }

  // SHOULD: Temporal claims in PR body without CI artifact references
  if (prBody) {
    for (const pattern of TEMPORAL_CLAIMS) {
      if (pattern.test(prBody)) {
        // Check if there's also a CI artifact reference
        const hasArtifactRef = /\b(verification-summary|context-budget-report|artifact|CI\s+gate|actions\/run)\b/i.test(prBody);
        if (!hasArtifactRef) {
          findings.push({
            severity: 'SHOULD',
            rule: 'temporal_claim_without_artifact',
            message: 'PR claims manual verification without CI artifact reference',
            file: null
          });
          break; // one warning is enough
        }
      }
    }
  }

  // SHOULD: Large code changes without test files
  const codeFiles = changedFiles.filter(f =>
    /\.(js|ts|py|sh|yaml|yml)$/.test(f) &&
    !f.includes('test') && !f.includes('spec') &&
    !f.startsWith('docs/') && !f.startsWith('.github/')
  );
  const testFiles = changedFiles.filter(f =>
    f.includes('test') || f.includes('spec')
  );

  if (codeFiles.length >= 5 && testFiles.length === 0) {
    findings.push({
      severity: 'SHOULD',
      rule: 'no_tests_for_code_changes',
      message: `${codeFiles.length} code files changed but no test files included`,
      file: null
    });
  }

  // SHOULD: Very large diff
  if (changedFiles.length > 25) {
    findings.push({
      severity: 'SHOULD',
      rule: 'large_diff',
      message: `PR touches ${changedFiles.length} files — consider splitting`,
      file: null
    });
  }

  const hasMust = findings.some(f => f.severity === 'MUST');
  const hasShould = findings.some(f => f.severity === 'SHOULD');

  return {
    status: hasMust ? 'FAIL' : (hasShould ? 'WARN' : 'PASS'),
    findings
  };
}

// ─── Report Builder ───

/**
 * Build a combined report.
 *
 * @param {{ stage1: { status: string, findings: Array },
 *           stage2: { status: string, findings: Array },
 *           run_id: string, commit_sha: string, pr_number: number }} opts
 * @returns {object}
 */
function buildReport({ stage1, stage2, run_id, commit_sha, pr_number }) {
  const anyMust = stage1.status === 'FAIL' || stage2.status === 'FAIL';
  const anyShould = [...stage1.findings, ...stage2.findings].some(f => f.severity === 'SHOULD');

  let combined;
  if (anyMust) combined = 'FAIL';
  else if (anyShould) combined = 'WARN';
  else combined = 'PASS';

  return {
    run_id: run_id || 'unknown',
    commit_sha: commit_sha || 'unknown',
    timestamp_utc: new Date().toISOString(),
    pr_number: pr_number || 0,
    stage1: {
      status: stage1.status,
      findings: stage1.findings
    },
    stage2: {
      status: stage2.status,
      findings: stage2.findings
    },
    combined_status: combined,
    summary: {
      must: [...stage1.findings, ...stage2.findings].filter(f => f.severity === 'MUST').length,
      should: [...stage1.findings, ...stage2.findings].filter(f => f.severity === 'SHOULD').length,
      could: [...stage1.findings, ...stage2.findings].filter(f => f.severity === 'COULD').length
    }
  };
}

module.exports = {
  STAGE1_RULES,
  STAGE2_MUST_PATTERNS,
  PLAN_REQUIRED_HEADINGS,
  BINARY_ALLOWLIST,
  MAX_FILE_SIZE,
  TEMPORAL_CLAIMS,
  OPS_SAFE_PREFIXES,
  checkSpecCompliance,
  scanQualityIssues,
  buildReport
};
