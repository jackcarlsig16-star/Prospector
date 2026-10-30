// grow-ui-refresh-v1 REV2 Stage 2 - the one-click brand actions behind the redesigned Briefing, Brand page and Brands
// list: Pitch (claim + the Claude command, J1), Snooze (J7), Not a fit (J3), Log activity (an outside touch), and the
// research batch with its estimate (J8). Mounted under /api/hk/:businessId behind hkGate (member+). Nothing here sends
// and nothing calls Gmail; every action has its Undo and every Undo refuses when the brand changed since.
import { getSupabase, HkError, fail, isOwner, me, text, oneOf, logEvent, brandById, brandSummary, memberFirstNames, canContact, SPONSOR_RELATIONSHIPS, selectIn } from './hkShared.js';
import { patchBrandRoute } from './brandsRoutes.js';
import { pipelineRefusal } from './signalsRoutes.js';
import { trackedThreads } from './warm.js';
import { researchBrand, SWEEP_CALL_TYPE } from './brandResearch.js';
import { ANALYZE_CALL_TYPE } from './inboxAnalyze.js';
import { intelSettings } from './intelScore.js';
import { dayIn } from './jobs/plan.js';
import { scrubAddresses } from '../sales/scrubText.js';
import { callAnthropic } from '../businesses/shared.js';

const DAY = 864e5;
export const SNOOZE_DAYS = 14; // REVISABLE (J7)
export const BATCH_MAX = 10;
export const ESTIMATE_ROWS = 20, ESTIMATE_MIN_ROWS = 3;
const RESEARCH_CALL_TYPES = [SWEEP_CALL_TYPE, ANALYZE_CALL_TYPE];
const asRes = () => { const out = { code: 200, body: null }; const r = { status(c) { out.code = c; return r; }, json(b) { out.body = b; return r; } }; return [r, out]; };
const claimThrough = async (req, body, deps) => {
  const [r, out] = asRes();
  await patchBrandRoute({ ...req, body }, r, deps);
  if (out.code >= 400) throw new HkError(out.code, out.body?.error || 'that did not work', out.body);
  return out.body.brand;
};
const latestEvent = async (supabase, businessId, brandId, action) => {
  const { data, error } = await supabase.from('hk_events').select('actor_user_id, detail, created_at').eq('business_id', businessId).eq('entity_id', brandId).eq('action', action).order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] || null;
};
// The command Claude reads: the domain, else the name - never an address.
export const pitchCommand = b => `hk pitch ${b.domain || scrubAddresses(b.name).replace(/@/g, '')}`;
const VERDICT_WORDS = { sponsor: 'is a sponsor or founding partner', do_not_contact: 'is marked do not contact', passed: 'was passed on', owner_unclear: "owner is Unclear - sort it out first", warm: 'already has a thread with another founder', max_touches: 'has had every email touch already', owned_by: 'is owned by another founder' };

// POST /brands/:id/pitch { confirm_sheet_owner? } | { undo: true, expect_updated_at } - J1: claims the brand for the
// caller when it is nobody's (through the claim writer, so the sheet-owner question and the Activity row are the same
// as Claim) and returns "hk pitch <domain or name>" for the clipboard. Refused for every can_contact block. Undo releases
// only a claim this Pitch made (the latest brand.claimed row is the caller's, reason Pitch) and only while the brand is
// as Pitch left it.
export async function pitchRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, uid = me(req), body = req.body || {};
  try {
    const brand = await brandById(supabase, businessId, req.params.id);
    if (brand.archived_at) throw new HkError(409, 'that brand is archived');
    const deps = { supabase, now }, params = { businessId, id: brand.id };
    if (body.undo === true) {
      const last = await latestEvent(supabase, businessId, brand.id, 'brand.claimed');
      if (brand.owner_user_id !== uid || brand.updated_at !== body.expect_updated_at || !last || last.actor_user_id !== uid || last.detail?.reason !== 'Pitch') throw new HkError(409, `${brand.name} changed since - nothing to undo`);
      const out = await claimThrough({ ...req, params }, { claim: false, reason: 'undo Pitch' }, deps);
      return res.json({ brand: { ...brandSummary(out), updated_at: out.updated_at }, undone: true });
    }
    const why = pipelineRefusal(brand, uid, await memberFirstNames(supabase, businessId));
    if (why) throw new HkError(409, why);
    const { data: touches, error } = await supabase.from('hk_touches').select('channel, state').eq('business_id', businessId).eq('brand_id', brand.id);
    if (error) throw new Error(error.message);
    const { data: s } = await supabase.from('hk_settings').select('max_email_touches').eq('business_id', businessId).maybeSingle();
    const verdict = canContact({ brand, touches: touches || [], threadsByFounder: await trackedThreads(supabase, businessId, brand.id), senderUserId: uid, kind: 'cold', maxEmailTouches: s?.max_email_touches || 3 });
    if (!verdict.ok) throw new HkError(409, `${brand.name} ${VERDICT_WORDS[verdict.reason] || 'is blocked'}`, { verdict });
    const command = pitchCommand(brand);
    if (brand.owner_user_id === uid) return res.json({ brand: { ...brandSummary(brand), updated_at: brand.updated_at }, claimed: false, command, words: `Copied ${command}. Paste into Claude.` });
    const out = await claimThrough({ ...req, params }, { claim: true, reason: 'Pitch', ...(body.confirm_sheet_owner === true ? { confirm_sheet_owner: true } : {}) }, deps);
    res.json({ brand: { ...brandSummary(out), updated_at: out.updated_at }, claimed: true, command, words: `Claimed. Copied ${command}. Paste into Claude.` });
  } catch (e) { fail(res, e, 'brands/pitch'); }
}

// POST /brands/:id/snooze { on: true | false } - J7: out of Send these 10 for SNOOZE_DAYS; off (and Undo) clears it.
export async function snoozeRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId;
  try {
    if (typeof req.body?.on !== 'boolean') throw new HkError(400, 'send { on: true | false }');
    const brand = await brandById(supabase, businessId, req.params.id);
    if (brand.archived_at) throw new HkError(409, 'that brand is archived');
    const at = now(), until = req.body.on ? new Date(at.getTime() + SNOOZE_DAYS * DAY).toISOString() : null, prev = brand.snoozed_until || null;
    const { data, error } = await supabase.from('hk_brands').update({ snoozed_until: until, updated_at: at.toISOString() }).eq('id', brand.id).eq('business_id', businessId).select().single();
    if (error) throw new Error(error.message);
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: brand.id, action: until ? 'brand.snoozed' : 'brand.unsnoozed', detail: { name: brand.name, until, prev } });
    res.json({ brand: { ...brandSummary(data), snoozed_until: data.snoozed_until, updated_at: data.updated_at } });
  } catch (e) { fail(res, e, 'brands/snooze'); }
}

// POST /brands/:id/not-a-fit { reason? } | { undo: true, expect_updated_at } - J3: status passed + a reason (default
// "Not a fit"; sent again while passed, it edits the reason). Never do not contact. Undo puts back the status and
// reason from the latest brand.passed row, only while the brand is as the last call left it.
export async function notAFitRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, uid = me(req), body = req.body || {};
  try {
    const brand = await brandById(supabase, businessId, req.params.id);
    if (brand.archived_at) throw new HkError(409, 'that brand is archived');
    const at = now().toISOString();
    const write = async patch => { const { data, error } = await supabase.from('hk_brands').update({ ...patch, updated_at: at }).eq('id', brand.id).eq('business_id', businessId).select().single(); if (error) throw new Error(error.message); return data; };
    const reply = data => res.json({ brand: { ...brandSummary(data), pass_reason: data.pass_reason, updated_at: data.updated_at } });
    if (body.undo === true) {
      const last = await latestEvent(supabase, businessId, brand.id, 'brand.passed');
      if (brand.status !== 'passed' || brand.updated_at !== body.expect_updated_at || !last) throw new HkError(409, `${brand.name} changed since - nothing to undo`);
      const data = await write({ status: last.detail.prev_status, pass_reason: last.detail.prev_reason ?? null });
      await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: 'brand.unpassed', detail: { name: brand.name, status: data.status } });
      return reply(data);
    }
    if (SPONSOR_RELATIONSHIPS.has(brand.relationship)) throw new HkError(409, `${brand.name} is a sponsor or founding partner`);
    if (brand.owner_user_id && brand.owner_user_id !== uid && !isOwner(req)) throw new HkError(403, `${brand.name} is another founder's brand`);
    const reason = scrubAddresses(text(body.reason, 200, 'reason') || 'Not a fit');
    if (brand.status === 'passed') {
      const data = await write({ pass_reason: reason });
      await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: 'brand.pass_reason', detail: { name: brand.name, reason } });
      return reply(data);
    }
    const prev = { prev_status: brand.status, prev_reason: brand.pass_reason || null };
    const data = await write({ status: 'passed', pass_reason: reason });
    await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: 'brand.passed', detail: { name: brand.name, reason, ...prev } });
    reply(data);
  } catch (e) { fail(res, e, 'brands/not-a-fit'); }
}

// POST /brands/:id/activity { what, date 'YYYY-MM-DD', note? } (the note covers anything the five kinds don't) | { undo: <touch id> } - Log activity (L): an outside
// touch (kind 'outside', state sent) for contact made away from Grow. The note is scrubbed and stays off the Activity
// row. Undo discards that touch (never deleted).
export const ACTIVITY = { emailed: ['email', 'Emailed'], called: ['phone', 'Called'], met: ['in_person', 'Met'], dm: ['ig_dm', 'DM'], linkedin: ['linkedin', 'LinkedIn'] };
export async function logActivityRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, uid = me(req), body = req.body || {};
  try {
    const brand = await brandById(supabase, businessId, req.params.id);
    if (body.undo) {
      const { data, error } = await supabase.from('hk_touches').update({ state: 'discarded' }).eq('business_id', businessId).eq('brand_id', brand.id).eq('id', String(body.undo)).eq('kind', 'outside').eq('sender_user_id', uid).eq('state', 'sent').select('id');
      if (error) throw new Error(error.message);
      if (!data?.length) throw new HkError(409, 'nothing to undo');
      await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: 'touch.unlogged', detail: { name: brand.name, touch_id: data[0].id } });
      return res.json({ undone: true });
    }
    if (brand.archived_at) throw new HkError(409, 'that brand is archived');
    const what = oneOf(body.what, new Set(Object.keys(ACTIVITY)), 'what');
    if (!what) throw new HkError(400, 'say what happened: emailed, called, met, dm or linkedin');
    const date = String(body.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T17:00:00Z`))) throw new HkError(400, 'date must be YYYY-MM-DD');
    const sentAt = `${date}T17:00:00.000Z`;
    if (date > dayIn(now()) || date < '2020-01-01') throw new HkError(400, 'date must be a past day');
    const note = text(body.note, 200, 'note', { multiline: true });
    const [channel, words] = ACTIVITY[what];
    const { data: touch, error } = await supabase.from('hk_touches').insert({ business_id: businessId, brand_id: brand.id, sender_user_id: uid, channel, kind: 'outside', subject: words, body_text: note ? scrubAddresses(note) : null, state: 'sent', sent_at: sentAt, created_by: 'user' }).select().single();
    if (error) throw new Error(error.message);
    if (!brand.last_touch_at || brand.last_touch_at < sentAt) await supabase.from('hk_brands').update({ last_touch_at: sentAt }).eq('id', brand.id).eq('business_id', businessId);
    await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: 'touch.logged', detail: { name: brand.name, what: words, date, touch_id: touch.id } });
    res.status(201).json({ touch_id: touch.id, what: words, date });
  } catch (e) { fail(res, e, 'brands/activity'); }
}

// J8 - the average cost of the workspace's last ESTIMATE_ROWS research-type calls (the sweep, brand research and inbox
// Analyze are the same call); null under ESTIMATE_MIN_ROWS rows ("no estimate yet").
export async function researchEstimate(supabase, businessId) {
  const { data, error } = await supabase.from('business_anthropic_usage').select('cost_usd, created_at').eq('business_id', businessId).in('call_type', RESEARCH_CALL_TYPES).order('created_at', { ascending: false }).limit(ESTIMATE_ROWS);
  if (error) throw new Error(error.message);
  const costs = (data || []).map(r => Number(r.cost_usd)).filter(Number.isFinite);
  return { per_call: costs.length >= ESTIMATE_MIN_ROWS ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 1e4) / 1e4 : null, rows: costs.length };
}
// Today's research spend (Chicago day), every research-type call.
export async function spentToday(supabase, businessId, now) {
  const { data, error } = await supabase.from('business_anthropic_usage').select('cost_usd, created_at').eq('business_id', businessId).in('call_type', RESEARCH_CALL_TYPES).gte('created_at', new Date(now.getTime() - 2 * DAY).toISOString());
  if (error) throw new Error(error.message);
  const today = dayIn(now);
  return (data || []).filter(r => dayIn(new Date(r.created_at)) === today).reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
}
const money = n => `$${n.toFixed(2)}`;

// POST /research/batch { brand_ids: [<= 10], confirm? } - "Research the n" / bulk Research. Without confirm: the
// estimate only (0 calls). With confirm: one research per brand, in order, stopping on the first error (including the
// 25-a-day click cap) or once the day's research spend would pass the daily dollar cap.
export async function researchBatchRoute(req, res, d = {}) {
  const supabase = d.supabase || getSupabase(), call = d.call || callAnthropic, now = d.now || (() => new Date());
  const businessId = req.params.businessId, uid = me(req), body = req.body || {};
  try {
    const ids = body.brand_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > BATCH_MAX || new Set(ids).size !== ids.length) throw new HkError(400, `send { brand_ids: [...] } with 1 to ${BATCH_MAX} different brands`);
    const found = Object.fromEntries((await selectIn(() => supabase.from('hk_brands').select('*').eq('business_id', businessId).is('archived_at', null).order('id'), 'id', ids.map(String))).map(b => [b.id, b]));
    const brands = ids.map(id => found[id]).filter(Boolean);
    if (brands.length !== ids.length) throw new HkError(404, 'a brand in that list was not found or is archived');
    const est = await researchEstimate(supabase, businessId);
    const estimate = { n: brands.length, per_call: est.per_call, total_usd: est.per_call == null ? null : Math.round(est.per_call * brands.length * 100) / 100 };
    estimate.words = estimate.total_usd == null ? 'no estimate yet' : `about ${money(estimate.total_usd)}`;
    if (body.confirm !== true) return res.json({ estimate });
    const { data: srow } = await supabase.from('hk_settings').select('intel').eq('business_id', businessId).maybeSingle();
    const capUsd = intelSettings(srow?.intel).sweep.cap_usd, at = now();
    let spent = await spentToday(supabase, businessId, at), stopped = null;
    const results = [];
    for (const brand of brands) {
      if (spent + (est.per_call || 0) > capUsd) { stopped = `daily cap (${money(capUsd)})`; break; }
      try {
        const r = await researchBrand({ D: { supabase, call, now }, businessId, uid, brand });
        spent += r.cost_usd || 0;
        results.push({ brand_id: brand.id, name: brand.name, status: r.status, domain: r.domain || null, confidence: r.confidence || null, fit: r.intel?.fit?.sponsor_fit || null, cost_usd: r.cost_usd || 0 });
      } catch (e) { stopped = String(e.message || e).slice(0, 200); break; }
    }
    res.json({ estimate, results, stopped, cost_usd: Math.round(results.reduce((n, r) => n + r.cost_usd, 0) * 1e6) / 1e6 });
  } catch (e) { fail(res, e, 'research/batch'); }
}
