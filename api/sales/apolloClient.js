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
// is made. /mixed_companies/search (Organization Search, 1 credit/page)
// and every enrich/match/write endpoint are deliberately absent.
const ALLOWED_CALLS = [
  { method: 'POST', path: '/emailer_campaigns/search' },
  { method: 'GET', path: '/email_accounts' },
  { method: 'POST', path: '/accounts/search' },
  { method: 'POST', path: '/contacts/search' },
];

function isAllowed(method, path) {
  return ALLOWED_CALLS.some(a => a.method === method && a.path === path);
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
export async function apolloRequest({ method, path, body, ctx }) {
  if (!isAllowed(method, path)) {
    throw new Error(`apolloClient: ${method} ${path} is not on the allowlist - refusing before any request`);
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (ctx.callCounter.count >= ctx.callCounter.max) {
      throw new CallCapError(path);
    }

    const key = process.env.APOLLO_API_KEY;
    if (!key) throw new Error('apolloClient: APOLLO_API_KEY is not set');

    ctx.callCounter.count += 1;
    ctx.endpointCounts[path] = (ctx.endpointCounts[path] || 0) + 1;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(BASE_URL + path, {
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
