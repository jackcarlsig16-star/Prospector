// sales-partners-pipeline-v1 - partner pipeline rules shared by the API
// (api/sales/partnerSignals.js, goalsRoutes.js) and the Partners view, so
// "stale" and "touched" mean the same thing on both sides.

export const PIPELINE_STATUSES = [
  { id: 'not_started', label: 'Not started' },
  { id: 'researching', label: 'Researching' },
  { id: 'first_email_drafted', label: '1st email drafted' },
  { id: 'first_email_sent', label: '1st email sent' },
  { id: 'in_sequence', label: 'In sequence' },
  { id: 'replied', label: 'Replied' },
  { id: 'meeting_set', label: 'Meeting set' },
  { id: 'proposal_pilot', label: 'Proposal / pilot' },
  { id: 'live', label: 'Live' },
  { id: 'paused', label: 'Paused' },
];
export const PIPELINE_STATUS_IDS = PIPELINE_STATUSES.map(s => s.id);
export const TIERS = ['1', '2', '3', '4', 'active'];

// Moving into one of these is contact with the partner, so it stamps
// last_touch_at. Drafting, researching and pausing don't.
export const TOUCH_STATUSES = ['first_email_sent', 'in_sequence', 'replied', 'meeting_set', 'proposal_pilot', 'live'];

// REVISABLE (spec): stale after 7 days without a touch.
export const STALE_DAYS = 7;
const DAY_MS = 864e5;

export function daysSinceTouch(partner, now = Date.now()) {
  if (!partner.last_touch_at) return null;
  return Math.floor((now - Date.parse(partner.last_touch_at)) / DAY_MS);
}

// Never-touched partners aren't stale (they're not started); paused/live
// ones and anything snoozed past today are left alone.
export function isStalePartner(partner, now = Date.now(), today = new Date(now).toISOString().slice(0, 10)) {
  const days = daysSinceTouch(partner, now);
  if (days === null || days < STALE_DAYS) return false;
  if (['paused', 'live'].includes(partner.pipeline_status)) return false;
  return !(partner.snoozed_until && partner.snoozed_until > today);
}

// sales-partners-workflow-v1 - the 8 workflow steps the Partners view shows.
// in_sequence is still "Sent"; paused sits outside the steps (stepOf = null).
export const WORKFLOW_STEPS = [
  { id: 'not_started', label: 'Not started' },
  { id: 'researching', label: 'Researching' },
  { id: 'first_email_drafted', label: 'Drafted' },
  { id: 'first_email_sent', label: 'Sent' },
  { id: 'replied', label: 'Replied' },
  { id: 'meeting_set', label: 'Meeting' },
  { id: 'proposal_pilot', label: 'Pilot' },
  { id: 'live', label: 'Live' },
];
export function stepOf(status) {
  if (status === 'paused') return null;
  if (status === 'in_sequence') return 3;
  const i = WORKFLOW_STEPS.findIndex(s => s.id === (status || 'not_started'));
  return i < 0 ? 0 : i;
}

// Contact has been made: in a contact stage now, or touched before (same
// rule as the scorecard's Tier 1 touched).
export const isTouched = p => TOUCH_STATUSES.includes(p.pipeline_status) || !!p.last_touch_at;

// Order inside a group: placed by hand (sort_rank) first, then P1 > P2 > P3
// > none, hot, tier (active, 1 > 2 > 3 > 4, none), name.
const TIER_ORDER = { active: 0, 1: 1, 2: 2, 3: 3, 4: 4 };
export function comparePartners(a, b) {
  const ra = a.sort_rank == null ? null : Number(a.sort_rank), rb = b.sort_rank == null ? null : Number(b.sort_rank);
  if (ra !== null || rb !== null) {
    if (ra === null) return 1;
    if (rb === null) return -1;
    if (ra !== rb) return ra - rb;
  }
  return (a.priority ?? 9) - (b.priority ?? 9)
    || (b.hot ? 1 : 0) - (a.hot ? 1 : 0)
    || (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9)
    || (a.name || '').localeCompare(b.name || '');
}

// The one-step move the Next button makes from each status (live has none;
// paused resumes to the stage it was paused from - the caller looks that up).
export const NEXT_STEP = {
  not_started: { to: 'researching', label: 'Start research' },
  researching: { to: 'first_email_drafted', label: 'Mark drafted' },
  first_email_drafted: { to: 'first_email_sent', label: 'Mark sent' },
  first_email_sent: { to: 'replied', label: 'Got a reply' },
  in_sequence: { to: 'replied', label: 'Got a reply' },
  replied: { to: 'meeting_set', label: 'Meeting booked' },
  meeting_set: { to: 'proposal_pilot', label: 'Pilot / proposal' },
  proposal_pilot: { to: 'live', label: 'Mark live' },
};
export const nextStepFor = status => NEXT_STEP[status || 'not_started'] || null;
