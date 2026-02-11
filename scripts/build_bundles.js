#!/usr/bin/env node
/**
 * build_bundles.js — Compile governance artifacts into release bundles.
 *
 * Reads registry/ROLE_REGISTRY.yaml and produces:
 *   - role_registry.json   (compiled roles + agents)
 *   - tools_catalog.json   (all tools + which roles use them)
 *   - policy_bundle.json   (forbidden caps, gating rules, hard limits)
 *   - context_bundle.json  (boot contract, glossary, bundle metadata)
 *   - SHA256SUMS.txt       (integrity file for all bundles)
 *
 * Usage: node scripts/build_bundles.js [--tag TAG] [--outdir DIR]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- Minimal YAML parser (no deps) ---
// Handles the subset used in ROLE_REGISTRY.yaml:
// scalars, sequences (- item), mappings (key: value), block scalars (>)
function parseYaml(text) {
  // Strip document separator and comments-only lines at top
  const lines = text.split('\n');
  const cleaned = [];
  for (const line of lines) {
    if (line.trim() === '---') continue;
    cleaned.push(line);
  }
  return parseBlock(cleaned, 0).value;
}

function parseBlock(lines, startIndent) {
  const result = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Skip empty and comment-only lines
    if (!trimmed || trimmed.startsWith('#')) { i++; continue; }

    const indent = line.length - line.trimStart().length;
    if (indent < startIndent) break;
    if (indent > startIndent && Object.keys(result).length === 0) {
      startIndent = indent;
    }
    if (indent !== startIndent) { i++; continue; }

    // Sequence item at this level
    if (trimmed.startsWith('- ')) {
      // This block is actually an array
      const arr = [];
      while (i < lines.length) {
        const l = lines[i];
        const t = l.trimStart();
        if (!t || t.startsWith('#')) { i++; continue; }
        const ind = l.length - l.trimStart().length;
        if (ind < startIndent) break;
        if (ind === startIndent && t.startsWith('- ')) {
          const val = t.substring(2).trim();
          if (val.startsWith('{') || val.startsWith('[')) {
            arr.push(parseInlineValue(val));
          } else {
            // Check if there are indented children
            const childLines = [];
            let j = i + 1;
            while (j < lines.length) {
              const cl = lines[j];
              const ct = cl.trimStart();
              if (!ct || ct.startsWith('#')) { j++; continue; }
              const ci = cl.length - cl.trimStart().length;
              if (ci <= startIndent) break;
              childLines.push(cl);
              j++;
            }
            if (childLines.length > 0 && val.includes(':')) {
              // It's a mapping item starting with "- key: val"
              const obj = {};
              const [k, ...rest] = val.split(':');
              const v = rest.join(':').trim();
              if (v) obj[k.trim()] = parseScalar(v);
              // Parse children
              const childObj = parseBlock(childLines, childLines[0].length - childLines[0].trimStart().length);
              Object.assign(obj, childObj.value);
              arr.push(obj);
              i = j;
              continue;
            }
            arr.push(parseScalar(val));
          }
          i++;
        } else {
          break;
        }
      }
      return { value: arr, nextIndex: i };
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) { i++; continue; }
    const key = trimmed.substring(0, colonIdx).trim();
    let valPart = trimmed.substring(colonIdx + 1).trim();

    // Block scalar indicator (>)
    if (valPart === '>' || valPart === '|') {
      let blockVal = '';
      i++;
      while (i < lines.length) {
        const bl = lines[i];
        const bt = bl.trimStart();
        if (!bt || bt.startsWith('#')) { i++; continue; }
        const bi = bl.length - bl.trimStart().length;
        if (bi <= startIndent) break;
        blockVal += (blockVal ? ' ' : '') + bt;
        i++;
      }
      result[key] = blockVal;
      continue;
    }

    // Inline value
    if (valPart) {
      result[key] = parseInlineValue(valPart);
      i++;
    } else {
      // Nested block
      const childLines = [];
      i++;
      while (i < lines.length) {
        const cl = lines[i];
        const ct = cl.trimStart();
        if (!ct || ct.startsWith('#')) { childLines.push(cl); i++; continue; }
        const ci = cl.length - cl.trimStart().length;
        if (ci <= startIndent) break;
        childLines.push(cl);
        i++;
      }
      if (childLines.length > 0) {
        const firstNonEmpty = childLines.find(l => l.trim() && !l.trim().startsWith('#'));
        if (firstNonEmpty) {
          const childIndent = firstNonEmpty.length - firstNonEmpty.trimStart().length;
          const child = parseBlock(childLines, childIndent);
          result[key] = child.value;
        } else {
          result[key] = {};
        }
      } else {
        result[key] = {};
      }
    }
  }
  return { value: result, nextIndex: i };
}

function parseInlineValue(val) {
  if (val.startsWith('[') && val.endsWith(']')) {
    return val.slice(1, -1).split(',').map(s => parseScalar(s.trim()));
  }
  if (val.startsWith('{') && val.endsWith('}')) {
    const obj = {};
    val.slice(1, -1).split(',').forEach(pair => {
      const [k, ...v] = pair.split(':');
      if (k) obj[k.trim()] = parseScalar(v.join(':').trim());
    });
    return obj;
  }
  return parseScalar(val);
}

function parseScalar(val) {
  if (!val || val === '~' || val === 'null') return null;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  // Strip quotes
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

// --- Main ---
function main() {
  const args = process.argv.slice(2);
  let tag = 'dev';
  let outdir = path.join(__dirname, '..', 'dist', 'bundles');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tag' && args[i + 1]) tag = args[++i];
    if (args[i] === '--outdir' && args[i + 1]) outdir = args[++i];
  }

  const repoRoot = path.join(__dirname, '..');
  const registryPath = path.join(repoRoot, 'registry', 'ROLE_REGISTRY.yaml');
  const capRulesPath = path.join(repoRoot, 'registry', 'schemas', 'capability-rules.json');

  if (!fs.existsSync(registryPath)) {
    console.error('ERROR: registry/ROLE_REGISTRY.yaml not found');
    process.exit(1);
  }

  console.log(`Building bundles for tag: ${tag}`);
  console.log(`Output directory: ${outdir}`);

  // Parse registry
  const yamlText = fs.readFileSync(registryPath, 'utf8');
  const registry = parseYaml(yamlText);

  // Get source SHA from git (best-effort)
  let sourceSha = 'unknown';
  try {
    const { execSync } = require('child_process');
    sourceSha = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch (e) { /* running outside git is ok */ }

  const now = new Date().toISOString();

  // --- 1. role_registry.json ---
  const roles = {};
  if (registry.roles) {
    for (const [name, def] of Object.entries(registry.roles)) {
      if (!def || typeof def !== 'object') continue;
      roles[name] = {
        purpose: def.purpose || '',
        responsibilities: Array.isArray(def.responsibilities) ? def.responsibilities : [],
        allowed_tools: Array.isArray(def.allowed_tools) ? def.allowed_tools : [],
        hard_limits: Array.isArray(def.hard_limits) ? def.hard_limits : [],
        event_subscriptions: Array.isArray(def.event_subscriptions) ? def.event_subscriptions : [],
        default_work_queues: Array.isArray(def.default_work_queues) ? def.default_work_queues : [],
        status: def.status || 'UNKNOWN',
        priority: def.priority || 'MEDIUM',
      };
    }
  }

  const agents = {};
  if (registry.all_agents) {
    for (const [name, def] of Object.entries(registry.all_agents)) {
      if (!def || typeof def !== 'object') continue;
      agents[name] = {
        agent_id: def.agent_id || name,
        gateway: def.gateway || 'unknown',
        assigned_roles: Array.isArray(def.assigned_roles) ? def.assigned_roles : [],
        notes: def.notes || '',
      };
    }
  }

  const roleRegistry = {
    version: registry.registry_version || '1.0.0',
    generated: now,
    platform: registry.platform || 'OpenClaw',
    bundle_tag: tag,
    source_sha: sourceSha,
    roles,
    agents,
  };

  // --- 2. tools_catalog.json ---
  const toolMap = {};
  for (const [roleName, roleDef] of Object.entries(roles)) {
    for (const tool of roleDef.allowed_tools) {
      if (!toolMap[tool]) {
        toolMap[tool] = { tool, used_by_roles: [], description: `Tool: ${tool}` };
      }
      if (!toolMap[tool].used_by_roles.includes(roleName)) {
        toolMap[tool].used_by_roles.push(roleName);
      }
    }
  }
  const toolsCatalog = {
    version: roleRegistry.version,
    generated: now,
    bundle_tag: tag,
    tools: Object.values(toolMap),
  };

  // --- 3. policy_bundle.json ---
  let capRules = { forbidden_combinations: [], max_tools_per_role: 10 };
  if (fs.existsSync(capRulesPath)) {
    capRules = JSON.parse(fs.readFileSync(capRulesPath, 'utf8'));
  }

  const roleLimits = {};
  for (const [roleName, roleDef] of Object.entries(roles)) {
    roleLimits[roleName] = {
      hard_limits: roleDef.hard_limits,
      tool_count: roleDef.allowed_tools.length,
      max_tools: capRules.max_tools_per_role || 10,
    };
  }

  const policyBundle = {
    version: roleRegistry.version,
    generated: now,
    bundle_tag: tag,
    forbidden_combinations: capRules.forbidden_combinations || [],
    role_limits: roleLimits,
    gating_rules: {
      require_bundle_sha_verification: true,
      require_role_exists: true,
      require_capability_validation: true,
      require_ledger_registration: true,
      require_event_subscription: true,
      require_ready_event: true,
      fail_closed: true,
    },
  };

  // --- 4. context_bundle.json ---
  const contextBundle = {
    version: roleRegistry.version,
    generated: now,
    bundle_tag: tag,
    source_sha: sourceSha,
    platform: registry.platform || 'OpenClaw',
    boot_contract: {
      steps: [
        'Download bundles from GitHub Release for BUNDLE_TAG',
        'Verify SHA256SUMS.txt against downloaded files',
        'Load role_registry.json and confirm AGENT_ROLE exists',
        'Load policy_bundle.json and validate capabilities for role',
        'Load tools_catalog.json to determine available tools',
        'Register agent in ledger',
        'Subscribe to role-defined events',
        'Emit AGENT_READY event',
        'Start agent main process',
      ],
      fail_behavior: 'Exit non-zero if any step fails (fail-closed)',
    },
    glossary: {
      bundle_tag: 'Git tag that triggered the bundle build (e.g. registry@2026.02.11.1)',
      role: 'A named set of responsibilities, tools, and limits assigned to agents',
      capability_token: 'A token granting specific tool access for a role',
      ledger: 'Central registry of active agents and their states',
      event_bus: 'Pub/sub system for inter-agent communication',
      workspace: 'Isolated directory per agent: /workspace in container',
      manifest: 'MANIFEST.json in each workspace root tracking agent metadata',
    },
    workspace_rules: {
      isolation: 'Workspaces are NOT shared state. Each agent may ONLY access its own workspace.',
      cross_access: 'Mounting or reading another agent workspace is forbidden. Violations emit WORKSPACE_CROSS_ACCESS_DENIED.',
      coordination: 'Cross-agent coordination MUST use the ledger/event bus or an explicit shared store, never workspace files.',
      secret_guard: 'Writing secrets (.env, .pem, .key, private keys) into workspaces is blocked by safe-write guard.',
      cleanup: 'tmp/ cleaned after 7 days, logs/ capped at 7 days, bundles/ keeps last 3 tags, cache/ cleaned after 30 days.',
    },
    bundle_contents: [
      'role_registry.json',
      'tools_catalog.json',
      'policy_bundle.json',
      'context_bundle.json',
      'SHA256SUMS.txt',
    ],
  };

  // --- Write outputs ---
  fs.mkdirSync(outdir, { recursive: true });

  const files = {
    'role_registry.json': roleRegistry,
    'tools_catalog.json': toolsCatalog,
    'policy_bundle.json': policyBundle,
    'context_bundle.json': contextBundle,
  };

  const sums = [];
  for (const [filename, data] of Object.entries(files)) {
    const content = JSON.stringify(data, null, 2) + '\n';
    const filepath = path.join(outdir, filename);
    fs.writeFileSync(filepath, content);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    sums.push(`${hash}  ${filename}`);
    console.log(`  ${filename} (${content.length} bytes, sha256: ${hash.substring(0, 12)}...)`);
  }

  const sumsContent = sums.join('\n') + '\n';
  fs.writeFileSync(path.join(outdir, 'SHA256SUMS.txt'), sumsContent);
  console.log(`  SHA256SUMS.txt (${sums.length} entries)`);

  // --- Public-safe scan (MANDATORY) ---
  console.log('\nRunning public-safe scan on bundle outputs...');
  const FORBIDDEN_PATTERNS = [
    { re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, label: 'IPv4 address' },
    { re: /\b[0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){7}\b/, label: 'IPv6 address' },
    { re: /srv\d+\.hstgr\.cloud/i, label: 'Hostinger hostname' },
    { re: /hstgr\.cloud/i, label: 'hstgr.cloud pattern' },
    { re: /ssh\s+\w+@[\w.-]+/i, label: 'SSH command' },
    { re: /\b(ghp_|sk-|AKIA|xoxb-)\w+/, label: 'API key pattern' },
    { re: /BEGIN\s+(RSA\s+)?PRIVATE\s+KEY/, label: 'Private key block' },
    { re: /\/home\/\w+\//, label: 'Real filesystem path (/home/)' },
    { re: /\/root\//, label: 'Real filesystem path (/root/)' },
    { re: /\/var\/www\//, label: 'Real filesystem path (/var/www/)' },
    { re: /C:\\Users\\/i, label: 'Windows path' },
    { re: /127\.0\.0\.1:\d{4,5}/, label: 'Localhost with port' },
  ];

  let scanFails = 0;
  for (const [filename, data] of Object.entries(files)) {
    const content = JSON.stringify(data);
    for (const { re, label } of FORBIDDEN_PATTERNS) {
      const match = content.match(re);
      if (match) {
        console.error(`  FAIL: ${filename} contains ${label}: "${match[0].substring(0, 30)}..."`);
        scanFails++;
      }
    }
  }
  if (scanFails > 0) {
    console.error(`\nPUBLIC-SAFE SCAN FAILED: ${scanFails} violation(s) found in bundle outputs.`);
    console.error('Bundles must NOT contain infrastructure details. Redact before building.');
    process.exit(2);
  }
  console.log('  Public-safe scan: PASS (0 violations)');

  console.log(`\nBundle build complete: ${Object.keys(files).length + 1} files in ${outdir}`);

  // Validate: every role must have purpose and at least one tool
  let warnings = 0;
  for (const [name, role] of Object.entries(roles)) {
    if (!role.purpose) { console.warn(`  WARN: role '${name}' has no purpose`); warnings++; }
    if (role.allowed_tools.length === 0) { console.warn(`  WARN: role '${name}' has no allowed_tools`); warnings++; }
  }
  if (warnings > 0) console.warn(`\n${warnings} warning(s)`);

  return 0;
}

process.exit(main());
