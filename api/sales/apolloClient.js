// The only file that reads APOLLO_API_KEY or calls the Apollo API
// (COST GUARDRAILS 1-4). Never log, print, return, or commit the key -
// the key itself is never interpolated into any error message or console
// line below, on purpose.

const BASE_URL = 'https://api.apollo.io/api/v1';
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_PAGES_PER_CALL = 10;

// Exact method+path pairs only - confirmed against Apollo's real docs in
// Stage 0/the audit, not guessed. Anything else throws before any request
// is made. Every enrich/match/write endpoint is deliberately absent.
const ALLOWED_CALLS = [
  { method: 'POST', path: '/emailer_campaigns/search' },
  { method: 'GET', path: '/email_accounts' },
  { method: 'POST', path: '/accounts/search' },
  { method: 'POST', path: '/contacts/search' },
  // sales-hot-prospects-v1 - both 0 credits, confirmed live in Stage 1.
  { method: 'GET', path: '/emailer_messages/search' },
  { method: 'GET', path: '/emailer_messages/:id/activities', pattern: /^\/emailer_messages\/[0-9a-f]{24}\/activities$/ },
  // signals-v1 Stage 4 - proven in Stages 2b/2c. api_profile is the credit
  // balance (0 credits); mixed_companies/search may cost 1 credit and is only
  // ever the website-visitor search (see visitorOnly below).
  { method: 'GET', path: '/users/api_profile' },
  { method: 'POST', path: '/mixed_companies/search' },
  // visitor-to-record-v1 V2b - a people SEARCH (0 credits, Stage 0 call 2), only ever scoped to one company's domain
  // or the website-visitor filter (see peopleScoped). Never a reveal, never a general people search.
  { method: 'POST', path: '/mixed_people/api_search' },
  // visitor-to-record-v1 V2a (Oct 27 ruling) - "Get a List of All Lists": GET, no parameters, 0 credits, read-only
  // (docs.apollo.io/reference/get-a-list-of-all-lists; needs a key scoped to api/v1/labels/index or a master key).
  // Only ever used to resolve ONE list id by its exact name; the id is cached in sales_settings after the first call.
  { method: 'GET', path: '/labels' },
  // FIX headcount-auto-v1 REV2 H4 - Organization Enrichment: ONE domain in the query, never a name (domainOnly below).
  // Measured 0 credits on Oct 27 (the pricing page says 1): the fill stops on the first call whose delta is not 0.
  { method: 'GET', path: '/organizations/enrich' },
];

// A mixed_companies call without the visitor filter would be a general
// company search - refused before any request. Same for mixed_people/api_search
// without a company domain or the visitor filter. FIX headcount-auto-v1 REV2 H3a:
// the second guarded mode on mixed_companies - nameOnly = ONE exact company name,
// no visitor filter, per_page <= 3 (the domain finder; 0 credits measured).
// A body with neither filter is still refused.
const hasList = v => Array.isArray(v) && v.length > 0;
export const nameOnly = body => typeof body?.q_organization_name === 'string' && body.q_organization_name.trim().length > 0 && !hasList(body?.website_visitors_from_domains) && (body.per_page ?? 100) <= 3;
const visitorOnly = (path, body) => path !== '/mixed_companies/search' || hasList(body?.website_visitors_from_domains) || nameOnly(body);
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
export const domainOnly = query => { const q = new URLSearchParams(String(query || '')); const keys = [...q.keys()]; return keys.length === 1 && keys[0] === 'domain' && DOMAIN_RE.test(q.get('domain') || ''); };
const peopleScoped = (path, body) => path !== '/mixed_people/api_search' || hasList(body?.q_organization_domains) || hasList(body?.website_visitors_from_domains);

// Returns the matched entry's canonical path, so per-message paths are
// counted under one endpoint key instead of one key per message id.
function allowedPath(method, path) {
  const entry = ALLOWED_CALLS.find(a => a.method === method && (a.pattern ? a.pattern.test(path) : a.path === path));
  return entry ? entry.path : null;
}

export class CallCapError extends Error {
  constructor(path) {
    super(`per-run Apollo call cap reached before calling ${path}`);
    this.name = 'CallCapError';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function backoffMs(attempt) {
  return Math.min(2000 * 2 ** attempt, 15000);
}

// ctx.callCounter = { count, max } and ctx.endpointCounts = { path: n }.
// sync.js creates ctx once per run and threads it through every adapter -
// this is the single real enforcement point for guardrails 2-4.
export async function apolloRequest({ method, path, query, body, ctx }) {
  const countKey = allowedPath(method, path);
  if (!countKey) {
    throw new Error(`apolloClient: ${method} ${path} is not on the allowlist - refusing before any request`);
  }
  if (!visitorOnly(countKey, body)) {
    throw new Error('apolloClient: mixed_companies/search needs website_visitors_from_domains, or one q_organization_name with per_page <= 3 - refusing before any request');
  }
  if (!peopleScoped(countKey, body)) {
    throw new Error('apolloClient: mixed_people/api_search needs q_organization_domains (one company) - refusing before any request');
  }
  if (countKey === '/organizations/enrich' && !domainOnly(query)) {
    throw new Error('apolloClient: organizations/enrich takes exactly one domain= (never a name) - refusing before any request');
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (ctx.callCounter.count >= ctx.callCounter.max) {
      throw new CallCapError(path);
    }

    const key = process.env.APOLLO_API_KEY;
    if (!key) throw new Error('apolloClient: APOLLO_API_KEY is not set');

    ctx.callCounter.count += 1;
    ctx.endpointCounts[countKey] = (ctx.endpointCounts[countKey] || 0) + 1;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(BASE_URL + path + (query ? `?${query}` : ''), {
        method,
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new Error(`apollo ${method} ${path} failed after ${MAX_RETRIES} retries: ${err.message}`);
    }
    clearTimeout(timeoutHandle);

    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`apollo ${method} ${path} -> ${res.status}`);
      if (attempt < MAX_RETRIES) {
        const retryAfterHeader = res.headers.get('retry-after');
        const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : backoffMs(attempt);
        await sleep(waitMs);
        continue;
      }
      throw lastErr;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = (json && json.error) || 'unknown error';
      throw new Error(`apollo ${method} ${path} -> ${res.status}: ${detail}`);
    }
    return json;
  }
  throw lastErr;
}

// Bounded page loop - at most MAX_PAGES_PER_CALL pages, at the real
// confirmed max per_page of 100 (Stage 0). Stops early once total_pages is
// reached. A CallCapError from apolloRequest propagates straight out -
// sync.js is what decides how to handle a cap hit mid-page.
export async function apolloPaginate({ method, path, body, ctx, extractRecords, extractPagination }) {
  let page = 1;
  let all = [];
  for (let i = 0; i < MAX_PAGES_PER_CALL; i++) {
    const json = await apolloRequest({
      method, path, ctx,
      body: { ...body, page, per_page: 100 },
    });
    all = all.concat(extractRecords(json));
    const pagination = extractPagination(json);
    if (!pagination || page >= pagination.total_pages) break;
    page += 1;
  }
  return all;
}

// The credit balance (0 credits): one GET per read, counted on ctx like every other call.
export async function apolloBalance(ctx) {
  const json = await apolloRequest({ method: 'GET', path: '/users/api_profile', query: 'include_credit_usage=true', ctx });
  const n = json?.num_credits_remaining;
  if (typeof n !== 'number') throw new Error('Apollo credit balance unreadable');
  return n;
}
