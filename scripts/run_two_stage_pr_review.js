#!/usr/bin/env node
/**
 * run_two_stage_pr_review.js — Runner for two-stage PR review gate
 *
 * In CI:
 *   - Reads PR body from GitHub event payload
 *   - Gets labels from event payload
 *   - Gets changed files via git diff
 *   - Reads file stats and content samples (capped, redacted)
 *   - Produces tmp/two-stage-pr-review.json + tmp/two-stage-pr-review.md
 *
 * Exit codes:
 *   0  = no MUST failures
 *   20 = Stage 1 failures (spec compliance)
 *   21 = Stage 2 MUST failures (quality)
 *   2  = internal error
 *
 * Usage:
 *   node scripts/run_two_stage_pr_review.js [--ci] [--repo-dir <path>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  checkSpecCompliance,
  scanQualityIssues,
  buildReport
} = require('./two_stage_pr_review_policy.js');

// ─── Parse args ───

const args = process.argv.slice(2);
const isCI = args.includes('--ci');
const repoDirIdx = args.indexOf('--repo-dir');
const repoDir = repoDirIdx >= 0 ? args[repoDirIdx + 1] : process.cwd();

// ─── Redaction ───

const REDACT_PATTERN = /\b(KEY|TOKEN|SECRET|PASS|PASSWORD|AUTH|BEARER)\b/gi;
function redact(text) {
  if (!text) return '';
  return text.replace(REDACT_PATTERN, '[REDACTED]');
}

// ─── Read file safely (capped to 4000 chars) ───

function readFileSafe(filePath, cap) {
  try {
    const buf = fs.readFileSync(filePath);
    // Check for binary (NUL bytes in first 8KB)
    const sample = buf.slice(0, 8192);
    const isBinary = sample.includes(0);
    if (isBinary) return { content: null, binary: true, size: buf.length };
    const text = buf.toString('utf8').slice(0, cap || 4000);
    return { content: redact(text), binary: false, size: buf.length };
  } catch {
    return { content: null, binary: false, size: 0 };
  }
}

// ─── Get PR info from event payload ───

function getPRInfo() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    return { body: '', labels: [], number: 0 };
  }
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const pr = event.pull_request || {};
    return {
      body: pr.body || '',
      labels: (pr.labels || []).map(l => l.name),
      number: pr.number || 0
    };
  } catch {
    return { body: '', labels: [], number: 0 };
  }
}

// ─── Get changed files ───

function getChangedFiles(dir) {
  try {
    const output = execSync('git diff --name-only origin/main...HEAD', {
      cwd: dir, encoding: 'utf8', timeout: 30000
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    try {
      const output = execSync('git diff --name-only HEAD~1', {
        cwd: dir, encoding: 'utf8', timeout: 30000
      });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}

// ─── Get commit messages ───

function getCommitMessages(dir) {
  try {
    const output = execSync('git log --format=%B origin/main...HEAD', {
      cwd: dir, encoding: 'utf8', timeout: 30000
    });
    return output.trim().split('\n\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ─── Generate markdown summary ───

function generateMarkdown(report) {
  const lines = [];
  lines.push('# Two-Stage PR Review Report');
  lines.push('');
  lines.push(`**Combined Status:** ${report.combined_status}`);
  lines.push(`**PR:** #${report.pr_number}`);
  lines.push(`**Commit:** ${report.commit_sha}`);
  lines.push(`**Time:** ${report.timestamp_utc}`);
  lines.push('');

  lines.push('## Stage 1 — Spec Compliance');
  lines.push(`**Status:** ${report.stage1.status}`);
  if (report.stage1.findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const f of report.stage1.findings) {
      lines.push(`- **${f.severity}** [${f.rule}]: ${f.message}${f.file ? ` (${f.file})` : ''}`);
    }
  }
  lines.push('');

  lines.push('## Stage 2 — Quality Check');
  lines.push(`**Status:** ${report.stage2.status}`);
  if (report.stage2.findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const f of report.stage2.findings) {
      lines.push(`- **${f.severity}** [${f.rule}]: ${f.message}${f.file ? ` (${f.file})` : ''}`);
    }
  }
  lines.push('');

  lines.push('## Summary');
  lines.push(`- MUST findings: ${report.summary.must}`);
  lines.push(`- SHOULD findings: ${report.summary.should}`);
  lines.push(`- COULD findings: ${report.summary.could}`);

  return lines.join('\n') + '\n';
}

// ─── Main ───

function main() {
  console.log('Two-Stage PR Review');
  console.log('='.repeat(50));
  console.log(`Repo: ${repoDir}`);
  console.log(`CI mode: ${isCI}`);
  console.log();

  // Gather inputs
  const prInfo = isCI ? getPRInfo() : { body: '', labels: [], number: 0 };
  const changedFiles = getChangedFiles(repoDir);
  const commitMessages = getCommitMessages(repoDir);

  console.log(`Changed files: ${changedFiles.length}`);
  console.log(`Commit messages: ${commitMessages.length}`);
  console.log(`Labels: ${prInfo.labels.join(', ') || 'none'}`);
  console.log();

  // Read file stats and content samples
  const fileStats = {};
  const fileContents = {};
  const planContents = {};

  for (const file of changedFiles) {
    const fullPath = path.join(repoDir, file);
    const info = readFileSafe(fullPath, 4000);
    fileStats[file] = { size: info.size, binary: info.binary };
    if (info.content) {
      fileContents[file] = info.content;
    }
    // Collect plan file contents
    if (/^plans\/.*\.md$/i.test(file) && info.content) {
      planContents[file] = info.content;
    }
  }

  // Also try to read plan files that exist in repo but aren't in the diff
  const prText = [prInfo.body, ...commitMessages].join('\n');
  const planMatch = prText.match(/\bplans\/[^\s]+\.md\b/i);
  if (planMatch && !planContents[planMatch[0]]) {
    const planPath = path.join(repoDir, planMatch[0]);
    const info = readFileSafe(planPath, 8000);
    if (info.content) {
      planContents[planMatch[0]] = info.content;
    }
  }

  // Stage 1: Spec Compliance
  console.log('Stage 1 — Spec Compliance...');
  const stage1Result = checkSpecCompliance({
    prBody: prInfo.body,
    commitMessages,
    changedFiles,
    planContents,
    labels: prInfo.labels
  });

  const s1Musts = stage1Result.stage1.findings.filter(f => f.severity === 'MUST').length;
  console.log(`  Status: ${stage1Result.stage1.status} (${s1Musts} MUST findings)`);

  // Stage 2: Quality Check
  console.log('Stage 2 — Quality Check...');
  const stage2Result = scanQualityIssues({
    changedFiles,
    fileStats,
    fileContents,
    prBody: prInfo.body
  });

  const s2Musts = stage2Result.findings.filter(f => f.severity === 'MUST').length;
  const s2Shoulds = stage2Result.findings.filter(f => f.severity === 'SHOULD').length;
  console.log(`  Status: ${stage2Result.status} (${s2Musts} MUST, ${s2Shoulds} SHOULD findings)`);

  // Build report
  const report = buildReport({
    stage1: stage1Result.stage1,
    stage2: stage2Result,
    run_id: process.env.GITHUB_RUN_ID || 'local',
    commit_sha: process.env.GITHUB_SHA || 'local',
    pr_number: prInfo.number
  });

  // Write artifacts
  const tmpDir = path.join(repoDir, 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const jsonPath = path.join(tmpDir, 'two-stage-pr-review.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');

  const mdPath = path.join(tmpDir, 'two-stage-pr-review.md');
  fs.writeFileSync(mdPath, generateMarkdown(report));

  // Print summary
  console.log();
  console.log('='.repeat(50));
  console.log(`Combined: ${report.combined_status}`);
  console.log(`MUST: ${report.summary.must} | SHOULD: ${report.summary.should} | COULD: ${report.summary.could}`);
  console.log(`Report: ${jsonPath}`);
  console.log(`Summary: ${mdPath}`);

  // Exit code
  if (stage1Result.stage1.status === 'FAIL') {
    process.exit(20);
  } else if (stage2Result.status === 'FAIL') {
    process.exit(21);
  } else {
    process.exit(0);
  }
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(2);
}
