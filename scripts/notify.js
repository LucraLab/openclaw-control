#!/usr/bin/env node
/**
 * notify.js — Pluggable notification hook for Delivery OS (Port #11)
 *
 * Usage:
 *   node scripts/notify.js --event EVENT_NAME --detail "..." [--sink noop|stdout|file]
 *   node scripts/notify.js --event KILL_SWITCH_ENGAGED --detail "agent=builder" --sink file
 *
 * Sink modes:
 *   noop   — (default in CI) no output, exit 0
 *   stdout — print JSON notification to stdout
 *   file   — append JSON line to artifacts/notifications.log
 *
 * Environment:
 *   OC_NOTIFY_SINK — override sink mode (noop|stdout|file)
 *   DELIVERY_OS_HOME — used for file sink path resolution
 *
 * Security:
 *   - Payloads are sanitized: token-like strings redacted
 *   - Long payloads truncated to 500 chars
 *   - Never includes env vars, headers, or full dumps
 *
 * Exit 0 = notification sent/skipped
 * Exit 1 = error
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- Sanitization ---

const SECRET_PATTERN = /(sk-[a-zA-Z0-9]{10,}|ghp_[a-zA-Z0-9]{20,}|pit-[a-zA-Z0-9]{10,}|AKIA[A-Z0-9]{10,}|eyJ[a-zA-Z0-9._-]{20,}|Bearer\s+\S{10,}|token=[^\s&]{10,}|key=[^\s&]{10,}|password=[^\s&]+|secret=[^\s&]+)/gi;

const MAX_PAYLOAD_LENGTH = 500;

function sanitize(text) {
  if (!text) return '';
  let clean = String(text).replace(SECRET_PATTERN, '[REDACTED]');
  if (clean.length > MAX_PAYLOAD_LENGTH) {
    clean = clean.substring(0, MAX_PAYLOAD_LENGTH) + '...[truncated]';
  }
  return clean;
}

// --- Notification ---

function buildNotification(event, detail) {
  return {
    event: sanitize(event),
    detail: sanitize(detail),
    timestamp: new Date().toISOString(),
    hostname: require('os').hostname().split('.')[0],
    source: 'delivery-os-notify'
  };
}

function sinkNoop(_notification) {
  // Intentionally empty — used in CI
}

function sinkStdout(notification) {
  console.log(JSON.stringify(notification));
}

function sinkFile(notification) {
  const home = process.env.DELIVERY_OS_HOME || path.join(require('os').homedir(), '.openclaw');
  const logDir = path.join(home, '_logs');
  const logFile = path.join(logDir, 'notifications.log');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify(notification) + '\n');
}

// --- Exported for testing ---

function notify(event, detail, sink) {
  const notification = buildNotification(event, detail);
  switch (sink) {
    case 'noop':
      sinkNoop(notification);
      break;
    case 'stdout':
      sinkStdout(notification);
      break;
    case 'file':
      sinkFile(notification);
      break;
    default:
      sinkNoop(notification);
  }
  return notification;
}

// Export for require() in tests
if (typeof module !== 'undefined') {
  module.exports = { notify, sanitize, buildNotification };
}

// --- CLI ---

if (require.main === module) {
  const args = process.argv.slice(2);
  let event = '';
  let detail = '';
  let sink = process.env.OC_NOTIFY_SINK || 'noop';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--event': event = args[++i] || ''; break;
      case '--detail': detail = args[++i] || ''; break;
      case '--sink': sink = args[++i] || 'noop'; break;
    }
  }

  if (!event) {
    console.error('Usage: notify.js --event EVENT_NAME [--detail "..."] [--sink noop|stdout|file]');
    process.exit(1);
  }

  notify(event, detail, sink);
}
