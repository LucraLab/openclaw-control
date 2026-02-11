#!/usr/bin/env node
/**
 * coverage_report.js — Bundle Coverage Report Tool
 *
 * Analyzes compiled bundles and produces a coverage report:
 *   - Role assignment status (assigned vs unassigned)
 *   - Tool coverage per role
 *   - Policy violation checks
 *   - Unassigned critical roles
 *   - Agent-to-role mapping completeness
 *
 * Usage:
 *   node scripts/coverage_report.js [--json] [--bundles-dir <path>]
 *
 * Output:
 *   Without --json: human-readable markdown report to stdout
 *   With --json: structured JSON report to stdout
 *
 * Exit codes:
 *   0 = report generated (may contain warnings)
 *   1 = critical gaps found (unassigned CRITICAL roles)
 *   2 = bundle files missing or invalid
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Parse args
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const bundlesDirIdx = args.indexOf('--bundles-dir');
const bundlesDir = bundlesDirIdx >= 0 ? args[bundlesDirIdx + 1] : path.join(__dirname, '..', 'dist', 'bundles');

// Load bundle files
function loadBundle(name) {
  const filepath = path.join(bundlesDir, name);
  if (!fs.existsSync(filepath)) {
    console.error(`ERROR: ${name} not found at ${filepath}`);
    process.exit(2);
  }
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: ${name} is not valid JSON: ${e.message}`);
    process.exit(2);
  }
}

const registry = loadBundle('role_registry.json');
const catalog = loadBundle('tools_catalog.json');
const policy = loadBundle('policy_bundle.json');

// Analyze roles
const roles = registry.roles || {};
const agents = registry.agents || {};
const roleNames = Object.keys(roles);

const roleReport = roleNames.map(name => {
  const role = roles[name];
  const assignedAgents = Object.entries(agents)
    .filter(([, a]) => (a.assigned_roles || []).includes(name))
    .map(([agentName]) => agentName);

  return {
    role: name,
    status: role.status || 'UNKNOWN',
    priority: role.priority || 'UNKNOWN',
    purpose: (role.purpose || '').slice(0, 80),
    tool_count: (role.allowed_tools || []).length,
    hard_limit_count: (role.hard_limits || []).length,
    assigned_agents: assignedAgents,
    agent_count: assignedAgents.length,
    has_event_subscriptions: (role.event_subscriptions || []).length > 0,
    has_work_queues: (role.default_work_queues || []).length > 0
  };
});

// Identify gaps
const unassignedCritical = roleReport.filter(r =>
  r.agent_count === 0 && r.priority === 'CRITICAL'
);
const unassignedHigh = roleReport.filter(r =>
  r.agent_count === 0 && r.priority === 'HIGH'
);
const totalAssigned = roleReport.filter(r => r.agent_count > 0).length;
const totalUnassigned = roleReport.filter(r => r.agent_count === 0).length;

// Analyze tools coverage
const tools = (catalog.tools || []).map(t => ({
  tool: t.tool,
  role_count: (t.used_by_roles || t.allowed_roles || []).length,
  roles: t.used_by_roles || t.allowed_roles || []
}));

// Check policy violations
const violations = [];
const forbidden = policy.forbidden_combinations || [];
for (const rule of forbidden) {
  const role = roles[rule.role];
  if (!role) continue;
  const allowedTools = role.allowed_tools || [];
  for (const ft of (rule.forbidden_tools || [])) {
    if (allowedTools.includes(ft)) {
      violations.push({
        role: rule.role,
        forbidden_tool: ft,
        reason: rule.reason
      });
    }
  }
}

// Build report
const report = {
  generated: new Date().toISOString(),
  bundle_version: registry.version || 'unknown',
  bundle_tag: registry.bundle_tag || 'unknown',
  source_sha: registry.source_sha || 'unknown',
  summary: {
    total_roles: roleNames.length,
    assigned_roles: totalAssigned,
    unassigned_roles: totalUnassigned,
    coverage_pct: Math.round((totalAssigned / roleNames.length) * 100),
    total_agents: Object.keys(agents).length,
    total_tools: tools.length,
    policy_violations: violations.length,
    critical_gaps: unassignedCritical.length,
    high_gaps: unassignedHigh.length
  },
  roles: roleReport,
  tools,
  violations,
  critical_gaps: unassignedCritical.map(r => r.role),
  high_gaps: unassignedHigh.map(r => r.role)
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  // Human-readable markdown
  console.log('# Bundle Coverage Report');
  console.log('');
  console.log(`**Generated:** ${report.generated}`);
  console.log(`**Bundle:** ${report.bundle_tag} (v${report.bundle_version})`);
  console.log(`**Source:** ${report.source_sha}`);
  console.log('');
  console.log('## Summary');
  console.log('');
  console.log(`| Metric | Value |`);
  console.log(`|--------|-------|`);
  console.log(`| Roles | ${report.summary.total_roles} |`);
  console.log(`| Assigned | ${report.summary.assigned_roles} (${report.summary.coverage_pct}%) |`);
  console.log(`| Unassigned | ${report.summary.unassigned_roles} |`);
  console.log(`| Agents | ${report.summary.total_agents} |`);
  console.log(`| Tools | ${report.summary.total_tools} |`);
  console.log(`| Policy Violations | ${report.summary.policy_violations} |`);
  console.log(`| Critical Gaps | ${report.summary.critical_gaps} |`);
  console.log(`| High Gaps | ${report.summary.high_gaps} |`);
  console.log('');

  if (report.critical_gaps.length > 0) {
    console.log('## CRITICAL GAPS (unassigned CRITICAL roles)');
    console.log('');
    for (const r of report.critical_gaps) {
      console.log(`- **${r}**`);
    }
    console.log('');
  }

  if (report.high_gaps.length > 0) {
    console.log('## High Priority Gaps');
    console.log('');
    for (const r of report.high_gaps) {
      console.log(`- ${r}`);
    }
    console.log('');
  }

  console.log('## Role Details');
  console.log('');
  console.log('| Role | Status | Priority | Agents | Tools | Hard Limits |');
  console.log('|------|--------|----------|--------|-------|-------------|');
  for (const r of report.roles) {
    const agentStr = r.agent_count > 0 ? r.assigned_agents.join(', ') : '_none_';
    console.log(`| ${r.role} | ${r.status} | ${r.priority} | ${agentStr} | ${r.tool_count} | ${r.hard_limit_count} |`);
  }
  console.log('');

  if (report.violations.length > 0) {
    console.log('## Policy Violations');
    console.log('');
    for (const v of report.violations) {
      console.log(`- **${v.role}**: has forbidden tool \`${v.forbidden_tool}\` — ${v.reason}`);
    }
    console.log('');
  }

  console.log('## Tools Coverage');
  console.log('');
  console.log('| Tool | Roles Using |');
  console.log('|------|-------------|');
  for (const t of report.tools) {
    console.log(`| ${t.tool} | ${t.role_count} roles |`);
  }
}

// Exit code: 1 if critical gaps, 0 otherwise
if (unassignedCritical.length > 0) {
  if (!jsonMode) {
    console.log('');
    console.log(`EXIT 1: ${unassignedCritical.length} CRITICAL role(s) unassigned.`);
  }
  process.exit(1);
}
