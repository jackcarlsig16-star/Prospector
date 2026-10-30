// grow-signals-v1 G6 + G7 - the Signals panel's reads and actions, and the one-click lists. Mounted under
// /api/hk/:businessId (hkGate ran: GET viewer+, the rest member+). Dismiss / seen / acted are timestamps; nothing is
// deleted. + Pipeline runs the same can_contact refusals the connector's hk_claim does and claims through the same writer.
import { getSupabase, HkError, fail, me, logEvent, brandById, brandSummary, SPONSOR_RELATIONSHIPS, selectIn, memberFirstNames } from './hkShared.js';
import { patchBrandRoute } from './brandsRoutes.js';
import { SPONSOR_KINDS, writeSignal, recomputeHeat, signalWords } from './signals.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_MAX = 200;

// GET /signals?all=1 -> { prospects: [...], sponsors: [...] } newest first; open (not dismissed) unless all=1.
export async function listSignalsRoute(req, res, { supabase = getSupabase() } = {}) {
  const businessId = req.params.businessId;
  try {
    let q = supabase.from('hk_signals').select('*').eq('business_id', businessId).order('occurred_at', { ascending: false }).order('id').limit(LIST_MAX);
    if (req.query?.all !== '1') q = q.is('dismissed_at', null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const ids = [...new Set((data || []).map(s => s.brand_id).filter(Boolean))];
    const brands = Object.fromEntries((await selectIn(() => supabase.from('hk_brands').select('id, name, domain, status, relationship, owner_user_id, owner_unclear, updated_at, heat, heat_band, targeted_at').eq('business_id', businessId).order('id'), 'id', ids)).map(b => [b.id, b]));
    const row = s => ({ id: s.id, kind: s.kind, words: signalWords(s.kind), points: SPONSOR_KINDS.has(s.kind) ? 0 : s.points, occurred_at: s.occurred_at, source: s.source, detail: s.detail, brand: s.brand_id && brands[s.brand_id] ? brands[s.brand_id] : null, domain: s.domain, seen_at: s.seen_at, acted_at: s.acted_at, dismissed_at: s.dismissed_at, ref_type: s.ref_type, ref_id: s.ref_type === 'domain' || s.ref_type === 'thread' || s.ref_type === 'reply' ? s.ref_id : null });
    const all = (data || []).map(row);
    res.json({ prospects: all.filter(s => !SPONSOR_KINDS.has(s.kind)), sponsors: all.filter(s => SPONSOR_KINDS.has(s.kind)), unseen_hot_warm: all.filter(s => !s.seen_at && !SPONSOR_KINDS.has(s.kind) && ['hot', 'warm'].includes(s.brand?.heat_band)).length });
  } catch (e) { fail(res, e, 'signals/list'); }
}

// POST /signals/seen { ids: [...] } (<= 200)
export async function seenSignalsRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > LIST_MAX || !ids.every(i => UUID.test(String(i)))) throw new HkError(400, `send { ids: [...] } with 1 to ${LIST_MAX} signal ids`);
    const { data, error } = await supabase.from('hk_signals').update({ seen_at: now().toISOString() }).eq('business_id', req.params.businessId).in('id', ids).is('seen_at', null).select('id');
    if (error) throw new Error(error.message);
    res.json({ seen: (data || []).length });
  } catch (e) { fail(res, e, 'signals/seen'); }
}

async function signalById(supabase, businessId, id) {
  if (!UUID.test(String(id || ''))) throw new HkError(404, 'signal not found');
  const { data, error } = await supabase.from('hk_signals').select('*').eq('business_id', businessId).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HkError(404, 'signal not found');
  return data;
}

// POST /signals/:id/act - the person opened the thread / brand from it.
export async function actSignalRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  try {
    const s = await signalById(supabase, req.params.businessId, req.params.id);
    const at = now().toISOString();
    await supabase.from('hk_signals').update({ acted_at: s.acted_at || at, seen_at: s.seen_at || at }).eq('id', s.id);
    res.json({ acted: true });
  } catch (e) { fail(res, e, 'signals/act'); }
}

// POST /signals/:id/dismiss { undo? } - removes that signal's points from the brand's heat (undo puts them back).
export async function dismissSignalRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId;
  try {
    const s = await signalById(supabase, businessId, req.params.id);
    const undo = req.body?.undo === true, at = now();
    await supabase.from('hk_signals').update(undo ? { dismissed_at: null } : { dismissed_at: s.dismissed_at || at.toISOString(), seen_at: s.seen_at || at.toISOString() }).eq('id', s.id);
    if (s.brand_id) await recomputeHeat(supabase, businessId, { brandIds: [s.brand_id], now: at });
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: s.brand_id ? 'brand' : 'signal', entityId: s.brand_id || null, action: undo ? 'signal.restored' : 'signal.dismissed', detail: { signal_id: s.id, kind: s.kind } });
    res.json({ dismissed: !undo });
  } catch (e) { fail(res, e, 'signals/dismiss'); }
}

// POST /brands/:id/target { on: true | false } - + Target and its Undo. On: targeted_at/by + a targeted_by_user signal;
// off: clears them and dismisses that signal (never deleted).
export async function targetRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, uid = me(req);
  try {
    if (typeof req.body?.on !== 'boolean') throw new HkError(400, 'send { on: true | false }');
    const brand = await brandById(supabase, businessId, req.params.id);
    if (brand.archived_at) throw new HkError(409, 'that brand is archived');
    const at = now();
    if (req.body.on) {
      if (brand.targeted_at) return res.json({ brand: { ...brandSummary(brand), targeted_at: brand.targeted_at }, already: true });
      const { error } = await supabase.from('hk_brands').update({ targeted_at: at.toISOString(), targeted_by: uid }).eq('id', brand.id).eq('business_id', businessId);
      if (error) throw new Error(error.message);
      await writeSignal(supabase, { businessId, kind: 'targeted_by_user', brandId: brand.id, ownerUserId: brand.owner_user_id, occurredAt: at.toISOString(), source: 'user', refType: 'target', refId: `${brand.id}:${at.toISOString()}`, detail: `${brand.name} ${signalWords('targeted_by_user')}` });
    } else {
      if (!brand.targeted_at) return res.json({ brand: { ...brandSummary(brand), targeted_at: null }, already: true });
      const { error } = await supabase.from('hk_brands').update({ targeted_at: null, targeted_by: null }).eq('id', brand.id).eq('business_id', businessId);
      if (error) throw new Error(error.message);
      await supabase.from('hk_signals').update({ dismissed_at: at.toISOString() }).eq('business_id', businessId).eq('brand_id', brand.id).eq('kind', 'targeted_by_user').is('dismissed_at', null);
    }
    await recomputeHeat(supabase, businessId, { brandIds: [brand.id], now: at });
    await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: req.body.on ? 'brand.targeted' : 'brand.untargeted', detail: { name: brand.name } });
    res.json({ brand: { ...brandSummary(brand), targeted_at: req.body.on ? at.toISOString() : null } });
  } catch (e) { fail(res, e, 'brands/target'); }
}

// Why + Pipeline can't claim a brand for the caller, in plain words - or null.
export function pipelineRefusal(brand, uid, firstName = () => null) {
  if (SPONSOR_RELATIONSHIPS.has(brand.relationship)) return `${brand.name} is a ${brand.relationship === 'sponsor' ? 'sponsor' : 'founding partner'} - not for the Pipeline`;
  if (brand.relationship === 'do_not_contact') return `${brand.name} is marked do not contact`;
  if (brand.owner_unclear) return `${brand.name}'s owner is Unclear - sort it out first`;
  if (brand.owner_user_id && brand.owner_user_id !== uid) return `${brand.name} is owned by ${firstName(brand.owner_user_id) || 'another founder'}`;
  if (brand.status === 'passed') return `${brand.name} was passed on`;
  return null;
}

const asRes = () => { const out = { code: 200, body: null }; const r = { status(c) { out.code = c; return r; }, json(b) { out.body = b; return r; } }; return [r, out]; };

// POST /brands/:id/pipeline { undo?, expect_updated_at? } - claim for the caller (candidate -> claimed) so it shows on
// the Pipeline board. Undo releases it (the exact inverse of the claim) only while it is yours and its updated_at is
// still the one + Pipeline returned - a stale-screen guard, like the Partners `expect`.
export async function pipelineRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, uid = me(req);
  try {
    const brand = await brandById(supabase, businessId, req.params.id);
    if (brand.archived_at) throw new HkError(409, 'that brand is archived');
    const undo = req.body?.undo === true;
    if (undo) {
      if (brand.owner_user_id !== uid || brand.updated_at !== req.body?.expect_updated_at) throw new HkError(409, `${brand.name} changed since - nothing to undo`);
    } else {
      const why = pipelineRefusal(brand, uid, await memberFirstNames(supabase, businessId));
      if (why) throw new HkError(409, why);
      if (brand.owner_user_id === uid && brand.status !== 'candidate') return res.json({ brand: brandSummary(brand), already: true });
    }
    const [r, out] = asRes();
    await patchBrandRoute({ ...req, params: { businessId, id: brand.id }, body: { claim: !undo, reason: undo ? 'undo + Pipeline' : '+ Pipeline', ...(!undo && req.body?.confirm_sheet_owner === true ? { confirm_sheet_owner: true } : {}) } }, r, { supabase, now });
    if (out.code >= 400) throw new HkError(out.code, out.body?.error || 'that did not work', out.body);
    res.json({ brand: { ...brandSummary(out.body.brand), updated_at: out.body.brand.updated_at }, undone: undo });
  } catch (e) { fail(res, e, 'brands/pipeline'); }
}

