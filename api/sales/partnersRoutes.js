import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase, isDate, laStartOfDayMs } from './goalsShared.js';
import { applyPartnerSignal, undoPartnerSignal, SignalError } from './partnerSignals.js';
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
