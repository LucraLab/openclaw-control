#!/usr/bin/env node
/**
 * canonical_artifact.js — CLI for writing canonical artifacts
 *
 * Usage:
 *   node scripts/canonical_artifact.js ops-pulse '{"gateway":"OK","memory":"300MB",...}'
 *   node scripts/canonical_artifact.js daily-exec-brief '{"objectives_scanned":5,...}'
 */

'use strict';

const runtime = require('./autonomy_runtime');

const [,, type, jsonData] = process.argv;

const VALID_TYPES = ['ops-pulse', 'daily-exec-brief'];

if (!type || !VALID_TYPES.includes(type)) {
  console.error(`Usage: canonical_artifact.js <${VALID_TYPES.join('|')}> '<json>'`);
  process.exit(1);
}

if (!jsonData) {
  console.error('Error: JSON data argument required');
  process.exit(1);
}

try {
  const data = JSON.parse(jsonData);

  // Enrich with runtime state
  data.killswitch_active = runtime.isKillSwitchActive();
  data.quarantined_agents = runtime.quarantineList();

  if (type === 'ops-pulse') {
    const entries = runtime.readSpendLedger();
    const { total } = runtime.computeDailySpend(entries);
    data.daily_spend_usd = Math.round(total * 10000) / 10000;
  }

  if (type === 'daily-exec-brief') {
    const result = runtime.evaluateSpendAlerts();
    data.daily_spend_usd = Math.round(result.total * 10000) / 10000;
    data.alerts = result.alerts;
  }

  const { jsonPath, mdPath } = runtime.writeCanonicalArtifact(type, data);
  console.log(`Written: ${jsonPath}`);
  console.log(`Written: ${mdPath}`);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
