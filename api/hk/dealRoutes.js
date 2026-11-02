// grow-sponsor-deals-v1 S4 / S6 / ruling 2 - the money view and month writes (under /api/hk/:businessId behind hkGate:
// GET = Viewer, writes = Member; archive / restore = owner role, as the remove always was). Every write logs one Activity
// row, returns what its Undo needs and re-derives the brand's relationship from its months. A month is never deleted:
// "remove" archives it and Undo restores it. A user edit marks the row source 'user', so a sheet re-import leaves it.
import { getSupabase, HkError, fail, isOwner, me, text, bool, oneOf, logEvent, brandById } from './hkShared.js';
import { STATES, stateOf, chicagoMonth, addMonths, livePeriods, moneyByMonth, syncRelationship, detailPii } from './deals.js';
import { intelSettings } from './intelScore.js';

const PERIOD = /^([0-9]{4}-(0[1-9]|1[0-2])|launch)$/;
const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
export const MONEY_BACK = 3, MONEY_AHEAD = 3; // REVISABLE - the last 3 months + this month + next 3
const EDITABLE = ['period', 'state', 'amount_usd', 'paid', 'deal_type', 'details', 'note'];

const amountOf = v => { if (v === null || v === '') return null; if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 99999999) throw new HkError(400, 'amount must be blank or a dollar amount'); return Math.round(v * 100) / 100; };
export function detailsOf(v) {
  if (v == null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HkError(400, 'details must be an object');
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    const key = text(k, 40, 'a details label', { required: true }), s = val == null ? '' : String(val).replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (s.length > 300) throw new HkError(400, `${key} is too long (max 300 characters)`);
    if (detailPii(s)) throw new HkError(400, `${key} can't hold an email address or phone number`);
    out[key] = s;
  }
  if (Buffer.byteLength(JSON.stringify(out)) > 2048) throw new HkError(400, 'details are too long (2 KB max)');
  return out;
}
// The fields a body sets (only the ones it names). paid writes paid_at; a state change writes who and when.
function fieldsOf(body, uid, at, { move = false } = {}) {
  const p = {};
  if (move && 'period' in body) { p.period = String(body.period || '').trim(); if (!MONTH.test(p.period)) throw new HkError(400, 'period must be a month like 2026-11'); }
  if ('state' in body) { p.state = oneOf(body.state, new Set(STATES), 'state'); p.state_changed_at = at; p.state_changed_by = uid; }
  if ('amount_usd' in body) p.amount_usd = amountOf(body.amount_usd);
  if ('paid' in body) { p.paid = bool(body.paid, 'paid') ?? false; p.paid_at = p.paid ? at : null; }
  if ('deal_type' in body) p.deal_type = text(body.deal_type, 80, 'deal type');
  if ('details' in body) p.details = detailsOf(body.details);
  if ('note' in body) p.note = text(body.note, 300, 'note');
  return p;
}
const view = p => ({ id: p.id, brand_id: p.brand_id, period: p.period, kind: p.kind, state: stateOf(p), amount_usd: p.amount_usd == null ? null : Number(p.amount_usd), paid: !!p.paid, paid_at: p.paid_at || null, deal_type: p.deal_type || null, details: p.details || {}, note: p.note || null, source: p.source || 'sheet', state_changed_at: p.state_changed_at || null, archived_at: p.archived_at || null });
// Activity keeps which details changed, never their text (dates in them read as phones to the event guard).
const words = o => ('details' in o ? { ...o, details: Object.keys(o.details || {}) } : o);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function periodOf(supabase, businessId, brandId, pid) {
  const { data, error } = await supabase.from('hk_sponsor_periods').select('*').eq('business_id', businessId).eq('brand_id', brandId).eq('id', pid).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HkError(404, 'month not found');
  return data;
}
const writable = brand => { if (brand.archived_at) throw new HkError(409, 'that brand is archived'); if (brand.relationship === 'do_not_contact') throw new HkError(400, `${brand.name} is do-not-contact - no sponsor months`); };
async function defaultAmount(supabase, businessId) { const { data } = await supabase.from('hk_settings').select('intel').eq('business_id', businessId).maybeSingle(); return intelSettings(data?.intel).default_monthly_usd; }

// Adds a month, or brings an archived one back with these values (UNIQUE brand + period + kind). -> { period, relationship, undo }
async function putMonth(supabase, { businessId, brand, uid, at, period, kind, fields, action, detail }) {
  const { data: rows, error } = await supabase.from('hk_sponsor_periods').select('*').eq('business_id', businessId).eq('brand_id', brand.id).eq('period', period).eq('kind', kind);
  if (error) throw new Error(error.message);
  const prior = rows?.[0];
  if (prior && !prior.archived_at) throw new HkError(409, `${brand.name} already has that month`);
  const row = { state: 'confirmed', state_changed_at: at, state_changed_by: uid, ...fields, source: 'user', archived_at: null, archived_by: null };
  const q = prior ? supabase.from('hk_sponsor_periods').update(row).eq('id', prior.id) : supabase.from('hk_sponsor_periods').insert({ business_id: businessId, brand_id: brand.id, period, kind, ...row });
  const { data, error: e2 } = await q.select().single();
  if (e2) throw e2;
  await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action, detail: { period, kind, state: data.state, amount_usd: data.amount_usd ?? null, ...detail } });
  const relationship = await syncRelationship(supabase, { businessId, brand, actorUserId: uid, now: new Date(at) });
  return { period: view(data), relationship, undo: { archive: data.id } };
}

// GET /deals/money?from=YYYY-MM&to=YYYY-MM -> { months, totals, this_month, default_monthly_usd }
export async function moneyRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, q = req.query || {};
  try {
    const thisMonth = chicagoMonth(now());
    const from = q.from ? String(q.from) : addMonths(thisMonth, -MONEY_BACK), to = q.to ? String(q.to) : addMonths(thisMonth, MONEY_AHEAD);
    if (!MONTH.test(from) || !MONTH.test(to) || from > to) throw new HkError(400, 'from / to must be months like 2026-11, from before to');
    const months = []; for (let m = from; m <= to && months.length < 24; m = addMonths(m, 1)) months.push(m);
    const [periods, { data: brands, error }] = await Promise.all([livePeriods(supabase, businessId, 'id, brand_id, period, kind, state, amount_usd, paid'),
      supabase.from('hk_brands').select('id').eq('business_id', businessId).is('archived_at', null)]);
    if (error) throw new Error(error.message);
    const live = new Set((brands || []).map(b => b.id));
    res.json({ ...moneyByMonth(periods.filter(p => live.has(p.brand_id)), months), this_month: thisMonth, default_monthly_usd: await defaultAmount(supabase, businessId) });
  } catch (e) { fail(res, e, 'deals/money'); }
}

// POST /sponsors/:brandId/periods { period, kind?, state?, amount_usd?, paid?, deal_type?, details?, note? } (member)
// No amount_usd key = the Settings default (blank allowed); state defaults to confirmed.
export async function addPeriodRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, body = req.body || {}, uid = me(req);
  try {
    const brand = await brandById(supabase, businessId, req.params.brandId);
    writable(brand);
    const period = String(body.period || '').trim(); if (!PERIOD.test(period)) throw new HkError(400, "period must be YYYY-MM or 'launch'");
    const kind = oneOf(body.kind || (period === 'launch' ? 'launch' : 'monthly'), new Set(['launch', 'monthly']), 'kind');
    const at = now().toISOString();
    const fields = fieldsOf(body, uid, at);
    if (!('amount_usd' in body) && kind === 'monthly') fields.amount_usd = await defaultAmount(supabase, businessId);
    res.status(201).json(await putMonth(supabase, { businessId, brand, uid, at, period, kind, fields, action: 'sponsor.period_added', detail: {} }));
  } catch (e) { fail(res, e, 'sponsors/period'); }
}

// PATCH /sponsors/:brandId/periods/:pid { state?, amount_usd?, paid?, deal_type?, details?, note?, expect? } (member)
// expect = { field: value } the screen showed; a mismatch is a 409 (Undo refuses after someone else changed it).
// -> { period, prev (the changed fields' old values - Undo sends them back with expect = the new ones), relationship }
export async function patchPeriodRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, body = req.body || {}, uid = me(req);
  try {
    const brand = await brandById(supabase, businessId, req.params.brandId);
    writable(brand);
    const row = await periodOf(supabase, businessId, brand.id, req.params.pid);
    if (row.archived_at) throw new HkError(409, 'that month was removed - restore it first');
    const cur = view(row);
    if (body.expect != null) {
      if (typeof body.expect !== 'object' || Array.isArray(body.expect)) throw new HkError(400, 'expect must be an object');
      for (const [k, v] of Object.entries(body.expect)) if (EDITABLE.includes(k) && !same(cur[k], v)) throw new HkError(409, `${brand.name}'s month changed since - nothing to undo`, { current: cur });
    }
    const at = now().toISOString();
    const fields = fieldsOf(body, uid, at, { move: true });
    const changed = EDITABLE.filter(k => k in fields && !same(cur[k], k === 'amount_usd' && fields[k] != null ? Number(fields[k]) : fields[k]));
    if (!changed.length) return res.json({ period: cur, prev: {}, changed: [], relationship: null });
    // Moving a month (the "Needs update" fix and its Undo): monthly rows only, and never onto a month the brand already has
    // (UNIQUE brand + period + kind counts archived rows too).
    if (changed.includes('period')) {
      if (row.kind !== 'monthly') throw new HkError(400, 'only a monthly month can move');
      const { data: taken, error: te } = await supabase.from('hk_sponsor_periods').select('id, archived_at').eq('business_id', businessId).eq('brand_id', brand.id).eq('period', fields.period).eq('kind', 'monthly');
      if (te) throw new Error(te.message);
      if (taken?.length) throw new HkError(409, `${brand.name} already has ${fields.period}${taken[0].archived_at ? ' (removed - restore it instead)' : ''}`);
    }
    const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => changed.includes(k) || (k === 'paid_at' && changed.includes('paid')) || (k.startsWith('state_changed') && changed.includes('state'))));
    // An Undo (expect set) puts the row's source back too, so a sheet row undone is a sheet row again.
    const source = body.expect != null && ['sheet', 'user', 'email'].includes(body.source) ? body.source : 'user';
    const { data, error } = await supabase.from('hk_sponsor_periods').update({ ...patch, source }).eq('id', row.id).select().single();
    if (error) throw error;
    const prev = { ...Object.fromEntries(changed.map(k => [k, cur[k]])), source: cur.source };
    await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: body.expect ? 'sponsor.period_undone' : 'sponsor.period_changed', detail: { period: row.period, ...(changed.includes('period') ? { moved_to: data.period } : {}), changed, prev: words(Object.fromEntries(changed.map(k => [k, prev[k]]))), next: words(Object.fromEntries(changed.map(k => [k, data[k] ?? null]))) } });
    const relationship = await syncRelationship(supabase, { businessId, brand, actorUserId: uid, now: new Date(at) });
    res.json({ period: view(data), prev, changed, relationship });
  } catch (e) { fail(res, e, 'sponsors/period-patch'); }
}

// DELETE /sponsors/:brandId/periods/:pid (owner role, or the member who just added it - the Add's Undo, 2 min) - ruling 2:
// archives, never deletes. -> { period, undo: { restore } }
export const UNDO_ADD_MS = 2 * 60 * 1000;
export async function deletePeriodRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, uid = me(req);
  try {
    const brand = await brandById(supabase, businessId, req.params.brandId);
    const row = await periodOf(supabase, businessId, brand.id, req.params.pid);
    const justAdded = row.source === 'user' && row.state_changed_by === uid && row.state_changed_at && now().getTime() - Date.parse(row.state_changed_at) <= UNDO_ADD_MS;
    if (!isOwner(req) && !justAdded) throw new HkError(403, 'only an owner-role member can remove a sponsor month');
    if (row.archived_at) throw new HkError(409, 'that month is already removed');
    const at = now().toISOString();
    const { data, error } = await supabase.from('hk_sponsor_periods').update({ archived_at: at, archived_by: uid }).eq('id', row.id).is('archived_at', null).select().single();
    if (error) throw new Error(error.message);
    await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: 'sponsor.period_removed', detail: { period: row.period, kind: row.kind, state: stateOf(row), archived: true } });
    const relationship = await syncRelationship(supabase, { businessId, brand, actorUserId: uid, now: new Date(at) });
    res.json({ ok: true, period: view(data), relationship, undo: { restore: row.id } });
  } catch (e) { fail(res, e, 'sponsors/period-delete'); }
}

// POST /sponsors/:brandId/periods/:pid/restore (owner role) - the remove's Undo. 409 when the month is live (or was re-added).
export async function restorePeriodRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, uid = me(req);
  try {
    if (!isOwner(req)) throw new HkError(403, 'only an owner-role member can restore a sponsor month');
    const brand = await brandById(supabase, businessId, req.params.brandId);
    const row = await periodOf(supabase, businessId, brand.id, req.params.pid);
    if (!row.archived_at) throw new HkError(409, 'that month is not removed - nothing to undo');
    const { data, error } = await supabase.from('hk_sponsor_periods').update({ archived_at: null, archived_by: null }).eq('id', row.id).select().single();
    if (error) throw new Error(error.message);
    await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: 'sponsor.period_restored', detail: { period: row.period, kind: row.kind } });
    const relationship = await syncRelationship(supabase, { businessId, brand, actorUserId: uid, now: now() });
    res.json({ ok: true, period: view(data), relationship });
  } catch (e) { fail(res, e, 'sponsors/period-restore'); }
}

// POST /sponsors/:brandId/periods/:pid/copy-next (member) - a confirmed month -> next month as In discussion (the renewal
// ask), same amount / type / details. Undo = archive it (the returned undo.archive).
export async function copyNextRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, uid = me(req);
  try {
    const brand = await brandById(supabase, businessId, req.params.brandId);
    writable(brand);
    const row = await periodOf(supabase, businessId, brand.id, req.params.pid);
    if (row.archived_at || row.kind !== 'monthly' || stateOf(row) !== 'confirmed') throw new HkError(400, 'only a confirmed month copies to the next month');
    const at = now().toISOString(), next = addMonths(row.period, 1);
    const fields = { state: 'discussing', amount_usd: row.amount_usd ?? null, deal_type: row.deal_type || null, details: row.details || {}, paid: false, paid_at: null };
    res.status(201).json(await putMonth(supabase, { businessId, brand, uid, at, period: next, kind: 'monthly', fields, action: 'sponsor.period_added', detail: { copied_from: row.period } }));
  } catch (e) { fail(res, e, 'sponsors/period-copy'); }
}
