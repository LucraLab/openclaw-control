#!/usr/bin/env node
/**
 * executive_evidence_graph.js — Evidence Graph v1 (Port #14)
 *
 * Deterministic evidence graph that explains exactly why the Executive Strategy
 * Engine scored each objective the way it did, how hint deltas were derived,
 * and what the arbiter reordering looks like.
 *
 * Receipts-first: every derived change points to a rule that fired
 * and a supporting evidence source.
 *
 * Safety guarantees:
 *   - Fail closed: returns minimal safe graph on any error
 *   - No secrets: sanitizes all string output via SECRET_PATTERN
 *   - No shared mutable state: pure function (report, hints, context) → graph
 *   - No network calls, no LLM, no shelling out
 *   - Deterministic: same inputs → identical output (caller supplies computed_at)
 */

'use strict';

const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════════════════════

const GRAPH_VERSION = 'v1';

const FORCED_ZERO_REASONS = [
  'NONE',
  'KILL_SWITCH',
  'QUARANTINE',
  'LOW_CONFIDENCE',
  'HIGH_RISK',
  'SCHEMA_INVALID',
];

const DERIVATION_KINDS = ['BASE', 'DELTA', 'OVERRIDE', 'CLAMP'];

const DERIVATION_TARGETS = [
  'priority_score',
  'risk_score',
  'confidence',
  'recommended_action',
  'rank_delta_hint',
];

const EVIDENCE_SOURCES = [
  'drift',
  'budget',
  'arbitration',
  'quarantine',
  'kill_switch',
  'event_log',
  'hints',
];

const SIGNAL_SEVERITIES = ['low', 'med', 'high'];

const SIGNAL_LENSES = ['dev', 'ops', 'business'];

const RECOMMENDATION_CODES = ['STOP', 'HOLD', 'INVESTIGATE', 'PLAN', 'FOCUS', 'CONTAIN'];

const LIMITS = {
  max_objectives: 10000,
  max_derivations: 40,
  max_signals: 30,
  max_evidence_per_derivation: 10,
  max_string_length: 500,
};

// ═══════════════════════════════════════════════════════════════════════════
// Secret sanitization (same pattern as executive_strategy_engine.js)
// ═══════════════════════════════════════════════════════════════════════════

const SECRET_PATTERN = /(sk-[a-zA-Z0-9]{10,}|ghp_[a-zA-Z0-9]{20,}|pit-[a-zA-Z0-9]{10,}|AKIA[A-Z0-9]{10,}|eyJ[a-zA-Z0-9._-]{20,}|Bearer\s+\S{10,}|token=[^\s&]{10,}|key=[^\s&]{10,}|password=[^\s&]+|secret=[^\s&]+|-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----)/gi;

function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(SECRET_PATTERN, '[REDACTED]');
}

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic hashing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deterministic JSON serialization with recursively sorted keys.
 * Guarantees identical output for semantically equivalent objects.
 */
function sortedStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(sortedStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => JSON.stringify(k) + ':' + sortedStringify(obj[k]));
  return '{' + parts.join(',') + '}';
}

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function truncStr(str, max) {
  max = max || LIMITS.max_string_length;
  if (typeof str !== 'string') return '';
  const s = sanitize(str);
  return s.length > max ? s.slice(0, max) : s;
}

/** Classify a lens signal string into an evidence source. */
function classifySource(signalText) {
  const t = (signalText || '').toLowerCase();
  if (t.includes('drift')) return 'drift';
  if (t.includes('budget') || t.includes('cost') || t.includes('spend')) return 'budget';
  if (t.includes('quarantin')) return 'quarantine';
  if (t.includes('kill switch') || t.includes('kill_switch')) return 'kill_switch';
  if (t.includes('fail') || t.includes('event') || t.includes('retry') || t.includes('churn')) return 'event_log';
  if (t.includes('hint') || t.includes('rank_delta')) return 'hints';
  return 'arbitration';
}

/** Classify severity from absolute delta magnitude. */
function classifySeverity(absDelta) {
  if (absDelta >= 15) return 'high';
  if (absDelta >= 5) return 'med';
  return 'low';
}

function clampScore(v) { return Math.max(0, Math.min(100, Math.round(v))); }
function clampConfidence(v) { return Math.max(0, Math.min(1, parseFloat(v.toFixed(3)))); }

// Mirrors executive_strategy_hints.js RECOMMENDATION_MAP
const RECOMMENDATION_MAP = {
  STOP: 'STOP',
  HOLD: 'HOLD',
  INVESTIGATE: 'INVESTIGATE',
  RETRY: 'PLAN',
  PROCEED: 'FOCUS',
  DEPRIORITIZE: 'CONTAIN',
};

/** Compute rank_delta_hint from priority_score. Mirrors hints module. */
function computeRankDelta(priorityScore) {
  const raw = Math.round((priorityScore - 50) / 5);
  return Math.max(-10, Math.min(10, raw));
}

/**
 * Determine the forced-zero reason for an objective result.
 * Returns 'NONE' if no safety override applies.
 */
function detectForcedZero(objResult) {
  if (objResult.recommended_action === 'STOP') return 'KILL_SWITCH';
  if (objResult.recommended_action === 'HOLD') return 'QUARANTINE';
  if (objResult.confidence < 0.4) return 'LOW_CONFIDENCE';
  if (objResult.risk_score >= 90) return 'HIGH_RISK';
  return 'NONE';
}

// ═══════════════════════════════════════════════════════════════════════════
// Derivation chain builder
// ═══════════════════════════════════════════════════════════════════════════

function buildDerivations(objResult, hintsValid, hasHints) {
  const derivations = [];

  // ── 1. BASE derivations ──────────────────────────────────────────────
  derivations.push({
    kind: 'BASE', target: 'priority_score', from: null, to: 50,
    rule: 'Default base score (schema.makeDefaultResult)',
    evidence: [{ source: 'arbitration', ref: 'Schema default: priority_score=50' }],
  });
  derivations.push({
    kind: 'BASE', target: 'risk_score', from: null, to: 50,
    rule: 'Default base score (schema.makeDefaultResult)',
    evidence: [{ source: 'arbitration', ref: 'Schema default: risk_score=50' }],
  });
  derivations.push({
    kind: 'BASE', target: 'confidence', from: null, to: 0.5,
    rule: 'Default base score (schema.makeDefaultResult)',
    evidence: [{ source: 'arbitration', ref: 'Schema default: confidence=0.5' }],
  });

  // ── 2. Lens DELTA derivations ────────────────────────────────────────
  const lenses = objResult.lenses || {};
  let rawPriority = 50;
  let rawRisk = 50;
  let rawConf = 0.5;

  for (const lensName of SIGNAL_LENSES) {
    const lens = lenses[lensName];
    if (!lens) continue;

    const evidence = (lens.signals || []).slice(0, LIMITS.max_evidence_per_derivation).map(sig => ({
      source: classifySource(sig),
      ref: truncStr(sig),
    }));
    const fallbackEvidence = [{ source: 'arbitration', ref: lensName + ' lens delta' }];

    if (lens.score_delta && lens.score_delta !== 0) {
      const fromVal = rawPriority;
      rawPriority += lens.score_delta;
      derivations.push({
        kind: 'DELTA', target: 'priority_score', from: fromVal, to: rawPriority,
        rule: lensName + ' lens: score_delta=' + (lens.score_delta > 0 ? '+' : '') + lens.score_delta,
        evidence: evidence.length > 0 ? evidence : fallbackEvidence,
      });
    }

    if (lens.risk_delta && lens.risk_delta !== 0) {
      const fromVal = rawRisk;
      rawRisk += lens.risk_delta;
      derivations.push({
        kind: 'DELTA', target: 'risk_score', from: fromVal, to: rawRisk,
        rule: lensName + ' lens: risk_delta=' + (lens.risk_delta > 0 ? '+' : '') + lens.risk_delta,
        evidence: evidence.length > 0 ? evidence : fallbackEvidence,
      });
    }

    if (lens.confidence_delta && lens.confidence_delta !== 0) {
      const fromVal = parseFloat(rawConf.toFixed(3));
      rawConf += lens.confidence_delta;
      derivations.push({
        kind: 'DELTA', target: 'confidence', from: fromVal, to: parseFloat(rawConf.toFixed(3)),
        rule: lensName + ' lens: confidence_delta=' + (lens.confidence_delta > 0 ? '+' : '') + lens.confidence_delta,
        evidence: evidence.length > 0 ? evidence : fallbackEvidence,
      });
    }
  }

  // ── 3. Score CLAMP derivations ───────────────────────────────────────
  const clampedPriority = clampScore(rawPriority);
  if (clampedPriority !== Math.round(rawPriority)) {
    derivations.push({
      kind: 'CLAMP', target: 'priority_score', from: rawPriority, to: clampedPriority,
      rule: 'Clamped to [0, 100]',
      evidence: [{ source: 'arbitration', ref: 'schema.clampScore bounds enforcement' }],
    });
  }

  const clampedRisk = clampScore(rawRisk);
  if (clampedRisk !== Math.round(rawRisk)) {
    derivations.push({
      kind: 'CLAMP', target: 'risk_score', from: rawRisk, to: clampedRisk,
      rule: 'Clamped to [0, 100]',
      evidence: [{ source: 'arbitration', ref: 'schema.clampScore bounds enforcement' }],
    });
  }

  const clampedConf = clampConfidence(rawConf);
  if (clampedConf !== parseFloat(rawConf.toFixed(3))) {
    derivations.push({
      kind: 'CLAMP', target: 'confidence', from: parseFloat(rawConf.toFixed(3)), to: clampedConf,
      rule: 'Clamped to [0, 1]',
      evidence: [{ source: 'arbitration', ref: 'schema.clampConfidence bounds enforcement' }],
    });
  }

  // ── 4. Action OVERRIDE ───────────────────────────────────────────────
  const blocks = objResult.blocks || [];
  for (const block of blocks) {
    if (block.type === 'kill_switch') {
      derivations.push({
        kind: 'OVERRIDE', target: 'recommended_action', from: 'PROCEED', to: 'STOP',
        rule: 'Kill switch engaged — overrides all actions',
        evidence: [{ source: 'kill_switch', ref: truncStr(block.detail || 'Kill switch active') }],
      });
    } else if (block.type === 'quarantine') {
      derivations.push({
        kind: 'OVERRIDE', target: 'recommended_action', from: 'PROCEED', to: 'HOLD',
        rule: 'Objective quarantined — forced HOLD',
        evidence: [{ source: 'quarantine', ref: truncStr(block.detail || 'Quarantined') }],
      });
    }
  }

  // ── 5. Hint derivations ──────────────────────────────────────────────
  if (hasHints) {
    if (hintsValid) {
      const rawDeltaBeforeClamp = Math.round((objResult.priority_score - 50) / 5);
      const rawDelta = Math.max(-10, Math.min(10, rawDeltaBeforeClamp));
      const clampApplied = rawDeltaBeforeClamp !== rawDelta;

      derivations.push({
        kind: 'DELTA', target: 'rank_delta_hint', from: 0, to: rawDelta,
        rule: 'computeRankDelta(' + objResult.priority_score + ') = clamp(round((' + objResult.priority_score + '-50)/5), -10, 10) = ' + rawDelta,
        evidence: [{ source: 'hints', ref: 'priority_score=' + objResult.priority_score }],
      });

      if (clampApplied) {
        derivations.push({
          kind: 'CLAMP', target: 'rank_delta_hint', from: rawDeltaBeforeClamp, to: rawDelta,
          rule: 'Clamped to [-10, +10]',
          evidence: [{ source: 'hints', ref: 'rank_delta_hint bounds enforcement' }],
        });
      }

      const forcedZero = detectForcedZero(objResult);
      if (forcedZero !== 'NONE') {
        derivations.push({
          kind: 'OVERRIDE', target: 'rank_delta_hint', from: rawDelta, to: 0,
          rule: 'Safety override: ' + forcedZero + ' — delta forced to 0',
          evidence: [{ source: 'hints', ref: 'forced_zero_reason=' + forcedZero }],
        });
      }
    } else {
      // Hints present but invalid schema
      derivations.push({
        kind: 'OVERRIDE', target: 'rank_delta_hint', from: 0, to: 0,
        rule: 'Hints schema invalid — delta forced to 0 (SCHEMA_INVALID)',
        evidence: [{ source: 'hints', ref: 'forced_zero_reason=SCHEMA_INVALID' }],
      });
    }
  }

  return derivations.slice(0, LIMITS.max_derivations);
}

// ═══════════════════════════════════════════════════════════════════════════
// Signal extraction
// ═══════════════════════════════════════════════════════════════════════════

function buildSignals(objResult) {
  const signals = [];
  const lenses = objResult.lenses || {};

  for (const lensName of SIGNAL_LENSES) {
    const lens = lenses[lensName];
    if (!lens || !Array.isArray(lens.signals)) continue;

    const absDelta = Math.abs(lens.score_delta || 0) + Math.abs(lens.risk_delta || 0);

    for (const sig of lens.signals) {
      if (signals.length >= LIMITS.max_signals) break;
      signals.push({
        lens: lensName,
        severity: classifySeverity(absDelta),
        text: truncStr(sig),
        evidence_ref: classifySource(sig),
      });
    }
    if (signals.length >= LIMITS.max_signals) break;
  }

  return signals;
}

// ═══════════════════════════════════════════════════════════════════════════
// Arbiter simulation (JS — no shelling out to Python)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulate what the Python arbiter_hints.py applier would do:
 * Apply hint deltas (with safety overrides) and re-sort.
 *
 * @param {object[]} objectives - report.objectives (in engine sort order)
 * @param {object|null} hints - hints artifact (or null)
 * @param {boolean} hintsValid - whether hints passed schema validation
 * @returns {object[]} Simulated order entries
 */
function simulateArbiterOrder(objectives, hints, hintsValid) {
  if (!Array.isArray(objectives) || objectives.length === 0) {
    return [];
  }

  if (!hintsValid || !hints || !Array.isArray(hints.hints)) {
    return objectives.map(function (obj, i) {
      return { objective_id: obj.objective_id, original_position: i, rank_delta: 0, final_position: i };
    });
  }

  const hintMap = {};
  for (const h of hints.hints) {
    if (h && h.objective_id) hintMap[h.objective_id] = h;
  }

  const entries = objectives.map(function (obj, i) {
    let delta = 0;
    if (hintMap[obj.objective_id]) {
      delta = computeRankDelta(obj.priority_score);
      if (detectForcedZero(obj) !== 'NONE') delta = 0;
    }
    return { objective_id: obj.objective_id, original_position: i, rank_delta: delta };
  });

  // Sort: higher delta first, ties broken by original position (matches Python)
  entries.sort(function (a, b) {
    if (b.rank_delta !== a.rank_delta) return b.rank_delta - a.rank_delta;
    return a.original_position - b.original_position;
  });

  return entries.map(function (e, i) {
    return { objective_id: e.objective_id, original_position: e.original_position, rank_delta: e.rank_delta, final_position: i };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Failclosed graph
// ═══════════════════════════════════════════════════════════════════════════

function buildFailclosedGraph(reason, timestamp) {
  return {
    version: GRAPH_VERSION,
    computed_at: timestamp || new Date().toISOString(),
    inputs: { telemetry_bundle_hash: 'none', objectives_hash: 'none', hints_hash: 'none' },
    objectives: [],
    arbiter_simulation: [],
    summary: {
      total_objectives: 0,
      actions: {},
      forced_zero_count: 0,
      mean_confidence: 0,
      failclosed: true,
      failclosed_reason: truncStr(String(reason)),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main builder
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the evidence graph from engine report, hints, and context.
 *
 * @param {object} report  - Strategy report from engine.run()
 * @param {object|null} hints - Hints artifact from generateHints() (null if none)
 * @param {object} context - Original context passed to engine.run()
 * @returns {object} Evidence graph (always returns — never throws)
 */
function build(report, hints, context) {
  try {
    if (!report || typeof report !== 'object') {
      return buildFailclosedGraph('invalid_report');
    }
    if (report.status === 'FAILCLOSED') {
      return buildFailclosedGraph('upstream_failclosed', report.timestamp);
    }
    if (!Array.isArray(report.objectives)) {
      return buildFailclosedGraph('missing_objectives', report.timestamp);
    }
    if (report.objectives.length > LIMITS.max_objectives) {
      return buildFailclosedGraph('too_many_objectives', report.timestamp);
    }

    // Validate hints schema (quick check)
    const hasHints = hints != null && typeof hints === 'object';
    let hintsValid = false;
    if (hasHints && Array.isArray(hints.hints) && hints.version === '1.0.0' && typeof hints.computed_at === 'string') {
      hintsValid = true;
    }

    const timestamp = report.timestamp || new Date().toISOString();

    // Compute input hashes (deterministic)
    const telBundleHash = sha256(sortedStringify(context || {}));
    const objHash = sha256(sortedStringify(report.objectives));
    const hintsHash = hasHints ? sha256(sortedStringify(hints)) : 'none';

    // Build per-objective entries
    const graphObjectives = [];
    const actionCounts = {};
    let forcedZeroCount = 0;
    let confSum = 0;

    for (const obj of report.objectives) {
      // ── Strategy section ──
      const strategy = {
        priority_score: obj.priority_score,
        risk_score: obj.risk_score,
        confidence: obj.confidence,
        recommended_action: obj.recommended_action,
      };

      // ── Hint section ──
      let hintSection = null;
      if (hasHints) {
        const rawDeltaBeforeClamp = Math.round((obj.priority_score - 50) / 5);
        const rawDelta = Math.max(-10, Math.min(10, rawDeltaBeforeClamp));
        const clampApplied = rawDeltaBeforeClamp !== rawDelta;

        let forcedZeroReason;
        if (!hintsValid) {
          forcedZeroReason = 'SCHEMA_INVALID';
        } else {
          forcedZeroReason = detectForcedZero(obj);
        }

        const effectiveDelta = forcedZeroReason !== 'NONE' ? 0 : rawDelta;
        if (forcedZeroReason !== 'NONE') forcedZeroCount++;

        hintSection = {
          rank_delta_hint: effectiveDelta,
          forced_zero_reason: forcedZeroReason,
          clamp_applied: clampApplied,
          recommendation_code: RECOMMENDATION_MAP[obj.recommended_action] || 'FOCUS',
        };
      }

      // ── Derivations ──
      const derivations = buildDerivations(obj, hintsValid, hasHints);

      // ── Signals ──
      const signals = buildSignals(obj);

      graphObjectives.push({
        objective_id: obj.objective_id,
        strategy: strategy,
        hint: hintSection,
        derivations: derivations,
        signals: signals,
      });

      // Track summary stats
      actionCounts[obj.recommended_action] = (actionCounts[obj.recommended_action] || 0) + 1;
      confSum += obj.confidence;
    }

    // Arbiter simulation
    const arbiterSim = simulateArbiterOrder(report.objectives, hints, hintsValid);

    const meanConf = report.objectives.length > 0
      ? parseFloat((confSum / report.objectives.length).toFixed(3))
      : 0;

    return {
      version: GRAPH_VERSION,
      computed_at: timestamp,
      inputs: {
        telemetry_bundle_hash: telBundleHash,
        objectives_hash: objHash,
        hints_hash: hintsHash,
      },
      objectives: graphObjectives,
      arbiter_simulation: arbiterSim,
      summary: {
        total_objectives: report.objectives.length,
        actions: actionCounts,
        forced_zero_count: forcedZeroCount,
        mean_confidence: meanConf,
        failclosed: false,
      },
    };
  } catch (_e) {
    return buildFailclosedGraph('exception: ' + ((_e && _e.message) || 'unknown'));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate an evidence graph against the schema.
 * @param {object} graph
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(graph) {
  const errors = [];
  if (!graph || typeof graph !== 'object') {
    return { valid: false, errors: ['graph must be an object'] };
  }

  if (graph.version !== GRAPH_VERSION) {
    errors.push('version must be \'' + GRAPH_VERSION + '\', got \'' + graph.version + '\'');
  }
  if (typeof graph.computed_at !== 'string' || !graph.computed_at) {
    errors.push('computed_at must be a non-empty string');
  }

  // inputs
  if (!graph.inputs || typeof graph.inputs !== 'object') {
    errors.push('inputs must be an object');
  } else {
    var hashFields = ['telemetry_bundle_hash', 'objectives_hash', 'hints_hash'];
    for (var h = 0; h < hashFields.length; h++) {
      if (typeof graph.inputs[hashFields[h]] !== 'string') {
        errors.push('inputs.' + hashFields[h] + ' must be a string');
      }
    }
  }

  // objectives
  if (!Array.isArray(graph.objectives)) {
    errors.push('objectives must be an array');
    return { valid: false, errors: errors };
  }
  if (graph.objectives.length > LIMITS.max_objectives) {
    errors.push('objectives exceeds max (' + LIMITS.max_objectives + ')');
  }

  for (var i = 0; i < graph.objectives.length; i++) {
    var obj = graph.objectives[i];
    var p = 'objectives[' + i + ']';

    if (!obj || typeof obj !== 'object') { errors.push(p + ' must be an object'); continue; }
    if (typeof obj.objective_id !== 'string' || !obj.objective_id) {
      errors.push(p + '.objective_id must be a non-empty string');
    }

    // strategy
    if (!obj.strategy || typeof obj.strategy !== 'object') {
      errors.push(p + '.strategy must be an object');
    }

    // derivations
    if (!Array.isArray(obj.derivations)) {
      errors.push(p + '.derivations must be an array');
    } else {
      if (obj.derivations.length > LIMITS.max_derivations) {
        errors.push(p + '.derivations exceeds max (' + LIMITS.max_derivations + ')');
      }
      for (var j = 0; j < obj.derivations.length; j++) {
        var d = obj.derivations[j];
        var dp = p + '.derivations[' + j + ']';
        if (!d || typeof d !== 'object') { errors.push(dp + ' must be an object'); continue; }
        if (!DERIVATION_KINDS.includes(d.kind)) {
          errors.push(dp + '.kind must be one of: ' + DERIVATION_KINDS.join(', '));
        }
        if (!DERIVATION_TARGETS.includes(d.target)) {
          errors.push(dp + '.target must be one of: ' + DERIVATION_TARGETS.join(', '));
        }
        if (typeof d.rule !== 'string') {
          errors.push(dp + '.rule must be a string');
        }
        if (!Array.isArray(d.evidence)) {
          errors.push(dp + '.evidence must be an array');
        } else if (d.evidence.length > LIMITS.max_evidence_per_derivation) {
          errors.push(dp + '.evidence exceeds max (' + LIMITS.max_evidence_per_derivation + ')');
        } else {
          for (var k = 0; k < d.evidence.length; k++) {
            var ev = d.evidence[k];
            if (!ev || typeof ev !== 'object') { errors.push(dp + '.evidence[' + k + '] must be an object'); continue; }
            if (!EVIDENCE_SOURCES.includes(ev.source)) {
              errors.push(dp + '.evidence[' + k + '].source must be one of: ' + EVIDENCE_SOURCES.join(', '));
            }
          }
        }
      }
    }

    // signals
    if (!Array.isArray(obj.signals)) {
      errors.push(p + '.signals must be an array');
    } else if (obj.signals.length > LIMITS.max_signals) {
      errors.push(p + '.signals exceeds max (' + LIMITS.max_signals + ')');
    } else {
      for (var s = 0; s < obj.signals.length; s++) {
        var sig = obj.signals[s];
        if (!sig || typeof sig !== 'object') { errors.push(p + '.signals[' + s + '] must be an object'); continue; }
        if (!SIGNAL_LENSES.includes(sig.lens)) {
          errors.push(p + '.signals[' + s + '].lens must be one of: ' + SIGNAL_LENSES.join(', '));
        }
        if (!SIGNAL_SEVERITIES.includes(sig.severity)) {
          errors.push(p + '.signals[' + s + '].severity must be one of: ' + SIGNAL_SEVERITIES.join(', '));
        }
      }
    }

    // hint (nullable)
    if (obj.hint !== null && obj.hint !== undefined) {
      if (typeof obj.hint !== 'object') {
        errors.push(p + '.hint must be an object or null');
      } else {
        if (!FORCED_ZERO_REASONS.includes(obj.hint.forced_zero_reason)) {
          errors.push(p + '.hint.forced_zero_reason must be one of: ' + FORCED_ZERO_REASONS.join(', '));
        }
        if (!RECOMMENDATION_CODES.includes(obj.hint.recommendation_code)) {
          errors.push(p + '.hint.recommendation_code must be one of: ' + RECOMMENDATION_CODES.join(', '));
        }
        if (typeof obj.hint.rank_delta_hint !== 'number') {
          errors.push(p + '.hint.rank_delta_hint must be a number');
        }
        if (typeof obj.hint.clamp_applied !== 'boolean') {
          errors.push(p + '.hint.clamp_applied must be a boolean');
        }
      }
    }
  }

  // arbiter_simulation
  if (graph.arbiter_simulation !== undefined && !Array.isArray(graph.arbiter_simulation)) {
    errors.push('arbiter_simulation must be an array');
  }

  // summary
  if (!graph.summary || typeof graph.summary !== 'object') {
    errors.push('summary must be an object');
  } else {
    if (typeof graph.summary.total_objectives !== 'number') {
      errors.push('summary.total_objectives must be a number');
    }
    if (typeof graph.summary.failclosed !== 'boolean') {
      errors.push('summary.failclosed must be a boolean');
    }
    if (typeof graph.summary.mean_confidence !== 'number') {
      errors.push('summary.mean_confidence must be a number');
    }
    if (typeof graph.summary.forced_zero_count !== 'number') {
      errors.push('summary.forced_zero_count must be a number');
    }
  }

  return { valid: errors.length === 0, errors: errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// Markdown renderer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Render evidence graph to markdown.
 * @param {object} graph
 * @returns {string}
 */
function toMarkdown(graph) {
  if (!graph) return '# Evidence Graph — Error\n\nNo graph data.\n';

  var lines = [];
  lines.push('# Evidence Graph ' + graph.version);
  lines.push('');
  lines.push('**Computed:** ' + graph.computed_at);

  if (graph.summary && graph.summary.failclosed) {
    lines.push('');
    lines.push('## FAILCLOSED');
    lines.push('');
    lines.push('Reason: ' + (graph.summary.failclosed_reason || 'unknown'));
    lines.push('');
    lines.push('No evidence available.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('## Input Hashes');
  lines.push('');
  if (graph.inputs) {
    lines.push('- Telemetry: `' + graph.inputs.telemetry_bundle_hash + '`');
    lines.push('- Objectives: `' + graph.inputs.objectives_hash + '`');
    lines.push('- Hints: `' + graph.inputs.hints_hash + '`');
  }

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  if (graph.summary) {
    lines.push('- Total objectives: ' + graph.summary.total_objectives);
    lines.push('- Mean confidence: ' + graph.summary.mean_confidence);
    lines.push('- Forced-zero count: ' + graph.summary.forced_zero_count);
    lines.push('- Actions: ' + JSON.stringify(graph.summary.actions));
  }

  lines.push('');
  lines.push('## Objectives');

  var objs = graph.objectives || [];
  for (var i = 0; i < objs.length; i++) {
    var obj = objs[i];
    lines.push('');
    lines.push('### ' + obj.objective_id);
    lines.push('');

    if (obj.strategy) {
      lines.push('**Strategy:** priority=' + obj.strategy.priority_score +
        ' risk=' + obj.strategy.risk_score +
        ' confidence=' + obj.strategy.confidence +
        ' action=' + obj.strategy.recommended_action);
    }

    if (obj.hint) {
      lines.push('**Hint:** delta=' + obj.hint.rank_delta_hint +
        ' forced_zero=' + obj.hint.forced_zero_reason +
        ' clamp=' + obj.hint.clamp_applied +
        ' code=' + obj.hint.recommendation_code);
    }

    if (obj.derivations && obj.derivations.length > 0) {
      lines.push('');
      lines.push('**Derivations:**');
      lines.push('');
      lines.push('| # | Kind | Target | From | To | Rule |');
      lines.push('|---|------|--------|------|----|------|');
      for (var d = 0; d < obj.derivations.length; d++) {
        var deriv = obj.derivations[d];
        lines.push('| ' + (d + 1) + ' | ' + deriv.kind + ' | ' + deriv.target +
          ' | ' + deriv.from + ' | ' + deriv.to + ' | ' + truncStr(deriv.rule, 80) + ' |');
      }
    }

    if (obj.signals && obj.signals.length > 0) {
      lines.push('');
      lines.push('**Signals:**');
      lines.push('');
      for (var s = 0; s < obj.signals.length; s++) {
        var sig = obj.signals[s];
        lines.push('- [' + sig.lens + '/' + sig.severity + '] ' + sig.text);
      }
    }
  }

  if (graph.arbiter_simulation && graph.arbiter_simulation.length > 0) {
    lines.push('');
    lines.push('## Arbiter Simulation');
    lines.push('');
    lines.push('| Objective | Original | Delta | Final |');
    lines.push('|-----------|----------|-------|-------|');
    for (var a = 0; a < graph.arbiter_simulation.length; a++) {
      var entry = graph.arbiter_simulation[a];
      lines.push('| ' + entry.objective_id + ' | ' + entry.original_position +
        ' | ' + (entry.rank_delta >= 0 ? '+' : '') + entry.rank_delta +
        ' | ' + entry.final_position + ' |');
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Enums
  GRAPH_VERSION: GRAPH_VERSION,
  FORCED_ZERO_REASONS: FORCED_ZERO_REASONS,
  DERIVATION_KINDS: DERIVATION_KINDS,
  DERIVATION_TARGETS: DERIVATION_TARGETS,
  EVIDENCE_SOURCES: EVIDENCE_SOURCES,
  SIGNAL_SEVERITIES: SIGNAL_SEVERITIES,
  SIGNAL_LENSES: SIGNAL_LENSES,
  RECOMMENDATION_CODES: RECOMMENDATION_CODES,
  LIMITS: LIMITS,
  // Hashing
  sortedStringify: sortedStringify,
  sha256: sha256,
  // Helpers
  sanitize: sanitize,
  truncStr: truncStr,
  classifySource: classifySource,
  classifySeverity: classifySeverity,
  computeRankDelta: computeRankDelta,
  detectForcedZero: detectForcedZero,
  // Builders
  build: build,
  buildFailclosedGraph: buildFailclosedGraph,
  simulateArbiterOrder: simulateArbiterOrder,
  // Validation + rendering
  validate: validate,
  toMarkdown: toMarkdown,
};
