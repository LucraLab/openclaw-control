#!/usr/bin/env node
/**
 * executive_llm_assist.js — Optional LLM Assist for Executive Strategy Engine
 *
 * OFF by default. Only activates when EXEC_STRATEGY_LLM=1 AND an uncertainty
 * trigger fires. Hard constraints:
 *   - max input tokens: 800
 *   - max output tokens: 400
 *   - must output strict JSON matching schema
 *   - on schema invalid / timeout / budget breach → fail closed to rules-only
 *   - no retries
 *
 * Purpose (when active):
 *   - Classify likely root cause category
 *   - Suggest 1 diagnostic next action
 *   - Suggest 1 mitigation option
 *   - Max 3 suggestions total
 */

'use strict';

const schema = require('./executive_strategy_schema');

// Hard token limits
const MAX_INPUT_TOKENS = 800;
const MAX_OUTPUT_TOKENS = 400;

/**
 * Build a compact prompt for the LLM within token budget.
 * Strips to essential data only.
 */
function buildPrompt(result, context) {
  const objId = result.objective_id;
  const events = (context.events || [])
    .filter(e => e.objective_id === objId)
    .slice(-5)
    .map(e => ({ event: e.event, reason: e.reason || '' }));

  const prompt = {
    task: 'classify_and_suggest',
    objective_id: objId,
    priority_score: result.priority_score,
    risk_score: result.risk_score,
    confidence: result.confidence,
    action: result.recommended_action,
    signals: (result.why || []).slice(0, 3),
    recent_events: events,
  };

  const serialized = JSON.stringify(prompt);

  // Rough token estimate: 1 token per 4 chars
  const estimatedTokens = Math.ceil(serialized.length / 4);
  if (estimatedTokens > MAX_INPUT_TOKENS) {
    // Trim further
    prompt.recent_events = events.slice(-2);
    prompt.signals = (result.why || []).slice(0, 2);
  }

  return JSON.stringify(prompt);
}

/**
 * Parse and validate LLM response JSON.
 * Returns validated output or null on failure.
 */
function parseLLMResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') return null;

  try {
    const parsed = JSON.parse(responseText);
    const validation = schema.validateLLMOutput(parsed);
    if (!validation.valid) return null;

    // Enforce max 3 suggestions
    if (parsed.suggestions.length > 3) {
      parsed.suggestions = parsed.suggestions.slice(0, 3);
    }

    return parsed;
  } catch (_e) {
    return null;
  }
}

/**
 * Attempt LLM assist for an objective.
 *
 * This function is the integration point. In v1, it is STUB-ONLY:
 * there is no actual LLM call. The function returns null (no assist)
 * unless a mock/stub is injected for testing.
 *
 * @param {object} result - Current scored result
 * @param {object} context - Full context
 * @param {object} config - Engine config
 * @returns {object|null} LLM assist output or null
 */
function assist(result, context, config) {
  // Fail closed: if LLM not explicitly enabled, return null
  if (process.env.EXEC_STRATEGY_LLM !== '1' && !config.llm_enabled) {
    return null;
  }

  // Build prompt (validates token budget)
  const promptJson = buildPrompt(result, context);

  // --- STUB: No actual LLM call in v1 ---
  // In production, this would call an LLM API with:
  //   - input: promptJson (max 800 tokens)
  //   - max_output_tokens: 400
  //   - timeout: 5000ms
  //   - on failure: return null (fail closed)
  //
  // For testing, config._llmStub can be injected:
  if (typeof config._llmStub === 'function') {
    try {
      const rawResponse = config._llmStub(promptJson);
      const parsed = parseLLMResponse(rawResponse);
      if (!parsed) {
        // Schema invalid → fail closed
        return { failed: true, reason: 'schema_invalid' };
      }
      return parsed;
    } catch (_e) {
      return { failed: true, reason: 'stub_exception' };
    }
  }

  // No stub, no real LLM → rules-only
  return null;
}

module.exports = {
  assist,
  buildPrompt,
  parseLLMResponse,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
};
