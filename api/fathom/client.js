import crypto from 'crypto';
import { tokenSealer } from '../lib/tokenCrypto.js';

// fathom-notes-v1 - the Fathom External API (developers.fathom.ai, read Nov 19-20 2026). One key per member
// (X-Api-Key). Limits: 60 calls / 60 s; 30 / 60 s for /meetings with a summary or transcript. The key is never logged.

const BASE = 'https://api.fathom.ai/external/v1';
export const fathomDeps = { fetch: (...a) => fetch(...a) };
export const sealer = tokenSealer('FATHOM_TOKEN_KEY');

async function call(key, path, { method = 'GET', query = null, body = null } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null))}` : '';
  const res = await fathomDeps.fetch(`${BASE}${path}${qs}`, {
    method, headers: { 'X-Api-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const why = res.status === 401 || res.status === 403 ? 'Fathom refused the API key' : res.status === 429 ? 'Fathom rate limit reached - try again in a minute' : `Fathom answered ${res.status}`;
    throw Object.assign(new Error(why), { fathomStatus: res.status, retryAfter: Number(res.headers?.get?.('retry-after')) || null });
  }
  return res.json();
}

// { items, next_cursor, limit }. full: with the summary, transcript and action items (the heavier rate limit).
export const listMeetings = (key, { cursor = null, createdAfter = null, full = false } = {}) => call(key, '/meetings', {
  query: { cursor, created_after: createdAfter, ...(full ? { include_summary: true, include_transcript: true, include_action_items: true } : {}) },
});
// 201 { id, url, secret: "whsec_…", created_at, … } - the secret is returned here and nowhere else.
export const createWebhook = (key, destinationUrl) => call(key, '/webhooks', {
  method: 'POST',
  body: { destination_url: destinationUrl, triggered_for: ['my_recordings'], include_transcript: true, include_summary: true, include_action_items: true, include_crm_matches: false },
});
export async function deleteWebhook(key, id) {
  try { await call(key, `/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { if (e.fathomStatus !== 404) throw e; }
}

// Standard Webhooks: HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, key = base64 of the secret after "whsec_",
// the header a space-delimited list of "v1,<base64>"; 5 minutes of clock tolerance; constant-time compare.
const TOLERANCE_S = 300;
export function verifySignature({ secret, id, timestamp, signature, rawBody, now = Date.now() }) {
  if (!secret || !id || !signature || typeof rawBody !== 'string' || !/^\d{1,12}$/.test(String(timestamp || ''))) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const want = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return String(signature).split(' ').some(part => {
    const got = Buffer.from(part.slice(part.indexOf(',') + 1), 'base64');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  });
}
