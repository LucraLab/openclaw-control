#!/usr/bin/env node
/**
 * spend_alert.js — CLI for spend monitoring and burn-rate evaluation
 *
 * Usage:
 *   node scripts/spend_alert.js evaluate          — Run threshold checks, emit alerts
 *   node scripts/spend_alert.js log <json>         — Append a spend entry
 *   node scripts/spend_alert.js summary            — Show current daily spend
 */

'use strict';

const runtime = require('./autonomy_runtime');

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'evaluate': {
    const result = runtime.evaluateSpendAlerts();
    console.log(`Daily spend: $${result.total.toFixed(4)} (${result.pct.toFixed(1)}% of cap)`);
    console.log(`Projected daily burn: $${result.projectedDaily.toFixed(4)}`);
    if (result.alerts.length > 0) {
      console.log(`Alerts fired: ${result.alerts.join(', ')}`);
    } else {
      console.log('No alerts.');
    }
    break;
  }

  case 'log': {
    if (!args[0]) {
      console.error('Usage: spend_alert.js log \'{"agent_id":"...","model":"...","est_tokens_in":N,"est_tokens_out":N}\'');
      process.exit(1);
    }
    try {
      const entry = JSON.parse(args[0]);
      if (!entry.est_cost_usd && entry.est_tokens_in && entry.est_tokens_out) {
        entry.est_cost_usd = runtime.estimateCost(
          entry.model || 'unknown',
          entry.est_tokens_in,
          entry.est_tokens_out
        );
      }
      runtime.appendSpendEntry(entry);
      console.log(`Logged: $${(entry.est_cost_usd || 0).toFixed(6)} (${entry.agent_id || 'unknown'})`);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
    break;
  }

  case 'summary': {
    const entries = runtime.readSpendLedger();
    const { total, perAgent } = runtime.computeDailySpend(entries);
    const { projectedDaily } = runtime.computeBurnRate(entries);
    const thresholds = runtime.getThresholds();
    console.log(`Daily cap: $${thresholds.dailyCap}`);
    console.log(`Today's spend: $${total.toFixed(4)}`);
    console.log(`Projected daily: $${projectedDaily.toFixed(4)}`);
    if (Object.keys(perAgent).length > 0) {
      console.log('Per-agent:');
      for (const [agent, cost] of Object.entries(perAgent).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${agent}: $${cost.toFixed(4)}`);
      }
    }
    break;
  }

  default:
    console.error('Usage: spend_alert.js <evaluate|log|summary>');
    process.exit(1);
}
