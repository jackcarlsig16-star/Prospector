import { getSupabase } from './goalsShared.js';
import { RECORD_TABLE } from './leadSource.js';
import { cleanText } from './scrubText.js';

// homelover-flow-v1 - sales_flow_events: the Activity + Undo log for the flow actions on any record kind (deprioritize,
// bring back, a hand-set Fit, a Map Assign on an employer / target, the automatic reply / meeting moves, They replied…).
// Every row holds prev (what each changed column held) and meta.set (what it was set to), so Undo restores the exact
// prior values and refuses when something changed since (same rule as partner undo). Rows are never deleted: an Undo
// stamps undone_at and adds an 'undo' row. Partner stage / owner moves never go through here (applyPartnerSignal).
export const FLOW_KINDS = ['deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'undo'];
export const UNDO_WINDOW_MS = 2 * 60e3; // the client shows 10 s; the slack covers slow networks
export const AUTO_UNDO_WINDOW_MS = 7 * 864e5; // an automatic move (by_user null) stays undoable for 7 days (F7)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });

export async function logFlow(supabase, { businessId, recordType, recordId, kind, text, prev = {}, set = {}, meta = {}, byUser = null, now = new Date() }) {
  if (!FLOW_KINDS.includes(kind)) throw err(400, `kind must be one of ${FLOW_KINDS.join('|')}`);
  const r = await supabase.from('sales_flow_events').insert({
    business_id: businessId, record_type: recordType, record_id: String(recordId), kind, text: cleanText(text, 300) || kind,
    prev, meta: { ...meta, set }, by_user: byUser, at: now.toISOString(),
  }).select('id, kind, text, at, by_user').single();
  if (r.error?.code === '23505') throw err(409, 'already applied');
  return must(r);
}

// The latest not-undone event of a kind on a record (the They replied… outcome the panel's suggestion reads).
export async function latestFlow(supabase, businessId, recordType, recordId, kinds) {
  const rows = must(await supabase.from('sales_flow_events').select('id, kind, text, prev, meta, by_user, at, undone_at')
    .eq('business_id', businessId).eq('record_type', recordType).eq('record_id', String(recordId)).in('kind', kinds).order('at', { ascending: false }).limit(20));
  return rows.find(r => !r.undone_at) || null;
}

export async function listFlow(supabase, businessId, recordType, recordId, { limit = 20 } = {}) {
  return must(await supabase.from('sales_flow_events').select('id, kind, text, prev, meta, by_user, at, undone_at, undone_by')
    .eq('business_id', businessId).eq('record_type', recordType).eq('record_id', String(recordId)).order('at', { ascending: false }).limit(limit));
}

// Where a record kind's columns live. A visitor's live on its visit_priority_override row (keyed by company_key).
async function currentRow(supabase, businessId, ev) {
  if (ev.record_type === 'visitor') {
    const rows = must(await supabase.from('visit_priority_override').select('*').eq('business_id', businessId).eq('company_key', ev.record_id).limit(1));
    return rows[0] || null;
  }
  return must(await supabase.from(RECORD_TABLE[ev.record_type]).select('*').eq('business_id', businessId).eq('id', ev.record_id).maybeSingle());
}
async function restoreRow(supabase, businessId, ev, prev, now) {
  if (ev.record_type === 'visitor') {
    must(await supabase.from('visit_priority_override').upsert({ business_id: businessId, company_key: ev.record_id, ...prev }, { onConflict: 'business_id,company_key' }).select('company_key'));
    return;
  }
  const rows = must(await supabase.from(RECORD_TABLE[ev.record_type]).update({ ...prev, updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', ev.record_id).select('id'));
  if (!rows.length) throw err(404, `${ev.record_type} not found`);
}

// POST goals/flow/:id/undo -> { restored: { ...prev }, event: { id } }. Only the event's own changes come back, only
// while every column it set still holds that value (409 otherwise), within the window for its kind.
export async function undoFlow(supabase, { businessId, eventId, byUser = null, now = new Date() }) {
  if (!UUID.test(eventId || '')) return reply(404, { error: 'event not found' });
  try {
    const ev = must(await supabase.from('sales_flow_events').select('*').eq('business_id', businessId).eq('id', eventId).maybeSingle());
    if (!ev) return reply(404, { error: 'event not found' });
    if (ev.kind === 'undo') return reply(409, { error: 'an undo cannot be undone' });
    if (ev.undone_at) return reply(409, { error: 'already undone' });
    const window = ev.by_user ? UNDO_WINDOW_MS : AUTO_UNDO_WINDOW_MS;
    if (now - Date.parse(ev.at) > window) return reply(409, { error: 'too late to undo' });
    const set = ev.meta?.set || {}, prev = ev.prev || {};
    const cur = await currentRow(supabase, businessId, ev);
    if (!cur && Object.keys(set).length) return reply(404, { error: `${ev.record_type} not found` });
    const drift = Object.keys(set).find(k => String(cur?.[k] ?? '') !== String(set[k] ?? ''));
    if (drift) return reply(409, { error: `${drift} changed since - undo skipped`, code: 'drift' });
    if (Object.keys(prev).length) await restoreRow(supabase, businessId, ev, prev, now);
    must(await supabase.from('sales_flow_events').update({ undone_at: now.toISOString(), undone_by: byUser }).eq('id', ev.id).select('id'));
    const undo = await logFlow(supabase, { businessId, recordType: ev.record_type, recordId: ev.record_id, kind: 'undo', text: `Undid: ${ev.text}`, prev: set, set: prev, meta: { undid: ev.id, undid_kind: ev.kind }, byUser, now });
    return reply(200, { restored: prev, undid: { id: ev.id, kind: ev.kind, record_type: ev.record_type, record_id: ev.record_id }, event: { id: undo.id } });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function undoFlowRoute(req, res) {
  const r = await undoFlow(getSupabase(), { businessId: req.params.businessId, eventId: req.params.id, byUser: req.auth.user.id });
  res.status(r.status).json(r.body);
}

// GET goals/flow/:type/:id -> { events } (Viewer+; names and reasons only).
export async function listFlowRoute(req, res) {
  const { type, id } = req.params;
  if (!['partner', 'employer', 'target', 'visitor'].includes(type)) return res.status(400).json({ error: 'type must be partner|employer|target|visitor' });
  try { res.json({ events: await listFlow(getSupabase(), req.params.businessId, type, id) }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
