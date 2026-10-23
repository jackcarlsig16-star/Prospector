import { md } from '../tasks/TaskRow';
import { laDay } from '../huddleView';

// sales-ia-v2 A1 - Actions: the pure pieces over the items GET goals/actions
// returns (already ordered band -> company P -> due -> age, actions-v2 REV2).
// actions-v2 A1: whose list comes from the frame's one Who control (a member's
// user id = rows they own; 'team' = everything); the Unassigned chip shows the
// rows nobody owns. Kind and Search narrow it. The sort is remembered per browser.
export const KIND_LABEL = { signal: 'Signal', tidy: 'Tidy', waiting: 'Waiting on', todo: 'To-do', flag: 'Flag', focus: 'Focus', campaign: 'Campaign' };
export const KIND_OPTIONS = Object.entries(KIND_LABEL);
// What a Viewer's Team list holds (A1): to-dos, Focus 5 per member, flags.
export const VIEWER_KINDS = ['todo', 'focus', 'flag'];
export const EMPTY_FILTERS = { kind: '', q: '', unassigned: false };
export const activeFilterCount = f => (f.kind ? 1 : 0) + (f.q ? 1 : 0) + (f.unassigned ? 1 : 0);

const narrowed = (it, f) => {
  const needle = f.q.trim().toLowerCase();
  return (!f.kind || it.kind === f.kind) && (!needle || `${it.text} ${it.why || ''} ${it.company?.name || ''}`.toLowerCase().includes(needle));
};
// owner: a member's user id or 'team'.
export function matchesActionFilters(it, f, owner) {
  if (f.unassigned) return !it.owner_user_id && narrowed(it, f);
  return (owner === 'team' || it.owner_user_id === owner) && narrowed(it, f);
}

// actions-v2 A2 - the bands, in order, each with its open rows; Focus items already done fold under "n done ▸".
// unassigned = how many rows (Kind / Search applied) nobody owns, for the chip.
export const BANDS = [['now', 'Now'], ['today', 'Today'], ['week', 'This week'], ['housekeeping', 'Housekeeping']];
export function actionsView(items, f, { owner = 'team', viewer = false } = {}) {
  // A kind this screen has no label and buttons for yet stays hidden.
  const known = items.filter(it => it.kind in KIND_LABEL);
  const base = viewer ? known.filter(it => VIEWER_KINDS.includes(it.kind)) : known;
  const shown = base.filter(it => matchesActionFilters(it, f, owner));
  const open = shown.filter(it => it.status !== 'done');
  return {
    bands: BANDS.map(([id, label]) => ({ id, label, rows: open.filter(it => (it.band || 'housekeeping') === id) })),
    open, done: shown.filter(it => it.status === 'done'),
    unassigned: base.filter(it => !it.owner_user_id && it.status !== 'done' && narrowed(it, f)).length,
  };
}

// localStorage key (per browser): prospector_actions_folded - JSON list of folded band ids; absent = Housekeeping folded.
const FOLD_KEY = 'prospector_actions_folded';
export const DEFAULT_FOLDED = ['housekeeping'];
export function readFolded() {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY));
    return Array.isArray(v) && v.every(x => BANDS.some(([id]) => id === x)) ? v : DEFAULT_FOLDED;
  } catch { return DEFAULT_FOLDED; }
}
export const writeFolded = v => { try { localStorage.setItem(FOLD_KEY, JSON.stringify(v)); } catch { /* private mode */ } };

// actions-v2 A4 - the due-date button's choices from today (REVISABLE): Friday / next Monday never land on today.
const dow = d => new Date(`${d}T12:00:00Z`).getUTCDay();
export function dueChoices(today) {
  const plus = n => snoozeTo(today, n);
  return [['today', 'Today', today], ['tomorrow', 'Tomorrow', plus(1)], ['friday', 'Friday', plus(((5 - dow(today) + 7) % 7) || 7)], ['monday', 'Next Monday', plus(((8 - dow(today)) % 7) || 7)], ['none', 'No date', null]];
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
  if (it.kind === 'campaign') return m.action === 'reply' ? `Campaign “${m.campaign}” · replied ${day(m.replied_at) || ''}`.trim() : `Campaign “${m.campaign}” · ${m.track}`;
  return `Focus 5${m.plan_rank ? ` #${m.plan_rank}` : ''}${it.why && it.why !== 'Focus 5' ? ` · ${it.why}` : ''}`;
}

export function companyLine(c) {
  if (!c) return null;
  return [c.name, c.stage_label, c.priority && `P${c.priority}`, c.owner, c.type && c.type !== 'visitor' ? (c.last_touch_at ? `last touch ${day(c.last_touch_at)}` : 'no touch yet') : null].filter(Boolean).join(' · ');
}

export const datesLine = (it, ownerName) => [`Added ${day(it.created_at) || '—'}`, it.due_date ? `due ${day(it.due_date)}` : 'no due date', ownerName ? `owner ${ownerName}` : 'no owner'].join(' · ');

// seif-campaign-v1 - a campaign row's own detail line: which step, when the last one went out.
export function campaignLine(it) {
  const m = it.meta || {};
  if (it.kind !== 'campaign') return null;
  const steps = m.steps ? ` of ${m.steps}` : '';
  return [m.action === 'reply' ? `Replied after step ${m.step_no}${steps}` : `Step ${m.step_no}${steps}`, m.title, m.last_sent_at ? `last sent ${day(m.last_sent_at)}` : 'nothing sent yet'].filter(Boolean).join(' · ');
}
