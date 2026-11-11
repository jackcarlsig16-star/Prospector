import { addDays } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { isSnoozed } from '../../src/constants/todoSnooze.js';

// FIX actions-all-weeks-v1 A3 - the one definition of "an open to-do", read by Actions, the Dashboard's to-dos per
// owner and Needs attention so their numbers agree: kind todo, status open, no prospect contact (a flag is its own
// kind), not every step ticked, ANY week_start - the column still says when the to-do was planned, it no longer
// decides what is shown. userId narrows to one owner. A4: the week filter was also the row cap; status=open bounds the
// read now and TODO_CAP bounds the list - dated rows first (soonest due), then undated newest - with `total` beside it.
export const TODO_CAP = 500; // REVISABLE (spec A4)
const IN_CHUNK = 100;
export const todoDone = t => t.status === 'done' || (t.steps?.length > 0 && t.steps.every(s => s.done));
export const laMonday = today => addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
export const weekEndOf = today => addDays(laMonday(today), 6);

// Where a due date lands: today (overdue included) | week (through this LA Sunday) | later | nodate.
export const todoGroup = (due, today, weekEnd = weekEndOf(today)) => (!due ? 'nodate' : due <= today ? 'today' : due <= weekEnd ? 'week' : 'later');
export const todoCounts = (rows, today) => ({
  open: rows.length,
  overdue: rows.filter(r => r.due_date && r.due_date < today).length,
  nodate: rows.filter(r => !r.due_date).length,
});

const capOrder = (a, b) => ((a.due_date == null) - (b.due_date == null))
  || (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : String(b.created_at || '').localeCompare(String(a.created_at || '')))
  || String(a.id).localeCompare(String(b.id));

// todo-events-v1 T6: a snoozed to-do is not open until its day (isSnoozed, the one rule) - every reader of this
// function hides it; snoozed: 'only' returns them instead (the "Snoozed (n)" chip), 'all' returns both.
// -> { rows (steps attached, at most TODO_CAP), total, snoozed (how many are hidden) }
export async function openTodosFor(supabase, businessId, userId = null, { cols = '*', cap = TODO_CAP, snoozed = 'hide', today = laDateString(new Date()) } = {}) {
  if (cols !== '*' && !/\bsnooze_until\b/.test(cols)) cols = `${cols}, snooze_until`;
  const narrow = q => (userId ? q.eq('owner_user_id', userId) : q);
  const all = await selectAllPages(() => narrow(supabase.from('sales_week_goals').select(cols).eq('business_id', businessId).eq('kind', 'todo').eq('status', 'open').is('prospect_contact_id', null)).order('id'));
  const steps = [];
  for (let i = 0; i < all.length; i += IN_CHUNK) {
    const ids = all.slice(i, i + IN_CHUNK).map(r => r.id);
    steps.push(...await selectAllPages(() => supabase.from('sales_week_goal_steps').select('goal_id, done').eq('business_id', businessId).in('goal_id', ids).order('id')));
  }
  for (const r of all) r.steps = steps.filter(s => s.goal_id === r.id);
  const live = all.filter(r => !todoDone(r));
  const hidden = live.filter(r => isSnoozed(r, today));
  const open = (snoozed === 'only' ? hidden : snoozed === 'all' ? live : live.filter(r => !isSnoozed(r, today))).sort(capOrder);
  return { rows: open.slice(0, cap), total: open.length, snoozed: hidden.length };
}
