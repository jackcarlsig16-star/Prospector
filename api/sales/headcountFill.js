import { normName, GENERIC_WORDS } from './intakeMatch.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';
import { MONTHLY_CREDIT_CAP } from './visitPull.js';

// FIX headcount-auto-v1 REV2 Stage 1 - the pure half of "every company gets a headcount": candidate order, the free
// paths first (H3: a name search finds the domain, 0 credits; the visit row / a stated number / Research give the number
// when they have one), then the enrich lookup (H4) under the daily cap, the shared monthly ledger and the stop-on-first-
// charge rule, with a keep-list over Apollo's organization object (phone, address, funding, people never pass). Nothing
// here reads the network or the database: Stage 2 injects the lookups and applies the writes.
export const NAME_SEARCH_DAILY_CAP = 200; // REVISABLE
export const PAGE_LOAD_LOOKUPS = 10; // REVISABLE - H5 (3)
export const NAME_SEARCH_PATH = '/mixed_companies/search';
export const ENRICH_PATH = '/organizations/enrich';
export const BANDS = ['P1', 'P2', 'P3', 'P4'];
export const KEEP_LIST = ['estimated_num_employees', 'primary_domain', 'industry', 'annual_revenue_printed', 'founded_year'];
export const FIRMOGRAPHIC_KEYS = ['industry', 'annual_revenue_printed', 'founded_year'];
export const DOMAIN_SOURCES = ['visit', 'people', 'research', 'manual', 'upload', 'apollo_name'];
export const CONSUMER_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'me.com', 'live.com', 'msn.com', 'comcast.net', 'att.net', 'proton.me', 'protonmail.com', 'ymail.com', 'sbcglobal.net', 'verizon.net']);
export const isConsumerDomain = d => CONSUMER_DOMAINS.has(String(d || '').toLowerCase());
export const chargedMessage = credits => `Apollo started charging for headcount (${credits} credit${credits === 1 ? '' : 's'}) - paused`;

const str = (v, max = 160) => (v == null ? null : String(v).trim().slice(0, max) || null);
const int = v => (Number.isInteger(v) && v > 0 ? v : Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);

// The organization object -> only the keep-list, typed. Everything else (phone, street_address, postal_code, funding,
// people, emails, ...) is dropped here before anything is stored or logged.
export function firmographics(org) {
  if (!org || typeof org !== 'object') return null;
  const out = { industry: str(org.industry, 120), annual_revenue_printed: str(org.annual_revenue_printed, 40), founded_year: int(org.founded_year) };
  return Object.values(out).some(v => v != null) ? out : null;
}
export const headcountOf = org => int(org?.estimated_num_employees);
export const enrichDomainOf = org => normalizeDomain(org?.primary_domain || '') || null;

// --- requests (the client's guards refuse anything else) ---
export const nameSearchRequest = name => ({ method: 'POST', path: NAME_SEARCH_PATH, body: { q_organization_name: String(name).trim().replace(/\s+/g, ' '), per_page: 3, page: 1 } });
export const enrichRequest = domain => { const d = normalizeDomain(domain || ''); if (!d) throw new Error('headcountFill: a domain is required for enrich'); return { method: 'GET', path: ENRICH_PATH, query: `domain=${encodeURIComponent(d)}` }; };

// --- the name-match acceptance rule (H3a) ---
// exact: the same normalized name. contained: ours is a whole-word part of the hit's name AND ours has a word that is
// not generic (GENERIC_WORDS). One acceptable hit -> its primary_domain; two or more -> ambiguous; none -> no domain.
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsIn = (inner, outer) => new RegExp(`(^| )${escape(inner)}( |$)`).test(outer);
const meaningful = n => n.split(' ').some(w => w && !GENERIC_WORDS.has(w));
export function acceptNameHit(name, hits = []) {
  const ours = normName(name);
  if (!ours) return null;
  const withDomain = (Array.isArray(hits) ? hits : []).map(h => ({ name: str(h?.name, 160), domain: normalizeDomain(h?.primary_domain || h?.domain || '') || null })).filter(h => h.domain && h.name);
  const exact = withDomain.filter(h => normName(h.name) === ours);
  if (exact.length === 1) return { domain: exact[0].domain, hit: exact[0].name, how: 'exact' };
  if (exact.length > 1) return [...new Set(exact.map(h => h.domain))].length === 1 ? { domain: exact[0].domain, hit: exact[0].name, how: 'exact' } : { ambiguous: true, reason: `${exact.length} exact-name hits with different domains` };
  const contained = meaningful(ours) ? withDomain.filter(h => wordsIn(ours, normName(h.name))) : [];
  if (contained.length === 1) return { domain: contained[0].domain, hit: contained[0].name, how: 'contained' };
  if (contained.length > 1) return { ambiguous: true, reason: `${contained.length} hits contain the name` };
  return null;
}

// --- order (H4): P1 -> P4, newest first within a band, unscored last; only companies without a headcount ---
export function candidateOrder(records, scores = new Map()) {
  const rank = r => { const s = scores.get(r.key); return s && BANDS.includes(s.band) ? BANDS.indexOf(s.band) : BANDS.length; };
  return records.filter(r => r.employees == null && r.employees_source !== 'manual').map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || String(b.r.created_at || '').localeCompare(String(a.r.created_at || '')) || a.i - b.i).map(x => x.r);
}

// --- write rules ---
// A headcount is written only into an empty slot; a manual value is never touched; a research number stays (Apollo
// fills it only when research left it null, which is the empty slot). source: 'apollo' | 'research' | 'manual' | 'upload'.
export function headcountWrite(record, number, source, { now = new Date() } = {}) {
  const n = int(number);
  if (!n) return null;
  if (record.employees_source === 'manual') return null;
  if (record.employees != null) return null;
  return { employees: n, employees_source: source, employees_at: now.toISOString() };
}
// A domain is fill-only: never over a manual one, never over any existing one.
export function domainWrite(record, domain, source, { now = new Date() } = {}) {
  const d = normalizeDomain(domain || '');
  if (!d || isConsumerDomain(d) || !DOMAIN_SOURCES.includes(source)) return null;
  if (record.domain) return null;
  return { domain: d, domain_source: source, domain_at: now.toISOString() };
}

// --- caps: today's N (sales_settings.headcount_daily_credits) and the shared monthly ledger ---
export function capState({ dailyCap = 25, usedToday = 0, monthSpent = 0, monthlyCap = MONTHLY_CREDIT_CAP } = {}) {
  const paused = monthSpent >= monthlyCap;
  return { lookupsLeft: paused ? 0 : Math.max(0, Math.min(dailyCap - usedToday, monthlyCap - monthSpent)), paused };
}

// --- the run (pure over injected lookups) ---
// candidates: records { key, type, id, name, domain, domain_source, employees, employees_source, created_at }.
// lookups: { nameSearch(name) -> hits[], freeHeadcount(record) -> { number, source } | null, enrich(domain) -> { org, credits } }.
// Each enrich reports its MEASURED credit delta; the first delta above 0 stops the run (H4). nameSearch and enrich are
// counted against their caps; a lookup that throws is a 'lookup_error', never a stop.
export async function runFill(candidates, { lookups, caps = {}, nameSearchesLeft = NAME_SEARCH_DAILY_CAP, now = new Date() } = {}) {
  let { lookupsLeft } = capState(caps);
  let namesLeft = Math.max(0, nameSearchesLeft);
  const items = [];
  const counts = { candidates: candidates.length, domains_found: 0, filled_free: 0, filled_apollo: 0, unknown: 0, ambiguous: 0, name_searches: 0, lookups: 0, credits: 0, lookup_errors: 0, stopped: null };
  for (const r of candidates) {
    const item = { key: r.key, name: r.name, domain: r.domain || null, writes: {}, flags: [] };
    if (!item.domain && lookups.nameSearch && namesLeft > 0) {
      namesLeft--; counts.name_searches++;
      try {
        const hit = acceptNameHit(r.name, await lookups.nameSearch(r.name));
        if (hit?.domain) { const w = domainWrite(r, hit.domain, 'apollo_name', { now }); if (w) { Object.assign(item.writes, w); item.domain = w.domain; item.flags.push(`domain:${hit.how}`); counts.domains_found++; } }
        else if (hit?.ambiguous) { item.flags.push('name_ambiguous'); counts.ambiguous++; }
        else item.flags.push('no_name_hit');
      } catch (e) { item.flags.push('lookup_error'); counts.lookup_errors++; }
    }
    let filled = null;
    const free = lookups.freeHeadcount ? await lookups.freeHeadcount(r) : null;
    if (free?.number) { const w = headcountWrite(r, free.number, free.source, { now }); if (w) { Object.assign(item.writes, w); filled = free.source; counts.filled_free++; } }
    if (!filled && item.domain && lookups.enrich && lookupsLeft > 0 && !counts.stopped) {
      lookupsLeft--; counts.lookups++;
      try {
        const { org, credits = 0 } = await lookups.enrich(item.domain);
        counts.credits += credits;
        if (credits > 0) { counts.stopped = { credits, message: chargedMessage(credits), at: r.key }; item.flags.push('charged'); }
        const w = headcountWrite(r, headcountOf(org), 'apollo', { now });
        if (w) { Object.assign(item.writes, w); filled = 'apollo'; counts.filled_apollo++; }
        const f = firmographics(org);
        if (f) item.writes.apollo_firmographics = f;
        if (!w && !f) item.flags.push('enrich_empty');
      } catch (e) { item.flags.push('lookup_error'); counts.lookup_errors++; }
    }
    if (!filled) { counts.unknown++; if (!item.domain) item.flags.push('no_domain'); }
    item.filled = filled;
    items.push(item);
    if (counts.stopped) break;
  }
  counts.skipped = candidates.length - items.length;
  return { items, counts, lookupsLeft, nameSearchesLeft: namesLeft };
}

// "n domains found · m headcounts filled (k via Apollo) · j still unknown · a names ambiguous"
export const fillLine = c => `${c.domains_found} domain${c.domains_found === 1 ? '' : 's'} found · ${c.filled_free + c.filled_apollo} headcount${c.filled_free + c.filled_apollo === 1 ? '' : 's'} filled (${c.filled_apollo} via Apollo) · ${c.unknown} still unknown · ${c.ambiguous} name${c.ambiguous === 1 ? '' : 's'} ambiguous${c.stopped ? ` · ${c.stopped.message}` : ''}`;
