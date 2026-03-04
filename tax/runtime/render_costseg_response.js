#!/usr/bin/env node
/**
 * render_costseg_response.js - Render Cost Segregation Support response
 *
 * NO NETWORK, NO ENV VARS, NO I/O.
 * All outputs must be deterministic.
 */

'use strict';

/**
 * Render cost seg response markdown
 * @param {object} params - Response parameters
 * @param {object} params.intake - Original intake data
 * @param {object} params.analysis - Analysis results
 * @param {string} params.caseId - Case identifier
 * @param {string} params.timestamp - ISO 8601 UTC timestamp
 * @param {array} params.vaultCitations - Vault citations (optional)
 * @param {string} params.missingSourcesNote - Missing sources note (optional)
 * @returns {string} - Markdown formatted response
 */
function renderCostSegResponseMarkdown(params) {
  const { intake, analysis, caseId, timestamp, vaultCitations, missingSourcesNote } = params;
  const sections = [];

  // Header
  sections.push('# Tax Pod Response: Cost Segregation Support\n');
  sections.push('**THIS IS NOT A COST SEGREGATION STUDY**\n');
  sections.push('This is decision support for determining whether to engage a qualified cost segregation engineer/CPA.\n');

  // Summary (Go/No-Go)
  sections.push('## Summary: Go/No-Go Recommendation\n');
  sections.push(`${analysis.summary}\n`);

  // What You Told Me
  sections.push('## What You Told Me\n');
  sections.push(`- Property type: ${intake.property_type || 'Not specified'}`);
  sections.push(`- Purchase price: ${intake.purchase_price_range || 'Not specified'}`);
  sections.push(`- Land value estimate: ${intake.land_value_estimate_range || 'Not specified'}`);
  sections.push(`- Placed in service: ${intake.placed_in_service_year || 'Not specified'}`);
  sections.push(`- Rehab spend: ${intake.rehab_spend_range || 'Not specified'}`);
  sections.push(`- Rehab years: ${intake.rehab_years ? intake.rehab_years.join(', ') : 'Not specified'}`);
  sections.push(`- Short-term rental: ${intake.short_term_rental ? 'Yes' : 'No'}`);
  sections.push(`- Business use %: ${intake.business_use_pct_range || 'Not specified'}`);
  sections.push(`- Marginal tax rate: ${intake.current_marginal_tax_rate_range || 'Not specified'}`);
  sections.push(`- State: ${intake.state || 'Not specified'}`);
  sections.push(`- Entity type: ${intake.entity_type || 'Not specified'}`);
  sections.push(`- Bonus depreciation: ${intake.bonus_depreciation_relevant || 'Unknown'}\n`);

  // Eligibility Flags
  sections.push('## Eligibility Flags\n');
  analysis.eligibilityFlags.forEach(flag => {
    sections.push(`- ${flag}`);
  });
  sections.push('');

  // Estimated Upside (ROUGH, non-authoritative)
  sections.push('## Estimated Upside (ROUGH, Non-Authoritative)\n');
  sections.push('⚠️ **These are ballpark estimates only. NOT tax advice. Actual results depend on detailed engineering analysis.**\n');
  sections.push(`${analysis.estimatedUpside}\n`);

  // Documents to Gather
  sections.push('## Documents to Gather for CPA/Engineer\n');
  analysis.documentsToGather.forEach(doc => {
    sections.push(`- ${doc}`);
  });
  sections.push('');

  // Asset Inventory Template Instructions
  sections.push('## Asset Inventory Template Instructions\n');
  sections.push('A CSV template has been generated: `costseg_asset_inventory_template.csv`\n');
  sections.push('**Instructions:**');
  sections.push('1. Open the CSV in Excel or Google Sheets');
  sections.push('2. Fill in each row with asset details (category, description, cost, date, supporting docs)');
  sections.push('3. Add photos of major improvements (kitchen, HVAC, flooring, landscaping)');
  sections.push('4. Provide this completed template to your cost seg engineer/CPA');
  sections.push('5. The engineer will use this to build the detailed cost segregation study\n');

  // Questions to Ask CPA/Engineer
  sections.push('## Questions to Ask the CPA/Engineer\n');
  analysis.proQuestions.forEach(q => {
    sections.push(`- ${q}`);
  });
  sections.push('');

  // Risks & Audit Considerations
  sections.push('## Risks & Audit Considerations (Plain English)\n');
  analysis.risks.forEach(risk => {
    sections.push(`- ${risk}`);
  });
  sections.push('');

  // Evidence
  sections.push('## Evidence\n');
  sections.push(`- Case ID: ${caseId}`);
  sections.push(`- Timestamp: ${timestamp}`);
  sections.push(`- Agent: cost-seg-support-agent\n`);

  sections.push('**Sources (Internal - Tax Pod Policies):**');
  sections.push('- tax/policies/safe_answering_rules.md');
  sections.push('- tax/policies/disclaimers_and_limits.md');
  sections.push('');

  // IRS Sources from Vault (likely none for cost seg)
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
  }

  // Disclaimer
  sections.push('## Disclaimer\n');
  sections.push('**THIS IS NOT A COST SEGREGATION STUDY.**\n');
  sections.push('This is informational decision support only, not tax advice. You are responsible for verifying all information with qualified cost segregation engineers and licensed tax professionals (CPA, EA, or tax attorney) before taking action. The Tax Pod does not guarantee accuracy, tax savings, or IRS acceptance of cost segregation studies. Cost segregation studies must be performed by qualified engineers using detailed property inspections and engineering analysis. See tax/policies/disclaimers_and_limits.md for full disclaimers.\n');

  sections.push('---\n');
  sections.push('**END OF RESPONSE**\n');

  return sections.join('\n');
}

module.exports = {
  renderCostSegResponseMarkdown
};
