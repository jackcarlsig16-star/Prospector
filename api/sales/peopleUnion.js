import { normName } from './intakeMatch.js';
import { isPartialName } from './peopleFind.js';

// visitor-to-record-v1 REV2 V3 - one People search over the three contact tables (sales_people + its company,
// partner_contacts + its partner, sales_prospect_state + its account), pure over rows the route loads. A row says
// has_email (boolean) and never the address; phones never exist on the output. <= MAX rows.
export const MAX_ROWS = 50;
export const TIES = ['company', 'partner_referral', 'campaign', 'sequence', 'visit', 'upside'];
const OUT_KEYS = ['person_id', 'source_table', 'name', 'title', 'company', 'ties', 'last_activity', 'has_email', 'name_partial'];
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
const lower = s => String(s || '').toLowerCase();
const upsideTie = row => (row && ['upside', 'both'].includes(row.owner_team) ? { kind: 'upside', label: `Upside${row.co_owner_name ? ` (${row.co_owner_name})` : ''}`, who: row.co_owner_name || null } : null);

function companyOf(p, { opportunities = [], targets = [], partners = [] }) {
  if (p.company_type === 'employer' && p.opportunity_id) { const o = opportunities.find(x => x.id === p.opportunity_id); return o ? { type: 'employer', id: o.id, name: o.organization, row: o } : null; }
  if (p.target_id) { const t = targets.find(x => x.id === p.target_id); return t ? { type: 'target', id: t.id, name: t.name, row: t } : null; }
  if (p.goal_id) { const g = partners.find(x => x.id === p.goal_id); return g ? { type: 'partner', id: g.id, name: g.name, row: g } : null; }
  return null;
}
const pub = c => (c ? { type: c.type, id: c.id, name: c.name } : null);

// Every row the three tables hold, in the one shape, before the query filters.
export function unionRows({ salesPeople = [], partnerContacts = [], prospects = [], opportunities = [], targets = [], partners = [], visits = [], campaignNames = {} } = {}) {
  const ctx = { opportunities, targets, partners };
  const out = [];
  for (const p of salesPeople) {
    if (p.archived_at) continue;
    const c = companyOf(p, ctx);
    const ties = [];
    if (c) ties.push({ kind: 'company', label: c.name });
    if (p.source_kind === 'partner_referral' && p.source_partner_id) { const g = partners.find(x => x.id === p.source_partner_id); ties.push({ kind: 'partner_referral', label: `Referred by ${g?.name || 'a partner'}` }); }
    if (p.source_kind === 'campaign') ties.push({ kind: 'campaign', label: campaignNames[p.source_campaign_id] ? `Campaign ${campaignNames[p.source_campaign_id]}` : 'Campaign' });
    if (p.source_kind === 'web_visit' || p.visit_id) { const v = visits.find(x => x.id === p.visit_id); ties.push({ kind: 'visit', label: `Visited ${v?.last_visit || v?.pulled_on || ''}`.trim(), date: v?.last_visit || v?.pulled_on || null }); }
    const up = upsideTie(c?.row); if (up) ties.push(up);
    out.push({ person_id: p.id, source_table: 'sales_people', name: p.name, title: p.title || null, company: pub(c), ties, last_activity: p.updated_at || p.created_at || null, has_email: false, name_partial: isPartialName(p.note) });
  }
  for (const p of partnerContacts) {
    const c = companyOf(p, ctx);
    const ties = [];
    if (c) ties.push({ kind: 'company', label: c.name });
    if (p.source === 'apollo') ties.push({ kind: 'sequence', label: 'Apollo sequence' });
    const up = upsideTie(c?.row); if (up) ties.push(up);
    out.push({ person_id: p.id, source_table: 'partner_contacts', name: p.name, title: p.title || null, company: pub(c), ties, last_activity: p.last_activity_at || p.first_seen || null, has_email: !!p.email, name_partial: false });
  }
  for (const p of prospects) {
    const o = p.opportunity_id ? opportunities.find(x => x.id === p.opportunity_id) : null;
    const c = o ? { type: 'employer', id: o.id, name: o.organization, row: o } : p.company ? { type: 'account', id: null, name: p.company, row: null } : null;
    const ties = [];
    if (c) ties.push({ kind: 'company', label: c.name });
    ties.push({ kind: 'sequence', label: 'Apollo sequence' });
    const up = upsideTie(o); if (up) ties.push(up);
    out.push({ person_id: p.contact_id, source_table: 'sales_prospect_state', name: p.name || null, title: p.title || null, company: pub(c), ties, last_activity: p.updated_at || null, has_email: false, name_partial: false });
  }
  return out.filter(r => r.name);
}

// q matches the name (contains) or the company (normName contains); company = normName equality or contains; tie = one
// of TIES; title = contains. Newest activity first, then name. Output keys are fixed and checked for an address.
export function searchPeople(rows, { q = '', company = '', tie = '', title = '', limit = MAX_ROWS } = {}) {
  if (tie && !TIES.includes(tie)) throw Object.assign(new Error(`tie must be one of ${TIES.join('|')}`), { status: 400 });
  const nq = lower(q).trim(), nc = normName(company), nt = lower(title).trim();
  let hits = rows.filter(r => {
    if (nq && !(lower(r.name).includes(nq) || (r.company && normName(r.company.name).includes(normName(q))))) return false;
    if (nc && !(r.company && normName(r.company.name).includes(nc))) return false;
    if (tie && !r.ties.some(t => t.kind === tie)) return false;
    if (nt && !lower(r.title).includes(nt)) return false;
    return true;
  });
  hits.sort((a, b) => String(b.last_activity || '').localeCompare(String(a.last_activity || '')) || String(a.name).localeCompare(String(b.name)));
  hits = hits.slice(0, Math.min(Math.max(1, limit), MAX_ROWS)).map(r => Object.fromEntries(OUT_KEYS.map(k => [k, r[k]])));
  const text = JSON.stringify(hits);
  if (ADDRESS.test(text)) throw new Error('peopleUnion: an address reached the result - refused');
  return hits;
}
