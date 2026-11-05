import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { normName } from './intakeMatch.js';
import { cleanText } from './scrubText.js';

// homelover-flow-v1 F6 - "Reached n of m people", computed live, never stored. People known = the distinct people
// linked to the company (sales_prospect_state linked + partner_contacts or sales_people, de-duplicated by Apollo
// contact id, else by name). Reached = those with any touch: an Apollo sequence delivery (sales_email_messages), a
// campaign send (sales_outreach_contacts / events), a partner touch naming them (sales_partner_events contact_names),
// or a prospect marked contacted / booked. Replies = Apollo replied, a campaign reply, or a received partner touch.
// Buyer = sales_settings.buyer_titles. Names and titles only - never an address or a phone.
const TYPES = ['partner', 'employer', 'target'];
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
export const isBuyerTitle = (title, buyerTitles = []) => { const t = String(title || '').toLowerCase(); return !!t && buyerTitles.some(b => { const x = String(b).toLowerCase(); return !!x && (t.includes(x) || x.includes(t)); }); };

// people: [{ contact_id?, name, title?, status? }] (any source, duplicates allowed); messages: sales_email_messages
// rows { contact_id, delivered_at, replied }; outreach: sales_outreach_contacts rows { name, last_sent_at, replied_at,
// status }; partnerTouches: sales_partner_events touch rows { contact_names, meta: { direction } }.
export function countReach({ people = [], messages = [], outreach = [], partnerTouches = [], buyerTitles = [] } = {}) {
  const byKey = new Map();
  const keyOf = p => (p.contact_id ? `c:${p.contact_id}` : `n:${normName(p.name || '')}`);
  for (const p of people) {
    if (!p || !(p.name || p.contact_id)) continue;
    const nameKey = p.name ? `n:${normName(p.name)}` : null;
    // The same person once by contact id and once by name only (partner_contacts vs the linked prospect) is one person.
    const existing = byKey.get(keyOf(p)) || (nameKey && [...byKey.values()].find(x => x.name_key === nameKey)) || null;
    if (existing) { existing.contact_id = existing.contact_id || p.contact_id || null; existing.title = existing.title || p.title || null; if (['contacted', 'booked'].includes(p.status)) existing.contacted = true; continue; }
    byKey.set(keyOf(p), { contact_id: p.contact_id || null, name: cleanText(p.name || '', 120) || 'Unnamed', name_key: nameKey, title: p.title ? cleanText(p.title, 160) : null, contacted: ['contacted', 'booked'].includes(p.status), reached_via: new Set(), replied: false });
  }
  const list = [...byKey.values()];
  const byContact = new Map(list.filter(p => p.contact_id).map(p => [p.contact_id, p]));
  const byName = new Map(list.filter(p => p.name_key).map(p => [p.name_key, p]));
  for (const p of list) if (p.contacted) p.reached_via.add('status');
  for (const m of messages) {
    const p = byContact.get(m.contact_id);
    if (!p) continue;
    if (m.delivered_at) p.reached_via.add('apollo');
    if (m.replied) { p.replied = true; p.reached_via.add('apollo'); }
  }
  for (const o of outreach) {
    const p = byName.get(`n:${normName(o.name || '')}`);
    if (!p) continue;
    if (o.last_sent_at || ['active', 'replied', 'meeting', 'not_interested', 'done'].includes(o.status)) p.reached_via.add('campaign');
    if (o.replied_at || ['replied', 'meeting'].includes(o.status)) { p.replied = true; p.reached_via.add('campaign'); }
  }
  for (const t of partnerTouches) {
    for (const n of t.contact_names || []) {
      const p = byName.get(`n:${normName(n)}`);
      if (!p) continue;
      p.reached_via.add('touch');
      if (t.meta?.direction === 'received') p.replied = true;
    }
  }
  const out = list.map(p => ({ name: p.name, title: p.title, buyer: isBuyerTitle(p.title, buyerTitles), reached: p.reached_via.size > 0, replied: p.replied, via: [...p.reached_via].sort() }))
    .sort((a, b) => Number(b.buyer) - Number(a.buyer) || Number(b.reached) - Number(a.reached) || a.name.localeCompare(b.name));
  const buyers = out.filter(p => p.buyer);
  return {
    known: out.length, reached: out.filter(p => p.reached).length,
    buyers: buyers.length, buyers_reached: buyers.filter(p => p.reached).length, buyers_not_yet: buyers.filter(p => !p.reached).length,
    replies: out.filter(p => p.replied).length, people: out,
  };
}

const LINK_COL = { partner: 'goal_id', employer: 'opportunity_id', target: 'target_id' };

export async function reachFor(supabase, businessId, { type, id }) {
  if (!TYPES.includes(type)) return reply(400, { error: 'type must be partner|employer|target' });
  const col = LINK_COL[type];
  const page = (table, cols, build = q => q) => selectAllPages(() => build(supabase.from(table).select(cols).eq('business_id', businessId)).order(cols.split(',')[0].trim()));
  const [prospects, contacts, uploaded, outreach, touches, settings] = await Promise.all([
    type === 'target' ? [] : page('sales_prospect_state', 'contact_id, name, title, status', q => q.eq(col, id)),
    type === 'partner' ? page('partner_contacts', 'id, name, title, apollo_contact_id', q => q.eq('goal_id', id)) : [],
    type === 'partner' ? [] : page('sales_people', 'id, name, title', q => q.eq(col, id).is('archived_at', null)),
    page('sales_outreach_contacts', 'id, name, status, last_sent_at, replied_at', q => q.eq(col, id)),
    type === 'partner' ? page('sales_partner_events', 'id, contact_names, meta', q => q.eq('goal_id', id).eq('event', 'touch')) : [],
    supabase.from('sales_settings').select('buyer_titles').eq('business_id', businessId).maybeSingle().then(r => r.data || null),
  ]);
  const people = [
    ...prospects.map(p => ({ contact_id: p.contact_id, name: p.name, title: p.title, status: p.status })),
    ...contacts.map(c => ({ contact_id: c.apollo_contact_id || null, name: c.name, title: c.title })),
    ...uploaded.map(u => ({ name: u.name, title: u.title })),
  ];
  const contactIds = [...new Set(people.map(p => p.contact_id).filter(Boolean))];
  const messages = contactIds.length ? await selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, contact_id, delivered_at, replied').eq('business_id', businessId).in('contact_id', contactIds).order('apollo_message_id')) : [];
  const out = countReach({ people, messages, outreach, partnerTouches: touches, buyerTitles: settings?.buyer_titles || [] });
  return reply(200, out);
}

// GET goals/reach/:type/:id (Viewer+)
export async function reachRoute(req, res) {
  try { const r = await reachFor(getSupabase(), req.params.businessId, { type: req.params.type, id: req.params.id }); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ error: e.message }); }
}
