// hkos-data-foundation-v1 Stage 3 - the browser's door to /api/hk/:businessId/*. JSON in, JSON out; an error body's
// `error` becomes the thrown message, a 409 keeps the server's verdict on the error (err.verdict) and a 422 its lint
// problems (err.problems).
export async function hkFetch(businessId, path, { method = 'GET', body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
  const res = await fetch(`/api/hk/${businessId}${path}${qs}`, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) { const err = new Error(data?.error || `Request failed (${res.status})`); err.status = res.status; err.verdict = data?.verdict || null; err.problems = data?.problems || null; err.body = data; throw err; }
  return data;
}
export const hkGet = (b, path, query) => hkFetch(b, path, { query });
export const hkPost = (b, path, body) => hkFetch(b, path, { method: 'POST', body });
export const hkPatch = (b, path, body) => hkFetch(b, path, { method: 'PATCH', body });
export const hkDelete = (b, path) => hkFetch(b, path, { method: 'DELETE' });
