import { PIPELINE_STATUSES } from './partnerPipeline.js';
import { STAGE_LABELS } from '../components/salesAnalytics/pipelineStages.js';

// pipeline-board-v1 - one color per row across partners, employers, targets
// and Apollo-only companies. PROPOSED/REVISABLE: recolor or rename a band here
// and nothing else changes. The board route computes it server-side; the UI
// only maps the key to a token.
export const BOARD_COLORS = [
  { id: 'green', label: 'Live / strategic' },
  { id: 'yellow', label: 'Meeting' },
  { id: 'blue', label: 'Talking' },
  { id: 'gray', label: 'In outreach' },
  { id: 'light', label: 'Not started' },
  { id: 'faded', label: 'Parked' },
];
export const BOARD_COLOR_IDS = BOARD_COLORS.map(c => c.id);
export const BOARD_TYPES = ['partner', 'employer', 'target', 'apollo'];
export const TOP_CAP = 25;

const PARTNER_COLOR = {
  not_started: 'light', researching: 'gray', first_email_drafted: 'gray', first_email_sent: 'gray', in_sequence: 'gray',
  replied: 'blue', meeting_set: 'yellow', proposal_pilot: 'yellow', live: 'green', paused: 'faded',
};
const EMPLOYER_COLOR = {
  target: 'light', contacted: 'gray', responded: 'blue', meeting: 'yellow', proposal_pilot: 'yellow',
  verbal: 'green', contract: 'green', launched: 'green', nurture: 'faded', on_hold: 'faded', lost: 'faded',
};
// Accepted targets became a partner or employer row; rejected ones are hidden.
const TARGET_COLOR = { proposed: 'light', researching: 'gray' };
const TARGET_LABELS = { proposed: 'Proposed', researching: 'Researching' };
const PARTNER_LABELS = Object.fromEntries(PIPELINE_STATUSES.map(s => [s.id, s.label]));
const CURRENT_PARTNERS = /^1\./;

// { stage, stage_label, color } for a row, or null when the row isn't on the board.
export function boardStage(type, row) {
  if (type === 'partner') {
    const stage = row.pipeline_status || 'not_started';
    // A paused current partner reads as parked, not live.
    const color = stage !== 'paused' && CURRENT_PARTNERS.test(row.category || '') ? 'green' : PARTNER_COLOR[stage];
    return { stage, stage_label: PARTNER_LABELS[stage], color };
  }
  if (type === 'employer') return { stage: row.stage, stage_label: STAGE_LABELS[row.stage], color: EMPLOYER_COLOR[row.stage] };
  if (type === 'target') return TARGET_COLOR[row.status] ? { stage: row.status, stage_label: TARGET_LABELS[row.status], color: TARGET_COLOR[row.status] } : null;
  return { stage: 'sequenced', stage_label: 'Sequenced in Apollo', color: 'gray' };
}

const TIER_RANK = { 1: 1, 2: 2, 3: 3, 4: 4, active: 0 };
// Color order, then tier (blank last), then next-step due (soonest, blank last), then name.
export function compareBoardRows(a, b) {
  return BOARD_COLOR_IDS.indexOf(a.color) - BOARD_COLOR_IDS.indexOf(b.color)
    || (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9)
    || (a.next_step_due || '9999').localeCompare(b.next_step_due || '9999')
    || a.name.localeCompare(b.name);
}
