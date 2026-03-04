#!/usr/bin/env node
/**
 * payment_plan_first.js - Payment Plan First analysis runtime
 *
 * Pure function: intake JSON -> { responseMarkdown, evidenceRecord }
 * NO NETWORK, NO ENV VARS, NO I/O except through explicit parameters.
 * Deterministic outputs only.
 */

'use strict';

const { renderResponseMarkdown } = require('./render_response.js');
const { buildEvidenceRecord, buildInternalSource } = require('./evidence_writer.js');
const { sanitizePII } = require('./util.js');
const { buildInstallmentAgreementCitations, buildPenaltyCitations, getMissingSources } = require('./vault_reader.js');

/**
 * Analyze payment plan options (Payment Plan First approach)
 * @param {object} intake - Intake data (minimal validation assumed done by caller)
 * @param {object} context - Execution context
 * @param {string} context.nowUtc - ISO 8601 UTC timestamp (injected for determinism)
 * @param {string} context.caseId - Case identifier (injected for determinism)
 * @param {string} context.agentId - Agent identifier
 * @param {object} context.vaultIndex - Vault index (optional, for citations)
 * @returns {object} - { responseMarkdown, evidenceRecord }
 */
function analyzePaymentPlanFirst(intake, context) {
  const { nowUtc, caseId, agentId, vaultIndex } = context;

  // Validate required context
  if (!nowUtc || !caseId || !agentId) {
    throw new Error('analyzePaymentPlanFirst requires nowUtc, caseId, agentId in context');
  }

  // Extract intake data with defaults
  const taxYears = intake.tax_years || [];
  const balanceRange = intake.balance_estimate_range || 'unknown';
  const paymentCapacity = intake.payment_capacity_range || 'unknown';
  const filingStatus = intake.filing_status || 'unknown';
  const noticeReceived = intake.notice_received || false;
  const hardship = intake.hardship || false;
  const state = intake.state || 'unknown';

  // Determine urgency
  let urgency = 'medium';
  if (noticeReceived) {
    urgency = 'high';
  }
  if (hardship) {
    urgency = 'high';
  }

  // Build assumptions
  const assumptions = [
    'Your stated tax years and balance estimate are accurate per IRS records',
    'You have filed (or will file) all required tax returns before requesting payment plan',
    'You do not have other outstanding IRS debts beyond stated amount',
    'Standard IRS collection statute (10 years from assessment) applies',
    'You can afford the payment amount calculated (not verified against actual budget)'
  ];

  if (balanceRange.includes('under')) {
    assumptions.push('Balance under $50k qualifies for streamlined installment agreement');
  }

  // Build immediate steps
  const immediateSteps = [];

  if (!intake.all_returns_filed) {
    immediateSteps.push('**1. File all missing tax returns immediately** (prerequisite for payment plan)');
  }

  immediateSteps.push('**2. Request IRS account transcript** to verify exact balance owed');
  immediateSteps.push('**3. Calculate monthly disposable income** (net income minus IRS allowable expenses)');

  if (noticeReceived) {
    immediateSteps.push('**4. URGENT: Respond to IRS notice before deadline** to preserve rights');
  }

  immediateSteps.push('**5. Consult licensed tax professional** to validate payment plan vs other options (OIC, CNC)');

  // Build pathway description
  let pathway = '';
  if (balanceRange.includes('under $50k') || balanceRange.includes('$25k-$50k')) {
    pathway = `**Streamlined Installment Agreement (Balance < $50k)**

1. **Eligibility:** If balance owed is under $50,000, you may qualify for streamlined IA with up to 72-month term and minimal financial disclosure.

2. **Application:** File Form 9465 (Installment Agreement Request) with the IRS. Can be done online, by mail, or by phone.

3. **Monthly Payment:** IRS will calculate minimum payment (total owed / 72 months). You may propose higher payment to pay off faster.

4. **Setup Fee:** Typically $31-$225 depending on payment method (direct debit vs check/card).

5. **Timeline:** IRS typically responds within 30 days. Penalties and interest continue during plan.

6. **Critical:** Do NOT miss payments. Missed payment can default agreement and trigger levy/lien.`;
  } else if (balanceRange.includes('over $50k') || balanceRange.includes('$50k+')) {
    pathway = `**Non-Streamlined Installment Agreement (Balance >= $50k)**

1. **Financial Statement Required:** Must file Form 433-F (Collection Information Statement) or 433-A (detailed) showing income, expenses, and assets.

2. **Ability-to-Pay Analysis:** IRS will calculate monthly disposable income and require payment at or above that amount.

3. **Longer Process:** More scrutiny than streamlined. IRS may request documentation (pay stubs, bank statements).

4. **Options if Hardship:** If monthly payment exceeds ability-to-pay, consider Currently Not Collectible (CNC) status or Offer in Compromise (OIC).

5. **Professional Help Recommended:** Balances over $50k often benefit from CPA/enrolled agent representation to negotiate optimal terms.`;
  } else {
    pathway = `**General Payment Plan Pathway**

1. Determine exact balance owed (request IRS account transcript)
2. Assess ability-to-pay (monthly income vs IRS allowable expenses)
3. File Form 9465 with proposed payment amount
4. IRS reviews and approves, modifies, or denies
5. If approved, make monthly payments on time (no missed payments)
6. Plan continues until balance paid in full or collection statute expires`;
  }

  // Build pro questions
  const proQuestions = [
    'Can you realistically afford the calculated monthly payment for the full term?',
    'Do your actual monthly expenses exceed IRS allowable expense standards?',
    'Should you pursue Offer in Compromise (OIC) to settle for less than full amount?',
    'Are penalties eligible for abatement (reasonable cause, first-time penalty abatement)?',
    'Is the tax liability even correct? (Consider audit reconsideration if disputed)',
    'Do you qualify for Currently Not Collectible (CNC) status due to financial hardship?'
  ];

  // Build risks
  const risks = [
    'Penalties and interest continue to accrue during payment plan (approximately 3-5% annually)',
    'Missing a payment or owing new taxes can default the agreement, leading to IRS levy or lien',
    'Payment plan may not be optimal; professional should evaluate all options (OIC, CNC, penalty abatement)',
    'If assumptions about balance or filing compliance are wrong, payment plan may be denied',
    'This analysis does NOT address state tax obligations (only federal IRS)'
  ];

  if (hardship) {
    risks.push('Financial hardship may qualify you for Currently Not Collectible (CNC) status instead of payment plan');
  }

  // Build summary
  let summary = '';
  if (balanceRange.includes('under $50k') || balanceRange.includes('$25k-$50k')) {
    summary = `Based on your balance estimate (${balanceRange}), you likely qualify for a **streamlined installment agreement** with up to 72 months to pay and minimal paperwork. Priority: file missing returns immediately, then apply for payment plan. Professional verification required before proceeding.`;
  } else if (balanceRange.includes('over $50k') || balanceRange.includes('$50k+')) {
    summary = `Based on your balance estimate (${balanceRange}), you will need a **non-streamlined installment agreement** requiring detailed financial disclosure. Given complexity and amount, professional representation (CPA/enrolled agent) is strongly recommended to negotiate optimal terms and explore alternatives (OIC, CNC).`;
  } else {
    summary = `Payment plan pathway analysis based on your tax situation. Immediate action: file missing returns, request IRS transcript, calculate ability-to-pay, consult tax professional to validate approach.`;
  }

  // Build analysis object
  const analysis = {
    summary,
    assumptions,
    immediateSteps,
    pathway,
    proQuestions,
    risks
  };

  // Build vault citations if vault index provided
  let vaultCitations = [];
  let missingSourcesNote = null;

  if (vaultIndex) {
    // Cite IRM 5.14.1 for installment agreement guidance
    vaultCitations = buildInstallmentAgreementCitations(vaultIndex);

    // Check for missing sources
    const missingSources = getMissingSources(vaultIndex);
    if (missingSources.length > 0) {
      const missingTitles = missingSources.map(s => s.title).join(', ');
      missingSourcesNote = `Missing vault sources: ${missingTitles}. These will be added in a future port.`;
    }
  }

  // Render response markdown
  const responseMarkdown = renderResponseMarkdown({
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
      case_type: 'installment_agreement',
      tax_years: taxYears,
      amount_involved: extractBalanceEstimate(balanceRange),
      urgency_level: urgency,
      user_summary_sanitized: sanitizePII(`Payment plan analysis for ${taxYears.join(', ')} with balance ${balanceRange}`),
      prerequisites_provided: intake.all_returns_filed ? ['returns_filed'] : []
    },

    assumptions,

    sources: [
      buildInternalSource('tax/policies/safe_answering_rules.md', 'internal_document', 'Tax Pod Safe Answering Rules'),
      buildInternalSource('tax/policies/disclaimers_and_limits.md', 'internal_document', 'Tax Pod Disclaimers and Limits'),
      buildInternalSource('tax/intake/schemas/installment_agreement_intake.schema.json', 'internal_document', 'Installment Agreement Intake Schema'),
      ...vaultCitations
    ],

    outputsSummary: {
      recommendation: summary,
      options_presented: balanceRange.includes('under $50k') ? ['streamlined_ia', 'short_term_plan'] : ['non_streamlined_ia', 'oic', 'cnc'],
      recommended_option: balanceRange.includes('under $50k') ? 'streamlined_ia' : 'non_streamlined_ia_with_pro',
      justification: balanceRange.includes('under $50k')
        ? 'Balance under $50k qualifies for streamlined IA with minimal paperwork'
        : 'Balance over $50k requires detailed financial analysis and professional representation',
      urgency_flagged: urgency
    },

    risks,

    nextQuestions: proQuestions,

    artifacts: [
      {
        type: 'response_output',
        format: 'markdown',
        sanitized: true
      }
    ]
  });

  return {
    responseMarkdown,
    evidenceRecord
  };
}

/**
 * Extract numeric balance estimate from range string
 * @param {string} range - Balance range string
 * @returns {number} - Midpoint estimate
 */
function extractBalanceEstimate(range) {
  if (range.includes('under $10k')) return 5000;
  if (range.includes('$10k-$25k')) return 17500;
  if (range.includes('$25k-$50k')) return 37500;
  if (range.includes('over $50k') || range.includes('$50k+')) return 75000;
  return 0;
}

module.exports = {
  analyzePaymentPlanFirst
};
