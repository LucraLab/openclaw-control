#!/usr/bin/env node
'use strict';

/**
 * Apply Door V1 — The ONLY writer for TaxPod runtime artifacts.
 *
 * Takes a validated ChangeSetV1 and atomically applies proposed changes
 * to runtime artifacts under /home/openclaw/.openclaw/tax_work/<case>/.
 *
 * Fail-closed: any ambiguity refuses. No partial writes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--changeset':    args.changeset = argv[++i]; break;
      case '--case':         args.caseId = argv[++i]; break;
      case '--approve-proof': args.approveProof = argv[++i]; break;
      case '--approve-proof-sha256': args.approveProofSha256 = argv[++i]; break;
      case '--out':          args.out = argv[++i]; break;
      case '--dry-run':      args.dryRun = true; break;
      case '--runtime-root': args.runtimeRoot = argv[++i]; break;
      case '--created-utc':  args.createdUtc = argv[++i]; break;
      default:
        die(2, `Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(code, msg) {
  process.stderr.write(JSON.stringify({ error: true, exit_code: code, reason: msg }) + '\n');
  process.exit(code);
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256Str(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function stableStringify(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

/**
 * Resolve a JSON pointer (RFC6901) against an object.
 * Returns { parent, key, value } or null if path doesn't exist.
 */
function resolvePointer(obj, pointer) {
  if (!pointer || pointer === '/') return { parent: null, key: null, value: obj };
  const parts = pointer.split('/').slice(1); // drop leading empty string
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i].replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || current === undefined) return null;
    if (Array.isArray(current)) {
      const idx = parseInt(seg, 10);
      if (isNaN(idx) || idx < 0 || idx >= current.length) return null;
      if (i === parts.length - 1) {
        return { parent: current, key: idx, value: current[idx] };
      }
      current = current[idx];
    } else if (typeof current === 'object') {
      if (!(seg in current)) {
        if (i === parts.length - 1) {
          // Key doesn't exist — for "add" op this is ok
          return { parent: current, key: seg, value: undefined };
        }
        return null;
      }
      if (i === parts.length - 1) {
        return { parent: current, key: seg, value: current[seg] };
      }
      current = current[seg];
    } else {
      return null;
    }
  }
  return null;
}

/**
 * Set a value at a JSON pointer path.
 */
function setAtPointer(obj, pointer, value) {
  const resolved = resolvePointer(obj, pointer);
  if (!resolved || !resolved.parent) return false;
  resolved.parent[resolved.key] = value;
  return true;
}

/**
 * Atomic write: write to temp file then rename.
 */
function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp_${crypto.randomBytes(8).toString('hex')}`);
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Load allowlist
// ---------------------------------------------------------------------------

function loadAllowlist() {
  const allowlistPath = path.join(__dirname, 'apply_allowlist.json');
  if (!fs.existsSync(allowlistPath)) die(4, 'apply_allowlist.json not found');
  return JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Gate functions
// ---------------------------------------------------------------------------

/** Gate 1: Parse and validate changeset structure */
function gate1_parseChangeset(changesetPath) {
  if (!changesetPath) die(2, 'Missing --changeset argument');
  if (!fs.existsSync(changesetPath)) die(2, `Changeset file not found: ${changesetPath}`);
  let cs;
  try {
    cs = JSON.parse(fs.readFileSync(changesetPath, 'utf8'));
  } catch (e) {
    die(2, `Changeset is not valid JSON: ${e.message}`);
  }
  // Structural checks
  if (cs.version !== 'ChangeSetV1') die(2, `Expected version ChangeSetV1, got ${cs.version}`);
  const required = ['changeset_id', 'case_id', 'created_utc', 'source_feedback_id',
                     'package_manifest_sha256', 'actions', 'derived_impacts', 'audit'];
  for (const field of required) {
    if (!(field in cs)) die(2, `Missing required field: ${field}`);
  }
  if (!Array.isArray(cs.actions) || cs.actions.length === 0) {
    die(2, 'Changeset must have at least one action');
  }
  return cs;
}

/** Gate 2: Case ID match */
function gate2_caseIdMatch(cs, caseId) {
  if (!caseId) die(2, 'Missing --case argument');
  if (cs.case_id !== caseId) {
    die(2, `Case ID mismatch: changeset has "${cs.case_id}", --case is "${caseId}"`);
  }
}

/** Gate 3: Approval proof */
function gate3_approvalProof(approveProofPath, approveProofSha256) {
  if (!approveProofPath) die(3, 'Missing --approve-proof argument');
  if (!approveProofSha256) die(3, 'Missing --approve-proof-sha256 argument');
  if (!fs.existsSync(approveProofPath)) {
    die(3, `Approval proof file not found: ${approveProofPath}`);
  }
  const actualSha = sha256File(approveProofPath);
  if (actualSha !== approveProofSha256) {
    die(3, `Approval proof SHA-256 mismatch: expected ${approveProofSha256}, got ${actualSha}`);
  }
}

/** Gate 4: Human approval check */
function gate4_humanApproval(cs) {
  for (const action of cs.actions) {
    if (action.requires_human_approval !== true) {
      die(3, `Action ${action.action_id} does not have requires_human_approval: true`);
    }
  }
}

/** Gate 5: Action allowlist + Gate 6: Destructive op check */
function gate5and6_allowlist(cs, allowlist) {
  const allowedTypes = Object.keys(allowlist.allowed_action_types);
  const refusedTypes = Object.keys(allowlist.refused_action_types || {});

  for (const action of cs.actions) {
    // Check refused types first
    if (refusedTypes.includes(action.action_type)) {
      die(2, `Action type ${action.action_type} is refused in V1: ${allowlist.refused_action_types[action.action_type]}`);
    }
    // Check allowed types
    if (!allowedTypes.includes(action.action_type)) {
      die(2, `Action type ${action.action_type} is not in the allowlist`);
    }
    // Cascade markers (REQUIRE_*) are allowed to reference any artifact — they only write marker files
    const isCascadeMarker = ['REQUIRE_REEXPORT_BUNDLE', 'REQUIRE_RERUN_PORT1',
                              'REQUIRE_RERUN_PORT2', 'REQUIRE_REBUILD_PORT3'].includes(action.action_type);

    // Check target artifact for PACKAGE refusal (only for mutation actions, not cascade markers)
    if (!isCascadeMarker && action.target && action.target.artifact === 'PACKAGE') {
      const artifactConfig = allowlist.allowed_artifacts.PACKAGE;
      if (artifactConfig && artifactConfig.runtime_path === null) {
        die(2, `Target artifact PACKAGE is refused for ${action.action_type}: ${artifactConfig.notes}`);
      }
    }
    // For PATCH_JSON: check op and path
    if (action.action_type === 'PATCH_JSON') {
      if (!action.patch) die(2, `PATCH_JSON action ${action.action_id} missing patch field`);
      const allowedOps = allowlist.allowed_action_types.PATCH_JSON.allowed_ops;
      if (!allowedOps.includes(action.patch.op)) {
        die(2, `Patch op "${action.patch.op}" is not allowed. Allowed: ${allowedOps.join(', ')}`);
      }
      // Resolve artifact config
      const artifactName = action.target.artifact;
      const artifactConfig = allowlist.allowed_artifacts[artifactName];
      if (!artifactConfig) die(2, `Unknown artifact: ${artifactName}`);
      if (artifactConfig.runtime_path === null) die(2, `Artifact ${artifactName} is refused`);
      // Check path against allowed prefixes
      const patchPath = action.patch.path;
      const allowedPrefixes = artifactConfig.allowed_path_prefixes || [];
      const refusedPrefixes = artifactConfig.refused_path_prefixes || [];
      // Check refused first
      for (const prefix of refusedPrefixes) {
        if (patchPath.startsWith(prefix)) {
          die(2, `Path ${patchPath} matches refused prefix ${prefix} for artifact ${artifactName}`);
        }
      }
      // Check at least one allowed prefix matches
      const pathAllowed = allowedPrefixes.some(prefix => patchPath.startsWith(prefix));
      if (!pathAllowed) {
        die(2, `Path ${patchPath} does not match any allowed prefix for artifact ${artifactName}. Allowed: ${allowedPrefixes.join(', ')}`);
      }
    }
  }
}

/** Gate 7: Resolve targets + drift detection. Returns file map. */
function gate7_resolveAndDrift(cs, runtimeRoot, caseId, allowlist) {
  const caseRoot = path.join(runtimeRoot, 'tax_work', caseId);
  // Map of artifact -> { filePath, data, originalContent }
  const fileMap = {};

  for (const action of cs.actions) {
    if (action.action_type === 'PATCH_JSON') {
      const artifactName = action.target.artifact;
      const artifactConfig = allowlist.allowed_artifacts[artifactName];
      const relPath = artifactConfig.runtime_path;
      const filePath = path.join(caseRoot, relPath);

      // Load file if not already loaded
      if (!fileMap[filePath]) {
        if (!fs.existsSync(filePath)) {
          die(2, `Target file not found: ${filePath}`);
        }
        const content = fs.readFileSync(filePath, 'utf8');
        fileMap[filePath] = {
          filePath,
          originalContent: content,
          preSha256: sha256Str(content),
          data: JSON.parse(content)
        };
      }

      // Drift detection
      const resolved = resolvePointer(fileMap[filePath].data, action.patch.path);
      if (!resolved) {
        die(2, `Cannot resolve path ${action.patch.path} in ${filePath}`);
      }
      if (action.patch.op === 'replace') {
        // For replace, old_value must match current value
        const current = resolved.value;
        const expected = action.patch.old_value;
        if (JSON.stringify(current) !== JSON.stringify(expected)) {
          die(2, `Drift detected at ${action.patch.path}: expected old_value=${JSON.stringify(expected)}, found=${JSON.stringify(current)}`);
        }
      } else if (action.patch.op === 'add') {
        // For add, the key should not already exist (or value should be undefined)
        if (resolved.value !== undefined) {
          die(2, `Add target ${action.patch.path} already exists with value ${JSON.stringify(resolved.value)}`);
        }
      }
    }

    // For flag operations, load the relevant file
    if (action.action_type === 'ADD_FLAG' || action.action_type === 'REMOVE_FLAG') {
      const artifactName = action.target.artifact;
      // Flags can target PAYMENT_MODEL or STRATEGY (not PACKAGE)
      if (artifactName === 'PACKAGE') {
        // For PACKAGE-targeted flags, we store in a flags file under the case
        const flagsPath = path.join(caseRoot, 'flags.json');
        if (!fileMap[flagsPath]) {
          let content = '{"flags":[]}\n';
          if (fs.existsSync(flagsPath)) {
            content = fs.readFileSync(flagsPath, 'utf8');
          }
          fileMap[flagsPath] = {
            filePath: flagsPath,
            originalContent: content,
            preSha256: sha256Str(content),
            data: JSON.parse(content),
            isNew: !fs.existsSync(flagsPath)
          };
        }
      } else {
        const artifactConfig = allowlist.allowed_artifacts[artifactName];
        if (!artifactConfig || artifactConfig.runtime_path === null) {
          die(2, `Cannot add flag to refused artifact: ${artifactName}`);
        }
        const relPath = artifactConfig.runtime_path;
        const filePath = path.join(caseRoot, relPath);
        if (!fileMap[filePath]) {
          if (!fs.existsSync(filePath)) {
            die(2, `Target file not found for flag operation: ${filePath}`);
          }
          const content = fs.readFileSync(filePath, 'utf8');
          fileMap[filePath] = {
            filePath,
            originalContent: content,
            preSha256: sha256Str(content),
            data: JSON.parse(content)
          };
        }
      }
    }
  }

  return fileMap;
}

/** Gate 8: Apply actions (or dry-run) */
function gate8_apply(cs, fileMap, runtimeRoot, caseId, dryRun, allowlist) {
  const caseRoot = path.join(runtimeRoot, 'tax_work', caseId);
  const actionsApplied = [];
  const markerFiles = [];

  for (const action of cs.actions) {
    if (action.action_type === 'PATCH_JSON') {
      const artifactName = action.target.artifact;
      const artifactConfig = allowlist.allowed_artifacts[artifactName];
      const filePath = path.join(caseRoot, artifactConfig.runtime_path);
      const entry = fileMap[filePath];

      setAtPointer(entry.data, action.patch.path, action.patch.value);

      actionsApplied.push({
        action_id: action.action_id,
        action_type: 'PATCH_JSON',
        target_file: artifactConfig.runtime_path,
        patch_path: action.patch.path,
        result: dryRun ? 'WOULD_APPLY' : 'APPLIED'
      });

    } else if (action.action_type === 'ADD_FLAG') {
      const artifactName = action.target.artifact;
      let entry;
      if (artifactName === 'PACKAGE') {
        const flagsPath = path.join(caseRoot, 'flags.json');
        entry = fileMap[flagsPath];
        if (!entry.data.flags) entry.data.flags = [];
        const flagObj = action.flag || { name: 'UNKNOWN' };
        // Deduplicate by name+scope+year
        const exists = entry.data.flags.some(f =>
          f.name === flagObj.name && f.scope === flagObj.scope && f.year === flagObj.year
        );
        if (!exists) {
          entry.data.flags.push(flagObj);
          entry.data.flags.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }
        actionsApplied.push({
          action_id: action.action_id,
          action_type: 'ADD_FLAG',
          target_file: 'flags.json',
          result: dryRun ? 'WOULD_APPLY' : 'APPLIED'
        });
      } else {
        const artifactConfig = allowlist.allowed_artifacts[artifactName];
        const filePath = path.join(caseRoot, artifactConfig.runtime_path);
        entry = fileMap[filePath];
        if (!entry.data.risk_flags) entry.data.risk_flags = [];
        const flagName = action.flag ? action.flag.name : null;
        if (flagName && !entry.data.risk_flags.includes(flagName)) {
          entry.data.risk_flags.push(flagName);
          entry.data.risk_flags.sort();
        }
        actionsApplied.push({
          action_id: action.action_id,
          action_type: 'ADD_FLAG',
          target_file: artifactConfig.runtime_path,
          result: dryRun ? 'WOULD_APPLY' : 'APPLIED'
        });
      }

    } else if (action.action_type === 'REMOVE_FLAG') {
      const artifactName = action.target.artifact;
      const artifactConfig = allowlist.allowed_artifacts[artifactName];
      if (artifactConfig && artifactConfig.runtime_path) {
        const filePath = path.join(caseRoot, artifactConfig.runtime_path);
        const entry = fileMap[filePath];
        if (entry.data.risk_flags && action.flag) {
          entry.data.risk_flags = entry.data.risk_flags.filter(f => f !== action.flag.name);
        }
        actionsApplied.push({
          action_id: action.action_id,
          action_type: 'REMOVE_FLAG',
          target_file: artifactConfig.runtime_path,
          result: dryRun ? 'WOULD_APPLY' : 'APPLIED'
        });
      }

    } else if (action.action_type === 'ADD_DOC_REFERENCE') {
      // Write a reference metadata stub
      const docId = action.target.doc_id || `doc_ref_${action.action_id}`;
      const refPath = path.join(caseRoot, 'doc_references', `${docId}.json`);
      const refStub = {
        doc_id: docId,
        added_by_changeset: cs.changeset_id,
        reason: action.reason,
        target_year: action.target.year || null,
        added_utc: cs.created_utc
      };
      fileMap[refPath] = {
        filePath: refPath,
        originalContent: '',
        preSha256: sha256Str(''),
        data: refStub,
        isNew: true
      };
      actionsApplied.push({
        action_id: action.action_id,
        action_type: 'ADD_DOC_REFERENCE',
        target_file: `doc_references/${docId}.json`,
        result: dryRun ? 'WOULD_APPLY' : 'APPLIED'
      });

    } else if (['REQUIRE_REEXPORT_BUNDLE', 'REQUIRE_RERUN_PORT1',
                 'REQUIRE_RERUN_PORT2', 'REQUIRE_REBUILD_PORT3'].includes(action.action_type)) {
      // Write marker file
      const markerName = `.${action.action_type.toLowerCase()}`;
      const markerPath = path.join(caseRoot, markerName);
      markerFiles.push({
        path: markerPath,
        content: JSON.stringify({
          marker: action.action_type,
          changeset_id: cs.changeset_id,
          created_utc: cs.created_utc,
          reason: action.reason
        }, null, 2) + '\n'
      });
      actionsApplied.push({
        action_id: action.action_id,
        action_type: action.action_type,
        target_file: markerName,
        result: dryRun ? 'WOULD_APPLY' : 'APPLIED'
      });
    }
  }

  // Sort actions_applied by action_id for determinism
  actionsApplied.sort((a, b) => a.action_id.localeCompare(b.action_id));

  // Now do atomic writes (unless dry-run)
  if (!dryRun) {
    // Write modified JSON files
    for (const key of Object.keys(fileMap).sort()) {
      const entry = fileMap[key];
      const newContent = stableStringify(entry.data);
      atomicWrite(entry.filePath, newContent);
      entry.postSha256 = sha256Str(newContent);
    }
    // Write marker files
    for (const marker of markerFiles) {
      atomicWrite(marker.path, marker.content);
    }
  } else {
    // Dry run: compute post hashes without writing
    for (const key of Object.keys(fileMap).sort()) {
      const entry = fileMap[key];
      const newContent = stableStringify(entry.data);
      entry.postSha256 = sha256Str(newContent);
    }
  }

  return actionsApplied;
}

/** Gate 9: Write receipt + audit JSONL */
function gate9_audit(cs, actionsApplied, fileMap, args, runtimeRoot, caseId, dryRun) {
  const createdUtc = args.createdUtc || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const changesetSha256 = sha256File(args.changeset);
  const approveProofSha256 = args.approveProofSha256;

  // Receipt ID: deterministic hash of changeset_id + approve_proof_sha256 + created_utc
  const receiptId = sha256Str(`${cs.changeset_id}:${approveProofSha256}:${createdUtc}`);

  // Build files array (sorted by path)
  const files = [];
  for (const key of Object.keys(fileMap).sort()) {
    const entry = fileMap[key];
    const caseRoot = path.join(runtimeRoot, 'tax_work', caseId);
    const relPath = path.relative(caseRoot, entry.filePath);
    files.push({
      path: relPath,
      pre_sha256: entry.preSha256,
      post_sha256: entry.postSha256 || entry.preSha256
    });
  }

  const receipt = {
    receipt_id: receiptId,
    case_id: caseId,
    created_utc: createdUtc,
    changeset_id: cs.changeset_id,
    changeset_sha256: changesetSha256,
    package_manifest_sha256: cs.package_manifest_sha256,
    approve_proof_sha256: approveProofSha256,
    dry_run: dryRun,
    result: dryRun ? 'DRY_RUN' : 'APPLIED',
    refusal_reason: null,
    actions_applied: actionsApplied,
    files: files
  };

  // Write receipt
  const outDir = args.out || path.join(runtimeRoot, 'tax_work', caseId, 'audit');
  const receiptPath = path.join(outDir, 'apply_receipt.json');
  const receiptContent = stableStringify(receipt);

  if (!dryRun) {
    atomicWrite(receiptPath, receiptContent);
  } else {
    // Even in dry-run, write the receipt (it documents the dry run)
    atomicWrite(receiptPath, receiptContent);
  }

  // Append audit JSONL
  const auditDir = path.join(runtimeRoot, 'audit');
  const auditPath = path.join(auditDir, 'taxpod_apply.jsonl');
  const auditLine = JSON.stringify({
    event: 'APPLY',
    utc: createdUtc,
    case_id: caseId,
    changeset_id: cs.changeset_id,
    result: dryRun ? 'DRY_RUN' : 'APPLIED',
    receipt_id: receiptId,
    dry_run: dryRun
  }) + '\n';

  fs.mkdirSync(auditDir, { recursive: true });
  fs.appendFileSync(auditPath, auditLine, 'utf8');

  return { receipt, receiptPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  const runtimeRoot = args.runtimeRoot || '/home/openclaw/.openclaw';
  const dryRun = args.dryRun || false;

  // Load allowlist
  const allowlist = loadAllowlist();

  // Gate 1: Parse changeset
  const cs = gate1_parseChangeset(args.changeset);

  // Gate 2: Case ID match
  gate2_caseIdMatch(cs, args.caseId);

  // Gate 3: Approval proof
  gate3_approvalProof(args.approveProof, args.approveProofSha256);

  // Gate 4: Human approval on all actions
  gate4_humanApproval(cs);

  // Gate 5 + 6: Allowlist + destructive op check
  gate5and6_allowlist(cs, allowlist);

  // Gate 7: Resolve targets + drift detection
  const fileMap = gate7_resolveAndDrift(cs, runtimeRoot, args.caseId, allowlist);

  // Gate 8: Apply (or dry-run)
  const actionsApplied = gate8_apply(cs, fileMap, runtimeRoot, args.caseId, dryRun, allowlist);

  // Gate 9: Audit
  const { receipt, receiptPath } = gate9_audit(cs, actionsApplied, fileMap, args, runtimeRoot, args.caseId, dryRun);

  // Success output
  process.stdout.write(stableStringify({
    result: dryRun ? 'DRY_RUN' : 'APPLIED',
    receipt_id: receipt.receipt_id,
    receipt_path: receiptPath,
    actions_count: actionsApplied.length,
    dry_run: dryRun
  }));

  process.exit(0);
}

main();
