import { normName } from './intakeMatch.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase } from './goalsShared.js';

// company-panel-v2 D1 - a person (sales_prospect_state) -> the company record
// they belong to. Exact only, never fuzzy, fill-only: a link is set where
// there is none, never re-pointed. The same rules as the Stage 1 backfill
// (20261021_company_panel_v2_links.sql), so the sync and the migration agree.
//   goal_id:        (1) email domain = a CONFIRMED domain of one live partnership ('domain')
//                   (2) normalized company = one live partnership's name ('name')
//   opportunity_id: normalized company = one non-archived opportunity's name ('name')
// A name shared by two records links nothing. 'manual' (a person clicked
// "Not this company") is never overwritten; 'pipeline' (Huddle's Add to
// pipeline) is never touched. The email is read for its domain here only.
export const AMBIGUOUS = 'ambiguous';
export const GOAL_LINK_VIAS = ['domain', 'name', 'manual'];
export const OPP_LINK_VIAS = ['name', 'manual', 'pipeline'];
export const LINK_COLUMNS = ['goal_id', 'goal_link_via', 'opportunity_id', 'opportunity_link_via'];

export const emailDomain = email => (typeof email === 'string' && email.includes('@') ? normalizeDomain(email.split('@')[1]) : null);

const index = (rows, key, value) => {
  const m = new Map();
  for (const r of rows) { const k = key(r); if (!k) continue; const v = value(r); m.set(k, m.has(k) && m.get(k) !== v ? AMBIGUOUS : v); }
  return m;
};

// partners: live partnerships [{ id, name }]; domains: confirmed [{ goal_id, domain }];
// opportunities: non-archived [{ id, organization }].
export function buildLinkIndex({ partners = [], domains = [], opportunities = [] }) {
  const live = new Set(partners.map(p => p.id));
  return {
    byDomain: index(domains.filter(d => live.has(d.goal_id)), d => normalizeDomain(d.domain), d => d.goal_id),
    byPartnerName: index(partners, p => normName(p.name), p => p.id),
    byOppName: index(opportunities, o => normName(o.organization), o => o.id),
  };
}

// The columns to set for one person (empty when nothing applies).
export function linkPatch(person, idx) {
  const patch = {};
  const company = normName(person.company);
  if (person.goal_id == null && person.goal_link_via !== 'manual') {
    const d = idx.byDomain.get(emailDomain(person.email));
    if (d && d !== AMBIGUOUS) Object.assign(patch, { goal_id: d, goal_link_via: 'domain' });
    else if (company) { const n = idx.byPartnerName.get(company); if (n && n !== AMBIGUOUS) Object.assign(patch, { goal_id: n, goal_link_via: 'name' }); }
  }
  if (person.opportunity_id == null && person.opportunity_link_via !== 'manual' && company) {
    const o = idx.byOppName.get(company);
    if (o && o !== AMBIGUOUS) Object.assign(patch, { opportunity_id: o, opportunity_link_via: 'name' });
  }
  return patch;
}

export async function loadLinkIndex(supabase, businessId) {
  const all = (table, cols, narrow) => selectAllPages(() => narrow(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [partners, domains, opportunities] = await Promise.all([
    all('sales_goals', 'id, name', q => q.eq('goal_type', 'partnership').is('archived_at', null)),
    all('partner_domains', 'id, goal_id, domain', q => q.eq('confirmed', true)),
    all('sales_opportunities', 'id, organization', q => q.is('archived_at', null)),
  ]);
  return buildLinkIndex({ partners, domains, opportunities });
}

// POST /prospects/:contactId/unlink { which: 'goal' | 'opportunity' } - "Not
// this company": the link goes to null with link_via 'manual', so no sync
// sets it again. -> { prospect }.
const reply = (status, body) => ({ status, body });
export async function unlinkProspect(supabase, { businessId, contactId, body, byUser }) {
  const which = body?.which;
  if (!['goal', 'opportunity'].includes(which)) return reply(400, { error: 'which must be goal or opportunity' });
  const { data: p, error } = await supabase.from('sales_prospect_state').select('contact_id, goal_id, opportunity_id').eq('business_id', businessId).eq('contact_id', contactId).maybeSingle();
  if (error) return reply(500, { error: error.message });
  if (!p) return reply(404, { error: 'prospect not found' });
  const patch = which === 'goal' ? { goal_id: null, goal_link_via: 'manual' } : { opportunity_id: null, opportunity_link_via: 'manual' };
  const { data, error: uErr } = await supabase.from('sales_prospect_state').update({ ...patch, updated_by: byUser, updated_at: new Date().toISOString() })
    .eq('business_id', businessId).eq('contact_id', contactId).select('contact_id, goal_id, goal_link_via, opportunity_id, opportunity_link_via').single();
  if (uErr) return reply(500, { error: uErr.message });
  return reply(200, { prospect: data, before: { goal_id: p.goal_id, opportunity_id: p.opportunity_id } });
}
export async function unlinkProspectRoute(req, res) {
  const r = await unlinkProspect(getSupabase(), { businessId: req.params.businessId, contactId: req.params.contactId, body: req.body, byUser: req.auth.user.email });
  res.status(r.status).json(r.body);
}
