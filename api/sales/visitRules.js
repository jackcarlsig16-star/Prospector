import { normName } from './intakeMatch.js';
import { cleanText } from './scrubText.js';
import { findDupes } from './partnerDupeCheck.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';

// signals-v1 REV4 Stage 4 - pure functions over Apollo's website-visitor
// search (shape proven in Stages 2b/2c) and rows the pull already loaded.
// Nothing here reads or writes the database. Thresholds and the noise lists
// are REVISABLE until Brad agrees (D10).
export const VISITOR_DOMAINS = ['homelover.ai', 'homelover.com'];
export const US_500_FILTERS = {
  organization_num_employees_ranges: ['501,1000', '1001,2000', '2001,5000', '5001,10000', '10001,'],
  organization_locations: ['United States'],
};
export const PHONE_FIELDS = ['phone', 'primary_phone', 'sanitized_phone'];
export const SEED_SKIP = ['SimpliBorrow', 'Embrace Home Loans', 'Lovable', 'Apollo'];
export const PRIORITY_LABEL = { P1: 'act today', P2: 'this week', P3: 'watch', P4: 'noise' };
const OWN = /(^|\.)homelover\.(ai|com)$/;
const HOSTING = /\b(amazon web services|google cloud|microsoft azure|digitalocean|cloudflare|akamai|linode|ovh|hetzner|comcast|verizon|charter communications|cox communications|t mobile)\b/;
const HOSTING_NAICS = /^518/;
const USER_PATH = /^\/(auth|help|privacy|terms)(\/|$|\?)/i;
const CONTACT_PATH = /^\/(employer-partners|contact)/i;
const UPSIDE = ['upside', 'both'];
const RANK = { partner: 0, opportunity: 1, target: 2 };

// Apollo's path ids are host + path ("homelover.ai/contact"); keep the path.
const pathOf = id => cleanText(String(id || '').replace(/^([a-z]+:\/\/)?[^/?#]*/i, ''), 200) || '/';
const ymd = n => { const s = String(n || ''); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null; };
const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const strs = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 20) : null);
const orgIdOf = (row, fromAccounts) => row.intent_signal_account?.organization_id || (fromAccounts ? row.organization_id : row.id) || row.id;

// Phones never leave this function: every row is copied without them, and
// toVisit below keeps only its own field list anyway.
export function mergeResults(json) {
  const byId = new Map();
  const rows = [...(json?.organizations || []).map(r => [r, false]), ...(json?.accounts || []).map(r => [r, true])];
  for (const [raw, fromAccounts] of rows) {
    const row = { ...raw };
    for (const k of PHONE_FIELDS) delete row[k];
    const id = orgIdOf(row, fromAccounts);
    const prior = byId.get(id);
    if (!prior) { byId.set(id, { ...row, _org_id: id }); continue; }
    for (const [k, v] of Object.entries(row)) if (prior[k] == null) prior[k] = v;
  }
  return [...byId.values()];
}

export function toVisit(row, us500) {
  const isa = row.intent_signal_account || {};
  const aggs = Array.isArray(isa.domain_aggregates) ? isa.domain_aggregates : [];
  const pv = isa.website_visitor_metrics?.page_view_aggregates || {};
  const paths = new Map(), weeks = new Map();
  for (const a of aggs) {
    for (const p of a.top_5_paths || []) {
      const path = pathOf(p._id);
      paths.set(path, (paths.get(path) || 0) + (num(p.total_visits) || 0));
    }
    for (const w of a.weekly_aggregates || []) {
      const wk = String(w.week_start_date || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(wk)) weeks.set(wk, (weeks.get(wk) || 0) + (num(w.count) || 0));
    }
  }
  const firsts = aggs.map(a => ymd(a.first_visit)).filter(Boolean).sort();
  const lasts = aggs.map(a => ymd(a.last_visit)).filter(Boolean).sort();
  const scores = aggs.map(a => num(a.intent_score)).filter(n => n != null);
  const name = cleanText(row.name || '', 160) || null;
  const domain = normalizeDomain(row.primary_domain || row.website_url || '');
  return {
    company_name: name, company_key: normName(name) || domain, domain, apollo_org_id: String(row._org_id || '') || null,
    linkedin_url: typeof row.linkedin_url === 'string' ? row.linkedin_url.slice(0, 300) : null,
    naics_codes: strs(row.naics_codes), sic_codes: strs(row.sic_codes), revenue: num(row.organization_revenue),
    headcount_growth: { six_month: num(row.organization_headcount_six_month_growth), twelve_month: num(row.organization_headcount_twelve_month_growth), twenty_four_month: num(row.organization_headcount_twenty_four_month_growth) },
    us_500: !!us500, first_visit: firsts[0] || null, last_visit: lasts[lasts.length - 1] || null,
    visits_1d: num(pv.one_day_count), visits_7d: num(pv.seven_day_count) ?? num(isa.total_visits),
    unique_visitors_7d: num(isa.unique_visitors) ?? aggs.reduce((n, a) => n + (num(a.unique_visitors) || 0), 0),
    weekly: [...weeks].sort().map(([week_start, count]) => ({ week_start, count })),
    top_paths: [...paths].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([path, visits]) => ({ path, visits })),
    apollo_intent: typeof isa.overall_intent === 'string' ? isa.overall_intent.slice(0, 40) : null,
    intent_score: scores.length ? Math.max(...scores) : null,
  };
}

// The record a visit counts as "matched" to for priority: a live exact
// match (name or confirmed partner domain), partner > employer > target.
// Apollo-only accounts and partial names don't count - same as Accept.
export function liveMatch(v, ctx) {
  const hit = findDupes({ name: v.company_name, domain: v.domain }, ctx).exact
    .filter(h => h.type in RANK && !h.archived).sort((a, b) => RANK[a.type] - RANK[b.type])[0];
  if (!hit) return null;
  const list = { partner: ctx.partners, opportunity: ctx.opportunities, target: ctx.targets }[hit.type];
  const row = list.find(r => r.id === hit.id) || {};
  return { type: hit.type, id: hit.id, name: hit.name, owner_team: row.owner_team || null, kind: row.kind || null };
}

// Typed-in Apollo account headcount is the only size Prospector holds for
// an unmatched company; true = known and under 500.
export const knownSmall = (v, ctx) => ctx.companies.some(c => c.employees != null && c.employees < 500 && normName(c.name) === v.company_key);

export function prioritize(v, { match, small = false, skip = new Set() }) {
  const n = v.visits_7d || 0, people = v.unique_visitors_7d || 0;
  const paths = v.top_paths.map(p => p.path);
  const noise = (rule, extra = {}) => ({ priority: 'P4', priority_rule: rule, noise_reason: rule, maybe_user: false, ...extra });
  if ((v.domain && OWN.test(v.domain)) || v.company_key === 'homelover') return noise('HomeLover’s own site');
  if (skip.has(v.company_key)) return noise('On the skip list');
  if (HOSTING.test(v.company_key || '') || (v.naics_codes || []).some(c => HOSTING_NAICS.test(c))) return noise('ISP, hosting or bot traffic');
  if (paths.length && paths.every(p => USER_PATH.test(p))) return noise('Only /auth, /help, /privacy or /terms - may already be a user', { maybe_user: true });
  if (small && !match && n <= 2) return noise('Under 500 employees with 1–2 visits');
  const p = (priority, priority_rule) => ({ priority, priority_rule, noise_reason: null, maybe_user: false });
  if (match?.type === 'partner') return p('P1', 'Matched partner visited');
  if (match?.type === 'opportunity') return p('P1', 'Matched employer visited');
  if (match?.type === 'target' && UPSIDE.includes(match.owner_team)) return p('P1', 'Upside-owned target visited');
  if (v.us_500 && (n >= 5 || people >= 3)) return p('P1', 'US 500+ with 5+ visits or 3+ people in 7 days');
  if (paths.some(x => CONTACT_PATH.test(x)) && n >= 2) return p('P1', 'Employer/contact page plus a repeat visit');
  if (v.us_500 && (n >= 2 || people >= 2)) return p('P2', 'US 500+ with 2+ visits or 2+ people in 7 days');
  return p('P3', v.us_500 ? 'US 500+ with one visit' : 'Size unknown - watch');
}

// The sales_signals row for a P1/P2 visit: no person, so no who.
export function toWebSignal(v, { businessId, week, userId, match, hint }) {
  const pages = v.top_paths.slice(0, 3).map(p => p.path).join(', ');
  const n = v.visits_7d || 0, people = v.unique_visitors_7d || 0;
  return {
    business_id: businessId, source: 'web_visit', signal_week: week, company_name: v.company_name, company_key: v.company_key,
    kind: match?.type === 'partner' || match?.kind === 'partner' ? 'partner' : 'employer', kind_guessed: !match,
    who: null, who_key: null,
    signal: cleanText(`${n} visit${n === 1 ? '' : 's'} / ${people} ${people === 1 ? 'person' : 'people'} in 7 days${pages ? `; top pages ${pages}` : ''}`, 400),
    why_now: cleanText(`${v.priority} ${PRIORITY_LABEL[v.priority]}: ${v.priority_rule}`, 400),
    first_line: null, score: null, upside_joint: !!match && UPSIDE.includes(match.owner_team), match: hint, status: 'new', created_by: userId,
  };
}
