import { md } from '../tasks/TaskRow';
import { STAGE_LABELS } from '../pipelineStages';
import { stageName } from './partners/activityTimeline';

// sales-ia-v1 Stage 2 - the pure pieces behind Today (Design F) and the
// viewer's Today (Design G). Every list starts from buildTaskGroups' output;
// nothing here groups to-dos on its own.

const DAY_MS = 864e5;
const groupItems = (groups, id) => groups.find(g => g.id === id)?.items || [];
const dueOn = (items, today) => items.filter(t => t.due_date === today);

// "Your day": Overdue is the overdue group as-is; Due today is every open
// to-do due today plus the ones already ticked today (struck through, so a
// tick stays visible); Flagged is the flagged group. Follow-ups due and
// Research ready are not built yet, so they are not here at all.
export function yourDaySections(groups, today, { forMe = true } = {}) {
  const open = [...groupItems(groups, 'week'), ...groupItems(groups, 'calls')];
  return [
    { id: 'overdue', label: 'Overdue', glyph: '!', items: groupItems(groups, 'overdue') },
    { id: 'due', label: 'Due today', items: [...dueOn(open, today), ...dueOn(groupItems(groups, 'done'), today)] },
    { id: 'flagged', label: forMe ? 'Flagged for you' : 'Flagged', glyph: '⚑', items: groupItems(groups, 'flagged') },
  ];
}
export const thingsCount = sections => sections.reduce((n, s) => n + s.items.filter(t => t.st !== 'done').length, 0);

export const daysLate = (due, today) => Math.round((Date.parse(today) - Date.parse(due)) / DAY_MS);
export function dueText(t, today) {
  if (!t.due_date) return '';
  if (t.st === 'done') return 'done';
  if (t.due_date === today) return 'Today';
  if (t.due_date < today) { const n = daysLate(t.due_date, today); return `${md(t.due_date)} · ${n}d late`; }
  return md(t.due_date);
}

export const dayTitle = (today, short = false) => new Date(`${today}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: short ? 'short' : 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

// Viewer: one line per member from that member's own groups.
export function teamToday(members, buildGroups, today) {
  return members.map(m => {
    const s = yourDaySections(buildGroups(m.user_id), today, { forMe: false });
    return { member: m, overdue: s[0].items.length, due: s[1].items.filter(t => t.st !== 'done').length, flags: s[2].items.length };
  });
}
// The top open to-dos due today across the team, then the overdue ones.
export function topOfList(groups, today, n = 5) {
  const open = [...groupItems(groups, 'week'), ...groupItems(groups, 'calls')];
  return [...dueOn(open, today), ...groupItems(groups, 'overdue')].slice(0, n);
}

// reports: [{ week_start, report }] in any order -> the newest final one.
export function pickNewestFinal(reports) {
  return reports.filter(r => r.report?.status === 'final').sort((a, b) => (a.week_start < b.week_start ? 1 : -1))[0] || null;
}

// Pipeline moves this week: partner stage changes from partner events and
// employer stage moves (forward, back, lost) from the movement read, newest
// first. Newly added opportunities are not moves, so they stay out.
export function pipelineMoves({ events = [], partnersById = new Map(), movement = null }, n = 8) {
  const rows = [];
  for (const e of events) {
    if (!['status', 'touch', 'deprioritize'].includes(e.event) || !e.to_status || e.to_status === e.from_status) continue;
    const p = partnersById.get(e.goal_id);
    if (!p) continue;
    rows.push({ key: `p-${e.id}`, name: p.name, kind: 'Partner', to: stageName(e.to_status), at: e.at });
  }
  const bucket = (key, to) => (movement?.[key] || []).forEach(o => rows.push({ key: `o-${key}-${o.id}`, name: o.organization, kind: 'Employer', to: to || STAGE_LABELS[o.stage] || o.stage, at: o.updated_at || null }));
  bucket('moved_forward'); bucket('moved_back'); bucket('lost', 'Lost');
  return rows.sort((a, b) => (a.at && b.at ? (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) : a.at ? -1 : b.at ? 1 : 0)).slice(0, n);
}

export const focusOf = (commitments, ownerId) => commitments.filter(c => c.plan_id && c.owner_user_id === ownerId && c.status !== 'dropped')
  .sort((a, b) => (a.plan_rank ?? 99) - (b.plan_rank ?? 99));
