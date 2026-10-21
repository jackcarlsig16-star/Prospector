import { OWNER_TEAMS, TEAM_LABEL } from '../../../constants/ownership';
import { PIPELINE_STATUSES } from '../../../constants/partnerPipeline';
import { BOARD_COLORS } from '../../../constants/pipelineBoard';
import { familyOf, categoryName } from './partners/partnerTypes';
import { md } from '../tasks/TaskRow';

// sales-ia-v2 D1 - the pure pieces of the Dashboard: the range / team
// options, the chart series over GET goals/dashboard, and the captions that
// say what a chart counts and for whom.
export const RANGE_OPTIONS = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
export const DEFAULT_RANGE = 30;
export const TEAM_OPTIONS = [['', 'All teams'], ...OWNER_TEAMS.map(t => [t, TEAM_LABEL[t]])];
// Short channel names so seven columns fit a 340 px card.
export const CHANNEL_SHORT = { website_visit: 'Website', scout: 'Scout', apollo_outbound: 'Apollo', partner_referral: 'Partner', call_note: 'Call note', import: 'Import', manual: 'Manual', unknown: 'Unknown' };
export const PIE_SLICES = 5; // top categories drawn; the rest fold into Other

export const dayLabel = d => md(d);
export const weekLabel = w => md(w);

// Who a filtered chart counts; '' when the Dashboard shows the whole team.
export function scopeLabel({ owner, team }, lookup) {
  return [owner ? lookup(owner).first : null, team ? TEAM_LABEL[team] : null].filter(Boolean).join(' · ');
}
// Captions: filtered charts name the scope, team-wide ones say so while a filter is on.
export const captionFor = (base, scope, teamWide = false) => (teamWide ? (scope ? `${base} · team-wide` : base) : scope ? `${base} · ${scope}` : base);

export const dayPoints = (rows, keys) => rows.map(r => ({ x: r.day, label: dayLabel(r.day), values: Object.fromEntries(keys.map(k => [k, r[k]])) }));
export const weekPoints = (rows, keys) => rows.map(r => ({ x: r.week_start, label: weekLabel(r.week_start), values: Object.fromEntries(keys.map(k => [k, r[k]])) }));

// Partners by status per owner: one group per status anyone is in; one bar per owner.
export function statusGroups(rows) {
  return PIPELINE_STATUSES.filter(s => rows.some(r => r.counts[s.id])).map(s => ({ id: s.id, label: s.label, values: Object.fromEntries(rows.map(r => [r.owner_user_id || 'unassigned', r.counts[s.id] || 0])) }));
}
export const ownerSeries = (rows, lookup) => rows.map(r => ({ id: r.owner_user_id || 'unassigned', label: lookup(r.owner_user_id).first, color: lookup(r.owner_user_id).color }));

// Pie parts: the top PIE_SLICES categories, colored by their type family, then Other.
export function categoryParts(rows) {
  const top = rows.slice(0, PIE_SLICES).map(r => ({ id: r.category, label: categoryName(r.category), count: r.count, color: familyOf(r.category).color }));
  const rest = rows.slice(PIE_SLICES).reduce((n, r) => n + r.count, 0);
  return rest ? [...top, { id: 'other', label: `Other (${rows.length - PIE_SLICES})`, count: rest, color: 'var(--sa-neutral)' }] : top;
}

// Companies by channel and stage band: x = channels with rows, stacked by band (board colors).
export const bandSeries = tokens => BOARD_COLORS.map(b => ({ id: b.id, label: b.label, color: tokens[b.id] }));
export const channelPoints = rows => rows.map(r => ({ x: r.channel, label: CHANNEL_SHORT[r.channel] || r.label, values: r.bands }));

// "History starts Oct 20" until 30 days of pulls exist; no pulls yet says so.
export function historyNote(d) {
  if (!d.history_start) return 'No visitor pulls yet';
  return d.history_full ? null : `History starts ${md(d.history_start)}`;
}
export const monthName = ym => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
