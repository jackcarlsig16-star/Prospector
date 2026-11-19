// actions-v2 Stage 1 - ONE request per new route through the REAL wiring: the server.js this script spawns on
// localhost, signed in as the platform owner (ownerSession: a magic-link token, no email sent; released at the end
// with last_seen_at restored - the sign-in row in auth_events is kept). Read-only: GET goals/today, GET
// goals/today/fixes, and POST goals/today/:key/work with an UNKNOWN verb, which the route refuses with 400 before any
// model call. Declared: 3 requests, est. 20 s, cap 90 s. 0 writes to sales tables, 0 Claude, 0 Apollo. Never prints a body.
// Usage: node scripts/verify/actions-v2-stage1-wiring.mjs
import { createRequire } from 'module';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
import { keysOf } from './lib/realWiring.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
let owner = null, srv = null, bad = 0;
const done = async code => { if (srv) srv.kill(); if (owner) console.log(await owner.release()); process.exit(code); };
setTimeout(() => { console.log('CAP: 90 s'); done(1); }, 90000).unref();
const ok = (label, pass, detail) => { if (!pass) bad++; console.log(`${pass ? 'ok  ' : 'FAIL'} ${label} · ${detail}`); };
try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 80; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const req = async (p, init = {}) => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { ...init, headers: { cookie, 'content-type': 'application/json' } }); return { code: r.status, body: await r.json().catch(() => null) }; };
  const t = await req('/goals/today?owner=me');
  ok('GET goals/today?owner=me', t.code === 200 && t.body?.groups?.length === 5, `${t.code} · keys ${keysOf(t.body)} · rows ${t.body?.groups?.reduce((n, g) => n + g.n, 0)}`);
  const f = await req('/goals/today/fixes');
  ok('GET goals/today/fixes', f.code === 200 && Array.isArray(f.body?.items), `${f.code} · keys ${keysOf(f.body)} · n ${f.body?.n}`);
  const key = t.body?.groups?.flatMap(g => g.rows)[0]?.key;
  const w = await req(`/goals/today/${encodeURIComponent(key)}/work`, { method: 'POST', body: JSON.stringify({ verb: 'not_a_verb' }) });
  ok('POST goals/today/:key/work (unknown verb: refused before any call)', w.code === 400 && /verb must be one of/.test(w.body?.error || ''), `${w.code} · keys ${keysOf(w.body)}`);
  const anon = await fetch(`${BASE}/api/sales/${HL}/goals/today`);
  ok('no session', anon.status === 401 || anon.status === 403, String(anon.status));
} catch (e) { bad++; console.log('FAIL', e.message); }
console.log(`${bad ? 'FAILED' : '4/4'} · writes to sales tables: 0 · Claude 0 · Apollo 0`);
await done(bad ? 1 : 0);
