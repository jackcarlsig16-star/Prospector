// Hunter.io client wrappers — cache-first, never hit the API twice for the
// same lookup within TTL. All real key material lives server-side in env;
// the client only ever touches the proxied /api/hunter/* routes.

const CACHE_KEY = "prospector_hunter_cache";
const FIND_TTL_MS   = 30 * 24 * 60 * 60 * 1000; // 30 days
const DOMAIN_TTL_MS =  7 * 24 * 60 * 60 * 1000; // 7 days

const norm = s => String(s || "").toLowerCase().trim();

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function saveCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}
function readEntry(key, ttl) {
  const cache = loadCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - (entry.cachedAt || 0) > ttl) return null;
  return entry.value;
}
function writeEntry(key, value) {
  const cache = loadCache();
  cache[key] = { value, cachedAt: Date.now() };
  saveCache(cache);
}

// Normalize a website / URL into a bare domain for Hunter
export function extractHunterDomain(input) {
  if (!input) return null;
  const raw = String(input).toLowerCase().trim();
  if (!raw) return null;
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0] || null;
}

export async function findEmail({ domain, firstName, lastName }) {
  const d = extractHunterDomain(domain);
  const fn = norm(firstName);
  const ln = norm(lastName);
  if (!d || !fn || !ln) return { email: null, error: "missing_args" };

  const key = `find|${fn}|${ln}|${d}`;
  const cached = readEntry(key, FIND_TTL_MS);
  if (cached) return { ...cached, _cached: true };

  try {
    const r = await fetch("/api/hunter/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: d, firstName: fn, lastName: ln }),
    });
    const data = await r.json();
    if (!r.ok) return { email: null, error: data?.error || `http_${r.status}` };
    writeEntry(key, data);
    return data;
  } catch (err) {
    return { email: null, error: err.message };
  }
}

export async function searchDomain({ domain, department, limit }) {
  const d = extractHunterDomain(domain);
  if (!d) return { contacts: [], error: "missing_domain" };

  const key = `domain|${d}|${norm(department) || "any"}|${limit || 5}`;
  const cached = readEntry(key, DOMAIN_TTL_MS);
  if (cached) return { ...cached, _cached: true };

  try {
    const r = await fetch("/api/hunter/domain-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: d, department: department || undefined, limit: limit || 5 }),
    });
    const data = await r.json();
    if (!r.ok) return { contacts: [], error: data?.error || `http_${r.status}` };
    writeEntry(key, data);
    return data;
  } catch (err) {
    return { contacts: [], error: err.message };
  }
}

export async function getHunterAccount() {
  try {
    const r = await fetch("/api/hunter/account");
    const data = await r.json();
    if (!r.ok) return { error: data?.error || `http_${r.status}` };
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

export function clearHunterCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

// Return all cached domain-search contacts for the given website/URL,
// sorted by confidence (highest first). Internal helper.
function getCachedContactsSorted(websiteOrDomain) {
  const d = extractHunterDomain(websiteOrDomain);
  if (!d) return [];
  const cache = loadCache();
  const byKey = new Map();
  for (const [key, entry] of Object.entries(cache)) {
    if (!key.startsWith(`domain|${d}|`)) continue;
    const contacts = entry?.value?.contacts || [];
    for (const c of contacts) {
      const id = `${c.email || ''}|${c.firstName || ''}|${c.lastName || ''}`;
      const existing = byKey.get(id);
      if (!existing || (c.confidence || 0) > (existing.confidence || 0)) byKey.set(id, c);
    }
  }
  return [...byKey.values()].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

// Return the highest-confidence contact from any cached domain-search for the
// given website/URL. Used by the Outbound flow to pre-populate the frontier
// entry's topContact without hitting Hunter again.
export function getCachedTopContact(websiteOrDomain) {
  return getCachedContactsSorted(websiteOrDomain)[0] || null;
}

// Up to four alternate contacts beyond the top one — for the Outbound card's
// "Use this contact" swap row.
export function getCachedAlternateContacts(websiteOrDomain, max = 4) {
  return getCachedContactsSorted(websiteOrDomain).slice(1, 1 + max);
}
