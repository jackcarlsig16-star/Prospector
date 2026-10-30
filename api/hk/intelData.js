// grow-inbox-intel-v1 - the one read behind Briefing, the reach line and the research sweep: live brands, touches,
// replies, contacts (has-an-email flag only - the address is dropped here), domain intel, members, settings.intel.
import { liveBrands, selectAllPages, sponsorsNichesOf } from './hkShared.js';
import { intelSettings } from './intelScore.js';

const group = (rows, key) => { const by = {}; for (const r of rows) (by[r[key]] ||= []).push(r); return by; };

export async function loadIntel(supabase, businessId, now = new Date()) {
  const all = (t, cols) => selectAllPages(() => supabase.from(t).select(cols).eq('business_id', businessId).order('id'));
  const [brands, touches, replies, contacts, intel] = await Promise.all([
    liveBrands(supabase, businessId),
    all('hk_touches', 'id, brand_id, sender_user_id, channel, kind, state, sent_at, drafted_at, gmail_thread_id'),
    all('hk_replies', 'id, brand_id, touch_id, label, handled, received_at, gmail_thread_id'),
    all('hk_contacts', 'id, brand_id, name, title, email, email_source, is_primary, left_company, created_by'),
    all('hk_domain_intel', 'id, domain, intel, cost_usd, researched_at'),
  ]);
  const { data: settingsRow, error } = await supabase.from('hk_settings').select('*').eq('business_id', businessId).maybeSingle();
  if (error) throw new Error(error.message);
  const claims = await selectAllPages(() => supabase.from('hk_events').select('id, entity_id, created_at').eq('business_id', businessId).eq('action', 'brand.claimed').order('id'));
  const claimedAt = {};
  for (const e of claims) if (e.entity_id && (!claimedAt[e.entity_id] || e.created_at > claimedAt[e.entity_id])) claimedAt[e.entity_id] = e.created_at;
  const { data: members } = await supabase.from('business_members').select('user_id, name, role, created_at').eq('business_id', businessId).order('created_at');
  return {
    now, brands, touches, replies, claimedAt,
    touchesBy: group(touches, 'brand_id'), repliesBy: group(replies, 'brand_id'),
    // The address is dropped here: name, role and where the email came from only.
    contactsBy: group(contacts.map(c => ({ brand_id: c.brand_id, has_email: !!c.email, name: c.name || null, title: c.title || null, email_source: c.email_source || null, is_primary: !!c.is_primary, left_company: !!c.left_company, created_by: c.created_by || null })), 'brand_id'),
    intelByDomain: Object.fromEntries(intel.map(i => [i.domain, i])),
    sponsorsNiches: sponsorsNichesOf(brands),
    settingsRow: settingsRow || {}, settings: intelSettings(settingsRow?.intel),
    members: (members || []).map(m => ({ user_id: m.user_id, role: m.role, first_name: String(m.name || '').trim().split(/\s+/)[0] || null })),
  };
}

export const firstNameOf = (data, uid) => data.members.find(m => m.user_id === uid)?.first_name || null;
