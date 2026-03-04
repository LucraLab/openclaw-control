#!/usr/bin/env node
/**
 * render_response.js - Render markdown response using response_template.md structure
 *
 * NO NETWORK, NO ENV VARS, NO I/O.
 * All outputs must be deterministic.
 */

'use strict';

/**
 * Render response markdown
 * @param {object} params - Response parameters
 * @param {object} params.intake - Original intake data
 * @param {object} params.analysis - Analysis results
 * @param {string} params.caseId - Case identifier
 * @param {string} params.timestamp - ISO 8601 UTC timestamp
 * @param {array} params.vaultCitations - Vault citations (optional)
 * @param {string} params.missingSourcesNote - Missing sources note (optional)
 * @returns {string} - Markdown formatted response
 */
function renderResponseMarkdown(params) {
  const { intake, analysis, caseId, timestamp, vaultCitations, missingSourcesNote } = params;
  const sections = [];

  // Summary
  sections.push('# Tax Pod Response: Payment Plan First Analysis\n');
  sections.push('## Summary\n');
  sections.push(`${analysis.summary}\n`);

  // What You Told Me
  sections.push('## What You Told Me\n');
  sections.push(`- Filing status: ${intake.filing_status || 'Not specified'}`);
  sections.push(`- Tax years involved: ${(intake.tax_years || []).join(', ')}`);
  sections.push(`- Balance estimate: ${intake.balance_estimate_range || 'Not specified'}`);
  sections.push(`- Payment capacity: ${intake.payment_capacity_range || 'Not specified'}`);
  sections.push(`- Notice received: ${intake.notice_received ? 'Yes' : 'No'}`);
  sections.push(`- Financial hardship: ${intake.hardship ? 'Yes' : 'No'}`);
  sections.push(`- State: ${intake.state || 'Not specified'}\n`);

  // What I'm Assuming
  sections.push('## What I\'m Assuming\n');
  for (const assumption of analysis.assumptions) {
    sections.push(`- ${assumption}`);
  }
  sections.push('');

  // Immediate Next Steps
  sections.push('## Immediate Next Steps (Today/This Week)\n');
  for (const step of analysis.immediateSteps) {
    sections.push(`${step}`);
  }
  sections.push('');

  // Payment Plan Pathway
  sections.push('## Payment Plan Pathway (High-Level)\n');
  sections.push(analysis.pathway);
  sections.push('');

  // What to Confirm with a Pro
  sections.push('## What to Confirm with a Tax Professional\n');
  sections.push('**IMPORTANT:** This is decision support only, not tax or legal advice.\n');
  for (const question of analysis.proQuestions) {
    sections.push(`- ${question}`);
  }
  sections.push('');

  // Risks
  sections.push('## Risks and Limitations\n');
  for (const risk of analysis.risks) {
    sections.push(`- ${risk}`);
  }
  sections.push('');

  // Evidence
  sections.push('## Evidence\n');
  sections.push(`**Case ID:** ${caseId}`);
  sections.push(`**Timestamp:** ${timestamp}`);
  sections.push(`**Agent:** payment-plan-agent`);
  sections.push('');
  sections.push('**Sources (Internal - Port P5 Fixture Mode):**');
  sections.push('- tax/policies/safe_answering_rules.md');
  sections.push('- tax/policies/disclaimers_and_limits.md');
  sections.push('- tax/intake/schemas/installment_agreement_intake.schema.json');
  sections.push('');

  // IRS Sources from Vault (P6)
  if (vaultCitations && vaultCitations.length > 0) {
    sections.push('## IRS Sources (Local Vault)\n');
    vaultCitations.forEach(citation => {
      sections.push(`- **${citation.title}**`);
      sections.push(`  - Identifier: ${citation.identifier}`);
      sections.push(`  - Locator: ${citation.locator}`);
    });
    sections.push('');
  }

  // Missing sources note
  if (missingSourcesNote) {
    sections.push(`**Note:** ${missingSourcesNote}\n`);
  } else if (vaultCitations && vaultCitations.length > 0) {
    sections.push('**Note:** IRS source citations are included from the local vault (Port P6).\n');
  }

  // Disclaimer
  sections.push('## Disclaimer\n');
  sections.push('This is informational decision support only, not legal or tax advice. You are responsible for verifying all information with licensed tax professionals (CPA, enrolled agent, or tax attorney) before taking action. The Tax Pod does not guarantee accuracy, IRS acceptance, or outcomes. See tax/policies/disclaimers_and_limits.md for full disclaimers.\n');

  sections.push('---\n');
  sections.push('**END OF RESPONSE**\n');

  return sections.join('\n');
}

module.exports = {
  renderResponseMarkdown
};
