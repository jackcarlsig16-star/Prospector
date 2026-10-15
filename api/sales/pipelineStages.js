// sales-pipeline-v1 - the canonical stage enum, defined ONCE (DECIDED),
// used by every later SPEC (scorecard, weekly-report) that needs to know
// stage order or default probabilities. STAGE_ORDER excludes the side
// lanes - 'lost' (a terminal exit) and the parked lanes 'nurture' / 'on_hold'
// are off the forward path, not positions on it, and never count as active
// pipeline.
export const STAGE_ORDER = [
  'target', 'contacted', 'responded', 'meeting', 'proposal_pilot', 'verbal', 'contract', 'launched',
];
export const PARKED_STAGES = ['nurture', 'on_hold'];
export const SIDE_LANES = ['lost', ...PARKED_STAGES];
export const STAGE_ENUM = [...STAGE_ORDER, ...SIDE_LANES];
export const ORG_TYPE_ENUM = ['employer', 'membership', 'channel_partner'];

// PROPOSED/REVISABLE starting values, per SPEC.
export const DEFAULT_PROBABILITY = {
  target: 0.02, contacted: 0.05, responded: 0.10, meeting: 0.20,
  proposal_pilot: 0.40, verbal: 0.70, contract: 0.90, launched: 1.0, lost: 0, nurture: 0, on_hold: 0,
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

// Bulk writes (CSV import, master-sheet importer) never move a stage back,
// and may park a deal only before it has responded, so a sheet can't park a
// live deal. A person editing in the panel may set any stage.
export function bulkStageRefusal(current, next) {
  if (!current || current === next) return null;
  if (compareStages(current, next) === 'back') return `stage ${next} is behind the current stage ${current}`;
  if (PARKED_STAGES.includes(next) && !['target', 'contacted', ...PARKED_STAGES].includes(current)) return `can't park ${current} as ${next}`;
  return null;
}
