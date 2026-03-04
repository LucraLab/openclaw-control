#!/usr/bin/env node
/**
 * cost_seg_support.js - Cost Segregation Support analysis runtime
 *
 * Pure function: intake JSON -> { responseMarkdown, evidenceRecord, csvText }
 * NO NETWORK, NO ENV VARS, NO I/O except through explicit parameters.
 * Deterministic outputs only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { renderCostSegResponseMarkdown } = require('./render_costseg_response.js');
const { buildEvidenceRecord, buildInternalSource } = require('./evidence_writer.js');
const { sanitizePII } = require('./util.js');
const { getMissingSources } = require('./vault_reader.js');

/**
 * Analyze cost segregation opportunity (decision support + CPA handoff)
 * @param {object} intake - Intake data
 * @param {object} context - Execution context
 * @param {string} context.nowUtc - ISO 8601 UTC timestamp (injected for determinism)
 * @param {string} context.caseId - Case identifier (injected for determinism)
 * @param {string} context.agentId - Agent identifier
 * @param {object} context.vaultIndex - Vault index (optional, for citations)
 * @param {string} context.repoRoot - Repo root path (for loading CSV template)
 * @returns {object} - { responseMarkdown, evidenceRecord, csvText }
 */
function analyzeCostSegSupport(intake, context) {
  const { nowUtc, caseId, agentId, vaultIndex, repoRoot } = context;

  // Validate required context
  if (!nowUtc || !caseId || !agentId) {
    throw new Error('analyzeCostSegSupport requires nowUtc, caseId, agentId in context');
  }

  // Extract intake data with defaults
  const propertyType = intake.property_type || 'Unknown';
  const purchasePriceRange = intake.purchase_price_range || 'unknown';
  const landValueRange = intake.land_value_estimate_range || 'unknown';
  const placedInServiceYear = intake.placed_in_service_year || 'unknown';
  const rehabSpendRange = intake.rehab_spend_range || 'none';
  const rehabYears = intake.rehab_years || [];
  const shortTermRental = intake.short_term_rental || false;
  const businessUsePct = intake.business_use_pct_range || 'unknown';
  const taxRateRange = intake.current_marginal_tax_rate_range || 'unknown';
  const state = intake.state || 'unknown';
  const entityType = intake.entity_type || 'unknown';
  const bonusDepreciation = intake.bonus_depreciation_relevant || 'unknown';
  const improvementsCategories = intake.improvements_categories || [];

  // Determine go/no-go recommendation
  const goNoGo = determineGoNoGo(purchasePriceRange, rehabSpendRange, placedInServiceYear, shortTermRental);

  // Build eligibility flags
  const eligibilityFlags = [];

  if (shortTermRental) {
    eligibilityFlags.push('✅ **Short-term rental** (Airbnb/VRBO style) - May qualify for higher deductions via cost seg + bonus depreciation');
  } else {
    eligibilityFlags.push('ℹ️ Long-term rental - Standard MACRS depreciation applies (27.5 years residential)');
  }

  if (businessUsePct.includes('100') || businessUsePct.includes('90-100')) {
    eligibilityFlags.push('✅ **High business use %** - Good candidate for cost seg');
  } else if (businessUsePct !== 'unknown') {
    eligibilityFlags.push('⚠️ Partial business use - Only business-use portion eligible for cost seg benefits');
  }

  const currentYear = new Date().getFullYear();
  const yearsSincePlacement = currentYear - (parseInt(placedInServiceYear) || currentYear);

  if (yearsSincePlacement <= 1) {
    eligibilityFlags.push('✅ **Recently placed in service** - Prime window for cost seg analysis');
  } else if (yearsSincePlacement <= 3) {
    eligibilityFlags.push('ℹ️ Placed in service within last 3 years - Still viable for cost seg via catch-up depreciation (Form 3115)');
  } else if (yearsSincePlacement > 10) {
    eligibilityFlags.push('⚠️ Placed in service over 10 years ago - Cost seg benefits may be minimal due to depreciation already taken');
  }

  if (rehabYears.length > 0) {
    eligibilityFlags.push('✅ **Substantial improvements made** - Rehab costs are often prime targets for cost seg reclassification');
  }

  // Estimated upside (ROUGH, non-authoritative)
  let estimatedUpside = '';
  if (goNoGo === 'GO') {
    estimatedUpside = `Based on the property details:\n\n`;
    estimatedUpside += `- **Purchase price range:** ${purchasePriceRange}\n`;
    estimatedUpside += `- **Rehab spend range:** ${rehabSpendRange}\n`;
    estimatedUpside += `- **Estimated building basis (excluding land):** ${estimateBuildingBasis(purchasePriceRange, landValueRange, rehabSpendRange)}\n\n`;
    estimatedUpside += `**ROUGH estimated tax benefit (Year 1):**\n`;
    estimatedUpside += `- If cost seg identifies 20-40% of building basis as 5/7/15-year property (typical range)\n`;
    estimatedUpside += `- And bonus depreciation applies (100% for qualified property placed in service 2022-2023)\n`;
    estimatedUpside += `- Estimated first-year deduction boost: ${estimateFirstYearBoost(purchasePriceRange, rehabSpendRange, bonusDepreciation)}\n`;
    estimatedUpside += `- At ${taxRateRange} marginal tax rate, estimated tax savings: ${estimateTaxSavings(purchasePriceRange, rehabSpendRange, taxRateRange, bonusDepreciation)}\n\n`;
    estimatedUpside += `⚠️ **CRITICAL:** These are ballpark estimates only. Actual results require detailed engineering analysis. Cost seg study fees typically range $5k-$15k+ depending on property complexity.`;
  } else if (goNoGo === 'MAYBE') {
    estimatedUpside = `Cost seg may provide modest benefits, but professional analysis required to determine if study cost justifies potential savings. Factors to consider:\n\n`;
    estimatedUpside += `- Property size and rehab spend are on the lower end for typical cost seg ROI\n`;
    estimatedUpside += `- Study fees ($5k-$15k) may exceed first-year tax savings\n`;
    estimatedUpside += `- Consult CPA to run preliminary numbers before committing to full study`;
  } else {
    estimatedUpside = `Based on the property details, cost segregation is **NOT RECOMMENDED** at this time:\n\n`;
    estimatedUpside += `- Property value/rehab spend too low to justify study costs\n`;
    estimatedUpside += `- Standard depreciation (27.5 years residential) is likely the best approach\n`;
    estimatedUpside += `- Focus on other tax strategies (expense maximization, proper entity structure, etc.)`;
  }

  // Documents to gather
  const documentsToGather = [
    'Purchase contract (HUD-1 settlement statement if available)',
    'Appraisal report (especially land value allocation)',
    'All rehab/improvement invoices (contractors, materials, permits)',
    'Photos of property (before/after rehab if applicable)',
    'Floor plans or building blueprints (if available)',
    'Building permits for improvements',
    'Property insurance declarations (to verify square footage/details)',
    'Prior year tax returns (to see depreciation schedule)',
    'Rental income records (to verify business use %)',
    'Engineering or inspection reports (if any)'
  ];

  // Questions to ask CPA/engineer
  const proQuestions = [
    'What is the estimated cost for a cost segregation study on this property?',
    'Based on preliminary review, what % of building basis do you estimate can be reclassified to 5/7/15-year property?',
    'Does my property qualify for bonus depreciation? (placed in service date matters)',
    'If I already started taking depreciation, how do I catch up using Form 3115?',
    'What is the estimated first-year tax benefit vs. the cost of the study?',
    'How defensible is this study if the IRS audits? (quality of engineering analysis matters)',
    'Are there state tax implications I should consider?',
    'Should I consider a cost seg for this property or wait for a larger acquisition?'
  ];

  // Risks & audit considerations
  const risks = [
    'Cost segregation studies MUST be performed by qualified engineers - not DIY',
    'Low-quality studies (template-based, no site inspection) are IRS audit magnets',
    'Study costs ($5k-$15k+) may exceed tax benefits for smaller properties',
    'Bonus depreciation creates large Year 1 deduction but may trigger passive loss limitations',
    'If you sell the property, accelerated depreciation becomes recapture income (taxed at ordinary rates up to 25%)',
    'State tax treatment varies - some states do not conform to federal bonus depreciation rules',
    'This analysis does NOT address passive activity loss rules (rental real estate income classification matters)',
    'Short-term rental status must be substantiated (avg rental period < 7 days AND substantial services provided)'
  ];

  if (shortTermRental) {
    risks.push('Short-term rental classification requires careful documentation - IRS scrutinizes this heavily');
  }

  // Build summary
  let summary = '';
  if (goNoGo === 'GO') {
    summary = `**GO:** This property appears to be a strong candidate for cost segregation analysis. `;
    summary += `Estimated tax benefits likely exceed study costs. Consult a qualified cost segregation engineer/CPA for detailed analysis.`;
  } else if (goNoGo === 'MAYBE') {
    summary = `**MAYBE:** Cost seg may provide benefits, but ROI is uncertain. Run preliminary numbers with CPA before committing to full study.`;
  } else {
    summary = `**NO-GO:** Cost segregation is NOT recommended for this property at this time. Standard depreciation is the better approach.`;
  }

  // Build analysis object
  const analysis = {
    summary,
    goNoGo,
    eligibilityFlags,
    estimatedUpside,
    documentsToGather,
    proQuestions,
    risks
  };

  // Build vault citations (likely none for cost seg)
  let vaultCitations = [];
  let missingSourcesNote = null;

  if (vaultIndex) {
    // Cost seg studies don't typically cite vault sources
    // Missing sources should include cost seg specific guidance
    const missingSources = getMissingSources(vaultIndex);
    const costSegMissing = [
      'MACRS depreciation rules guidance (IRS Pub 946)',
      'Cost segregation audit technique guidance (IRS ATG)',
      'Bonus depreciation rules summaries (IRS guidance)',
      'Form 4562 instructions (depreciation)',
      'Tangible property regulations (IRS Regs 1.263(a))'
    ];

    const allMissing = [...missingSources.map(s => s.title), ...costSegMissing];
    missingSourcesNote = `Missing vault sources: ${allMissing.join(', ')}. Cost segregation requires specialized engineering and tax guidance not yet in vault.`;
  }

  // Load CSV template
  let csvText = '';
  if (repoRoot) {
    try {
      const csvPath = path.join(repoRoot, 'tax', 'templates', 'costseg_asset_inventory_template.csv');
      csvText = fs.readFileSync(csvPath, 'utf8');
    } catch (err) {
      csvText = 'ERROR: Could not load CSV template. Template should be at tax/templates/costseg_asset_inventory_template.csv';
    }
  } else {
    csvText = 'ERROR: repoRoot not provided in context. Cannot load CSV template.';
  }

  // Render response markdown
  const responseMarkdown = renderCostSegResponseMarkdown({
    intake,
    analysis,
    caseId,
    timestamp: nowUtc,
    vaultCitations,
    missingSourcesNote
  });

  // Build evidence record
  const evidenceRecord = buildEvidenceRecord({
    caseId,
    timestamp: nowUtc,
    agentId,

    inputsSummary: {
      case_type: 'cost_segregation',
      tax_years: [placedInServiceYear],
      amount_involved: extractPurchaseEstimate(purchasePriceRange),
      urgency_level: 'medium',
      user_summary_sanitized: sanitizePII(`Cost seg analysis for ${propertyType} placed in service ${placedInServiceYear}`),
      prerequisites_provided: []
    },

    assumptions: [
      'Property details you provided are accurate (purchase price, land value, rehab costs)',
      'Business use % represents actual rental/business activity (not personal use)',
      'Property was placed in service in the year stated',
      'Property is depreciable business or investment property (not personal residence)',
      'No prior cost segregation study has been performed on this property',
      'Estimated tax rates and ranges are approximations for planning purposes only'
    ],

    sources: [
      buildInternalSource('tax/policies/safe_answering_rules.md', 'internal_document', 'Tax Pod Safe Answering Rules'),
      buildInternalSource('tax/policies/disclaimers_and_limits.md', 'internal_document', 'Tax Pod Disclaimers and Limits'),
      ...vaultCitations
    ],

    outputsSummary: {
      recommendation: summary,
      options_presented: ['cost_seg_study', 'standard_depreciation', 'preliminary_analysis'],
      recommended_option: goNoGo === 'GO' ? 'cost_seg_study' : (goNoGo === 'MAYBE' ? 'preliminary_analysis' : 'standard_depreciation'),
      justification: goNoGo === 'GO'
        ? 'Property characteristics suggest cost seg benefits likely exceed study costs'
        : (goNoGo === 'MAYBE'
          ? 'ROI uncertain; preliminary CPA analysis recommended before full study'
          : 'Property value/rehab spend too low to justify cost seg study costs'),
      professional_verification_required: true,
      urgency_flagged: 'medium'
    },

    risks,

    nextQuestions: proQuestions,

    artifacts: [
      {
        type: 'response_output',
        format: 'markdown',
        sanitized: true
      },
      {
        type: 'calculation_worksheet',
        format: 'csv',
        sanitized: true,
        path: 'costseg_asset_inventory_template.csv'
      }
    ]
  });

  return {
    responseMarkdown,
    evidenceRecord,
    csvText
  };
}

/**
 * Determine go/no-go recommendation
 */
function determineGoNoGo(purchasePriceRange, rehabSpendRange, placedInServiceYear, shortTermRental) {
  const purchaseEstimate = extractPurchaseEstimate(purchasePriceRange);
  const rehabEstimate = extractRehabEstimate(rehabSpendRange);
  const totalBasis = purchaseEstimate + rehabEstimate;

  // Heuristics (rough guidelines)
  if (totalBasis >= 500000 || (shortTermRental && totalBasis >= 300000)) {
    return 'GO';
  } else if (totalBasis >= 200000 || (shortTermRental && totalBasis >= 150000)) {
    return 'MAYBE';
  } else {
    return 'NO-GO';
  }
}

/**
 * Estimate building basis (excluding land)
 */
function estimateBuildingBasis(purchasePriceRange, landValueRange, rehabSpendRange) {
  const purchase = extractPurchaseEstimate(purchasePriceRange);
  const land = extractLandEstimate(landValueRange);
  const rehab = extractRehabEstimate(rehabSpendRange);
  const building = purchase - land + rehab;
  return `$${(building / 1000).toFixed(0)}k (estimated)`;
}

/**
 * Estimate first-year deduction boost
 */
function estimateFirstYearBoost(purchasePriceRange, rehabSpendRange, bonusDepreciation) {
  const purchase = extractPurchaseEstimate(purchasePriceRange);
  const land = purchase * 0.2; // Assume 20% land
  const rehab = extractRehabEstimate(rehabSpendRange);
  const building = purchase - land + rehab;

  // Assume 30% reclassified to 5/7/15 year (conservative)
  const reclassified = building * 0.30;

  if (bonusDepreciation === 'yes' || bonusDepreciation === 'unknown') {
    return `$${(reclassified / 1000).toFixed(0)}k - $${(reclassified * 0.4 / 1000).toFixed(0)}k additional depreciation`;
  } else {
    return `$${(reclassified * 0.15 / 1000).toFixed(0)}k - $${(reclassified * 0.25 / 1000).toFixed(0)}k additional depreciation`;
  }
}

/**
 * Estimate tax savings
 */
function estimateTaxSavings(purchasePriceRange, rehabSpendRange, taxRateRange, bonusDepreciation) {
  const purchase = extractPurchaseEstimate(purchasePriceRange);
  const land = purchase * 0.2;
  const rehab = extractRehabEstimate(rehabSpendRange);
  const building = purchase - land + rehab;
  const reclassified = building * 0.30;

  let taxRate = 0.32; // Default
  if (taxRateRange.includes('37')) taxRate = 0.37;
  else if (taxRateRange.includes('35')) taxRate = 0.35;
  else if (taxRateRange.includes('32')) taxRate = 0.32;
  else if (taxRateRange.includes('24')) taxRate = 0.24;

  const savings = reclassified * taxRate;
  return `$${(savings / 1000).toFixed(0)}k - $${(savings * 1.3 / 1000).toFixed(0)}k (rough estimate)`;
}

/**
 * Extract numeric estimates from ranges
 */
function extractPurchaseEstimate(range) {
  if (range.includes('under $250k')) return 150000;
  if (range.includes('$250k-$500k')) return 375000;
  if (range.includes('$500k-$1M')) return 750000;
  if (range.includes('over $1M')) return 1500000;
  return 0;
}

function extractLandEstimate(range) {
  if (range.includes('under $50k')) return 30000;
  if (range.includes('$50k-$100k')) return 75000;
  if (range.includes('$100k-$150k')) return 125000;
  if (range.includes('$150k-$250k')) return 200000;
  return 0;
}

function extractRehabEstimate(range) {
  if (range === 'none' || range === 'unknown') return 0;
  if (range.includes('under $50k')) return 25000;
  if (range.includes('$50k-$100k')) return 75000;
  if (range.includes('$100k-$200k')) return 150000;
  if (range.includes('$200k-$500k')) return 350000;
  if (range.includes('over $500k')) return 750000;
  return 0;
}

module.exports = {
  analyzeCostSegSupport
};
