// actions-v2 REV2 A2 - priority in one place (pure: reads nothing). itemUrgency = which band an Actions row sits
// in (audits/priority-v2-report.txt §D item urgency): the band orders the list, the company P only orders rows
// inside a band, so housekeeping never outranks a live conversation because its company is a P1. SPEC priority-v2
// adds companyPriority() here.
export const BANDS = [['now', 'Now'], ['today', 'Today'], ['week', 'This week'], ['housekeeping', 'Housekeeping']];
export const BAND_ORDER = Object.fromEntries(BANDS.map(([id], i) => [id, i]));
export const FLAG_FRESH_DAYS = 5;

const TIDY_BAND = {
  reply_task: 'now',
  interest_follow_up: 'today', visited_no_touch: 'today', follow_up: 'today', nudge: 'today',
  research_or_drop: 'week', check_co_owner: 'week',
  set_a_date: 'housekeeping', duplicate: 'housekeeping', flag_cold: 'housekeeping',
};

// kind: an Actions row kind. meta: { overdue, due_date, today, tidy_kind, campaign_action ('send' | 'reply'),
// flag_age_days }. Anything overdue is Now; a reply always is.
export function itemUrgency(kind, meta = {}) {
  if (kind === 'campaign' && meta.campaign_action === 'reply') return 'now';
  if (meta.overdue) return 'now';
  switch (kind) {
    case 'waiting': return 'now';
    case 'flag': return meta.flag_age_days != null && meta.flag_age_days >= FLAG_FRESH_DAYS ? 'housekeeping' : 'now';
    case 'tidy': return TIDY_BAND[meta.tidy_kind] || 'housekeeping';
    case 'signal': return 'week';
    case 'focus': return 'today';
    case 'campaign': return 'today';
    case 'todo':
      if (!meta.due_date) return 'housekeeping';
      return meta.due_date <= meta.today ? 'today' : 'week';
    default: return 'housekeeping';
  }
}
