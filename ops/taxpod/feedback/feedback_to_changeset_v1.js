#!/usr/bin/env node
'use strict';

/**
 * feedback_to_changeset_v1.js
 *
 * PORT4.1 — Deterministic FeedbackV1 → ChangeSetV1 transformer.
 *
 * CLI:
 *   node feedback_to_changeset_v1.js \
 *     --feedback <input_feedback.json> \
 *     --out <out_dir> \
 *     --created-utc <YYYYMMDDTHHMMSSZ>
 *
 * Exit codes:
 *   0  success
 *   2  refused validation (schema, missing fields, unknown types)
 */

const fs   = require('fs');
const path = require('path');
const {
  validateFeedback,
  normalizeFeedback,
  stableStringify,
  sha256,
} = require('./normalize_feedback_v1.js');

// ─── CLI parsing ───────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--feedback'    && args[i+1]) { opts.feedback   = args[++i]; continue; }
    if (args[i] === '--out'         && args[i+1]) { opts.out        = args[++i]; continue; }
    if (args[i] === '--created-utc' && args[i+1]) { opts.createdUtc = args[++i]; continue; }
  }
  return opts;
}

function die(code, reason) {
  process.stderr.write(JSON.stringify({ error: true, exit_code: code, reason }) + '\n');
  process.exit(code);
}

// ─── Path conversion ──────────────────────────────────────────
// Converts CPA-style paths like "tax_years[year=2022].interest"
// to RFC6901 JSON pointers like "/liability_summary/tax_years/0/interest".
// The array index is always 0 since we target the first matching year.
// The json_root prefix (e.g. /liability_summary) is prepended based on
// the artifact type — this ensures the pointer resolves correctly against
// the actual runtime JSON file (e.g. payment_plan_model.json).

const ARTIFACT_JSON_ROOT = {
  LIABILITY_SNAPSHOT: '/liability_summary',
};

function feedbackPathToJsonPointer(fbPath, artifact) {
  if (!fbPath) return undefined;
  // Replace array bracket notation: tax_years[year=2022] → tax_years/0
  let p = fbPath.replace(/\[year=\d+\]/g, '/0');
  // Replace dots with slashes
  p = p.replace(/\./g, '/');
  // Ensure leading slash
  if (!p.startsWith('/')) p = '/' + p;
  // Prepend artifact json_root if applicable
  const root = ARTIFACT_JSON_ROOT[artifact];
  if (root) p = root + p;
  return p;
}

// ─── Cascade rules ────────────────────────────────────────────
// Each feedback type produces specific cascade markers.

const CASCADE_RULES = {
  LIABILITY_CORRECTION: [
    {
      action_type: 'REQUIRE_RERUN_PORT2',
      target: { artifact: 'STRATEGY' },
      reason: 'Liability snapshot changed; strategy must be recalculated with updated total.',
    },
    {
      action_type: 'REQUIRE_REBUILD_PORT3',
      target: { artifact: 'PACKAGE' },
      reason: 'Upstream artifacts changed; CPA package must be rebuilt.',
    },
  ],
  MISSING_DOC: [
    {
      action_type: 'REQUIRE_REEXPORT_BUNDLE',
      target: { artifact: 'PACKAGE' },
      reason: 'New documents must be added to the bundle before package rebuild.',
    },
    {
      action_type: 'REQUIRE_REBUILD_PORT3',
      target: { artifact: 'PACKAGE' },
      reason: 'Bundle contents changed; CPA package must be rebuilt to include new document references.',
    },
  ],
  DISPUTE_OR_UNCERTAIN: [
    {
      action_type: 'REQUIRE_REEXPORT_BUNDLE',
      target: { artifact: 'PACKAGE' },
      reason: 'Verification flag added; bundle must be re-exported to reflect updated case status.',
    },
  ],
  STRATEGY_OVERRIDE_NOTE: [
    {
      action_type: 'REQUIRE_REBUILD_PORT3',
      target: { artifact: 'PACKAGE' },
      reason: 'Strategy note changed; CPA package must be rebuilt.',
    },
  ],
  PAYMENT_CAPACITY_ASSUMPTION_FIX: [
    {
      action_type: 'REQUIRE_RERUN_PORT1',
      target: { artifact: 'PAYMENT_MODEL' },
      reason: 'Payment capacity assumption changed; payment model must be recalculated.',
    },
    {
      action_type: 'REQUIRE_RERUN_PORT2',
      target: { artifact: 'STRATEGY' },
      reason: 'Payment model changed; strategy must be recalculated.',
    },
    {
      action_type: 'REQUIRE_REBUILD_PORT3',
      target: { artifact: 'PACKAGE' },
      reason: 'Upstream artifacts changed; CPA package must be rebuilt.',
    },
  ],
};

// ─── Action generators per feedback type ──────────────────────

function generateActions_LIABILITY_CORRECTION(item) {
  const actions = [];
  const jsonPointer = feedbackPathToJsonPointer(item.target.path, item.target.artifact);

  actions.push({
    action_type: 'PATCH_JSON',
    source_item_id: item.item_id,
    target: {
      artifact: item.target.artifact,
      path: jsonPointer,
      year: item.target.year,
    },
    patch: {
      op: 'replace',
      path: jsonPointer,
      value: item.proposed_change.new_value,
      old_value: item.proposed_change.old_value,
    },
    reason: item.evidence.notes,
    requires_human_approval: true,
  });

  return actions;
}

function generateActions_MISSING_DOC(item) {
  const actions = [];

  actions.push({
    action_type: 'ADD_DOC_REFERENCE',
    source_item_id: item.item_id,
    target: {
      artifact: item.target.artifact,
      year: item.target.year,
      doc_id: item.proposed_change.doc_name,
    },
    reason: item.proposed_change.reason,
    requires_human_approval: true,
  });

  return actions;
}

function generateActions_DISPUTE_OR_UNCERTAIN(item) {
  const actions = [];

  actions.push({
    action_type: 'ADD_FLAG',
    source_item_id: item.item_id,
    target: {
      artifact: item.target.artifact,
      year: item.target.year,
    },
    flag: {
      name: item.proposed_change.flag,
      scope: item.proposed_change.scope,
      year: item.target.year,
    },
    reason: item.proposed_change.reason,
    requires_human_approval: true,
  });

  return actions;
}

function generateActions_STRATEGY_OVERRIDE_NOTE(item) {
  const jsonPointer = feedbackPathToJsonPointer(item.target.path, item.target.artifact);

  return [{
    action_type: 'PATCH_JSON',
    source_item_id: item.item_id,
    target: {
      artifact: item.target.artifact,
      path: jsonPointer,
    },
    patch: {
      op: 'replace',
      path: jsonPointer,
      value: item.proposed_change.new_value,
      old_value: item.proposed_change.old_value,
    },
    reason: item.evidence.notes,
    requires_human_approval: true,
  }];
}

function generateActions_PAYMENT_CAPACITY_ASSUMPTION_FIX(item) {
  const jsonPointer = feedbackPathToJsonPointer(item.target.path, item.target.artifact);

  return [{
    action_type: 'PATCH_JSON',
    source_item_id: item.item_id,
    target: {
      artifact: item.target.artifact,
      path: jsonPointer,
    },
    patch: {
      op: 'replace',
      path: jsonPointer,
      value: item.proposed_change.new_value,
      old_value: item.proposed_change.old_value,
    },
    reason: item.evidence.notes,
    requires_human_approval: true,
  }];
}

const ACTION_GENERATORS = {
  LIABILITY_CORRECTION: generateActions_LIABILITY_CORRECTION,
  MISSING_DOC: generateActions_MISSING_DOC,
  DISPUTE_OR_UNCERTAIN: generateActions_DISPUTE_OR_UNCERTAIN,
  STRATEGY_OVERRIDE_NOTE: generateActions_STRATEGY_OVERRIDE_NOTE,
  PAYMENT_CAPACITY_ASSUMPTION_FIX: generateActions_PAYMENT_CAPACITY_ASSUMPTION_FIX,
};

// ─── Main transform ──────────────────────────────────────────

function feedbackToChangeset(feedback, createdUtc) {
  const norm = normalizeFeedback(feedback);

  // Validate
  const errors = validateFeedback(norm);
  if (errors.length > 0) {
    die(2, 'Validation failed: ' + errors.join('; '));
  }

  // Check for unsupported types
  for (const item of norm.items) {
    if (!ACTION_GENERATORS[item.type]) {
      die(2, `Unknown feedback type: "${item.type}". Supported: ${Object.keys(ACTION_GENERATORS).join(', ')}`);
    }
  }

  // Generate per-item actions (content actions first, cascades collected separately)
  const contentActions = [];
  const cascadeActions = [];
  const cascadeSet = new Set(); // dedup cascade markers by action_type

  for (const item of norm.items) {
    const gen = ACTION_GENERATORS[item.type];
    const itemActions = gen(item);
    contentActions.push(...itemActions);

    // Collect cascade markers for this item's type (dedup by action_type)
    const rules = CASCADE_RULES[item.type] || [];
    for (const rule of rules) {
      if (!cascadeSet.has(rule.action_type)) {
        cascadeSet.add(rule.action_type);
        cascadeActions.push({
          source_item_id: item.item_id,
          action_type: rule.action_type,
          target: { ...rule.target },
          reason: rule.reason,
          requires_human_approval: true,
        });
      }
    }
  }

  // Content actions first, then cascade markers — assign sequential action_ids
  // Build with action_id as the FIRST key for deterministic JSON output
  const allActions = [];
  const rawActions = [...contentActions, ...cascadeActions];
  for (let i = 0; i < rawActions.length; i++) {
    const raw = rawActions[i];
    const ordered = { action_id: `act_${String(i + 1).padStart(3, '0')}` };
    // Copy source_item_id first, then action_type, then rest
    ordered.source_item_id = raw.source_item_id;
    ordered.action_type = raw.action_type;
    ordered.target = raw.target;
    if (raw.patch) ordered.patch = raw.patch;
    if (raw.flag) ordered.flag = raw.flag;
    ordered.reason = raw.reason;
    ordered.requires_human_approval = raw.requires_human_approval;
    allActions.push(ordered);
  }

  // Compute derived_impacts (sorted, unique)
  const impacts = [...cascadeSet].sort();

  // Build changeset
  const changeset = {
    version: 'ChangeSetV1',
    changeset_id: `${norm.case_id}_cs_${createdUtc}`,
    case_id: norm.case_id,
    created_utc: createdUtc,
    source_feedback_id: norm.feedback_id,
    package_manifest_sha256: norm.package_manifest_sha256,
    actions: allActions,
    derived_impacts: impacts,
    audit: {
      input_feedback_sha256: sha256(stableStringify(norm)),
      changeset_sha256: '',
    },
  };

  // Compute changeset hash (with changeset_sha256 = '' as placeholder)
  changeset.audit.changeset_sha256 = sha256(stableStringify(changeset));

  return changeset;
}

// ─── Atomic write ─────────────────────────────────────────────

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

// ─── main ─────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();

  if (!opts.feedback) die(2, 'Missing --feedback <path>');
  if (!opts.out)      die(2, 'Missing --out <dir>');
  if (!opts.createdUtc) die(2, 'Missing --created-utc <UTC>');

  // Validate UTC format
  if (!/^[0-9]{8}T[0-9]{6}Z$/.test(opts.createdUtc)) {
    die(2, `Invalid --created-utc format: "${opts.createdUtc}". Expected YYYYMMDDTHHMMSSZ`);
  }

  // Load feedback
  let raw;
  try {
    raw = fs.readFileSync(opts.feedback, 'utf8');
  } catch (e) {
    die(2, `Cannot read feedback file: ${opts.feedback}: ${e.message}`);
  }

  let feedback;
  try {
    feedback = JSON.parse(raw);
  } catch (e) {
    die(2, `Invalid JSON in feedback file: ${e.message}`);
  }

  // Transform
  const changeset = feedbackToChangeset(feedback, opts.createdUtc);

  // Ensure output directory exists
  fs.mkdirSync(opts.out, { recursive: true });

  // Write output
  const outPath = path.join(opts.out, 'changeset.json');
  atomicWrite(outPath, JSON.stringify(changeset, null, 2) + '\n');

  // Print summary to stdout
  const summary = {
    result: 'OK',
    changeset_id: changeset.changeset_id,
    changeset_path: outPath,
    actions_count: changeset.actions.length,
    derived_impacts: changeset.derived_impacts,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main();
