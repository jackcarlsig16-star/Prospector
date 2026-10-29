// hkos-data-foundation-v1 Stage 2 - what every /api/hk route shares: the service client, role helpers, the one
// hasPii guard for free text, the event log, and the serializers that decide what reaches the browser. The ONLY
// addresses that ever leave the server are hk_contacts.email (brand detail + contacts routes, HumanKind members) -
// hk_replies.from_email is stripped here and nowhere else may add it back.
import { getServiceSupabase } from '../lib/authUser.js';
import { roleAtLeast } from '../../src/constants/roles.js';
import { hasPii } from '../sales/scrubText.js';
import { normName, nameMatches } from '../sales/intakeMatch.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { canContact } from './rules.js';
import { decodeEntities } from './gmailMime.js';

export { normName, nameMatches, normalizeDomain, selectAllPages, canContact, hasPii };
// Test seam (prodWiring.test.mjs): the client a route resolves when it is called with (req, res) only, as server.js calls it.
export const seams = { supabase: getServiceSupabase };
export const getSupabase = () => seams.supabase();
export const SPONSOR_RELATIONSHIPS = new Set(['sponsor', 'founding_partner']);
export const MANUAL_STATUSES = new Set(['meeting', 'signed', 'passed', 'skipped']);
export const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i;
export const TEAM_DOMAINS = ['humankindcollective.app'];

export class HkError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
export const fail = (res, e, tag) => {
  if (e instanceof HkError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
  if (e?.code === '23505') return res.status(409).json({ error: 'that row already exists' });
  console.error(`[hk/${tag}]`, e.message);
  return res.status(500).json({ error: e.message });
};
export const isOwner = req => req.auth.isPlatformOwner || roleAtLeast(req.auth.roles.get(req.params.businessId), 'owner');
export const me = req => req.auth.user.id;

// Free text: trimmed, capped, never an address or a phone. multiline keeps line breaks (notes, ideas).
export function text(v, max, label, { required = false, multiline = false } = {}) {
  if (v == null || v === '') { if (required) throw new HkError(400, `${label} is required`); return null; }
  if (typeof v !== 'string') throw new HkError(400, `${label} must be text`);
  const s = (multiline ? v.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : v.replace(/\s+/g, ' ')).trim();
  if (!s) { if (required) throw new HkError(400, `${label} is required`); return null; }
  if (s.length > max) throw new HkError(400, `${label} is too long (max ${max} characters)`);
  if (hasPii(s)) throw new HkError(400, `${label} can't hold an email address or phone number`);
  return s;
}
export const bool = (v, label) => { if (v == null) return null; if (typeof v !== 'boolean') throw new HkError(400, `${label} must be true or false`); return v; };
export const oneOf = (v, set, label) => { if (v == null) return null; if (!set.has(v)) throw new HkError(400, `${label} must be one of ${[...set].join(', ')}`); return v; };
export const domainOf = v => { if (v == null || v === '') return null; const d = normalizeDomain(String(v)); if (!d) throw new HkError(400, 'domain must look like brand.com'); return d; };
export const emailOf = v => { if (v == null || v === '') return null; const s = String(v).trim().toLowerCase(); if (s.length > 254 || !EMAIL_RE.test(s)) throw new HkError(400, 'email must look like name@brand.com'); return s; };

// Ids and timestamps are digit-heavy and can look like a phone to hasPii; they are stripped before the guard runs.
const UUID_OR_TIME = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}T[\d:.]+Z?/gi;
export const detailHasPii = detail => hasPii(JSON.stringify(detail).replace(UUID_OR_TIME, ''));
export async function logEvent(supabase, { businessId, actorUserId = null, actorKind = 'user', entityType, entityId = null, action, detail = {} }) {
  if (detailHasPii(detail)) throw new HkError(400, 'an event detail would hold an email address or phone number');
  const { error } = await supabase.from('hk_events').insert({ business_id: businessId, actor_user_id: actorUserId, actor_kind: actorKind, entity_type: entityType, entity_id: entityId, action, detail });
  if (error) throw new Error(error.message);
}

const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
const LIST_FIELDS = ['id', 'name', 'domain', 'aliases', 'segment', 'category', 'niche', 'size_band', 'is_local', 'city', 'neighborhood', 'status', 'relationship', 'owner_user_id', 'owner_unclear', 'source', 'last_touch_at', 'next_due_at', 'created_at', 'updated_at', 'archived_at'];
export const brandRow = (b, extra = {}) => ({ ...pick(b, LIST_FIELDS), ...extra });
export const brandDetail = b => ({ ...b });
export const contactRow = c => pick(c, ['id', 'brand_id', 'name', 'title', 'email', 'email_source', 'apollo_person_id', 'is_primary', 'role_checked_at', 'left_company', 'created_by', 'created_at']);
export const touchRow = t => pick(t, ['id', 'brand_id', 'contact_id', 'sender_user_id', 'channel', 'kind', 'subject', 'challenge_concept', 'state', 'drafted_at', 'sent_at', 'lint_passed', 'created_by', 'gmail_thread_id', 'created_at']);
// hkos-inbox-v2-polish P3: summaries stored before the Stage 2 decode still carry entities ("What&#39;s"); decoded on read.
const decodedSummary = row => (row.summary ? { ...row, summary: decodeEntities(row.summary) } : row);
export const replyRow = r => decodedSummary(pick(r, ['id', 'brand_id', 'touch_id', 'gmail_message_id', 'gmail_thread_id', 'from_name', 'from_domain', 'received_at', 'label', 'label_overridden_by', 'summary', 'urgent', 'handled', 'handled_by', 'handled_at', 'snoozed_until', 'created_at']));
export const brandSummary = b => pick(b, ['id', 'name', 'domain', 'status', 'relationship', 'owner_user_id', 'niche', 'is_local', 'source', 'created_at']);

// hkos-brands-list-500 F2 - an id list never goes into ONE PostgREST in() filter: a long URL is answered 400 (952 brand
// ids took Grow › Brands down). selectIn runs buildQuery().in(column, part) per chunk of IN_CHUNK ids, pages each chunk
// (buildQuery must end its ORDER BY on a unique column - see selectAllPages) and throws on any error, never an empty
// list. The chunks come back concatenated: a caller that needs one order sorts after.
export const IN_CHUNK = 100; // REVISABLE (spec)
export const chunks = (arr, n = IN_CHUNK) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
export async function selectIn(buildQuery, column, ids, { size = IN_CHUNK } = {}) {
  const out = [];
  for (const part of chunks([...new Set(ids)], size)) out.push(...await selectAllPages(() => buildQuery().in(column, part)));
  return out;
}

export const liveBrands = (supabase, businessId) => selectAllPages(() => supabase.from('hk_brands').select('*').eq('business_id', businessId).is('archived_at', null).order('created_at').order('id'));
export const allBrands = (supabase, businessId) => selectAllPages(() => supabase.from('hk_brands').select('*').eq('business_id', businessId).order('created_at').order('id'));
export async function brandById(supabase, businessId, id) {
  const { data, error } = await supabase.from('hk_brands').select('*').eq('business_id', businessId).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HkError(404, 'brand not found');
  return data;
}
export const sponsorsNichesOf = brands => brands.filter(b => SPONSOR_RELATIONSHIPS.has(b.relationship)).map(b => ({ name: b.name, niche: b.niche }));

// The legacy HumanKind rows are an IMPORT SOURCE (read-only here): a name match there is flagged 'legacy'.
export async function legacyNames(supabase, businessId) {
  const out = [];
  const { data: accounts } = await supabase.from('accounts').select('id, data, account_kind').eq('business_id', businessId);
  for (const a of accounts || []) { const name = a.data?.name; if (name) out.push({ id: a.id, name, kind: a.account_kind || 'account', table: 'accounts' }); }
  const { data: projects } = await supabase.from('projects').select('id').eq('business_id', businessId);
  const pids = (projects || []).map(p => p.id);
  const prospects = await selectIn(() => supabase.from('prospects').select('id, name').order('id'), 'project_id', pids);
  for (const p of prospects) if (p.name) out.push({ id: p.id, name: p.name, kind: 'prospect', table: 'prospects' });
  return out;
}

// One verdict per { name, domain, niche? }: clear | warm | sponsor | do_not_contact | owned_by | possible_duplicate | niche_warning.
export function verdictFor(item, { brands, legacy, senderUserId, sponsorsNiches, threadsByBrand = {}, threadsByDomain = {} }) {
  const name = String(item.name || '').trim();
  const domain = item.domain ? normalizeDomain(String(item.domain)) : null;
  const n = normName(name);
  const exact = brands.find(b => (domain && b.domain === domain) || (n && normName(b.name) === n) || (n && (b.aliases || []).some(a => normName(a) === n))) || null;
  const partial = exact ? [] : nameMatches(name, brands, 'name', true);
  const legacyHits = exact ? [] : [...nameMatches(name, legacy, 'name', false), ...nameMatches(name, legacy, 'name', true)].filter((h, i, arr) => arr.indexOf(h) === i);
  const base = { name, domain, match: exact ? brandSummary(exact) : null, matches: partial.map(brandSummary), legacy: legacyHits.map(h => ({ id: h.id, name: h.name, kind: h.kind, table: h.table })), warnings: [] };
  if (exact) {
    const v = canContact({ brand: exact, senderUserId, kind: 'cold', sponsorsNiches, threadsByFounder: threadsByBrand[exact.id] || [] });
    base.warnings = v.warnings;
    if (v.reason === 'sponsor' || v.reason === 'do_not_contact' || v.reason === 'owned_by') return { ...base, verdict: v.reason, owner_user_id: v.owner_user_id || null };
    if (v.reason === 'warm') return { ...base, verdict: 'warm', founder_user_id: v.founder_user_id, last_at: v.last_at, exact: true };
    return { ...base, verdict: 'possible_duplicate', exact: true };
  }
  if (partial.length || legacyHits.length) return { ...base, verdict: 'possible_duplicate', exact: false };
  const v = canContact({ brand: { status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, niche: item.niche || null }, senderUserId, kind: 'cold', sponsorsNiches, threadsByFounder: (domain && threadsByDomain[domain]) || [] });
  base.warnings = v.warnings;
  if (v.reason === 'warm') return { ...base, verdict: 'warm', founder_user_id: v.founder_user_id, last_at: v.last_at };
  return { ...base, verdict: v.warnings.some(w => w.code === 'niche_overlap') ? 'niche_warning' : 'clear' };
}
