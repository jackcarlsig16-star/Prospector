// Builds Gmail search queries scoped to a specific account.
//
// Resolves scope in priority order, free-tier-safe by construction:
//   1. PERSONAS    — exact contact-email allowlist (most precise)
//   2. DOMAIN      — company domain, IF non-free-tier (gmail/yahoo/etc. skipped)
//   3. NAME        — quoted distinctive account name as fallback
//   4. NONE        — return null query rather than dump unrelated noise
//
// Callers consult `scope` to surface scope rationale in UI ("scoped to 3
// contacts" vs "domain match" vs "name match" vs "no reliable scope").
//
// Replaces 4 separate domain-only inline queries (CallPrepModal,
// threadIndexer, weekAhead) that all silently flooded the inbox for any
// account on a free-tier domain (e.g. a founder using @gmail.com).

const FREE_TIER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com',
  'proton.me', 'protonmail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
]);

export function extractDomain(acc) {
  const raw = (acc?.web || '').toLowerCase().trim();
  if (!raw) return null;
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '')
            .split('/')[0].split('?')[0] || null;
}

// Reject obviously-generic names that would over-match as a quoted fallback.
function isGenericName(name) {
  if (!name) return true;
  const n = name.toLowerCase().trim();
  const generic = new Set(['test', 'demo', 'account', 'company', 'inc', 'llc']);
  if (generic.has(n)) return true;
  // Strip common corporate suffixes; remaining core must be distinctive.
  const core = n.replace(/\b(inc|llc|co|corp|ltd|limited|gmbh|sa|sas)\.?\b/g, '').trim();
  return core.length < 4;
}

/**
 * @param acc           account record
 * @param dateClause    e.g. " newer_than:14d" — appended raw; caller responsible for the leading space
 * @param sentOnly      when true, prepends "in:sent " and uses `to:` only (drops the `from:` side)
 * @returns { q, scope, detail }
 *   q       — full query string, or null if no reliable scope
 *   scope   — 'personas' | 'domain' | 'name' | 'none'
 *   detail  — human-readable rationale (e.g. "3 known contacts", "lenderdock.com", "no reliable scope")
 */
export function buildAccountEmailQuery(acc, { dateClause = '', sentOnly = false } = {}) {
  const sentPrefix = sentOnly ? 'in:sent ' : '';

  // 1. PERSONAS — exact emails, free-tier-safe by construction
  const personaEmails = (acc?.personas || [])
    .map(p => (p?.email || '').trim().toLowerCase())
    .filter(e => e && e.includes('@'));
  if (personaEmails.length) {
    const list = personaEmails.join(' OR ');
    const q = sentOnly
      ? `${sentPrefix}to:(${list})${dateClause}`
      : `(from:(${list}) OR to:(${list}))${dateClause}`;
    return { q, scope: 'personas', detail: `${personaEmails.length} known contact${personaEmails.length === 1 ? '' : 's'}` };
  }

  // 2. DOMAIN — only when it's a real (non-free-tier) company domain
  const domain = extractDomain(acc);
  if (domain && !FREE_TIER_DOMAINS.has(domain)) {
    const q = sentOnly
      ? `${sentPrefix}to:${domain}${dateClause}`
      : `(from:${domain} OR to:${domain})${dateClause}`;
    return { q, scope: 'domain', detail: domain };
  }

  // 3. NAME — distinctive account name as a quoted fallback
  const name = (acc?.name || '').trim();
  if (name.length >= 5 && !isGenericName(name)) {
    const q = `${sentPrefix}"${name}"${dateClause}`;
    return { q, scope: 'name', detail: `name match "${name}"` };
  }

  // 4. NONE — better to return nothing than scrape unrelated noise
  return { q: null, scope: 'none', detail: 'no reliable scope' };
}

export { FREE_TIER_DOMAINS };
