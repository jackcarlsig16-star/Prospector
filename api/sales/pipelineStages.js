// sales-pipeline-v1 - the canonical stage enum, defined ONCE (DECIDED),
// used by every later SPEC (scorecard, weekly-report) that needs to know
// stage order or default probabilities. STAGE_ORDER excludes 'lost' -
// it's a terminal exit off the forward path, not a position on it.
export const STAGE_ORDER = [
  'target', 'contacted', 'responded', 'meeting', 'proposal_pilot', 'verbal', 'contract', 'launched',
];
export const STAGE_ENUM = [...STAGE_ORDER, 'lost'];
export const ORG_TYPE_ENUM = ['employer', 'membership', 'channel_partner'];

// PROPOSED/REVISABLE starting values, per SPEC.
export const DEFAULT_PROBABILITY = {
  target: 0.02, contacted: 0.05, responded: 0.10, meeting: 0.20,
  proposal_pilot: 0.40, verbal: 0.70, contract: 0.90, launched: 1.0, lost: 0,
};

export function stageIndex(stage) {
  return STAGE_ORDER.indexOf(stage);
}

// 'forward' | 'back' | 'same' | null (null when either stage isn't on the
// linear path, e.g. 'lost' - callers handle lost as its own case, not via
// this comparison).
export function compareStages(fromStage, toStage) {
  const a = stageIndex(fromStage);
  const b = stageIndex(toStage);
  if (a === -1 || b === -1) return null;
  if (a === b) return 'same';
  return b > a ? 'forward' : 'back';
}
