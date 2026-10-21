import { md } from '../tasks/TaskRow';

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
  const base = viewer ? items.filter(it => VIEWER_KINDS.includes(it.kind)) : items;
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
