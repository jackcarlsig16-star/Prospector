import { selectAllPages } from '../lib/selectAllPages.js';
import { normName } from './intakeMatch.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';
import { loadDupeContext } from './partnerDupeCheck.js';
import { liveMatch } from './visitRules.js';

// homelover-flow-v1 ruling F-d - web_visits rows that matched nothing when they were pulled get matched later: when a
// target / employer / partner is created or promoted (same normalized domain, or the same normalized name), and once
// over every record (backfillVisitMatches, reported before -> after). Only rows with no match move; a row already
// matched to a record is never re-pointed here (promote moves those itself). Mace's rows are the live check.
const VISIT_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

// -> the number of rows matched to the record.
export async function rematchVisits(supabase, { businessId, type, id, name, domain = null }) {
  const matchedType = VISIT_TYPE[type];
  if (!matchedType) return 0;
  const key = normName(name || ''), dom = normalizeDomain(domain || '');
  let n = 0;
  if (key) n += must(await supabase.from('web_visits').update({ matched_type: matchedType, matched_id: id }).eq('business_id', businessId).eq('company_key', key).is('matched_id', null).select('id')).length;
  if (dom) n += must(await supabase.from('web_visits').update({ matched_type: matchedType, matched_id: id }).eq('business_id', businessId).eq('domain', dom).is('matched_id', null).select('id')).length;
  return n;
}

// Pure: the plan for unmatched visit rows. ctx = loadDupeContext (names + confirmed partner domains, as the pull
// matches); domains = [{ type: 'employer' | 'target' | 'partner', id, name, domain }] (the records' own domain columns,
// which the pull's matcher never read). -> [{ visit_id, company_key, type, id, name, via }]
export function planVisitMatches(visits, { ctx, domains = [] }) {
  const byDomain = new Map();
  for (const d of domains) { const k = normalizeDomain(d.domain || ''); if (!k) continue; if (!byDomain.has(k)) byDomain.set(k, []); byDomain.get(k).push(d); }
  const RANK = { partner: 0, employer: 1, target: 2 };
  const out = [];
  for (const v of visits) {
    if (v.matched_id) continue;
    const live = liveMatch(v, ctx);
    if (live) { out.push({ visit_id: v.id, company_key: v.company_key, type: live.type === 'opportunity' ? 'employer' : live.type, id: live.id, name: live.name, via: 'name' }); continue; }
    const hits = (byDomain.get(normalizeDomain(v.domain || '')) || []).sort((a, b) => RANK[a.type] - RANK[b.type]);
    if (hits.length) out.push({ visit_id: v.id, company_key: v.company_key, type: hits[0].type, id: hits[0].id, name: hits[0].name, via: 'domain' });
  }
  return out;
}

export async function loadVisitMatchInputs(supabase, businessId) {
  const page = (table, cols, build = q => q) => selectAllPages(() => build(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [visits, ctx, employers, targets, partners] = await Promise.all([
    page('web_visits', 'id, company_key, company_name, domain, matched_type, matched_id, pulled_on', q => q.is('matched_id', null)),
    loadDupeContext(supabase, businessId),
    page('sales_opportunities', 'id, organization, domain', q => q.is('archived_at', null).not('domain', 'is', null)),
    page('sales_targets', 'id, name, domain, status', q => q.not('domain', 'is', null)),
    page('sales_goals', 'id, name, company_domain', q => q.eq('goal_type', 'partnership').is('archived_at', null).not('company_domain', 'is', null)),
  ]);
  const domains = [
    ...partners.map(p => ({ type: 'partner', id: p.id, name: p.name, domain: p.company_domain })),
    ...employers.map(e => ({ type: 'employer', id: e.id, name: e.organization, domain: e.domain })),
    ...targets.filter(t => t.status !== 'rejected').map(t => ({ type: 'target', id: t.id, name: t.name, domain: t.domain })),
  ];
  return { visits, ctx, domains };
}

// The one-off pass. apply = false reports only. -> { before: { unmatched }, would_match | matched: n, after: { unmatched }, rows }
export async function backfillVisitMatches(supabase, businessId, { apply = false } = {}) {
  const { visits, ctx, domains } = await loadVisitMatchInputs(supabase, businessId);
  const plan = planVisitMatches(visits, { ctx, domains });
  let matched = 0;
  if (apply) {
    for (const m of plan) {
      matched += must(await supabase.from('web_visits').update({ matched_type: VISIT_TYPE[m.type], matched_id: m.id }).eq('business_id', businessId).eq('id', m.visit_id).is('matched_id', null).select('id')).length;
    }
  }
  const byType = plan.reduce((o, m) => ({ ...o, [m.type]: (o[m.type] || 0) + 1 }), {});
  return { before: { unmatched: visits.length }, planned: plan.length, by_type: byType, matched, after: { unmatched: visits.length - (apply ? matched : 0) }, rows: plan };
}
