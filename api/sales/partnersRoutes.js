import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase, isDate, laStartOfDayMs, addDays } from './goalsShared.js';
import { applyPartnerSignal, undoPartnerSignal, plan, SignalError } from './partnerSignals.js';
import { loadPartnerData, firstContactEvent, isContact } from './partnerMetrics.js';
import { planRanks } from './partnerRank.js';

// sales-partners-pipeline-v1 Stage 2 - partner buttons and history. Mounted
// under /api/sales/:businessId, so salesGate has already applied viewer-reads
// / member-writes; the service key writes sales_partner_events.

const send = (res, fn) => fn.then(r => res.json(r)).catch(e => res.status(e instanceof SignalError ? e.status : 500).json({ error: e.message }));

// POST /goals/partners/:id/signal  body { type, ... } (see partnerSignals.js)
export async function partnerSignalRoute(req, res) {
  const supabase = getSupabase();
  const signal = req.body || {};
  if (signal.type === 'assign' && signal.owner_user_id) {
    const { data, error } = await supabase.from('business_members').select('id')
      .eq('business_id', req.params.businessId).eq('user_id', signal.owner_user_id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(400).json({ error: 'owner_user_id is not a member of this workspace' });
  }
  return send(res, applyPartnerSignal(supabase, { businessId: req.params.businessId, goalId: req.params.id, signal, byUser: req.auth.user.id }));
}

// POST /goals/partners/:id/undo  body { event_id }
export async function partnerUndoRoute(req, res) {
  const eventId = req.body?.event_id;
  if (typeof eventId !== 'string') return res.status(400).json({ error: 'event_id is required' });
  return send(res, undoPartnerSignal(getSupabase(), { businessId: req.params.businessId, goalId: req.params.id, eventId, byUser: req.auth.user.id }));
}

// GET /goals/partners/events?goal_id=&from=YYYY-MM-DD&to=YYYY-MM-DD (LA days, to exclusive)
export async function listPartnerEventsRoute(req, res) {
  const { goal_id, from, to } = req.query;
  if ((from && !isDate(from)) || (to && !isDate(to))) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
  const supabase = getSupabase();
  try {
    const events = await selectAllPages(() => {
      let q = supabase.from('sales_partner_events').select('*').eq('business_id', req.params.businessId);
      if (goal_id) q = q.eq('goal_id', goal_id);
      if (from) q = q.gte('at', new Date(laStartOfDayMs(from)).toISOString());
      if (to) q = q.lt('at', new Date(laStartOfDayMs(to)).toISOString());
      return q.order('at', { ascending: false }).order('id');
    });
    res.json({ events });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// POST /goals/partners/:id/rank  body { order: [ids top to bottom] } - the
// group's order after :id was moved (sales-partners-workflow-v1). Every id
// must be a live partner in this workspace. Reorders are last-write-wins and
// write no event (they're not partner activity).
const ORDER_MAX = 200;
export async function partnerRankRoute(req, res) {
  const order = req.body?.order;
  if (!Array.isArray(order) || !order.length || order.length > ORDER_MAX || !order.every(id => typeof id === 'string')) {
    return res.status(400).json({ error: `order must be a list of 1-${ORDER_MAX} partner ids` });
  }
  if (new Set(order).size !== order.length) return res.status(400).json({ error: 'order has the same partner twice' });
  if (!order.includes(req.params.id)) return res.status(400).json({ error: 'order must include the partner being moved' });
  const supabase = getSupabase();
  const { data: rows, error } = await supabase.from('sales_goals').select('id, sort_rank')
    .eq('business_id', req.params.businessId).eq('goal_type', 'partnership').is('archived_at', null).in('id', order);
  if (error) return res.status(500).json({ error: error.message });
  if (rows.length !== order.length) return res.status(404).json({ error: 'partner not found' });
  const updates = planRanks(order, new Map(rows.map(r => [r.id, r.sort_rank == null ? null : Number(r.sort_rank)])), req.params.id);
  for (const u of updates) {
    const { error: upErr } = await supabase.from('sales_goals').update({ sort_rank: u.sort_rank })
      .eq('business_id', req.params.businessId).eq('id', u.id);
    if (upErr) return res.status(500).json({ error: upErr.message });
  }
  res.json({ ranks: Object.fromEntries(updates.map(u => [u.id, u.sort_rank])) });
}

// POST /goals/partners/touches  body { dry_run, touches: [{ goal_id, touch_type,
// date, contacts?, note?, move_to?, expect? }] } - partner-touch-log-v1 bulk
// catch-up. dry_run returns the per-partner preview and writes nothing; the
// real run refuses the whole batch if any row would fail, then logs each
// touch through applyPartnerSignal (one event per row). A single touch is
// POST /partners/:id/signal with type 'touch'.
const BULK_MAX = 100;
const laDateOf = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const mondayOf = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

export function previewTouch(goal, touch, data, now) {
  const base = { goal_id: goal.id, name: goal.name, from_status: goal.pipeline_status || 'not_started' };
  try {
    const { event } = plan(goal, { ...touch, type: 'touch' }, now);
    const first = firstContactEvent(data, goal.id);
    const counts = isContact(event) && (!first || Date.parse(event.at) < Date.parse(first.at));
    return { ...base, to_status: event.to_status, at: event.at, week_start: mondayOf(touch.date), first_touch: counts, ...(counts && first ? { replaces_first_touch_week: mondayOf(laDateOf(first.at)) } : {}) };
  } catch (e) {
    if (!(e instanceof SignalError)) throw e;
    return { ...base, error: e.message, status: e.status };
  }
}

export async function logTouchesRoute(req, res) {
  const { dry_run, touches } = req.body || {};
  if (!Array.isArray(touches) || !touches.length || touches.length > BULK_MAX) return res.status(400).json({ error: `touches must be a list of 1-${BULK_MAX}` });
  if (!touches.every(t => t && typeof t === 'object' && typeof t.goal_id === 'string')) return res.status(400).json({ error: 'every touch needs a goal_id' });
  const ids = touches.map(t => t.goal_id);
  if (new Set(ids).size !== ids.length) return res.status(400).json({ error: 'the same partner is in the list twice - one touch per partner per batch' });
  const businessId = req.params.businessId;
  const supabase = getSupabase();
  const now = new Date();
  try {
    const [{ data: goals, error }, data] = await Promise.all([
      supabase.from('sales_goals').select('*').eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).in('id', ids),
      loadPartnerData(supabase, businessId),
    ]);
    if (error) throw new Error(error.message);
    const byId = new Map(goals.map(g => [g.id, g]));
    const preview = touches.map(t => (byId.has(t.goal_id)
      ? previewTouch(byId.get(t.goal_id), t, data, now)
      : { goal_id: t.goal_id, error: 'partner not found', status: 404 }));
    if (dry_run) return res.json({ preview });
    if (preview.some(p => p.error)) return res.status(400).json({ error: 'some touches can\'t be logged - fix them and try again', preview });
    const results = [];
    for (const t of touches) {
      const { goal_id, ...signal } = t;
      try {
        const r = await applyPartnerSignal(supabase, { businessId, goalId: goal_id, signal: { ...signal, type: 'touch' }, byUser: req.auth.user.id, now });
        results.push({ goal_id, event_id: r.event.id, to_status: r.event.to_status });
      } catch (e) {
        if (!(e instanceof SignalError)) throw e;
        results.push({ goal_id, error: e.message, status: e.status });
      }
    }
    res.json({ preview, results, logged: results.filter(r => !r.error).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
