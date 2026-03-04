#!/usr/bin/env node
/**
 * event_emitter.js - Tax Pod Event Emission (Append-Only Ledger)
 *
 * Emits deterministic audit events to tax/events/events.jsonl.
 * Each event records: case_id, agent_key, input_hash, output_hashes, sources_count, delivery_gate status.
 * NO PII: only hashes, paths, and counts.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Build a run event object
 * @param {object} params - Event parameters
 * @param {string} params.nowUtc - ISO 8601 UTC timestamp (injected for determinism)
 * @param {string} params.caseId - Case identifier
 * @param {string} params.agentKey - Agent key (payment_plan_first | irs_notice_triage | cost_seg_support)
 * @param {string} params.agentId - Agent ID (payment-plan-agent, etc.)
 * @param {string} params.inputHash - SHA256 hash of normalized intake JSON
 * @param {string} params.outDir - Output directory base path
 * @param {object} params.outputs - Outputs object { responseMarkdown, evidenceRecord, artifacts }
 * @param {object} params.evidenceRecord - Evidence record
 * @param {string} params.deliveryGateVersion - Delivery gate version
 * @returns {object} - Event object
 */
function buildRunEvent(params) {
  const {
    nowUtc,
    caseId,
    agentKey,
    agentId,
    inputHash,
    outDir,
    outputs,
    evidenceRecord,
    deliveryGateVersion
  } = params;

  // Build output file list with hashes and byte counts
  const caseDir = path.join(outDir, caseId);
  const outputFiles = [];

  // Response file
  const responsePath = path.join(caseDir, 'response.md');
  if (fs.existsSync(responsePath)) {
    const responseBytes = fs.readFileSync(responsePath, 'utf8');
    const responseSha256 = crypto.createHash('sha256').update(responseBytes).digest('hex');
    outputFiles.push({
      path: path.relative(process.cwd(), responsePath).replace(/\\/g, '/'),
      sha256: responseSha256,
      bytes: Buffer.byteLength(responseBytes, 'utf8')
    });
  }

  // Evidence file
  const evidencePath = path.join(caseDir, 'evidence.json');
  if (fs.existsSync(evidencePath)) {
    const evidenceBytes = fs.readFileSync(evidencePath, 'utf8');
    const evidenceSha256 = crypto.createHash('sha256').update(evidenceBytes).digest('hex');
    outputFiles.push({
      path: path.relative(process.cwd(), evidencePath).replace(/\\/g, '/'),
      sha256: evidenceSha256,
      bytes: Buffer.byteLength(evidenceBytes, 'utf8')
    });
  }

  // Artifacts (if any)
  if (outputs.artifacts && outputs.artifacts.length > 0) {
    const artifactsDir = path.join(caseDir, 'artifacts');
    for (const artifact of outputs.artifacts) {
      const artifactPath = path.join(artifactsDir, artifact.path);
      if (fs.existsSync(artifactPath)) {
        const artifactBytes = fs.readFileSync(artifactPath, 'utf8');
        const artifactSha256 = crypto.createHash('sha256').update(artifactBytes).digest('hex');
        outputFiles.push({
          path: path.relative(process.cwd(), artifactPath).replace(/\\/g, '/'),
          sha256: artifactSha256,
          bytes: Buffer.byteLength(artifactBytes, 'utf8')
        });
      }
    }
  }

  // Count sources and missing sources
  const sourcesCount = evidenceRecord.sources ? evidenceRecord.sources.length : 0;
  let missingSourcesCount = 0;

  // Attempt to derive missing sources count from risks or evidence
  // (If missing sources were noted in response, this would be in evidence metadata)
  // For now, we assume 0 unless explicitly tracked in future
  // (Could parse responseMarkdown for "Missing vault sources:" note if needed)

  // Build event object
  const eventObject = {
    event_type: 'tax_agent_run',
    timestamp_utc: nowUtc,
    case_id: caseId,
    agent_key: agentKey,
    agent_id: agentId,
    input_hash: inputHash,
    outputs: outputFiles,
    evidence_path: path.relative(process.cwd(), evidencePath).replace(/\\/g, '/'),
    sources_count: sourcesCount,
    missing_sources_count: missingSourcesCount,
    delivery_gate: {
      pass: true,
      version: deliveryGateVersion
    },
    contract_version: '1.0'
  };

  return eventObject;
}

/**
 * Append event line to events.jsonl
 * @param {object} params - Append parameters
 * @param {string} params.eventsPath - Path to events.jsonl file
 * @param {object} params.eventObject - Event object to append
 */
function appendEventLine(params) {
  const { eventsPath, eventObject } = params;

  // Ensure events directory exists
  const eventsDir = path.dirname(eventsPath);
  if (!fs.existsSync(eventsDir)) {
    fs.mkdirSync(eventsDir, { recursive: true });
  }

  // Append event line (JSON + newline)
  const eventLine = JSON.stringify(eventObject) + '\n';
  fs.appendFileSync(eventsPath, eventLine, 'utf8');
}

module.exports = {
  buildRunEvent,
  appendEventLine
};
