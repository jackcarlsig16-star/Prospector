// partner-360-v1 Stage 2 - a partner's web domains, the key that links it
// to Apollo accounts. Shared by the API (suggestions, matching, the Apollo
// CSV) and the drop-down. Suggestions are never stored: a partner_domains
// row exists only once someone confirms, adds or dismisses one.

// Same shape the table's CHECK enforces, plus a real TLD (2+ letters).
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export const DOMAIN_SOURCES = { manual: 'Added', sources: 'Sheet', apollo: 'Apollo' };

export function normalizeDomain(input) {
  if (typeof input !== 'string') return null;
  let t = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  t = t.split(/[/?#\s(),;:]/)[0].replace(/^www\./, '').replace(/\.+$/, '');
  return t.length <= 253 && HOST_RE.test(t) ? t : null;
}

// The sheet's sources column: "justworks.com/about; justworks.com/press"
// or "esusurent.com; nationalmortgagenews.com (15K mortgages; Series C)".
// Every segment's leading token that is a hostname, in order, once.
export function parseDomainsFromSources(sources) {
  if (typeof sources !== 'string') return [];
  const out = [];
  for (const seg of sources.split(/[;\n]+/)) {
    const d = normalizeDomain(seg.trim().split(/\s+/)[0] || '');
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

// The sheet lists the partner's own site first; the rest are press links.
export const ownDomainFromSources = sources => parseDomainsFromSources(sources)[0] || null;

const LEGAL_SUFFIX = /\b(inc|llc|corp|corporation|co|ltd|limited|plc|group)\b/g;
export function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(LEGAL_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}

const accountDomain = a => normalizeDomain(a.domain || '');

// Apollo accounts (the latest accounts snapshot) that are this partner:
// exact host on any of the given domains, or the same normalized name.
export function matchApolloAccounts({ name, domains = [] }, accounts) {
  const wanted = new Set(domains.map(normalizeDomain).filter(Boolean));
  const key = normalizeName(name);
  const byDomain = [], byName = [];
  for (const a of accounts || []) {
    const d = accountDomain(a);
    if (d && wanted.has(d)) byDomain.push(a);
    if (key && normalizeName(a.name) === key) byName.push(a);
  }
  return { byDomain, byName };
}

const pick = a => (a ? { id: a.id, name: a.name, domain: accountDomain(a) } : null);

// What the drop-down offers for a partner that has no row for the domain
// yet: the sheet's own domain (source 'sources'), and the domain of every
// Apollo account with the partner's name (source 'apollo'). apollo_account
// is set whenever Apollo already has that exact domain. both = the sheet
// and a name-matched Apollo account agree on the host: two independent
// signals, so bulk review can confirm it without a look.
export function suggestionsFor(partner, rows, accounts) {
  const taken = new Set((rows || []).map(r => r.domain));
  const own = ownDomainFromSources(partner.sources);
  const { byDomain, byName } = matchApolloAccounts({ name: partner.name, domains: own ? [own] : [] }, accounts);
  const out = [];
  if (own && !taken.has(own)) out.push({ domain: own, source: 'sources', apollo_account: pick(byDomain.find(a => accountDomain(a) === own)), both: byName.some(a => accountDomain(a) === own) });
  for (const a of byName) {
    const d = accountDomain(a);
    if (d && !taken.has(d) && !out.some(s => s.domain === d)) out.push({ domain: d, source: 'apollo', apollo_account: pick(a), both: false });
  }
  return out;
}

export const SUGGESTION_BADGE = s => (s.both ? 'Both' : DOMAIN_SOURCES[s.source] || s.source);

// Bulk review: every pending suggestion in the workspace, one row each,
// partners in name order.
export function pendingSuggestions(partners, rowsByGoal, accounts) {
  const out = [];
  for (const p of [...partners].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const s of suggestionsFor(p, rowsByGoal[p.id] || [], accounts)) out.push({ goal_id: p.id, partner_name: p.name, domain: s.domain, source: s.source, both: s.both });
  }
  return out;
}

export const confirmedDomains = rows => (rows || []).filter(r => r.confirmed).map(r => r.domain);
export const primaryDomain = rows => { const c = (rows || []).filter(r => r.confirmed); return (c.find(r => r.is_primary) || c[0])?.domain || null; };

// The Apollo account this partner IS, if any: a confirmed domain Apollo
// has, else the same name. Partners with one are not exported.
export function apolloAccountFor(partner, rows, accounts) {
  const { byDomain, byName } = matchApolloAccounts({ name: partner.name, domains: confirmedDomains(rows) }, accounts);
  return pick(byDomain[0] || byName[0] || null);
}

// "Export to Apollo (CSV)": partners with a confirmed domain that aren't
// Apollo accounts. ownerName: user id -> display name.
export function exportCandidates(partners, rowsByGoal, accounts, ownerName = () => '') {
  const out = [];
  for (const p of partners) {
    const rows = rowsByGoal[p.id] || [];
    const domain = primaryDomain(rows);
    if (!domain || apolloAccountFor(p, rows, accounts)) continue;
    out.push({ name: p.name, domain, category: (p.category || '').replace(/^\d+\.\s*/, ''), tier: p.tier || '', owner: p.owner_user_id ? ownerName(p.owner_user_id) || '' : '' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const APOLLO_CSV_COLUMNS = ['Company Name', 'Website', 'Category', 'Tier', 'Owner'];
const cell = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function buildApolloCsv(candidates) {
  const lines = [APOLLO_CSV_COLUMNS.join(',')];
  for (const c of candidates) lines.push([c.name, c.domain, c.category, c.tier, c.owner].map(cell).join(','));
  return lines.join('\r\n') + '\r\n';
}
