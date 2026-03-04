#!/usr/bin/env node
/**
 * render_notice_response.js - Render IRS Notice Triage response
 *
 * NO NETWORK, NO ENV VARS, NO I/O.
 * All outputs must be deterministic.
 */

'use strict';

/**
 * Render notice response markdown
 * @param {object} params - Response parameters
 * @param {object} params.intake - Original intake data
 * @param {object} params.analysis - Analysis results
 * @param {string} params.caseId - Case identifier
 * @param {string} params.timestamp - ISO 8601 UTC timestamp
 * @param {array} params.vaultCitations - Vault citations (optional)
 * @param {string} params.missingSourcesNote - Missing sources note (optional)
 * @returns {string} - Markdown formatted response
 */
function renderNoticeResponseMarkdown(params) {
  const { intake, analysis, caseId, timestamp, vaultCitations, missingSourcesNote } = params;
  const sections = [];

  // Header
  sections.push('# Tax Pod Response: IRS Notice Triage\n');

  // Summary
  sections.push('## Summary\n');
  sections.push(`${analysis.summary}\n`);

  // Notice Type Guess
  sections.push('## Notice Type Guess\n');
  sections.push(`Based on notice code "${intake.notice_code}" and summary:\n`);
  sections.push(`**${analysis.noticeTypeGuess}**\n`);

  // Urgency Level
  sections.push('## Urgency Level\n');
  sections.push(`**${analysis.urgency.toUpperCase()}**\n`);
  if (intake.deadline_date) {
    sections.push(`Deadline: ${intake.deadline_date}\n`);
  }

  // What You Told Me
  sections.push('## What You Told Me\n');
  sections.push(`- Notice code: ${intake.notice_code || 'Not specified'}`);
  sections.push(`- Tax year: ${intake.tax_year || 'Not specified'}`);
  sections.push(`- Amount due: ${intake.amount_due_range || 'Not specified'}`);
  sections.push(`- Received date: ${intake.received_date || 'Not specified'}`);
  sections.push(`- Deadline date: ${intake.deadline_date || 'None provided'}`);
  sections.push(`- All returns filed: ${intake.has_filed_all_returns ? 'Yes' : 'No'}`);
  sections.push(`- Hardship: ${intake.hardship ? 'Yes' : 'No'}`);
  sections.push(`- Contact attempted: ${intake.contact_attempted ? 'Yes' : 'No'}`);
  sections.push(`- State: ${intake.state || 'Not specified'}\n`);

  // Immediate Next Steps (First 72 Hours)
  sections.push('## Immediate Next Steps (First 72 Hours)\n');
  analysis.immediateSteps.forEach(step => {
    sections.push(step);
  });
  sections.push('');

  // Documents to Gather
  sections.push('## Documents to Gather\n');
  analysis.documentsToGather.forEach(doc => {
    sections.push(`- ${doc}`);
  });
  sections.push('');

  // Options to Consider
  sections.push('## Options to Consider\n');
  sections.push(`${analysis.options}\n`);

  // What NOT to Do
  sections.push('## What NOT to Do\n');
  analysis.whatNotToDo.forEach(item => {
    sections.push(`- ${item}`);
  });
  sections.push('');

  // Questions to Ask a Professional
  sections.push('## Questions to Ask a Professional\n');
  analysis.proQuestions.forEach(q => {
    sections.push(`- ${q}`);
  });
  sections.push('');

  // Handoff Pack Checklist
  sections.push('## Handoff Pack Checklist for EA/CPA\n');
  analysis.handoffChecklist.forEach(item => {
    sections.push(`- [ ] ${item}`);
  });
  sections.push('');

  // Risks
  sections.push('## Risks\n');
  analysis.risks.forEach(risk => {
    sections.push(`- ${risk}`);
  });
  sections.push('');

  // Evidence
  sections.push('## Evidence\n');
  sections.push(`- Case ID: ${caseId}`);
  sections.push(`- Timestamp: ${timestamp}`);
  sections.push(`- Agent: irs-notice-triage-agent\n`);

  sections.push('**Sources (Internal - Tax Pod Policies):**');
  sections.push('- tax/policies/safe_answering_rules.md');
  sections.push('- tax/policies/disclaimers_and_limits.md');
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
  sections.push('This is informational decision support only, not legal or tax advice. You are responsible for verifying all information with licensed tax professionals (EA, CPA, or tax attorney) before taking action. The Tax Pod does not guarantee accuracy, IRS acceptance, or outcomes. Do not ignore IRS notices. Professional representation is strongly recommended for all IRS notice responses. See tax/policies/disclaimers_and_limits.md for full disclaimers.\n');

  sections.push('---\n');
  sections.push('**END OF RESPONSE**\n');

  return sections.join('\n');
}

module.exports = {
  renderNoticeResponseMarkdown
};
