// Central model configuration for all Claude API calls in Prospector.
// To swap a model: change it here, rebuild. No other files need to change.

export const MODELS = {
  // High reasoning — used for complex analysis (DealTimeline, ActionItems deliverables)
  REASONING: 'claude-opus-4-8',

  // Standard — used for most panels (Pre-Call, Intel Q&A, Morning Brief, Comms)
  STANDARD: 'claude-sonnet-4-6',

  // Fast/cheap — used for high-frequency or simple tasks (NS copy, email gen, assay scoring)
  FAST: 'claude-haiku-4-5-20251001',
};

// USD per million tokens, Anthropic list price (checked 2026-10-07). Logged
// cost is an estimate from these; the Anthropic console is the real bill.
const PRICES = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

export function estimateCostUsd(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  return ((usage.input_tokens || 0) * p.input + (usage.output_tokens || 0) * p.output) / 1e6;
}
