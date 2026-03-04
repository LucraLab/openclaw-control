#!/usr/bin/env node
/**
 * normalize_outputs.js - Normalize agent outputs to standard contract
 *
 * Ensures all agent outputs conform to tax/contracts/output_contract.md
 * Does NOT transform decision logic, only ensures required sections exist.
 */

'use strict';

/**
 * Normalize agent outputs to standard contract
 * @param {string} agentKey - Agent key (payment_plan_first | irs_notice_triage | cost_seg_support)
 * @param {object} outputs - Raw agent outputs
 * @param {string} outputs.responseMarkdown - Response markdown
 * @param {object} outputs.evidenceRecord - Evidence record
 * @param {string} outputs.csvText - Optional CSV text (cost seg only)
 * @param {object} vaultIndex - Vault index (for missing sources)
 * @returns {object} - { responseMarkdown, evidenceRecord, artifacts: [{path, bytes, mime}] }
 */
function normalizeAgentOutputs(agentKey, outputs, vaultIndex = null) {
  let { responseMarkdown, evidenceRecord, csvText } = outputs;

  // Ensure missing sources note if no vault sources in response
  if (vaultIndex && vaultIndex.missing_sources && vaultIndex.missing_sources.length > 0) {
    const hasIrsSources = responseMarkdown.includes('## IRS Sources');
    const hasMissingNote = responseMarkdown.includes('Missing vault sources');

    if (!hasIrsSources && !hasMissingNote) {
      // Add missing sources note before Disclaimer
      const missingTitles = vaultIndex.missing_sources.map(s => s.title).join(', ');
      const missingNote = `\n**Note:** Missing vault sources: ${missingTitles}. These sources are not yet in the local vault.\n`;

      // Insert before Disclaimer section
      if (responseMarkdown.includes('## Disclaimer')) {
        responseMarkdown = responseMarkdown.replace('## Disclaimer', `${missingNote}\n## Disclaimer`);
      } else {
        // Append at end if no Disclaimer (gate will fail anyway)
        responseMarkdown += missingNote;
      }
    }
  }

  // Ensure evidence record includes internal policy sources (if not already present)
  if (!evidenceRecord.sources) {
    evidenceRecord.sources = [];
  }

  const hasInternalPolicySources = evidenceRecord.sources.some(
    s => s.identifier === 'tax/policies/safe_answering_rules.md'
  );

  if (!hasInternalPolicySources) {
    // Add internal policy sources at the beginning
    evidenceRecord.sources.unshift(
      {
        type: 'internal_document',
        identifier: 'tax/policies/safe_answering_rules.md',
        title: 'Tax Pod Safe Answering Rules',
        locator: 'tax/policies/safe_answering_rules.md'
      },
      {
        type: 'internal_document',
        identifier: 'tax/policies/disclaimers_and_limits.md',
        title: 'Tax Pod Disclaimers and Limits',
        locator: 'tax/policies/disclaimers_and_limits.md'
      }
    );
  }

  // Build artifacts array
  const artifacts = [];

  if (csvText) {
    artifacts.push({
      path: 'costseg_asset_inventory_template.csv',
      bytes: csvText,
      mime: 'text/csv'
    });
  }

  return {
    responseMarkdown,
    evidenceRecord,
    artifacts
  };
}

module.exports = {
  normalizeAgentOutputs
};
