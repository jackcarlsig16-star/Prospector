// AUDIT homelover-data-model-v1 - shared guard for the audit's read-only parts. 0 writes, 0 Claude, 0 Apollo:
// the Apollo / Anthropic keys are removed from the process before any module loads, every fetch that is not a
// GET / HEAD to the Supabase host (or the audit_table_schema RPC, a read) throws, and requests + bytes are counted.
import { createRequire } from 'module';
import path from 'path';
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
delete process.env.APOLLO_API_KEY; delete process.env.ANTHROPIC_API_KEY;
const { createClient } = require('@supabase/supabase-js');
const host = new URL(process.env.SUPABASE_URL).host;
export const net = { requests: 0, bytes: 0, refused: [], log: [], trace: false };
const realFetch = globalThis.fetch;
const guarded = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
  const readRpc = method === 'POST' && /\/rest\/v1\/rpc\/audit_table_schema$/.test(url.pathname);
  if (url.host !== host || !(['GET', 'HEAD'].includes(method) || readRpc)) { net.refused.push(`${method} ${url.host}${url.pathname}`); throw new Error(`audit guard: refused ${method} ${url.host}${url.pathname}`); }
  net.requests += 1;
  const a = performance.now();
  const res = await realFetch(input, init);
  if (!net.trace) { const len = Number(res.headers.get('content-length')); if (len) net.bytes += len; return res; }
  // trace mode: the body is read once here (rows = the JSON array's length) and handed on as a new Response.
  const text = method === 'HEAD' ? '' : await res.text();
  let rows = 0; try { const j = JSON.parse(text); rows = Array.isArray(j) ? j.length : j ? 1 : 0; } catch {}
  net.bytes += text.length;
  net.log.push({ table: url.pathname.replace(/^\/rest\/v1\//, ''), method, rows, bytes: text.length, ms: Math.round(performance.now() - a) });
  return new Response(method === 'HEAD' || res.status === 204 ? null : text, { status: res.status, statusText: res.statusText, headers: res.headers });
};
globalThis.fetch = guarded;
export const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, global: { fetch: guarded } });
export const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
export const cap = s => setTimeout(() => { console.log(`CAP: ${s} s - aborted`); process.exit(1); }, s * 1000).unref();
export const median3 = async fn => { const t = []; let out; for (let i = 0; i < 3; i++) { const a = performance.now(); out = await fn(); t.push(performance.now() - a); } t.sort((x, y) => x - y); return { ms: Math.round(t[1]), all: t.map(Math.round), out }; };
export const footer = () => console.log(`\nnet: ${net.requests} requests · ~${(net.bytes / 1024).toFixed(0)} KB (content-length where sent) · refused ${net.refused.length}${net.refused.length ? ' ' + net.refused.join(', ') : ''} · writes 0 · Claude 0 · Apollo 0`);
