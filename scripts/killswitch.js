#!/usr/bin/env node
/**
 * killswitch.js — CLI for the global kill switch
 *
 * Usage:
 *   node scripts/killswitch.js enable
 *   node scripts/killswitch.js disable
 *   node scripts/killswitch.js status
 *   node scripts/killswitch.js guard    (entrypoint-safe: 0=OK, 10=ACTIVE, 2=FAILCLOSED)
 */

'use strict';

const runtime = require('./autonomy_runtime');

const [,, cmd] = process.argv;

switch (cmd) {
  case 'enable':
    runtime.killSwitchEnable();
    console.log('Kill switch ENABLED. All autonomous operations halted.');
    break;

  case 'disable':
    runtime.killSwitchDisable();
    console.log('Kill switch DISABLED. Autonomous operations resumed.');
    break;

  case 'status': {
    const status = runtime.killSwitchStatus();
    console.log(`Kill switch: ${status.active ? 'ACTIVE (all operations halted)' : 'INACTIVE (normal operation)'}`);
    process.exit(status.active ? 1 : 0);
  }

  case 'guard':
    try {
      const fs = require('fs');
      const runtimeDir = runtime.RUNTIME_DIR;
      // Check if runtime dir exists
      if (fs.existsSync(runtimeDir)) {
        // Dir exists — verify readable, fail-closed if not
        try {
          fs.accessSync(runtimeDir, fs.constants.R_OK);
        } catch {
          console.log('KILLSWITCH_FAILCLOSED');
          process.exit(2);
        }
      }
      // Dir either doesn't exist (OK — no killswitch file) or is readable
      if (runtime.isKillSwitchActive()) {
        console.log('KILLSWITCH_ACTIVE');
        process.exit(10);
      } else {
        console.log('KILLSWITCH_OK');
        process.exit(0);
      }
    } catch (e) {
      console.log('KILLSWITCH_FAILCLOSED');
      process.exit(2);
    }
    break;

  default:
    console.error('Usage: killswitch.js <enable|disable|status|guard>');
    process.exit(1);
}
