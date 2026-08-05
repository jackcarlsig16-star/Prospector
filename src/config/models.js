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
