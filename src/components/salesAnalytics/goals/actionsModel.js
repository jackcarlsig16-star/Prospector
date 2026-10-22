import { md } from '../tasks/TaskRow';
import { laDay } from '../huddleView';

// sales-ia-v2 A1 - Actions: the pure pieces over the items GET goals/actions
// returns (already ranked overdue -> P1..P4 -> due). Filters: Mine | Team
// (Mine = owned by me or by no one - a signal, a Tidy row or a waiting row is
// everyone's to act on), Kind, Search. The sort is remembered per browser.
export const KIND_LABEL = { signal: 'Signal', tidy: 'Tidy', waiting: 'Waiting on', todo: 'To-do', flag: 'Flag', focus: 'Focus' };
export const KIND_OPTIONS = Object.entries(KIND_LABEL);
// What a Viewer's Team list holds (A1): to-dos, Focus 5 per member, flags.
export const VIEWER_KINDS = ['todo', 'focus', 'flag'];
export const EMPTY_FILTERS = { who: 'mine', kind: '', q: '' };
export const activeFilterCount = f => (f.kind ? 1 : 0) + (f.q ? 1 : 0);

export function matchesActionFilters(it, f, meId) {
  const needle = f.q.trim().toLowerCase();
  return (f.who !== 'mine' || !it.owner_user_id || it.owner_user_id === meId)
    && (!f.kind || it.kind === f.kind)
    && (!needle || `${it.text} ${it.why || ''} ${it.company?.name || ''}`.toLowerCase().includes(needle));
}

// { open, done }: Focus items already done fold under "n done ▸".
export function actionsView(items, f, { meId, viewer = false } = {}) {
  // A kind this screen has no label and buttons for yet (the server's campaign rows ahead of their UI) stays hidden.
  const known = items.filter(it => it.kind in KIND_LABEL);
  const base = viewer ? known.filter(it => VIEWER_KINDS.includes(it.kind)) : known;
  const shown = base.filter(it => matchesActionFilters(it, f, meId));
  return { open: shown.filter(it => it.status !== 'done'), done: shown.filter(it => it.status === 'done') };
}

export const priorityText = it => (it.overdue ? `Overdue · ${it.late_days} d` : `P${it.priority}`);
export const dueText = (it, today) => (!it.due_date ? '—' : it.due_date === today ? 'Today' : md(it.due_date));

export const DEFAULT_SORT = null; // null = the server's ranking
// localStorage key (per browser): prospector_actions_sort - { id, dir } of the last header sort, JSON; absent = ranked
const SORT_KEY = 'prospector_actions_sort';
export function readSort() {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY));
    return v && typeof v.id === 'string' && ['asc', 'desc'].includes(v.dir) ? v : DEFAULT_SORT;
  } catch { return DEFAULT_SORT; }
}
export const writeSort = s => { try { if (s) localStorage.setItem(SORT_KEY, JSON.stringify(s)); else localStorage.removeItem(SORT_KEY); } catch { /* private mode */ } };

// Snooze targets for a to-do (REVISABLE): a new due date from today.
export const SNOOZE_OPTIONS = [['1', 'Tomorrow'], ['3', '3 days'], ['7', 'Next week']];
export const snoozeTo = (today, days) => new Date(Date.parse(`${today}T12:00:00Z`) + Number(days) * 864e5).toISOString().slice(0, 10);

// FIX actions-row-detail-v1 - the row detail: where the row came from, in words, and its company line.
// Timestamps read as the LA day (the team's day), plain dates as given.
const SIGNAL_SOURCE = { scout: 'Signal Scout', web_visit: 'Website visit' };
const day = d => (!d ? null : String(d).length > 10 ? md(laDay(d)) : md(d));

export function actionSource(it) {
  const m = it.meta || {};
  if (it.kind === 'signal') return [SIGNAL_SOURCE[m.source] || 'Signal', m.score != null && `score ${m.score}`, m.who].filter(Boolean).join(' · ');
  if (it.kind === 'tidy') return `Tidy rule: ${m.rule || 'a housekeeping check'}`;
  if (it.kind === 'todo') return m.from_note ? `From call notes${m.note_date ? ` ${day(m.note_date)}` : ''}` : m.category ? `To-do · ${m.category}` : 'To-do added by hand';
  if (it.kind === 'waiting') return `${m.waiting_on || 'They'} owe${m.waiting_on ? 's' : ''} it · due ${day(it.due_date)} · ${it.late_days} day${it.late_days === 1 ? '' : 's'} late`;
  if (it.kind === 'flag') return `Flagged by ${m.flagged_by_name || 'a teammate'}${m.flag_note ? ` · “${m.flag_note}”` : ''}`;
  return `Focus 5${m.plan_rank ? ` #${m.plan_rank}` : ''}${it.why && it.why !== 'Focus 5' ? ` · ${it.why}` : ''}`;
}

export function companyLine(c) {
  if (!c) return null;
  return [c.name, c.stage_label, c.priority && `P${c.priority}`, c.owner, c.type && c.type !== 'visitor' ? (c.last_touch_at ? `last touch ${day(c.last_touch_at)}` : 'no touch yet') : null].filter(Boolean).join(' · ');
}

export const datesLine = (it, ownerName) => [`Added ${day(it.created_at) || '—'}`, it.due_date ? `due ${day(it.due_date)}` : 'no due date', ownerName ? `owner ${ownerName}` : 'owner Team'].join(' · ');
