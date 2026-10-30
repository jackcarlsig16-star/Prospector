// hkos-data-foundation-v1 D4 - sponsors, review, activity, settings and member prefs (under /api/hk/:businessId behind
// hkGate). Nothing here returns an address: replies go through replyRow, events were PII-guarded when written.
import { createRequire } from 'module';
import { getSupabase, HkError, fail, isOwner, me, text, bool, oneOf, logEvent, brandRow, brandSummary, liveBrands, allBrands, brandById, nameMatches, selectAllPages, selectIn, hasPii, SPONSOR_RELATIONSHIPS } from './hkShared.js';
import { BUCKETS, VIEWS as BRAND_VIEWS, SORTS, parseFilters } from './brandFilters.js';
import { LABELS } from './replyLabel.js';
const seed = createRequire(import.meta.url)('./lintSeed.json');
// Settings > Pitch shows the rules nobody can edit here: the lint seed's patterns plus the email-touch cap.
const LOCKED_RULES = [...seed.banned_patterns.map(p => ({ id: p.id, rule: p.rule })), { id: 'max_email_touches', rule: 'At most 3 email touches per brand: cold, bump, final.' }, { id: 'no_send', rule: 'Nothing is ever sent from Prospector. Drafts land in Gmail for you to send.' }];

const PERIOD = /^([0-9]{4}-(0[1-9]|1[0-2])|launch)$/;
export const SETTINGS_DEFAULTS = { members_stat: null, completions_stat: null, stats_confirmed_at: null, market_line_local: null, market_line_national: null, subject_format: null, banned_phrases: [], bump_after_days: 5, dm_after_days: 9, final_after_days: 14, max_email_touches: 3, apollo_batch_cap: 25, digest_time: '07:30', digest_days: 'weekdays', timezone: 'America/Chicago', quiet_weekends: true, modules: {}, theme: {} };
const INT_SETTINGS = { members_stat: [0, 10000000], completions_stat: [0, 100000000], bump_after_days: [1, 60], dm_after_days: [1, 90], final_after_days: [1, 120], apollo_batch_cap: [1, 500] };
const TEXT_SETTINGS = { market_line_local: 200, market_line_national: 200, subject_format: 120, digest_time: 5, digest_days: 20, timezone: 60 };

// GET /sponsors -> { sponsors: [...with periods], dnc: [...] }
export async function sponsorsRoute(req, res, { supabase = getSupabase() } = {}) {
  const businessId = req.params.businessId;
  try {
    const brands = await liveBrands(supabase, businessId);
    const sponsors = brands.filter(b => SPONSOR_RELATIONSHIPS.has(b.relationship)), dnc = brands.filter(b => b.relationship === 'do_not_contact');
    const ids = sponsors.map(b => b.id);
    const periods = (await selectIn(() => supabase.from('hk_sponsor_periods').select('*').eq('business_id', businessId).order('period').order('id'), 'brand_id', ids))
      .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
    const dncIds = dnc.map(b => b.id);
    const marks = (await selectIn(() => supabase.from('hk_events').select('id, entity_id, actor_user_id, created_at, action').eq('business_id', businessId).eq('action', 'brand.relationship').order('created_at', { ascending: false }).order('id'), 'entity_id', dncIds))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    res.json({
      sponsors: sponsors.map(b => brandRow(b, { notes: b.notes, periods: periods.filter(p => p.brand_id === b.id).map(p => ({ id: p.id, period: p.period, kind: p.kind, note: p.note })) })),
      dnc: dnc.map(b => { const m = marks.find(x => x.entity_id === b.id); return brandRow(b, { dnc_reason: b.dnc_reason, marked_by: m?.actor_user_id || null, marked_at: m?.created_at || b.updated_at }); }),
    });
  } catch (e) { fail(res, e, 'sponsors'); }
}
// POST /sponsors/:brandId/periods { period, kind, note }
export async function addPeriodRoute(req, res, { supabase = getSupabase() } = {}) {
  const businessId = req.params.businessId, body = req.body || {};
  try {
    const brand = await brandById(supabase, businessId, req.params.brandId);
    if (!SPONSOR_RELATIONSHIPS.has(brand.relationship)) throw new HkError(400, 'periods belong to sponsors and founding partners - set the relationship first');
    const period = String(body.period || '').trim(); if (!PERIOD.test(period)) throw new HkError(400, "period must be YYYY-MM or 'launch'");
    const kind = oneOf(body.kind || (period === 'launch' ? 'launch' : 'monthly'), new Set(['launch', 'monthly']), 'kind');
    const { data, error } = await supabase.from('hk_sponsor_periods').insert({ business_id: businessId, brand_id: brand.id, period, kind, note: text(body.note, 300, 'note') }).select().single();
    if (error) throw error;
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: brand.id, action: 'sponsor.period_added', detail: { period, kind } });
    res.status(201).json({ period: data });
  } catch (e) { fail(res, e, 'sponsors/period'); }
}
// DELETE /sponsors/:brandId/periods/:pid (owner role)
export async function deletePeriodRoute(req, res, { supabase = getSupabase() } = {}) {
  const businessId = req.params.businessId;
  try {
    if (!isOwner(req)) throw new HkError(403, 'only an owner-role member can remove a sponsor period');
    const { data: rows, error } = await supabase.from('hk_sponsor_periods').delete().eq('business_id', businessId).eq('brand_id', req.params.brandId).eq('id', req.params.pid).select();
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new HkError(404, 'period not found');
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: req.params.brandId, action: 'sponsor.period_removed', detail: { period: rows[0].period, kind: rows[0].kind } });
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'sponsors/period-delete'); }
}

const pairKey = (a, b) => [a, b].sort().join('|');
async function decidedPairs(supabase, businessId) { const { data, error } = await supabase.from('hk_duplicate_decisions').select('brand_a, brand_b, verdict').eq('business_id', businessId); if (error) throw new Error(error.message); return new Set((data || []).map(d => pairKey(d.brand_a, d.brand_b))); }
export function duplicatePairs(brands, decided = new Set()) {
  const out = [];
  for (let i = 0; i < brands.length; i++) for (let j = i + 1; j < brands.length; j++) {
    const a = brands[i], b = brands[j];
    if (decided.has(pairKey(a.id, b.id))) continue;
    const reason = a.domain && a.domain === b.domain ? 'same_domain' : nameMatches(a.name, [b], 'name', false).length ? 'same_name' : nameMatches(a.name, [b], 'name', true).length ? 'name_contains' : null;
    if (reason) out.push({ a: brandSummary(a), b: brandSummary(b), reason });
  }
  return out.sort((x, y) => x.a.name.localeCompare(y.a.name) || x.b.name.localeCompare(y.b.name));
}
// GET /review/duplicates
export async function duplicatesRoute(req, res, { supabase = getSupabase() } = {}) {
  try { res.json({ pairs: duplicatePairs(await liveBrands(supabase, req.params.businessId), await decidedPairs(supabase, req.params.businessId)) }); } catch (e) { fail(res, e, 'review/duplicates'); }
}
// POST /review/duplicates/decide { brand_a, brand_b, verdict: 'not_duplicate' | 'merge', winner? }
export async function decideDuplicateRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, body = req.body || {};
  try {
    const verdict = oneOf(body.verdict, new Set(['not_duplicate', 'merge']), 'verdict'); if (!verdict) throw new HkError(400, 'verdict is required');
    const a = await brandById(supabase, businessId, body.brand_a), b = await brandById(supabase, businessId, body.brand_b);
    if (a.id === b.id) throw new HkError(400, 'pick two different brands');
    if (a.archived_at || b.archived_at) throw new HkError(409, 'one of those brands is already archived');
    if (verdict === 'not_duplicate') {
      const { error } = await supabase.from('hk_duplicate_decisions').insert({ business_id: businessId, brand_a: a.id, brand_b: b.id, verdict: 'not_duplicate', decided_by: me(req) });
      if (error) throw error;
      await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: a.id, action: 'review.not_duplicate', detail: { other: b.id, names: [a.name, b.name] } });
      return res.json({ ok: true, verdict });
    }
    const winner = body.winner === b.id ? b : body.winner === a.id ? a : null; if (!winner) throw new HkError(400, 'winner must be brand_a or brand_b');
    const loser = winner === a ? b : a;
    const moved = {};
    if ((await supabase.from('hk_contacts').select('id').eq('brand_id', winner.id).eq('is_primary', true)).data?.length) await supabase.from('hk_contacts').update({ is_primary: false }).eq('brand_id', loser.id).eq('is_primary', true);
    for (const t of ['hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods']) { const { data, error } = await supabase.from(t).update({ brand_id: winner.id }).eq('brand_id', loser.id).select('id'); if (error) throw new Error(error.message); moved[t] = data?.length || 0; }
    const aliases = [...new Set([...(winner.aliases || []), loser.name, ...(loser.aliases || [])])];
    const { data: w, error: e1 } = await supabase.from('hk_brands').update({ aliases, updated_at: now().toISOString() }).eq('id', winner.id).select().single(); if (e1) throw e1;
    const { error: e2 } = await supabase.from('hk_brands').update({ archived_at: now().toISOString(), updated_at: now().toISOString() }).eq('id', loser.id); if (e2) throw e2;
    const { error: e3 } = await supabase.from('hk_duplicate_decisions').insert({ business_id: businessId, brand_a: a.id, brand_b: b.id, verdict: 'merged', decided_by: me(req) }); if (e3) throw e3;
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: winner.id, action: 'brand.merged', detail: { loser: loser.id, loser_name: loser.name, moved } });
    res.json({ ok: true, verdict, winner: brandSummary(w), archived: loser.id, moved });
  } catch (e) { fail(res, e, 'review/decide'); }
}
// Review > Data warnings, pure (the daily check counts them for the digest).
export function dataWarnings(brands, now = new Date()) {
  const t = now.getTime(), warnings = [];
  for (const b of brands) {
    if (b.last_touch_at && new Date(b.last_touch_at).getTime() > t) warnings.push({ brand_id: b.id, name: b.name, kind: 'future_last_touch', detail: b.last_touch_at });
    if (b.next_due_at && new Date(b.next_due_at).getTime() > t + 365 * 86400e3) warnings.push({ brand_id: b.id, name: b.name, kind: 'far_next_due', detail: b.next_due_at });
    if (!b.domain && b.status !== 'candidate') warnings.push({ brand_id: b.id, name: b.name, kind: 'missing_domain', detail: b.status });
    if (b.owner_user_id && b.owner_unclear) warnings.push({ brand_id: b.id, name: b.name, kind: 'owner_conflict', detail: b.owner_user_id });
  }
  return warnings;
}
// GET /review/warnings
export async function warningsRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  try { res.json({ warnings: dataWarnings(await liveBrands(supabase, req.params.businessId), now()) }); } catch (e) { fail(res, e, 'review/warnings'); }
}
// GET /activity?actor=&action=&brand=&from=&to=
export async function activityRoute(req, res, { supabase = getSupabase() } = {}) {
  const businessId = req.params.businessId, q = req.query || {};
  try {
    let rows = await selectAllPages(() => supabase.from('hk_events').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).order('id'));
    if (q.actor) rows = rows.filter(e => (['claude', 'system'].includes(q.actor) ? e.actor_kind === q.actor : e.actor_user_id === q.actor));
    if (q.action) rows = rows.filter(e => e.action.startsWith(String(q.action)));
    if (q.brand) rows = rows.filter(e => e.entity_id === q.brand);
    if (q.from) rows = rows.filter(e => e.created_at >= String(q.from));
    if (q.to) rows = rows.filter(e => e.created_at <= String(q.to));
    rows = rows.slice(0, 500);
    const names = Object.fromEntries((await allBrands(supabase, businessId)).map(b => [b.id, b.name]));
    res.json({ events: rows.map(e => ({ ...e, brand_name: e.entity_type === 'brand' ? names[e.entity_id] || null : null })) });
  } catch (e) { fail(res, e, 'activity'); }
}

async function settingsRow(supabase, businessId) { const { data, error } = await supabase.from('hk_settings').select('*').eq('business_id', businessId).maybeSingle(); if (error) throw new Error(error.message); return data; }
export async function getSettingsRoute(req, res, { supabase = getSupabase() } = {}) {
  try { const row = await settingsRow(supabase, req.params.businessId); res.json({ settings: { ...SETTINGS_DEFAULTS, business_id: req.params.businessId, ...(row || {}) }, seeded: !!row, locked_rules: LOCKED_RULES }); } catch (e) { fail(res, e, 'settings/get'); }
}
// grow-inbox-intel B3a / M2 - { target_categories?, sweep?: { on, n, cap_usd, time } } merged into hk_settings.intel.
// Weights are read-only in v1 (refused here).
export function intelPatch(v, current) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HkError(400, 'intel must be an object');
  if ('weights' in v) throw new HkError(400, 'weights are read-only for now');
  const out = { ...current };
  if ('target_categories' in v) {
    if (!Array.isArray(v.target_categories) || v.target_categories.length > 20) throw new HkError(400, 'target categories must be a list of up to 20');
    out.target_categories = [...new Set(v.target_categories.map(c => text(c, 60, 'target category')).filter(Boolean))];
  }
  if ('sweep' in v) {
    const s = v.sweep || {}, next = { ...(current.sweep || {}) };
    if ('on' in s) next.on = bool(s.on, 'auto-research on') ?? true;
    if ('n' in s) { if (!Number.isInteger(s.n) || s.n < 0 || s.n > 25) throw new HkError(400, 'research per day must be a whole number from 0 to 25'); next.n = s.n; }
    if ('cap_usd' in s) { if (typeof s.cap_usd !== 'number' || !(s.cap_usd >= 0 && s.cap_usd <= 5)) throw new HkError(400, 'the daily dollar cap must be between 0 and 5'); next.cap_usd = Math.round(s.cap_usd * 100) / 100; }
    if ('time' in s) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.time))) throw new HkError(400, 'time must look like 06:30'); next.time = s.time; }
    out.sweep = next;
  }
  if (hasPii(JSON.stringify(out))) throw new HkError(400, "intel can't hold an email address or phone number");
  return out;
}

// PATCH /settings (owner role); max_email_touches is read-only
export async function patchSettingsRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, body = req.body || {};
  try {
    if (!isOwner(req)) throw new HkError(403, 'only an owner-role member can change settings');
    if ('max_email_touches' in body) throw new HkError(400, 'max_email_touches is read-only');
    const patch = {};
    for (const [k, [lo, hi]] of Object.entries(INT_SETTINGS)) if (k in body) { const v = body[k]; if (v === null) { patch[k] = null; continue; } if (!Number.isInteger(v) || v < lo || v > hi) throw new HkError(400, `${k} must be a whole number between ${lo} and ${hi}`); patch[k] = v; }
    for (const [k, max] of Object.entries(TEXT_SETTINGS)) if (k in body) patch[k] = text(body[k], max, k);
    if ('quiet_weekends' in body) patch.quiet_weekends = bool(body.quiet_weekends, 'quiet_weekends') ?? true;
    if ('banned_phrases' in body) { if (!Array.isArray(body.banned_phrases)) throw new HkError(400, 'banned_phrases must be a list'); patch.banned_phrases = [...new Set(body.banned_phrases.map(p => text(p, 60, 'banned phrase')).filter(Boolean).map(p => p.toLowerCase()))]; }
    for (const k of ['modules', 'theme']) if (k in body) { if (!body[k] || typeof body[k] !== 'object' || Array.isArray(body[k])) throw new HkError(400, `${k} must be an object`); if (hasPii(JSON.stringify(body[k]))) throw new HkError(400, `${k} can't hold an email address or phone number`); patch[k] = body[k]; }
    if ('intel' in body) patch.intel = intelPatch(body.intel, (await settingsRow(supabase, businessId))?.intel || {});
    if (!Object.keys(patch).length) throw new HkError(400, 'nothing to change');
    const { data, error } = await supabase.from('hk_settings').upsert({ business_id: businessId, ...patch, updated_at: now().toISOString() }, { onConflict: 'business_id' }).select().single();
    if (error) throw error;
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'settings', entityId: null, action: 'settings.updated', detail: { changed: Object.keys(patch) } });
    res.json({ settings: { ...SETTINGS_DEFAULTS, ...data } });
  } catch (e) { fail(res, e, 'settings/patch'); }
}
// POST /settings/confirm-stats { members_stat?, completions_stat? } (member)
export async function confirmStatsRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, body = req.body || {};
  try {
    const patch = { stats_confirmed_at: now().toISOString(), updated_at: now().toISOString() };
    for (const k of ['members_stat', 'completions_stat']) if (k in body) { if (!Number.isInteger(body[k]) || body[k] < 0) throw new HkError(400, `${k} must be a whole number`); patch[k] = body[k]; }
    const { data, error } = await supabase.from('hk_settings').upsert({ business_id: businessId, ...patch }, { onConflict: 'business_id' }).select().single();
    if (error) throw error;
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'settings', entityId: null, action: 'settings.stats_confirmed', detail: { members_stat: data.members_stat, completions_stat: data.completions_stat } });
    res.json({ settings: { ...SETTINGS_DEFAULTS, ...data } });
  } catch (e) { fail(res, e, 'settings/confirm'); }
}
// GET / PATCH /me/prefs { avatar_slot 1..4 | null, owner_filter 'me' | 'all' | <user id> }
// grow-nav-filters-v1 S3 - saved views (N7) and rail state (N2). A saved view = { id, name, space, view?, filters,
// sort?, layout? }; filters only hold known keys and values (the same parser as GET /brands). Deleting one is a
// preference change, never a record change.
export const SAVED_VIEWS_MAX = 30, VIEW_NAME_MAX = 40; // REVISABLE
const INBOX_FILTERS = { lane: ['briefing', 'needs_you', 'brands', 'other', 'sent', 'drafts'], replies: ['open', ...LABELS, 'snoozed', 'handled'], drafts: ['all', 'email', 'ig_dm', 'lint_failed', 'older'] };
const SPACES = new Set(['brands', 'inbox', 'today']);
const plainObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
function savedViewOf(v) {
  if (!plainObject(v)) throw new HkError(400, 'each saved view must be an object');
  const extra = Object.keys(v).filter(k => !['id', 'name', 'space', 'view', 'filters', 'sort', 'layout'].includes(k));
  if (extra.length) throw new HkError(400, `unknown saved view field ${extra[0]}`);
  if (typeof v.id !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(v.id)) throw new HkError(400, 'saved view id must be 1 to 40 letters, digits or dashes');
  const name = text(v.name, VIEW_NAME_MAX, 'saved view name', { required: true });
  const space = oneOf(v.space ?? '', SPACES, 'space');
  if (v.filters != null && !plainObject(v.filters)) throw new HkError(400, 'filters must be an object');
  const out = { id: v.id, name, space, filters: {} };
  if (space === 'brands') {
    if (v.view != null) out.view = oneOf(v.view, new Set(BRAND_VIEWS), 'view');
    const unknown = Object.keys(v.filters || {}).filter(k => !BUCKETS.includes(k));
    if (unknown.length) throw new HkError(400, `unknown filter ${unknown[0]}`);
    out.filters = parseFilters(v.filters || {});
    if (v.sort != null) {
      if (!plainObject(v.sort)) throw new HkError(400, 'sort must be { by, dir }');
      out.sort = { by: oneOf(v.sort.by, new Set(SORTS), 'sort'), dir: oneOf(v.sort.dir || 'asc', new Set(['asc', 'desc']), 'dir') };
    }
    if (v.layout != null) out.layout = oneOf(v.layout, new Set(['table', 'stage']), 'layout');
  } else {
    if (space === 'today' && Object.keys(v.filters || {}).length) throw new HkError(400, 'Today has no filters');
    for (const [k, vals] of Object.entries(v.filters || {})) {
      if (!INBOX_FILTERS[k]) throw new HkError(400, `unknown filter ${k}`);
      const list = Array.isArray(vals) ? vals : [vals];
      if (!list.length || list.some(x => !INBOX_FILTERS[k].includes(x))) throw new HkError(400, `unknown ${k} value`);
      out.filters[k] = [...new Set(list)];
    }
    if (v.view != null || v.sort != null || v.layout != null) throw new HkError(400, 'view, sort and layout are Brands-only');
  }
  return out;
}
export function savedViewsOf(list) {
  if (!Array.isArray(list)) throw new HkError(400, 'saved_views must be a list');
  if (list.length > SAVED_VIEWS_MAX) throw new HkError(400, `at most ${SAVED_VIEWS_MAX} saved views`);
  const out = list.map(savedViewOf);
  if (new Set(out.map(v => v.id)).size !== out.length) throw new HkError(400, 'saved view ids must be unique');
  return out;
}
// rail: { narrow?: bool, collapsed?: { <space>: [bucket keys] } }
export function railOf(v) {
  if (!plainObject(v)) throw new HkError(400, 'rail must be an object');
  const extra = Object.keys(v).filter(k => k !== 'narrow' && k !== 'collapsed');
  if (extra.length) throw new HkError(400, `unknown rail field ${extra[0]}`);
  const out = {};
  if (v.narrow != null) out.narrow = bool(v.narrow, 'narrow');
  if (v.collapsed != null) {
    if (!plainObject(v.collapsed)) throw new HkError(400, 'collapsed must be an object');
    out.collapsed = {};
    for (const [space, keys] of Object.entries(v.collapsed)) {
      if (!SPACES.has(space)) throw new HkError(400, 'unknown space');
      const known = new Set(space === 'brands' ? ['views', ...BUCKETS] : ['my_mail', 'tracked_replies', 'queued_drafts']);
      if (!Array.isArray(keys) || keys.some(k => !known.has(k))) throw new HkError(400, 'unknown rail bucket');
      out.collapsed[space] = [...new Set(keys)];
    }
  }
  return out;
}

export async function getPrefsRoute(req, res, { supabase = getSupabase() } = {}) {
  try { const { data, error } = await supabase.from('hk_member_prefs').select('*').eq('business_id', req.params.businessId).eq('user_id', me(req)).maybeSingle(); if (error) throw new Error(error.message); res.json({ prefs: data || { business_id: req.params.businessId, user_id: me(req), avatar_slot: null, owner_filter: 'me', saved_views: [], rail: {} } }); } catch (e) { fail(res, e, 'prefs/get'); }
}
export async function patchPrefsRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const body = req.body || {};
  try {
    const patch = {};
    if ('avatar_slot' in body) { if (body.avatar_slot !== null && ![1, 2, 3, 4].includes(body.avatar_slot)) throw new HkError(400, 'avatar_slot must be 1 to 4'); patch.avatar_slot = body.avatar_slot; }
    if ('owner_filter' in body) { const v = body.owner_filter; if (!(v === 'me' || v === 'all' || /^[0-9a-f-]{36}$/.test(String(v)))) throw new HkError(400, "owner_filter must be 'me', 'all' or a member id"); patch.owner_filter = v; }
    if ('saved_views' in body) patch.saved_views = savedViewsOf(body.saved_views);
    if ('rail' in body) patch.rail = railOf(body.rail);
    if (!Object.keys(patch).length) throw new HkError(400, 'nothing to change');
    const { data, error } = await supabase.from('hk_member_prefs').upsert({ business_id: req.params.businessId, user_id: me(req), ...patch, updated_at: now().toISOString() }, { onConflict: 'business_id,user_id' }).select().single();
    if (error) { if (error.code === '23505') throw new HkError(409, 'that color slot is taken'); throw error; }
    res.json({ prefs: data });
  } catch (e) { fail(res, e, 'prefs/patch'); }
}
