// homelover-clients-v1 Stage 3 LIVE check - the HomeLover connector end to end, as Jack (ownerSession: a one-time session
// minted with the service key, no email sent). BASE = prod by default (after Render is Live and the connector migration
// ran); BASE=http://localhost:<port> runs it against a local server.js on the real DB.
// SCOPE (declared): 3 metadata GETs, 1 unauthenticated /hl/mcp POST (401), 1 DCR register (a test client on a loopback
// redirect, never opened), authorize + consent GET + consent POST (allow), 3 token POSTs (wrong verifier, code, refresh),
// MCP: initialize, tools/list, check_upside_owned (3 domains picked from the DB: one Upside-owned employer, one HomeLover
// employer, one not in Prospector), add_client on Momentum (same facts it already holds, no domain -> matched by name,
// must answer "updated" and change nothing). The workspace's other connector (/mcp) is probed once to show it refuses an /hl token.
// CAPS: Claude 0 · Apollo 0 · sends 0. WRITES (all removed at the end): 1 hl_oauth_clients row (cascade: its request,
// code, tokens); profiles.last_seen_at (ownerSession restores; sign-in rows kept by rule). restored = every watched sales
// count identical, Momentum's row identical (values + updated_at), hl_oauth_* back to baseline; a mismatch THROWS.
// Runtime < 1 min, hard cap 120 s.
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const BASE = process.env.BASE || 'https://prospector-chtj.onrender.com';
const REDIRECT = 'http://127.0.0.1:53683/callback';
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const timer = setTimeout(() => { console.error('ABORT: over the 120 s cap'); process.exit(2); }, 120000);
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const HL = must(await svc.from('businesses').select('id').ilike('name', 'homelover')).data[0].id;
const WATCH = ['sales_opportunities', 'sales_opportunity_events', 'sales_goals', 'sales_targets', 'sales_source_events', 'sales_client_events', 'sales_client_files', 'sales_week_goals', 'sales_outreach_contacts', 'sales_outreach_events', 'sales_people'];
const count = async (t, biz = true) => { const q = svc.from(t).select('*', { count: 'exact', head: true }); const r = await (biz ? q.eq('business_id', HL) : q); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of WATCH) o[t] = await count(t); for (const t of ['hl_oauth_clients', 'hl_oauth_requests', 'hl_oauth_codes', 'hl_oauth_tokens']) o[t] = await count(t, false); return o; };
const momBefore = must(await svc.from('sales_opportunities').select('*').eq('business_id', HL).ilike('organization', 'momentum%').is('archived_at', null)).data;
if (momBefore.length !== 1 || !momBefore[0].client_status) throw new Error('expected Momentum as a client (Stage 2)');
const mom = momBefore[0];
const before = await snapshot();
log('before', JSON.stringify(before));
const verifier = crypto.randomBytes(48).toString('base64url'), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const form = b => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
let owner, clientId = null, access = null, rpcId = 0;
const mcp = async (method, params = {}, token = access, url = `${BASE}/hl/mcp`) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  return { status: r.status, www: r.headers.get('www-authenticate'), body: await r.json().catch(() => null) };
};
const tool = async (name, args) => { const r = await mcp('tools/call', { name, arguments: args }); const t = r.body?.result?.content?.[0]?.text; return { status: r.status, isError: !!r.body?.result?.isError, data: t ? JSON.parse(t) : r.body }; };

try {
  owner = await ownerSession(svc);
  const cookie = `prospector_at=${encodeURIComponent(owner.session.access_token)}`;
  const api = async (p, init = {}) => { const r = await fetch(`${BASE}${p}`, { ...init, headers: { cookie, ...(init.body ? { 'content-type': 'application/json' } : {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const pr = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/hl/mcp`)).json();
  ok('protected-resource metadata: resource /hl/mcp, issuer /hl', pr.resource === `${BASE}/hl/mcp` && pr.authorization_servers[0] === `${BASE}/hl`, JSON.stringify(pr));
  const as = await (await fetch(`${BASE}/.well-known/oauth-authorization-server/hl`)).json();
  ok('authorization-server metadata (RFC 8414 path form): every endpoint under /hl, S256, public clients', as.issuer === `${BASE}/hl` && as.token_endpoint === `${BASE}/hl/oauth/token` && as.code_challenge_methods_supported.join() === 'S256', JSON.stringify(as).slice(0, 200));
  const hkMeta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  ok('the other connector\'s metadata is untouched (issuer = origin, /oauth/*)', hkMeta.issuer === BASE && hkMeta.token_endpoint === `${BASE}/oauth/token`);
  const anon = await mcp('tools/list', {}, null);
  ok('/hl/mcp without a token: 401 + resource_metadata on /hl', anon.status === 401 && anon.www === `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/hl/mcp"`, anon.www);

  const reg = await fetch(`${BASE}/hl/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Verify script (homelover-clients-v1)', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }) });
  const regBody = await reg.json(); clientId = regBody.client_id || null;
  ok('DCR register: 201, an hlc_ client', reg.status === 201 && /^hlc_/.test(clientId || ''), `${reg.status}`);
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'verify-state', scope: 'hl', resource: `${BASE}/hl/mcp` });
  const az = await fetch(`${BASE}/hl/oauth/authorize?${q}`, { headers: { cookie }, redirect: 'manual' });
  const loc = az.headers.get('location') || '';
  const reqId = new URL(loc, BASE).searchParams.get('id');
  ok('authorize: 302 to /hl/oauth/consent?id=…', az.status === 302 && /^\/hl\/oauth\/consent\?id=/.test(loc), loc.replace(/id=.*/, 'id=<id>'));
  const cg = await api(`/api/hl-oauth/consent/${reqId}`);
  ok(`consent GET: workspace ${cg.body?.workspace_name}, redirect host ${cg.body?.redirect_host}`, cg.status === 200 && cg.body.workspace_name === 'HomeLover' && cg.body.redirect_host === '127.0.0.1:53683');
  const cp = await api(`/api/hl-oauth/consent/${reqId}`, { method: 'POST', body: JSON.stringify({ decision: 'allow' }) });
  const back = new URL(cp.body.redirect);
  ok('consent allow: back to the loopback with code + state + iss /hl', back.searchParams.get('state') === 'verify-state' && back.searchParams.get('iss') === `${BASE}/hl` && !!back.searchParams.get('code'));
  const code = back.searchParams.get('code');
  const wrong = await (await fetch(`${BASE}/hl/oauth/token`, form({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: crypto.randomBytes(48).toString('base64url') }))).json();
  ok('token with the wrong PKCE verifier: invalid_grant', wrong.error === 'invalid_grant');
  const tok = await (await fetch(`${BASE}/hl/oauth/token`, form({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }))).json();
  ok('token: Bearer pair, 1 h', tok.token_type === 'Bearer' && tok.expires_in === 3600 && !!tok.refresh_token);
  const rf = await (await fetch(`${BASE}/hl/oauth/token`, form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tok.refresh_token }))).json();
  ok('refresh: a new pair, rotated', !!rf.access_token && rf.refresh_token !== tok.refresh_token);
  access = rf.access_token;
  const stored = must(await svc.from('hl_oauth_tokens').select('token_hash, business_id').eq('client_id', clientId)).data;
  ok('tokens stored hashed only, scoped to HomeLover', stored.length === 4 && stored.every(t => /^[0-9a-f]{64}$/.test(t.token_hash) && t.business_id === HL) && !JSON.stringify(stored).includes(access));
  const hkProbe = await mcp('tools/list', {}, access, `${BASE}/mcp`);
  ok('the other connector (/mcp) refuses an /hl token (401)', hkProbe.status === 401);

  const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify', version: '0' } });
  ok(`initialize: ${init.body?.result?.serverInfo?.name}`, init.status === 200 && init.body.result.serverInfo.name === 'homelover-prospector');
  const list = await mcp('tools/list', {});
  const names = list.body?.result?.tools?.map(t => t.name) || [];
  ok(`tools/list: ${names.join(', ')}`, names.join() === 'add_client,mark_signed,add_lookalikes,check_upside_owned');

  const up = must(await svc.from('sales_opportunities').select('domain').eq('business_id', HL).eq('owner_team', 'upside').not('domain', 'is', null).is('archived_at', null).limit(1)).data[0]?.domain;
  const hlOwn = must(await svc.from('sales_opportunities').select('domain').eq('business_id', HL).eq('owner_team', 'homelover').not('domain', 'is', null).is('archived_at', null).limit(1)).data[0]?.domain;
  const unknown = `not-in-prospector-${Date.now().toString(36)}.example`;
  const cu = await tool('check_upside_owned', { domains: [up, hlOwn, unknown].filter(Boolean) });
  const got = (cu.data.results || []).map(r => `${r.domain}: upside_owned=${r.upside_owned} joint=${r.joint} in_prospector=${r.in_prospector}`);
  ok(`check_upside_owned (read-only): ${got.join(' | ')}`, !cu.isError && cu.data.results.length === 3 && cu.data.results[0].upside_owned === true && cu.data.results[1].upside_owned === false && cu.data.results[1].in_prospector && cu.data.results[2].in_prospector === false);

  const ac = await tool('add_client', {
    company_name: mom.organization, status: mom.client_status, eligible_now: mom.eligible_now, eligible_added: mom.eligible_added, eligible_added_note: mom.eligible_added_note,
    expected_signing_date: mom.expected_signing_date, launch_date: mom.expected_launch, source_type: 'partner', referred_by_partner: 'HUB International',
  });
  const out = ac.data;
  ok(`add_client on Momentum: result ${out.result}, unchanged ${out.unchanged}, matched by ${out.matched_by}, stage ${out.stage}, status ${out.status}, eligible ${out.eligible_now} (+${out.eligible_added}), launch ${out.launch_date}, contacts_suppressed ${out.contacts_suppressed}, todo_id ${out.todo_id}, warnings [${(out.warnings || []).join(', ')}]`,
    !ac.isError && out.result === 'updated' && out.unchanged === true && out.company_id === mom.id && out.todo_id === null && !(out.warnings || []).length);
  ok('replies carry no email address', !/[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i.test(JSON.stringify([cu.data, out])));
  const momAfter = must(await svc.from('sales_opportunities').select('*').eq('id', mom.id).single()).data;
  ok('Momentum\'s row identical after add_client (values + updated_at)', JSON.stringify(momAfter) === JSON.stringify(mom));
  ok('0 Claude / 0 Apollo / 0 sends (no tool reaches them; nothing counted)', true);
} catch (e) {
  ok('run', false, e.stack || e.message);
} finally {
  if (clientId) await svc.from('hl_oauth_clients').delete().eq('client_id', clientId);
  if (owner) log(await owner.release());
}
const after = await snapshot();
log('after', JSON.stringify(after));
clearTimeout(timer);
const moved = Object.keys(before).filter(t => before[t] !== after[t]);
console.log(`\n${checks.filter(c => c.pass).length}/${checks.length} passed · ${Math.round((Date.now() - T0) / 1000)} s`);
if (moved.length) throw new Error(`restored: NO - ${moved.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')}`);
console.log('restored: yes (the test OAuth client and its request / code / tokens deleted; every watched count identical; Momentum unchanged)');
process.exit(checks.every(c => c.pass) ? 0 : 1);
