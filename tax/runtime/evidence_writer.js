#!/usr/bin/env node
/**
 * evidence_writer.js - Build evidence records conforming to evidence_record.schema.json
 *
 * NO NETWORK, NO ENV VARS, NO I/O.
 * All outputs must be deterministic.
 */

'use strict';

const { stableJsonStringify, sanitizePII } = require('./util.js');

/**
 * Build evidence record object
 * @param {object} params - Evidence parameters
 * @param {string} params.caseId - Case identifier
 * @param {string} params.timestamp - ISO 8601 UTC timestamp
 * @param {string} params.agentId - Agent identifier
 * @param {object} params.inputsSummary - Sanitized inputs summary
 * @param {string[]} params.assumptions - Array of assumption strings
 * @param {object[]} params.sources - Array of source citation objects
 * @param {object} params.outputsSummary - Sanitized outputs summary
 * @param {string[]} params.risks - Array of risk statements
 * @param {string[]} params.nextQuestions - Array of questions for user/pro
 * @param {object[]} params.artifacts - Array of artifact references
 * @returns {object} - Evidence record conforming to schema
 */
function buildEvidenceRecord({
  caseId,
  timestamp,
  agentId,
  inputsSummary,
  assumptions,
  sources,
  outputsSummary,
  risks,
  nextQuestions,
  artifacts
}) {
  // Sanitize all text fields
  const sanitizedInputs = {
    ...inputsSummary,
    user_summary_sanitized: sanitizePII(inputsSummary.user_summary_sanitized || '')
  };

  const sanitizedOutputs = {
    ...outputsSummary,
    recommendation: sanitizePII(outputsSummary.recommendation || '')
  };

  // Build evidence record matching tax/evidence/evidence_record.schema.json
  const evidenceRecord = {
    case_id: caseId,
    timestamp: timestamp,
    agent_id: agentId,

    inputs_summary: {
      case_type: sanitizedInputs.case_type || 'installment_agreement',
      tax_years: sanitizedInputs.tax_years || [],
      amount_involved: sanitizedInputs.amount_involved || 0,
      urgency_level: sanitizedInputs.urgency_level || 'medium',
      user_summary_sanitized: sanitizedInputs.user_summary_sanitized || 'Payment plan analysis requested',
      prerequisites_provided: sanitizedInputs.prerequisites_provided || []
    },

    assumptions: assumptions || [],

    sources: sources || [],

    outputs_summary: {
      recommendation: sanitizedOutputs.recommendation || 'Pursue payment plan pathway',
      options_presented: sanitizedOutputs.options_presented || [],
      recommended_option: sanitizedOutputs.recommended_option || 'unknown',
      justification: sanitizedOutputs.justification || 'Based on intake analysis',
      professional_verification_required: true,
      urgency_flagged: sanitizedOutputs.urgency_flagged || 'medium'
    },

    risks: risks || [],

    next_questions: nextQuestions || [],

    artifacts: artifacts || []
  };

  return evidenceRecord;
}

/**
 * Internal source citation builder
 * @param {string} identifier - File path relative to tax/
 * @param {string} type - Source type (policy, schema, template)
 * @param {string} description - Brief description
 * @returns {object} - Source citation object
 */
function buildInternalSource(identifier, type, description) {
  return {
    type: type || 'internal_document',
    identifier: identifier,
    title: description,
    last_updated: '2026-03-04' // Port P4 skeleton creation date
  };
}

module.exports = {
  buildEvidenceRecord,
  buildInternalSource
};
