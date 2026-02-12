#!/usr/bin/env node
/**
 * quarantine_agent.js — CLI for agent quarantine management
 *
 * Usage:
 *   node scripts/quarantine_agent.js add <agent_id>
 *   node scripts/quarantine_agent.js remove <agent_id>
 *   node scripts/quarantine_agent.js list
 */

'use strict';

const runtime = require('./autonomy_runtime');

const [,, cmd, agentId] = process.argv;

switch (cmd) {
  case 'add':
    if (!agentId) { console.error('Usage: quarantine_agent.js add <agent_id>'); process.exit(1); }
    try {
      runtime.quarantineAdd(agentId);
      console.log(`Quarantined: ${agentId}`);
      console.log(`Active quarantine: ${runtime.quarantineList().join(', ')}`);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
    break;

  case 'remove':
    if (!agentId) { console.error('Usage: quarantine_agent.js remove <agent_id>'); process.exit(1); }
    runtime.quarantineRemove(agentId);
    console.log(`Unquarantined: ${agentId}`);
    console.log(`Active quarantine: ${runtime.quarantineList().join(', ') || '(none)'}`);
    break;

  case 'list':
    const agents = runtime.quarantineList();
    if (agents.length === 0) {
      console.log('No agents quarantined.');
    } else {
      console.log(`Quarantined agents (${agents.length}):`);
      for (const a of agents) {
        console.log(`  - ${a}`);
      }
    }
    break;

  default:
    console.error('Usage: quarantine_agent.js <add|remove|list> [agent_id]');
    process.exit(1);
}
