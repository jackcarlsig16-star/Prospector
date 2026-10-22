import { applyPartnerSignal, undoPartnerSignal } from './partnerSignals.js';

// FIX actions-done-button-v1 REV2 - "Done" on an Actions signal / suggestion
// row = Accept with { done: true }: the to-do is created already done, and
// when the row resolves to a partner the Done is logged as ONE email touch
// (never a stage move: move_to 'none' + expect = the stage read in the same
// request, so a teammate's move in between is a 409). Undo takes the touch
// back first through undoPartnerSignal (only the partner's latest change,
// inside its window) - if that refuses, nothing else is undone.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status, error) => Object.assign(new Error(error), { status });

export function doneFlag(done) {
  if (done === undefined || done === false) return false;
  if (done === true) return true;
  throw err(400, 'done must be true');
}

export async function partnerDoneTouch(supabase, { businessId, goalId, userId, now, today, note, meta }) {
  const { data: g, error } = await supabase.from('sales_goals').select('pipeline_status').eq('business_id', businessId).eq('id', goalId).maybeSingle();
  if (error) throw err(500, error.message);
  if (!g) throw err(409, 'partner changed since - reload');
  return applyPartnerSignal(supabase, {
    businessId, goalId, byUser: userId, now, meta,
    signal: { type: 'touch', touch_type: 'email', date: today, move_to: 'none', expect: g.pipeline_status || 'not_started', note },
  });
}

// A failed request takes its touch back off without recording an undo event.
export async function revertTouch(supabase, event) {
  const prev = event.meta?.prev || {};
  if (Object.keys(prev).length) await supabase.from('sales_goals').update(prev).eq('id', event.goal_id);
  await supabase.from('sales_partner_events').delete().eq('id', event.id);
}

// The touch a Done logged for this row: the id the client handed back (must be
// this row's), else the newest touch carrying the row's id in its meta that no
// undo event has taken back yet (a row can be Done, undone and Done again), else null.
export async function doneTouchEvent(supabase, businessId, eventId, mine) {
  if (eventId != null && !UUID.test(eventId)) throw err(400, 'touch_event_id must be a uuid');
  const { data, error } = await supabase.from('sales_partner_events').select('*').eq('business_id', businessId).in('event', ['touch', 'undo']);
  if (error) throw err(500, error.message);
  const rows = data || [];
  if (eventId) {
    const hit = rows.find(e => e.id === eventId && e.event === 'touch' && mine(e)) || null;
    if (!hit) throw err(400, "touch_event_id is not this row's touch");
    return hit;
  }
  const undone = new Set(rows.filter(e => e.event === 'undo').map(e => e.meta?.undid));
  return rows.filter(e => e.event === 'touch' && mine(e) && !undone.has(e.id)).sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)))[0] || null;
}

// Undo's first step; a refusal (not the latest change, past the window, drift) comes back as its 409.
export async function undoDoneTouch(supabase, { businessId, touch, userId, now }) {
  try {
    await undoPartnerSignal(supabase, { businessId, goalId: touch.goal_id, eventId: touch.id, byUser: userId, now });
    return null;
  } catch (e) {
    return { status: e.status || 500, body: { error: e.message } };
  }
}
