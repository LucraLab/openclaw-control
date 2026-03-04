#!/usr/bin/env node
/**
 * vault_reader.js - Vault citation builder for Tax Pod
 *
 * Pure functions for reading vault index and building citations.
 * NO PARSING of HTML/PDF content in P6 (determinism constraint).
 * Citations are metadata-only from vault index.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load vault index from repo-relative path
 * @param {string} repoRoot - Absolute path to repo root
 * @returns {object} - Parsed vault index
 */
function loadVaultIndex(repoRoot) {
  const indexPath = path.join(repoRoot, 'tax', 'vault', 'index.json');

  if (!fs.existsSync(indexPath)) {
    throw new Error(`Vault index not found at: ${indexPath}`);
  }

  const indexJson = fs.readFileSync(indexPath, 'utf8');
  return JSON.parse(indexJson);
}

/**
 * Get source metadata by ID
 * @param {object} index - Vault index
 * @param {string} sourceId - Source ID (e.g., "irm-5.14.1")
 * @returns {object|null} - Source metadata or null if not found
 */
function getSourceById(index, sourceId) {
  return index.sources[sourceId] || null;
}

/**
 * Build citation object from source metadata
 * @param {object} source - Source metadata from vault index
 * @param {string} locator - Locator string (e.g., "topic=installment_agreement")
 * @returns {object} - Citation object for evidence record
 */
function buildCitation(source, locator) {
  if (!source) {
    return null;
  }

  return {
    type: 'irs_source',
    identifier: `${source.path}#${locator}`,
    title: source.title,
    last_updated: source.last_updated,
    locator: locator,
    quote: null  // No quotes in P6 (no parsing)
  };
}

/**
 * Build citations for installment agreement analysis
 * @param {object} vaultIndex - Vault index
 * @returns {array} - Array of citation objects
 */
function buildInstallmentAgreementCitations(vaultIndex) {
  const citations = [];

  // Cite IRM 5.14.1 (Securing Installment Agreements)
  const irm5141 = getSourceById(vaultIndex, 'irm-5.14.1');
  if (irm5141) {
    citations.push(buildCitation(irm5141, 'topic=installment_agreement'));
  }

  return citations;
}

/**
 * Build citations for penalty relief concepts
 * @param {object} vaultIndex - Vault index
 * @returns {array} - Array of citation objects
 */
function buildPenaltyCitations(vaultIndex) {
  const citations = [];

  // Cite IRM 20.1.1 (Introduction and Penalty Relief)
  const irm2011 = getSourceById(vaultIndex, 'irm-20.1.1');
  if (irm2011) {
    citations.push(buildCitation(irm2011, 'topic=penalty_relief'));
  }

  return citations;
}

/**
 * Get missing sources list from vault index
 * @param {object} vaultIndex - Vault index
 * @returns {array} - Array of missing source objects
 */
function getMissingSources(vaultIndex) {
  return vaultIndex.missing_sources || [];
}

module.exports = {
  loadVaultIndex,
  getSourceById,
  buildCitation,
  buildInstallmentAgreementCitations,
  buildPenaltyCitations,
  getMissingSources
};
