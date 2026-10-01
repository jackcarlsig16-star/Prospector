// sales-pipeline-v1 - client-side mirror of api/sales/pipelineStages.js.
// Can't literally share the module - CRA's build refuses any import
// reaching outside src/ (confirmed earlier in this feature, same reason
// metrics.registry.js duplicates cohort.js's keyword list instead of
// importing api/sales/cohort.js). Keep the two in sync by hand if the
// stage list or default probabilities ever change.
export const STAGE_ORDER = [
  'target', 'contacted', 'responded', 'meeting', 'proposal_pilot', 'verbal', 'contract', 'launched',
];
export const STAGE_ENUM = [...STAGE_ORDER, 'lost'];
export const ORG_TYPE_ENUM = ['employer', 'membership', 'channel_partner'];

export const STAGE_LABELS = {
  target: 'Target', contacted: 'Contacted', responded: 'Responded', meeting: 'Meeting',
  proposal_pilot: 'Proposal/Pilot', verbal: 'Verbal', contract: 'Contract', launched: 'Launched', lost: 'Lost',
};
export const ORG_TYPE_LABELS = { employer: 'Employer', membership: 'Membership org', channel_partner: 'Channel partner' };

export const DEFAULT_PROBABILITY = {
  target: 0.02, contacted: 0.05, responded: 0.10, meeting: 0.20,
  proposal_pilot: 0.40, verbal: 0.70, contract: 0.90, launched: 1.0, lost: 0,
};

export function stageIndex(stage) {
  return STAGE_ORDER.indexOf(stage);
}

export function compareStages(fromStage, toStage) {
  const a = stageIndex(fromStage);
  const b = stageIndex(toStage);
  if (a === -1 || b === -1) return null;
  if (a === b) return 'same';
  return b > a ? 'forward' : 'back';
}

// probability is nullable on the row (null = "use the stage default").
export function effectiveProbability(opp) {
  return opp.probability !== null && opp.probability !== undefined ? opp.probability : (DEFAULT_PROBABILITY[opp.stage] ?? 0);
}
