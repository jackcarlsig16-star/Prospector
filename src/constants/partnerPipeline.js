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
