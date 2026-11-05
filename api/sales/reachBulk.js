import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { countReach } from './reachCount.js';

// homelover-flow-v1 F6 (Stage 3) - "reached n of m" for EVERY record in one pass (the Map and Pipeline rows' "3/11"):
// the same rule as reachCount.countReach per company, over the workspace's people, Apollo messages, campaign contacts
// and partner touches read once with selectAllPages. Never stored; names never leave (counts only go out).
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

export async function reachAll(supabase, businessId) {
  const page = (table, cols, build = q => q) => selectAllPages(() => build(supabase.from(table).select(cols).eq('business_id', businessId)).order(cols.split(',')[0].trim()));
  const [prospects, contacts, uploaded, outreach, touches, settings] = await Promise.all([
    page('sales_prospect_state', 'contact_id, name, title, status, opportunity_id, goal_id'),
    page('partner_contacts', 'id, goal_id, name, title, apollo_contact_id'),
    page('sales_people', 'id, opportunity_id, target_id, name, title', q => q.is('archived_at', null)),
    page('sales_outreach_contacts', 'id, goal_id, opportunity_id, target_id, name, status, last_sent_at, replied_at'),
    page('sales_partner_events', 'id, goal_id, contact_names, meta', q => q.eq('event', 'touch')),
    supabase.from('sales_settings').select('buyer_titles').eq('business_id', businessId).maybeSingle().then(r => r.data || null),
  ]);
  const by = new Map();
  const bucket = key => { if (!by.has(key)) by.set(key, { people: [], outreach: [], touches: [] }); return by.get(key); };
  for (const p of prospects) {
    const key = p.opportunity_id ? `employer:${p.opportunity_id}` : p.goal_id ? `partner:${p.goal_id}` : null;
    if (key) bucket(key).people.push({ contact_id: p.contact_id, name: p.name, title: p.title, status: p.status });
  }
  for (const c of contacts) bucket(`partner:${c.goal_id}`).people.push({ contact_id: c.apollo_contact_id || null, name: c.name, title: c.title });
  for (const u of uploaded) { const key = u.opportunity_id ? `employer:${u.opportunity_id}` : u.target_id ? `target:${u.target_id}` : null; if (key) bucket(key).people.push({ name: u.name, title: u.title }); }
  for (const o of outreach) { const key = o.goal_id ? `partner:${o.goal_id}` : o.opportunity_id ? `employer:${o.opportunity_id}` : o.target_id ? `target:${o.target_id}` : null; if (key) bucket(key).outreach.push(o); }
  for (const t of touches) bucket(`partner:${t.goal_id}`).touches.push(t);
  const contactIds = [...new Set(prospects.map(p => p.contact_id))];
  const messages = contactIds.length ? await selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, contact_id, delivered_at, replied').eq('business_id', businessId).order('apollo_message_id')) : [];
  const msgsByContact = new Map();
  for (const m of messages) { if (!msgsByContact.has(m.contact_id)) msgsByContact.set(m.contact_id, []); msgsByContact.get(m.contact_id).push(m); }
  const buyerTitles = settings?.buyer_titles || [];
  const out = {};
  for (const [key, b] of by) {
    const msgs = b.people.flatMap(p => (p.contact_id ? msgsByContact.get(p.contact_id) || [] : []));
    const r = countReach({ people: b.people, messages: msgs, outreach: b.outreach, partnerTouches: b.touches, buyerTitles });
    out[key] = { known: r.known, reached: r.reached, buyers_reached: r.buyers_reached, buyers_not_yet: r.buyers_not_yet, replies: r.replies };
  }
  return out;
}

// GET goals/reach -> { reach: { '<type>:<id>': { known, reached, buyers_reached, buyers_not_yet, replies } } } (Viewer+)
export async function reachAllRoute(req, res) {
  try { res.json({ reach: await reachAll(getSupabase(), req.params.businessId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
}
