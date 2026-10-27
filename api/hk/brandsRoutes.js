// hkos-data-foundation-v1 D4 - brands + contacts routes (mounted under /api/hk/:businessId behind hkGate; viewer = GET,
// member = writes, owner-role = relationship upgrades + releasing another's claim). List rows never carry an address;
// the brand detail and the contacts routes do (hk_contacts.email - the scoped HumanKind exception, D5).
import { getSupabase, HkError, fail, isOwner, me, text, bool, oneOf, domainOf, emailOf, logEvent, brandRow, brandDetail, contactRow, touchRow, replyRow, liveBrands, brandById, legacyNames, verdictFor, sponsorsNichesOf, canContact, normName, SPONSOR_RELATIONSHIPS, MANUAL_STATUSES } from './hkShared.js';

const SEGMENTS = new Set(['sponsor_brand', 'creator', 'nonprofit', 'press', 'podcast', 'university']);
const SOURCES = new Set(['sourced', 'user_supplied', 'apollo_list', 'places', 'import']);
const EMAIL_SOURCES = new Set(['apollo_verified', 'site_published', 'user_supplied', 'import']);
const VIEWS = new Set(['my_open', 'unclaimed', 'overdue', 'local', 'all']);
const CLOSED = new Set(['passed', 'skipped', 'sponsor']);
const SHORT = { name: [160, 'name'], category: [80, 'category'], niche: [80, 'niche'], size_band: [40, 'size band'], city: [80, 'city'], neighborhood: [80, 'neighborhood'] };
const LONG = { notes: [4000, 'notes'], challenge_idea: [1000, 'challenge idea'], origin_hook: [1000, 'origin hook'], reward_idea: [1000, 'reward idea'] };

const ctx = async (supabase, businessId, senderUserId) => { const brands = await liveBrands(supabase, businessId); return { brands, legacy: await legacyNames(supabase, businessId), senderUserId, sponsorsNiches: sponsorsNichesOf(brands) }; };
const aliasesOf = v => { if (v == null) return null; if (!Array.isArray(v)) throw new HkError(400, 'aliases must be a list'); return [...new Set(v.map(a => text(a, 160, 'alias')).filter(Boolean))]; };
async function primaryNames(supabase, businessId, ids) {
  if (!ids.length) return {};
  const { data, error } = await supabase.from('hk_contacts').select('brand_id, name, is_primary').eq('business_id', businessId).in('brand_id', ids);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).filter(c => c.is_primary).map(c => [c.brand_id, c.name]));
}

// GET /brands?view=&q=&owner=&status=&segment=
export async function listBrandsRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, q = req.query || {};
  try {
    const view = oneOf(q.view || null, VIEWS, 'view') || 'all';
    let rows = await liveBrands(supabase, businessId);
    const owner = q.owner === 'me' ? me(req) : q.owner && q.owner !== 'all' ? String(q.owner) : null;
    if (owner) rows = rows.filter(b => b.owner_user_id === owner);
    if (q.status) rows = rows.filter(b => b.status === q.status);
    if (q.segment) rows = rows.filter(b => b.segment === q.segment);
    if (view === 'my_open') rows = rows.filter(b => b.owner_user_id === me(req) && !CLOSED.has(b.status));
    if (view === 'unclaimed') rows = rows.filter(b => !b.owner_user_id && b.status === 'candidate' && b.relationship === 'prospect');
    if (view === 'overdue') rows = rows.filter(b => b.next_due_at && new Date(b.next_due_at) < now() && !CLOSED.has(b.status));
    if (view === 'local') rows = rows.filter(b => b.is_local);
    if (q.q) { const n = normName(q.q), raw = String(q.q).trim().toLowerCase(); rows = rows.filter(b => normName(b.name).includes(n) || (b.domain || '').includes(raw) || (b.aliases || []).some(a => normName(a).includes(n))); }
    const primary = await primaryNames(supabase, businessId, rows.map(b => b.id));
    res.json({ view, brands: rows.map(b => brandRow(b, { primary_contact_name: primary[b.id] || null })) });
  } catch (e) { fail(res, e, 'brands/list'); }
}

// POST /brands/check  [{ name, domain, niche? }]
export async function checkBrandsRoute(req, res, { supabase = getSupabase() } = {}) {
  try {
    const items = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || !items.length || items.length > 50) throw new HkError(400, 'send 1 to 50 items as [{ name, domain }]');
    const c = await ctx(supabase, req.params.businessId, me(req));
    res.json({ results: items.map(it => verdictFor({ name: text(it.name, 160, 'name', { required: true }), domain: it.domain ? domainOf(it.domain) : null, niche: text(it.niche, 80, 'niche') }, c)) });
  } catch (e) { fail(res, e, 'brands/check'); }
}

function brandFields(body, { partial = false } = {}) {
  const patch = {};
  for (const [k, [max, label]] of Object.entries(SHORT)) if (k in body) patch[k] = text(body[k], max, label, { required: k === 'name' });
  for (const [k, [max, label]] of Object.entries(LONG)) if (k in body) patch[k] = text(body[k], max, label, { multiline: true });
  if ('domain' in body) patch.domain = domainOf(body.domain);
  if ('is_local' in body) patch.is_local = bool(body.is_local, 'is_local') ?? false;
  if ('aliases' in body) patch.aliases = aliasesOf(body.aliases) || [];
  if (!partial) { patch.segment = oneOf(body.segment, SEGMENTS, 'segment') || 'sponsor_brand'; patch.source = oneOf(body.source, SOURCES, 'source') || 'user_supplied'; if (!patch.name) throw new HkError(400, 'name is required'); }
  if (patch.name) patch.normalized_name = normName(patch.name);
  return patch;
}

// POST /brands  { ...fields, claim?, force_duplicate? }
export async function createBrandRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, body = req.body || {};
  try {
    const fields = brandFields(body);
    const verdict = verdictFor({ name: fields.name, domain: fields.domain, niche: fields.niche }, await ctx(supabase, businessId, me(req)));
    if (verdict.verdict === 'sponsor' || verdict.verdict === 'do_not_contact') throw new HkError(409, `${fields.name} is already a ${verdict.verdict === 'sponsor' ? 'sponsor or founding partner' : 'do-not-contact brand'}`, { verdict });
    if ((verdict.verdict === 'possible_duplicate' || verdict.verdict === 'owned_by') && body.force_duplicate !== true) throw new HkError(409, verdict.verdict === 'owned_by' ? 'that brand exists and is owned by another founder' : 'a brand like that already exists', { verdict });
    const claim = bool(body.claim, 'claim') === true;
    const row = { ...fields, business_id: businessId, created_by: me(req), owner_user_id: claim ? me(req) : null, status: claim ? 'claimed' : 'candidate', updated_at: now().toISOString() };
    const { data, error } = await supabase.from('hk_brands').insert(row).select().single();
    if (error) throw error;
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: data.id, action: 'brand.created', detail: { name: data.name, domain: data.domain, verdict: verdict.verdict, forced: body.force_duplicate === true } });
    if (claim) await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: data.id, action: 'brand.claimed', detail: { name: data.name } });
    res.status(201).json({ brand: brandDetail(data), verdict });
  } catch (e) { fail(res, e, 'brands/create'); }
}

// GET /brands/:id - brand + contacts (with email) + timeline + the caller's verdict
export async function getBrandRoute(req, res, { supabase = getSupabase() } = {}) {
  const businessId = req.params.businessId;
  try {
    const brand = await brandById(supabase, businessId, req.params.id);
    const by = async (t, order = 'created_at') => { const { data, error } = await supabase.from(t).select('*').eq('business_id', businessId).eq('brand_id', brand.id).order(order, { ascending: false }); if (error) throw new Error(error.message); return data || []; };
    const [contacts, touches, replies, periods, events] = await Promise.all([by('hk_contacts'), by('hk_touches'), by('hk_replies', 'received_at'), by('hk_sponsor_periods'), (async () => { const { data, error } = await supabase.from('hk_events').select('*').eq('business_id', businessId).eq('entity_id', brand.id).order('created_at', { ascending: false }).limit(200); if (error) throw new Error(error.message); return data || []; })()]);
    const sponsorsNiches = sponsorsNichesOf(await liveBrands(supabase, businessId));
    const max_email_touches = await maxTouches(supabase, businessId);
    const verdict = canContact({ brand, touches, threadsByFounder: [], senderUserId: me(req), kind: 'cold', sponsorsNiches, maxEmailTouches: max_email_touches });
    res.json({ brand: brandDetail(brand), contacts: contacts.map(contactRow), touches: touches.map(touchRow), replies: replies.map(replyRow), sponsor_periods: periods, events, verdict, email_touches_sent: touches.filter(t => t.channel === 'email' && t.state === 'sent').length, max_email_touches });
  } catch (e) { fail(res, e, 'brands/get'); }
}
async function maxTouches(supabase, businessId) { const { data } = await supabase.from('hk_settings').select('max_email_touches').eq('business_id', businessId).maybeSingle(); return data?.max_email_touches || 3; }

// PATCH /brands/:id  fields | status (manual) | claim true/false | relationship (+ dnc_reason)
export async function patchBrandRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, body = req.body || {}, uid = me(req);
  try {
    const brand = await brandById(supabase, businessId, req.params.id);
    if (brand.archived_at) throw new HkError(409, 'that brand is archived');
    const patch = brandFields(body, { partial: true });
    let action = 'brand.updated';
    if ('status' in body) { patch.status = oneOf(body.status, MANUAL_STATUSES, 'status'); action = 'brand.status'; }
    if ('claim' in body) {
      if (bool(body.claim, 'claim')) { if (brand.owner_user_id && brand.owner_user_id !== uid && !isOwner(req)) throw new HkError(409, 'another founder owns this brand'); patch.owner_user_id = uid; patch.owner_unclear = false; if (brand.status === 'candidate') patch.status = 'claimed'; action = 'brand.claimed'; }
      else { if (brand.owner_user_id && brand.owner_user_id !== uid && !isOwner(req)) throw new HkError(403, "only the owner of the claim or an owner-role member can release it"); patch.owner_user_id = null; if (brand.status === 'claimed') patch.status = 'candidate'; action = 'brand.released'; }
    }
    if ('relationship' in body) {
      const rel = oneOf(body.relationship, new Set(['prospect', 'sponsor', 'founding_partner', 'do_not_contact']), 'relationship');
      if (rel === 'do_not_contact') { patch.dnc_reason = text(body.dnc_reason, 200, 'reason', { required: true }); }
      else { if (!isOwner(req)) throw new HkError(403, 'only an owner-role member can mark a brand as sponsor, founding partner or prospect'); patch.dnc_reason = null; }
      patch.relationship = rel; if (SPONSOR_RELATIONSHIPS.has(rel)) patch.status = 'sponsor'; action = 'brand.relationship';
    }
    const changed = Object.keys(patch).filter(k => k !== 'normalized_name' && JSON.stringify(patch[k]) !== JSON.stringify(brand[k]));
    if (!changed.length) return res.json({ brand: brandDetail(brand), changed: [] });
    const prev = Object.fromEntries(changed.map(k => [k, brand[k] ?? null]));
    const reason = text(body.reason, 200, 'reason');
    patch.updated_at = now().toISOString();
    const { data, error } = await supabase.from('hk_brands').update(patch).eq('id', brand.id).eq('business_id', businessId).select().single();
    if (error) throw error;
    await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action, detail: { changed, prev, ...(reason ? { reason } : {}) } });
    res.json({ brand: brandDetail(data), changed });
  } catch (e) { fail(res, e, 'brands/patch'); }
}

// Contacts: GET/POST /brands/:id/contacts, PATCH /brands/:id/contacts/:cid. hasPii on name / title; email validated.
function contactFields(body, { partial = false } = {}) {
  const p = partial ? {} : { title: null, email: null, email_source: null, apollo_person_id: null, is_primary: false, left_company: false };
  if ('name' in body || !partial) p.name = text(body.name, 160, 'name', { required: true });
  if ('title' in body) p.title = text(body.title, 120, 'title');
  if ('email' in body) p.email = emailOf(body.email);
  if ('email_source' in body) p.email_source = oneOf(body.email_source, EMAIL_SOURCES, 'email_source');
  if ('is_primary' in body) p.is_primary = bool(body.is_primary, 'is_primary') ?? false;
  if ('left_company' in body) p.left_company = bool(body.left_company, 'left_company') ?? false;
  if ('apollo_person_id' in body) p.apollo_person_id = text(body.apollo_person_id, 80, 'apollo id');
  if (p.email && !p.email_source && !partial) p.email_source = 'user_supplied';
  return p;
}
export async function listContactsRoute(req, res, { supabase = getSupabase() } = {}) {
  try {
    const brand = await brandById(supabase, req.params.businessId, req.params.id);
    const { data, error } = await supabase.from('hk_contacts').select('*').eq('business_id', brand.business_id).eq('brand_id', brand.id).order('created_at');
    if (error) throw new Error(error.message);
    res.json({ contacts: (data || []).map(contactRow) });
  } catch (e) { fail(res, e, 'contacts/list'); }
}
export async function createContactRoute(req, res, { supabase = getSupabase() } = {}) {
  const businessId = req.params.businessId;
  try {
    const brand = await brandById(supabase, businessId, req.params.id);
    const fields = contactFields(req.body || {});
    if (fields.is_primary) await supabase.from('hk_contacts').update({ is_primary: false }).eq('brand_id', brand.id).eq('is_primary', true);
    const { data, error } = await supabase.from('hk_contacts').insert({ ...fields, business_id: businessId, brand_id: brand.id, created_by: me(req) }).select().single();
    if (error) throw error;
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: brand.id, action: 'contact.added', detail: { contact_id: data.id, name: data.name, has_email: !!data.email, is_primary: !!data.is_primary } });
    res.status(201).json({ contact: contactRow(data) });
  } catch (e) { fail(res, e, 'contacts/create'); }
}
export async function patchContactRoute(req, res, { supabase = getSupabase() } = {}) {
  const businessId = req.params.businessId;
  try {
    const brand = await brandById(supabase, businessId, req.params.id);
    const { data: existing, error: e0 } = await supabase.from('hk_contacts').select('*').eq('business_id', businessId).eq('brand_id', brand.id).eq('id', req.params.cid).maybeSingle();
    if (e0) throw new Error(e0.message);
    if (!existing) throw new HkError(404, 'contact not found');
    const fields = contactFields(req.body || {}, { partial: true });
    if (!Object.keys(fields).length) return res.json({ contact: contactRow(existing), changed: [] });
    if (fields.is_primary) await supabase.from('hk_contacts').update({ is_primary: false }).eq('brand_id', brand.id).eq('is_primary', true);
    const { data, error } = await supabase.from('hk_contacts').update(fields).eq('id', existing.id).select().single();
    if (error) throw error;
    const changed = Object.keys(fields);
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: brand.id, action: 'contact.updated', detail: { contact_id: existing.id, changed, has_email: !!data.email } });
    res.json({ contact: contactRow(data), changed });
  } catch (e) { fail(res, e, 'contacts/patch'); }
}
