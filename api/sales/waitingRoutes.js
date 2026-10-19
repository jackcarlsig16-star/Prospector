import { getSupabase, findRow, weekIsFinal, FINAL_ERROR, addDays } from './goalsShared.js';
import { laDateString } from './laDate.js';

// call-notes-targets-v1 REV5 - a 'waiting' row is something a counterpart
// owes us (sales_week_goals kind 'waiting', waiting_on = who). "Got it" is a
// plain status PATCH; Nudge turns it into OUR open to-do, due today, owned
// by whoever clicked. Tidy's nudge suggestion accepts through the same text.
export const NUDGE_CATEGORY = 'Nudge';
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
export const nudgeText = (who, text) => cut(`Nudge ${who} re ${text}`, 300);
const laMonday = today => addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));

export async function nudgeWaiting(supabase, { businessId, userId, id, now = Date.now() }) {
  const { data: row, error } = await findRow(supabase, 'sales_week_goals', businessId, id);
  if (error) return { status: 500, body: { error: error.message } };
  if (!row || row.kind !== 'waiting') return { status: 404, body: { error: 'waiting-on item not found' } };
  if (row.status !== 'open') return { status: 409, body: { error: `already ${row.status}` } };
  const today = laDateString(new Date(now));
  const week = laMonday(today);
  if (await weekIsFinal(supabase, businessId, week)) return { status: 409, body: { error: FINAL_ERROR } };
  const { data: todo, error: insErr } = await supabase.from('sales_week_goals').insert({
    business_id: businessId, week_start: week, kind: 'todo', status: 'open', text: nudgeText(row.waiting_on || 'them', row.text),
    owner_user_id: userId, due_date: today, link_type: row.link_type, link_id: row.link_id, category: NUDGE_CATEGORY, sort_order: 0, created_by: userId,
  }).select().single();
  if (insErr) return { status: 500, body: { error: insErr.message } };
  return { status: 201, body: { todo } };
}

// POST /goals/waiting/:id/nudge -> { todo }
export async function nudgeWaitingRoute(req, res) {
  const r = await nudgeWaiting(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id });
  res.status(r.status).json(r.body);
}
