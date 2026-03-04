#!/usr/bin/env node
/**
 * delivery_gate.js - Tax Pod Delivery Gate (fail-closed validation)
 *
 * Validates agent outputs before writing to disk.
 * FAIL-CLOSED: If validation fails, outputs are NOT written.
 *
 * Contract: tax/contracts/output_contract.md
 * Schema: tax/evidence/evidence_record.schema.json
 */

'use strict';

/**
 * Validate delivery outputs against contract
 * @param {object} params - Validation parameters
 * @param {string} params.responseMarkdown - Response markdown text
 * @param {object} params.evidenceRecord - Evidence record object
 * @param {array} params.requiredSections - Optional additional required sections
 * @returns {object} - { pass: boolean, reasons: string[] }
 */
function validateDelivery(params) {
  const { responseMarkdown, evidenceRecord, requiredSections = [] } = params;
  const reasons = [];

  // Response markdown validations
  if (!responseMarkdown || typeof responseMarkdown !== 'string') {
    reasons.push('responseMarkdown is missing or not a string');
  } else {
    // Required: Disclaimer section
    if (!responseMarkdown.includes('## Disclaimer')) {
      reasons.push('Response missing required "## Disclaimer" section');
    }

    // Required: Must have EITHER vault sources OR missing sources note
    const hasIrsSources = responseMarkdown.includes('## IRS Sources');
    const hasMissingNote = responseMarkdown.includes('Missing vault sources');
    if (!hasIrsSources && !hasMissingNote) {
      reasons.push('Response missing both "## IRS Sources" section and "Missing vault sources" note');
    }

    // Check additional required sections (agent-specific)
    for (const section of requiredSections) {
      if (!responseMarkdown.includes(section)) {
        reasons.push(`Response missing required "${section}" section`);
      }
    }
  }

  // Evidence record validations
  if (!evidenceRecord || typeof evidenceRecord !== 'object') {
    reasons.push('evidenceRecord is missing or not an object');
  } else {
    // Required fields
    if (!evidenceRecord.case_id || typeof evidenceRecord.case_id !== 'string') {
      reasons.push('evidenceRecord.case_id is missing or not a string');
    }

    if (!evidenceRecord.timestamp || typeof evidenceRecord.timestamp !== 'string') {
      reasons.push('evidenceRecord.timestamp is missing or not a string');
    }

    if (!evidenceRecord.agent_id || typeof evidenceRecord.agent_id !== 'string') {
      reasons.push('evidenceRecord.agent_id is missing or not a string');
    }

    if (!evidenceRecord.inputs_summary || typeof evidenceRecord.inputs_summary !== 'object') {
      reasons.push('evidenceRecord.inputs_summary is missing or not an object');
    }

    // Assumptions (array with min 1)
    if (!Array.isArray(evidenceRecord.assumptions)) {
      reasons.push('evidenceRecord.assumptions is not an array');
    } else if (evidenceRecord.assumptions.length === 0) {
      reasons.push('evidenceRecord.assumptions array is empty (min 1 required)');
    }

    // Sources (array with min 2)
    if (!Array.isArray(evidenceRecord.sources)) {
      reasons.push('evidenceRecord.sources is not an array');
    } else if (evidenceRecord.sources.length < 2) {
      reasons.push(`evidenceRecord.sources has ${evidenceRecord.sources.length} items (min 2 required)`);
    }

    if (!evidenceRecord.outputs_summary || typeof evidenceRecord.outputs_summary !== 'object') {
      reasons.push('evidenceRecord.outputs_summary is missing or not an object');
    }

    // Risks (array with min 1)
    if (!Array.isArray(evidenceRecord.risks)) {
      reasons.push('evidenceRecord.risks is not an array');
    } else if (evidenceRecord.risks.length === 0) {
      reasons.push('evidenceRecord.risks array is empty (min 1 required)');
    }

    // Next questions (array with min 1)
    if (!Array.isArray(evidenceRecord.next_questions)) {
      reasons.push('evidenceRecord.next_questions is not an array');
    } else if (evidenceRecord.next_questions.length === 0) {
      reasons.push('evidenceRecord.next_questions array is empty (min 1 required)');
    }

    // Artifacts (array, can be empty)
    if (!Array.isArray(evidenceRecord.artifacts)) {
      reasons.push('evidenceRecord.artifacts is not an array');
    }
  }

  return {
    pass: reasons.length === 0,
    reasons
  };
}

module.exports = {
  validateDelivery
};
