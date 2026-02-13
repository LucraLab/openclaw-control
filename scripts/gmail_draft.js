#!/usr/bin/env node
/**
 * gmail_draft.js — CLI for Gmail Draft Assistant
 *
 * Usage:
 *   node scripts/gmail_draft.js auth-init              — Print consent URL, accept auth code
 *   node scripts/gmail_draft.js auth-status             — Show sanitized auth status
 *   node scripts/gmail_draft.js draft --intent <path>   — Create draft from intent JSON
 *   node scripts/gmail_draft.js validate --intent <path> — Validate intent only
 *   node scripts/gmail_draft.js rate-status             — Show today's draft count
 *   node scripts/gmail_draft.js allowlist-status        — Show allowlist config (counts only)
 *
 * Safety:
 *   - Draft-only. NO send endpoint, NO send scope.
 *   - OAuth scope: https://www.googleapis.com/auth/gmail.compose
 *   - All output sanitized (tokens, keys, secrets redacted).
 *   - Fail closed on any error.
 */

'use strict';

const fs = require('fs');
const readline = require('readline');
const policy = require('./email_draft_policy');

const [,, cmd, ...args] = process.argv;

function getArg(name) {
  const idx = args.indexOf('--' + name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

function readIntentFile(intentPath) {
  if (!intentPath) {
    console.error('Error: --intent <path.json> required');
    process.exit(1);
  }
  if (!fs.existsSync(intentPath)) {
    console.error(`Error: Intent file not found: ${intentPath}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(intentPath, 'utf8'));
  } catch (e) {
    console.error(`Error: Failed to parse intent JSON: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  switch (cmd) {
    case 'auth-init': {
      const result = policy.generateAuthUrl();
      if (result.error) {
        console.error(`Error: ${result.error}`);
        console.error(`\nTo set up Gmail auth:`);
        console.error(`1. Go to Google Cloud Console -> APIs & Services -> Credentials`);
        console.error(`2. Create an OAuth 2.0 Client ID (Desktop app)`);
        console.error(`3. Download the JSON and save it as:`);
        console.error(`   ${policy.gmailSecretsDir()}/client_credentials.json`);
        process.exit(1);
      }

      console.log('Gmail Draft Assistant — OAuth Setup');
      console.log('='.repeat(50));
      console.log(`\nScope: ${policy.GMAIL_SCOPE}`);
      console.log('(Draft-only. Cannot send emails.)\n');
      console.log('Open this URL in your browser:\n');
      console.log(result.url);
      console.log('');

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const code = await new Promise(resolve => {
        rl.question('Paste the authorization code: ', (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      if (!code) {
        console.error('No code provided. Aborting.');
        process.exit(1);
      }

      console.log('\nExchanging code for tokens...');
      const tokenResult = await policy.exchangeAuthCode(code);
      if (tokenResult.error) {
        console.error(`Error: ${policy.sanitize(tokenResult.error)}`);
        process.exit(1);
      }

      console.log('Auth successful!');
      console.log(`Scope: ${tokenResult.tokens.scope}`);
      console.log(`Token type: ${tokenResult.tokens.token_type}`);
      console.log(`Tokens stored in: ${policy.gmailSecretsDir()}`);
      break;
    }

    case 'auth-status': {
      const status = policy.authStatus();
      console.log('Gmail Auth Status');
      console.log('='.repeat(30));
      console.log(`Authenticated: ${status.authenticated}`);
      console.log(`Has refresh token: ${status.has_refresh}`);
      if (status.scope) console.log(`Scope: ${status.scope}`);
      if (status.refreshed_at) console.log(`Last refreshed: ${status.refreshed_at}`);
      if (status.error) console.log(`Error: ${status.error}`);
      break;
    }

    case 'draft': {
      const intentPath = getArg('intent');
      const intent = readIntentFile(intentPath);

      // Force approval_required = true
      intent.approval_required = true;

      console.log('Creating draft...');
      const result = await policy.draftEmail(intent);

      console.log(`\nStatus: ${result.status}`);
      console.log(`Event: ${result.event}`);

      if (result.status === 'created') {
        console.log(`Draft ID: ${result.detail.draftId}`);
        if (result.detail.webLink) {
          console.log(`Link: ${result.detail.webLink}`);
        }
        console.log(`\nTelegram notification:`);
        console.log(policy.formatTelegramNotification(result.event, result.detail));
      } else {
        console.log(`Detail: ${policy.sanitize(JSON.stringify(result.detail))}`);
        if (result.event === 'EMAIL_DRAFT_SKIPPED_NEEDS_CLARIFIER') {
          console.log(`\nTelegram notification:`);
          console.log(policy.formatTelegramNotification(result.event, result.detail));
        }
      }

      // Exit non-zero for blocked/error
      if (result.status !== 'created' && result.status !== 'needs_clarifier') {
        process.exit(1);
      }
      break;
    }

    case 'validate': {
      const intentPath = getArg('intent');
      const intent = readIntentFile(intentPath);

      const validation = policy.validateIntent(intent);
      console.log(`Valid: ${validation.valid}`);
      if (validation.errors.length > 0) {
        console.log('Errors:');
        validation.errors.forEach(e => console.log(`  - ${e}`));
        process.exit(1);
      }

      const clarifier = policy.oneClarifierPolicy(intent);
      if (!clarifier.ready) {
        console.log(`\nNeeds clarification: ${clarifier.question}`);
        console.log(`Missing: ${clarifier.missing_field}`);
      } else {
        console.log('Intent is complete and valid.');
      }

      const allowlist = policy.recipientAllowlistCheck(intent);
      console.log(`\nAllowlist: ${allowlist.allowed ? 'PASS' : 'BLOCKED'}`);
      if (!allowlist.allowed) {
        console.log(`Blocked: ${(allowlist.blocked || []).map(b => policy.sanitize(b)).join(', ')}`);
      }

      const rate = policy.rateLimitCheck(intent);
      console.log(`Rate limit: ${rate.count}/${rate.limit} (${rate.remaining} remaining)`);
      break;
    }

    case 'rate-status': {
      const rate = policy.rateLimitCheck({});
      console.log('Email Draft Rate Status');
      console.log('='.repeat(30));
      console.log(`Today: ${rate.count}/${rate.limit} drafts`);
      console.log(`Remaining: ${rate.remaining}`);
      console.log(`Date: ${policy.todayDateString()}`);
      break;
    }

    case 'allowlist-status': {
      const domains = policy.getAllowDomains();
      const exact = policy.getAllowExact();
      console.log('Email Allowlist Status');
      console.log('='.repeat(30));
      console.log(`Allowed domains: ${domains.length} configured`);
      console.log(`Allowed exact addresses: ${exact.length} configured`);
      // Only show details in local/debug mode
      if (process.env.OPENCLAW_EMAIL_DEBUG === 'true') {
        console.log(`\nDomains: ${domains.join(', ')}`);
        console.log(`Exact: ${exact.join(', ')}`);
      } else {
        console.log('(Set OPENCLAW_EMAIL_DEBUG=true to see full list)');
      }
      break;
    }

    default:
      console.error('Gmail Draft Assistant — CLI');
      console.error('='.repeat(30));
      console.error('');
      console.error('Commands:');
      console.error('  auth-init            — Set up Gmail OAuth');
      console.error('  auth-status          — Show auth status (sanitized)');
      console.error('  draft --intent <f>   — Create draft from intent JSON');
      console.error('  validate --intent <f> — Validate intent only');
      console.error('  rate-status          — Show today\'s draft count');
      console.error('  allowlist-status     — Show allowlist config');
      console.error('');
      console.error('Safety: Draft-only. Cannot send. Fail closed.');
      process.exit(1);
  }
}

main().catch(e => {
  console.error(`Fatal: ${policy.sanitize(e.message)}`);
  process.exit(1);
});
