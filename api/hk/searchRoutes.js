// grow-nav-filters-v1 S2 - GET /search?q= : the one search's records (N6). Brands by name / domain / alias (as /brands q),
// people by contact name (an address can match, but only here on the server), tracked replies by brand name or label.
// Top SEARCH_TOP of each. The response never holds an address or phone: contacts are returned as name + brand, and any
// item whose fields would carry one (a typed address in a name) is dropped. Viewers may search (GET).
import { getSupabase, HkError, fail, text, liveBrands, selectAllPages, normName, detailHasPii } from './hkShared.js';

export const SEARCH_TOP = 5; // REVISABLE (spec N6)
const LABEL_WORDS = { interested: 'interest interested', pricing: 'pricing price', referral: 'referral', decline: 'declined decline', auto_reply: 'auto reply', prefers_email: 'prefers email', new_thread: 'new thread', other: 'other' };

export async function searchRoute(req, res, { supabase = getSupabase() } = {}) {
  const businessId = req.params.businessId;
  try {
    const q = text(req.query?.q, 80, 'q') || '';
    if (q.length < 2) throw new HkError(400, 'type at least 2 characters');
    const n = normName(q), raw = q.toLowerCase();
    const brands = await liveBrands(supabase, businessId), byId = Object.fromEntries(brands.map(b => [b.id, b]));
    const nameHit = b => normName(b.name).includes(n) || (b.aliases || []).some(a => normName(a).includes(n));
    const starts = name => (normName(name).startsWith(n) ? 0 : 1);
    const clean = items => items.filter(x => !detailHasPii(x)).slice(0, SEARCH_TOP);

    const brandHits = brands.filter(b => nameHit(b) || (b.domain || '').includes(raw)).sort((a, b) => starts(a.name) - starts(b.name) || a.name.localeCompare(b.name));
    const contacts = await selectAllPages(() => supabase.from('hk_contacts').select('id, brand_id, name, email').eq('business_id', businessId).order('id'));
    const people = contacts.filter(c => byId[c.brand_id] && ((c.name && normName(c.name).includes(n)) || (raw.length >= 3 && (c.email || '').toLowerCase().includes(raw))))
      .map(c => ({ contact_id: c.id, name: c.name || 'Unnamed contact', brand_id: c.brand_id, brand_name: byId[c.brand_id].name }))
      .sort((a, b) => starts(a.name) - starts(b.name) || a.name.localeCompare(b.name));
    const replies = await selectAllPages(() => supabase.from('hk_replies').select('id, brand_id, label, received_at, handled').eq('business_id', businessId).order('id'));
    const replyHits = replies.filter(r => byId[r.brand_id] && (nameHit(byId[r.brand_id]) || (LABEL_WORDS[r.label] || '').includes(raw)))
      .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))
      .map(r => ({ id: r.id, brand_id: r.brand_id, brand_name: byId[r.brand_id].name, label: r.label || 'other', received_at: r.received_at, handled: !!r.handled }));

    res.json({ q, brands: clean(brandHits.map(b => ({ id: b.id, name: b.name, domain: b.domain || null, status: b.status }))), people: clean(people), replies: clean(replyHits) });
  } catch (e) { fail(res, e, 'search'); }
}
