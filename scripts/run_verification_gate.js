#!/usr/bin/env node
/**
 * run_verification_gate.js — Fresh verification gate runner
 *
 * Ensures PRs don't commit evidence artifacts to bypass CI verification.
 * Produces a fresh verification-summary.json as a CI build artifact.
 *
 * Usage:
 *   node scripts/run_verification_gate.js [--ci]
 *
 * --ci: Running in GitHub Actions context (uses GITHUB_RUN_ID, GITHUB_SHA)
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = policy violations found
 *   2 = execution error
 *
 * Pattern origin: obra/superpowers verification-before-completion
 * Vendored: 2026-02-11, adapted for deterministic CI gate use
 * No runtime dependency on upstream
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const policy = require('./verification_gate_policy');

const IS_CI = process.argv.includes('--ci');
const REPO_ROOT = path.resolve(__dirname, '..');
const SUMMARY_DIR = path.join(REPO_ROOT, 'tmp');
const SUMMARY_FILE = path.join(SUMMARY_DIR, 'verification-summary.json');

// ─── Helpers ─────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      timeout: 30000,
      ...opts
    }).trim();
  } catch (e) {
    if (opts.allowFail) return e.stdout || '';
    throw e;
  }
}

function timestamp() {
  return new Date().toISOString();
}

function elapsed(startMs) {
  return Date.now() - startMs;
}

// ─── Get changed files ───────────────────────────────────

function getChangedFiles() {
  // In CI: compare against origin/main
  // Locally: same approach
  try {
    const diff = run('git diff --name-only --diff-filter=ACMRT origin/main...HEAD', { allowFail: true });
    if (diff) return diff.split('\n').filter(Boolean);
  } catch (_) { /* fall through */ }

  // Fallback: compare against HEAD~1
  try {
    const diff = run('git diff --name-only --diff-filter=ACMRT HEAD~1', { allowFail: true });
    if (diff) return diff.split('\n').filter(Boolean);
  } catch (_) { /* fall through */ }

  console.log('WARN: Could not determine changed files; checking all tracked files');
  const all = run('git ls-files', { allowFail: true });
  return all ? all.split('\n').filter(Boolean) : [];
}

// ─── Main ────────────────────────────────────────────────

function main() {
  const checks = [];
  let hasFailure = false;

  console.log('============================================');
  console.log('  Verification Gate — Fresh Evidence Check');
  console.log(`  ${timestamp()}`);
  console.log('============================================');
  console.log('');

  // ── Check 1: Evidence artifact policy ──────────────────
  const t1 = Date.now();
  const changedFiles = getChangedFiles();
  console.log(`Changed files: ${changedFiles.length}`);

  const result = policy.evaluateChangedFiles(changedFiles);

  if (result.ok) {
    console.log('  PASS: evidence_policy (no committed evidence artifacts)');
    checks.push({ name: 'evidence_policy', status: 'pass', duration_ms: elapsed(t1) });
  } else {
    console.log('  FAIL: evidence_policy');
    for (const v of result.violations) {
      console.log(`    - ${v.file}: ${v.reason}`);
    }
    checks.push({ name: 'evidence_policy', status: 'fail', duration_ms: elapsed(t1) });
    hasFailure = true;
  }

  // ── Check 2: Schema validation (quick) ─────────────────
  const t2 = Date.now();
  try {
    run('python3 -c "import yaml; yaml.safe_load(open(\'registry/ROLE_REGISTRY.yaml\'))"');
    console.log('  PASS: schema_quick_check (ROLE_REGISTRY.yaml is valid YAML)');
    checks.push({ name: 'schema_quick_check', status: 'pass', duration_ms: elapsed(t2) });
  } catch (e) {
    console.log('  FAIL: schema_quick_check (ROLE_REGISTRY.yaml is not valid YAML)');
    checks.push({ name: 'schema_quick_check', status: 'fail', duration_ms: elapsed(t2) });
    hasFailure = true;
  }

  // ── Check 3: Secret pattern scan (changed files only) ──
  const t3 = Date.now();
  const SECRET_PATTERN = /(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16})/;
  const CREDENTIAL_PATTERN = /(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)=[^$\{][^\n]{8,}/;
  let secretsFound = 0;

  for (const file of changedFiles) {
    const fullPath = path.join(REPO_ROOT, file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > 1024 * 1024) continue; // Skip files > 1MB
      const content = fs.readFileSync(fullPath, 'utf8');
      if (SECRET_PATTERN.test(content) || CREDENTIAL_PATTERN.test(content)) {
        // Exclude test files that test for these patterns
        if (!file.includes('.test.') && !file.includes('gate-secrets') && !file.match(/run_.*_gate.js$/)) {
          console.log(`    SECRET: ${file}`);
          secretsFound++;
        }
      }
    } catch (_) { /* skip unreadable files */ }
  }

  if (secretsFound === 0) {
    console.log('  PASS: secret_scan (no secret patterns in changed files)');
    checks.push({ name: 'secret_scan', status: 'pass', duration_ms: elapsed(t3) });
  } else {
    console.log(`  FAIL: secret_scan (${secretsFound} files with secret patterns)`);
    checks.push({ name: 'secret_scan', status: 'fail', duration_ms: elapsed(t3) });
    hasFailure = true;
  }

  // ── Produce verification summary ───────────────────────
  const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  const commitSha = process.env.GITHUB_SHA || run('git rev-parse HEAD', { allowFail: true }) || 'unknown';

  const summary = policy.buildSummary({
    run_id: runId,
    commit_sha: commitSha,
    checks
  });

  // Write summary to tmp/ (never committed — .gitignore or CI artifact only)
  fs.mkdirSync(SUMMARY_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2) + '\n');

  console.log('');
  console.log(`Summary written to: ${path.relative(REPO_ROOT, SUMMARY_FILE)}`);
  console.log('');

  // ── Final result ───────────────────────────────────────
  const passCount = checks.filter(c => c.status === 'pass').length;
  const failCount = checks.filter(c => c.status === 'fail').length;

  console.log('============================================');
  console.log(`  Results: ${passCount} pass, ${failCount} fail`);
  console.log('============================================');

  if (hasFailure) {
    process.exit(1);
  }
}

try {
  main();
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(2);
}
