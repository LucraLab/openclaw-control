#!/usr/bin/env node
/**
 * irs_notice_triage.js - IRS Notice Triage analysis runtime
 *
 * Pure function: intake JSON -> { responseMarkdown, evidenceRecord }
 * NO NETWORK, NO ENV VARS, NO I/O except through explicit parameters.
 * Deterministic outputs only.
 */

'use strict';

const { renderNoticeResponseMarkdown } = require('./render_notice_response.js');
const { buildEvidenceRecord, buildInternalSource } = require('./evidence_writer.js');
const { sanitizePII } = require('./util.js');
const { buildInstallmentAgreementCitations, buildPenaltyCitations, getMissingSources } = require('./vault_reader.js');

/**
 * Analyze IRS notice (triage and action plan)
 * @param {object} intake - Intake data
 * @param {object} context - Execution context
 * @param {string} context.nowUtc - ISO 8601 UTC timestamp (injected for determinism)
 * @param {string} context.caseId - Case identifier (injected for determinism)
 * @param {string} context.agentId - Agent identifier
 * @param {object} context.vaultIndex - Vault index (optional, for citations)
 * @returns {object} - { responseMarkdown, evidenceRecord }
 */
function analyzeIrsNoticeTriage(intake, context) {
  const { nowUtc, caseId, agentId, vaultIndex } = context;

  // Validate required context
  if (!nowUtc || !caseId || !agentId) {
    throw new Error('analyzeIrsNoticeTriage requires nowUtc, caseId, agentId in context');
  }

  // Extract intake data with defaults
  const noticeCode = intake.notice_code || 'UNKNOWN';
  const noticeSummary = intake.notice_summary || '';
  const taxYear = intake.tax_year || 'unknown';
  const amountDueRange = intake.amount_due_range || 'unknown';
  const receivedDate = intake.received_date || 'unknown';
  const deadlineDate = intake.deadline_date || null;
  const hasFiledAll = intake.has_filed_all_returns !== false;
  const hardship = intake.hardship || false;
  const contactAttempted = intake.contact_attempted || false;
  const state = intake.state || 'unknown';

  // Classify notice type
  const noticeTypeGuess = classifyNotice(noticeCode, noticeSummary);

  // Determine urgency
  const urgency = determineUrgency(noticeSummary, deadlineDate, hardship);

  // Build immediate steps (first 72 hours)
  const immediateSteps = [];

  if (!contactAttempted && urgency === 'critical') {
    immediateSteps.push('**1. URGENT: Call IRS immediately** (number on notice) to confirm deadline and prevent levy');
  }

  if (!hasFiledAll) {
    immediateSteps.push('**File all missing tax returns immediately** (prerequisite for most resolution options)');
  }

  immediateSteps.push('**Request IRS account transcript** (online via IRS.gov or Form 4506-T) to verify exact balance and status');

  if (deadlineDate) {
    immediateSteps.push(`**Do NOT miss the deadline: ${deadlineDate}** - Mark calendar, set reminders`);
  }

  immediateSteps.push('**Consult licensed EA/CPA/tax attorney within 72 hours** - Do not navigate IRS notices alone');

  if (urgency === 'critical') {
    immediateSteps.push('**Gather all documents immediately** (see checklist below) for professional consultation');
  } else {
    immediateSteps.push('**Begin gathering documents** (see checklist below) for professional review');
  }

  // Documents to gather
  const documentsToGather = [
    'Copy of the IRS notice (all pages)',
    'IRS account transcript (request online or via Form 4506-T)',
    'Tax returns for the year(s) in question',
    'Proof of prior payments made (bank statements, canceled checks)',
    'Correspondence history with IRS (if any)',
    'Financial statements (if considering payment plan or OIC)',
    'Notice of any life events causing hardship (medical, job loss, etc.)'
  ];

  // Build options section
  let options = '';
  if (urgency === 'critical') {
    options = `**Given the urgency (${urgency.toUpperCase()}), immediate professional intervention is critical.**\n\n`;
    options += `Options a professional may explore:\n`;
    options += `- **Collection Due Process (CDP) Hearing:** If levy notice, you may request a hearing to pause collection.\n`;
    options += `- **Installment Agreement:** Payment plan to resolve balance over time (requires all returns filed).\n`;
    options += `- **Currently Not Collectible (CNC):** Temporary pause if you cannot pay due to hardship.\n`;
    options += `- **Offer in Compromise (OIC):** Settle for less than full amount (strict eligibility).\n`;
    options += `- **Penalty Abatement:** Request removal of penalties if reasonable cause exists.\n`;
  } else {
    options = `Options to discuss with a professional:\n\n`;
    options += `- **Installment Agreement:** Pay over time (up to 72 months for balances under $50k).\n`;
    options += `- **Short-Term Payment Plan:** Pay in full within 180 days (no setup fee).\n`;
    options += `- **Offer in Compromise (OIC):** Settle for less (requires detailed financial disclosure).\n`;
    options += `- **Currently Not Collectible (CNC):** Temporary relief if unable to pay.\n`;
    options += `- **Penalty Abatement:** Request removal of penalties (first-time penalty abatement, reasonable cause).\n`;
    options += `- **Audit Reconsideration:** Challenge the tax liability if you believe it's incorrect.\n`;
  }

  // What NOT to do
  const whatNotToDo = [
    'Do NOT ignore the notice (penalties and interest accrue daily)',
    'Do NOT pay with credit card before exploring options (may worsen financial situation)',
    'Do NOT share your SSN, bank account, or credit card over unsolicited phone calls (IRS scams are common)',
    'Do NOT agree to payment terms you cannot sustain (defaulting worsens situation)',
    'Do NOT attempt complex negotiations with IRS without professional representation',
    'Do NOT file missing returns after the deadline without consulting a professional first'
  ];

  // Questions to ask a professional
  const proQuestions = [
    'Is the amount the IRS claims actually correct? (Audit reconsideration if disputed)',
    'Am I eligible for penalty abatement (first-time, reasonable cause)?',
    'Should I pursue Currently Not Collectible status instead of a payment plan?',
    'Do I qualify for Offer in Compromise to settle for less than full amount?',
    'If this is a levy notice, should I request a Collection Due Process hearing?',
    'What is the collection statute expiration date for this debt?',
    'Are there state tax implications I need to address separately?'
  ];

  // Handoff pack checklist
  const handoffChecklist = [
    'Copy of IRS notice (all pages)',
    'IRS account transcript',
    'Tax returns for affected years',
    'Proof of payments made',
    'List of assets and liabilities (if discussing OIC or CNC)',
    'Income and expense documentation (pay stubs, bank statements)',
    'Timeline of events leading to tax issue',
    'Any prior IRS correspondence or agreements',
    'Power of Attorney (Form 2848) authorization for representation'
  ];

  // Build risks
  const risks = [
    'Ignoring an IRS notice can lead to levy (wage garnishment, bank account seizure) or lien (public record affecting credit)',
    'Penalties and interest continue to accrue until resolved (approximately 3-5% annually)',
    'This analysis is NOT a substitute for professional representation - IRS notices require expert handling',
    'Acting on this triage without professional verification may result in missed deadlines or incorrect responses',
    'If the notice is fraudulent (IRS scam), verifying authenticity with IRS directly is critical',
    'State tax obligations are NOT addressed in this analysis (only federal IRS)'
  ];

  if (!hasFiledAll) {
    risks.push('Missing tax returns will prevent most resolution options - filing compliance is mandatory');
  }

  if (hardship) {
    risks.push('Financial hardship may qualify for Currently Not Collectible status, but requires detailed financial disclosure');
  }

  // Build summary
  let summary = '';
  if (urgency === 'critical') {
    summary = `⚠️ **CRITICAL URGENCY:** This notice contains severe language (levy, lien, or final notice keywords). `;
    summary += `Deadline: ${deadlineDate || 'CHECK NOTICE'}. `;
    summary += `You must consult a licensed EA/CPA/tax attorney **immediately** (within 24-48 hours). `;
    summary += `Do NOT attempt to handle this alone. Professional representation can prevent asset seizure.`;
  } else if (urgency === 'high') {
    summary = `**HIGH URGENCY:** This notice requires prompt action. `;
    summary += `Deadline: ${deadlineDate || 'Check notice for deadline'}. `;
    summary += `Consult a licensed EA/CPA/tax attorney within 72 hours to preserve your rights and explore options.`;
  } else {
    summary = `This notice requires attention but is not immediately critical. `;
    summary += `Consult a licensed EA/CPA/tax attorney within 1-2 weeks to develop a response plan. `;
    summary += `Do not ignore—penalties and interest accrue daily.`;
  }

  // Build analysis object
  const analysis = {
    summary,
    noticeTypeGuess,
    urgency,
    immediateSteps,
    documentsToGather,
    options,
    whatNotToDo,
    proQuestions,
    handoffChecklist,
    risks
  };

  // Build vault citations if vault index provided
  let vaultCitations = [];
  let missingSourcesNote = null;

  if (vaultIndex) {
    // Cite IRM 5.14.1 if discussing payment plans
    if (options.includes('Installment Agreement')) {
      vaultCitations.push(...buildInstallmentAgreementCitations(vaultIndex));
    }

    // Cite IRM 20.1.1 if discussing penalty abatement
    if (options.includes('Penalty Abatement')) {
      vaultCitations.push(...buildPenaltyCitations(vaultIndex));
    }

    // Check for missing sources
    const missingSources = getMissingSources(vaultIndex);
    if (missingSources.length > 0) {
      const missingTitles = missingSources.map(s => s.title).join(', ');
      missingSourcesNote = `Missing vault sources: ${missingTitles}. Notice-specific IRS publications not yet in vault.`;
    }
  }

  // Render response markdown
  const responseMarkdown = renderNoticeResponseMarkdown({
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
      case_type: 'irs_notice_response',
      tax_years: [taxYear],
      amount_involved: extractAmountEstimate(amountDueRange),
      urgency_level: urgency,
      user_summary_sanitized: sanitizePII(`IRS notice ${noticeCode} for ${taxYear} with balance ${amountDueRange}`),
      prerequisites_provided: hasFiledAll ? ['returns_filed'] : []
    },

    assumptions: [
      'The IRS notice you received is authentic (not a scam)',
      'The notice accurately reflects IRS records (you should verify with account transcript)',
      'All information you provided is accurate and complete',
      'You have not already responded to this notice or made payment arrangements',
      'Standard IRS collection procedures apply (no special circumstances like bankruptcy)',
      'This analysis addresses federal IRS notices only, not state tax notices'
    ],

    sources: [
      buildInternalSource('tax/policies/safe_answering_rules.md', 'internal_document', 'Tax Pod Safe Answering Rules'),
      buildInternalSource('tax/policies/disclaimers_and_limits.md', 'internal_document', 'Tax Pod Disclaimers and Limits'),
      ...vaultCitations
    ],

    outputsSummary: {
      recommendation: summary,
      options_presented: ['installment_agreement', 'oic', 'cnc', 'penalty_abatement', 'cdp_hearing'],
      recommended_option: urgency === 'critical' ? 'immediate_professional_intervention' : 'professional_consultation',
      justification: urgency === 'critical'
        ? 'Critical urgency requires immediate professional intervention to prevent levy/lien'
        : 'IRS notice response requires professional guidance to preserve rights and explore optimal resolution',
      professional_verification_required: true,
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
 * Classify notice type based on notice code and summary
 * @param {string} noticeCode - Notice code (e.g., CP14, LT11)
 * @param {string} noticeSummary - Summary text
 * @returns {string} - Notice type guess
 */
function classifyNotice(noticeCode, noticeSummary) {
  const code = noticeCode.toUpperCase();
  const summary = noticeSummary.toLowerCase();

  // Common notice types
  if (code === 'CP14' || summary.includes('balance due')) {
    return 'Balance Due Notice (likely CP14 or similar)';
  }

  if (code.startsWith('LT') || summary.includes('levy') || summary.includes('intent to levy')) {
    return 'Levy Notice (Intent to Seize Assets)';
  }

  if (code === 'CP2000' || summary.includes('proposed changes') || summary.includes('underreported income')) {
    return 'Proposed Tax Changes (likely CP2000 - underreported income)';
  }

  if (summary.includes('audit') || summary.includes('examination')) {
    return 'Audit or Examination Notice';
  }

  if (summary.includes('lien') || summary.includes('federal tax lien')) {
    return 'Federal Tax Lien Notice';
  }

  if (summary.includes('penalty') || summary.includes('interest')) {
    return 'Penalty or Interest Assessment Notice';
  }

  if (summary.includes('final notice') || summary.includes('final')) {
    return 'Final Notice (escalated collection action)';
  }

  return `Notice type unclear (code: ${noticeCode}). Professional review required to classify.`;
}

/**
 * Determine urgency level
 * @param {string} noticeSummary - Notice summary text
 * @param {string|null} deadlineDate - Deadline date if present
 * @param {boolean} hardship - Whether user indicated hardship
 * @returns {string} - Urgency level (low|medium|high|critical)
 */
function determineUrgency(noticeSummary, deadlineDate, hardship) {
  const summary = noticeSummary.toLowerCase();

  // Critical: levy, lien, final notice, intent to seize
  if (summary.includes('levy') || summary.includes('intent to levy') ||
      summary.includes('seize') || summary.includes('final notice') ||
      summary.includes('lien')) {
    return 'critical';
  }

  // High: deadline present or audit/examination
  if (deadlineDate || summary.includes('audit') || summary.includes('examination')) {
    return 'high';
  }

  // Medium: balance due, proposed changes
  if (summary.includes('balance due') || summary.includes('proposed changes')) {
    return 'medium';
  }

  // Default medium
  return 'medium';
}

/**
 * Extract numeric amount estimate from range string
 * @param {string} range - Amount range string
 * @returns {number} - Midpoint estimate
 */
function extractAmountEstimate(range) {
  if (range.includes('under $10k')) return 5000;
  if (range.includes('$10k-$25k')) return 17500;
  if (range.includes('$25k-$50k')) return 37500;
  if (range.includes('over $50k') || range.includes('$50k+')) return 75000;
  return 0;
}

module.exports = {
  analyzeIrsNoticeTriage
};
