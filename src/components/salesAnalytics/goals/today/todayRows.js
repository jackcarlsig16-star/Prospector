import { addDays } from '../goalsUi';

// actions-v2 Stage 2 - what a Today row says, pure. The server ranks and groups (GET goals/today); nothing here
// re-orders, re-counts or scores.
// The nine sources a row can come from (Q4): [label, a 16 px stroke path].
export const SOURCE = {
  manual: ['Typed', 'M3 13l1-3.500 6.500-6.500 2.500 2.500L6.500 12z'],
  scout: ['Scout', 'M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.800 1.800M10.200 10.200 12 12M12 4l-1.800 1.800M5.800 10.200 4 12'],
  call_notes: ['Call notes', 'M3 2.500h3l1 3-1.500 1a7 7 0 0 0 4 4l1-1.500 3 1v3c-6 .500-11-4.500-10.500-10.500z'],
  signal: ['Signal', 'M2 12l3-4 3 2 3-6 3 4'],
  tidy: ['Tidy', 'M3 13l7-7M9 3l4 4M5 3v2M4 4h2'],
  panel: ['Company window', 'M2.500 3.500h11v9h-11zM2.500 6.500h11'],
  plan: ['Plan', 'M3 4h10M3 8h10M3 12h6'],
  reply: ['A reply', 'M6 4 2.500 7.500 6 11M3 7.500h6a4 4 0 0 1 4 4'],
  waiting: ['Waiting on', 'M8 4.500V8l2.500 1.500M2 8a6 6 0 1 0 12 0A6 6 0 0 0 2 8z'],
};
export const SOURCE_IDS = Object.keys(SOURCE);
export const VERB_LABEL = { draft_reply: 'Draft reply', prep_call: 'Prep call', draft_email: 'Draft email', find_people: 'Find people', next_steps: 'Next steps' };

const say = (d, opts) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
export const dayWords = d => say(d, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
export const shortDay = d => say(d, { month: 'short', day: 'numeric' });
export const nextMonday = today => addDays(today, ((8 - new Date(`${today}T12:00:00Z`).getUTCDay()) % 7) || 7);

// -> { text, tone: 'bad' | 'text' | 'muted' } | null (no date)
export function dueWords(row, today) {
  if (row.kind === 'reply') return row.replied_at ? { text: `replied ${shortDay(row.replied_at)}`, tone: 'muted' } : null;
  if (row.overdue) return { text: `${row.late_days} d late`, tone: 'bad' };
  if (!row.due) return null;
  return row.due === today ? { text: 'Today', tone: 'text' } : { text: dayWords(row.due), tone: 'muted' };
}
export const snoozeChoices = today => [['Tomorrow', addDays(today, 1)], ['Monday', nextMonday(today)], ['1 week', addDays(today, 7)]];
export const dueChoices = today => [['Today', today], ['Tomorrow', addDays(today, 1)], ['Next week', nextMonday(today)]];
export const bulkDates = today => [addDays(today, 1), nextMonday(today), addDays(today, 8)];

// The row as Scout's plan takes it: a to-do, or the person of a reply nobody has a to-do for.
export const scoutRow = r => (r.kind === 'reply'
  ? { entity: 'people', id: r.person.key, title: r.person.name, company: r.company?.id ? { type: r.company.type, id: r.company.id, name: r.company.name } : null }
  : { entity: 'todos', id: r.id, title: r.text });
export const scoutKey = r => `${r.entity}:${r.id}`;

// The done line of an act, in the list's own words; the server's line when the batch was mixed.
export function doneWords(verb, result, { date = null, ownerName = null } = {}) {
  const ok = result.rows.filter(r => r.ok);
  if (!ok.length || result.failed) return result.line;
  const one = ok.length === 1 ? ok[0].title : null, n = `${ok.length} to-dos`;
  if (verb === 'task_done') return one ? `Done: ${one}.` : `Done: ${n}.`;
  if (verb === 'snooze') return `Snoozed until ${dayWords(date)}: ${one || n}.`;
  if (verb === 'assign') return ownerName ? `${one || n} ${one ? 'is' : 'are'} now ${ownerName}’s.` : `${one || n} ${one ? 'is' : 'are'} now unassigned.`;
  if (verb === 'task_drop') return `Dropped: ${one || n}.`;
  if (verb === 'task_due') return one ? `Due ${dayWords(date)}: ${one}.` : `Dated ${n} ${dayWords(date)}.`;
  if (verb === 'reply_todos') return `Added ${ok.length} to-do${ok.length === 1 ? '' : 's'}.`;
  return result.line;
}

export const todayQuery = ({ owner, chip, source, q }) => ({ ...(owner === 'me' ? { owner: 'me' } : {}), ...(chip ? { chips: chip } : {}), ...(source ? { source } : {}), ...(q ? { q } : {}) });
