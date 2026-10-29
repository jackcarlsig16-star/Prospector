// hkos-mcp-connector-v1 Stage 3 LIVE check - the Claude connector end to end against PROD, as Jack (ownerSession: a
// one-time magic-link session minted with the service key, no email sent, no browser click needed).
// SCOPE (declared): prod - 2 metadata GETs, 1 unauthenticated /mcp POST (401), 1 DCR register (test client on a
// loopback redirect, never opened), 1 authorize + consent GET + consent POST (allow), 3 token POSTs (wrong verifier,
// code, refresh), MCP: initialize, tools/list, hk_settings, hk_due, hk_check (2 real names, NO domains -> no live
// mailbox search), hk_brand (1), hk_draft_save (1, lint-failing body on a brand Jack owns, picked without a domain so the
// warm search never runs), 1 POST /brands/check (the Add-brand comparison, same 2 names, no domains), GET /connector,
// 1 revoke POST, 2 after-revoke probes. Browser: the local build's server.js against the real DB, GET-only (every
// non-GET aborted): Settings › Connections at 1440 + 390, contrast on the connector card, Activity's connector rows,
// a Viewer pass by intercept (the shell answer rewritten to role viewer).
// CAPS: Claude 0 · Apollo 0 · Gmail API 0 expected (cap 2 calls = 10 quota units if the picked brand turns out to have a
// domain) · Gmail drafts created 0 (hk_touches count must not move).
// WRITES (all removed by id at the end): 1 hk_oauth_clients row (cascade: its request, code, tokens), the hk_events
// rows the tool calls + revoke log (connector.* by Jack since the start), hk_member_prefs.last_seen_at (restored),
// profiles.last_seen_at (ownerSession restores; sign-in rows kept by rule).
// restored = every HumanKind count identical + hk_oauth_* counts back to baseline + the draft brand row unchanged; any
// count error THROWS -> "restored: NO", exit 1. Runtime ~1-2 min, hard cap 240 s.
// Usage: npm run build && node scripts/verify/hkos-mcp-connector-v1-stage3.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { measureScript, summarize } = require('./lib/contrastMeasure.cjs');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'hkos-mcp-connector-v1');
const PROD = 'https://prospector-chtj.onrender.com', PORT = 4011, LOCAL = `http://localhost:${PORT}`;
const REDIRECT = 'http://127.0.0.1:53682/callback';
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_events', 'hk_settings', 'hk_member_prefs', 'hk_sync_runs', 'hk_job_runs'];
const OAUTH_TABLES = ['hk_oauth_clients', 'hk_oauth_requests', 'hk_oauth_codes', 'hk_oauth_tokens'];
const LINT_FAIL_BODY = 'Hi there - we would love to partner — Thoughts?';
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now(), START = new Date().toISOString();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const num = (t, r) => { if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || 'no count'}`); return r.count; };
const now = new Date();
if (now.getHours() % 6 === 5 && now.getMinutes() >= 55 || now.getHours() % 6 === 0 && now.getMinutes() < 3) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }

const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = num(t, await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)); for (const t of OAUTH_TABLES) o[t] = num(t, await svc.from(t).select('*', { count: 'exact', head: true })); return o; };
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;

// The draft target: a live brand Jack owns, prospect, owner clear, no domain, no sent touch and no reply (canContact
// passes, so the lint is what refuses). The two hk_check names: that brand + one other live brand.
const live = must(await svc.from('hk_brands').select('id, name, domain, status, relationship, owner_user_id, owner_unclear, updated_at').eq('business_id', hk.id).is('archived_at', null).order('name').limit(1000)).data;
const sent = new Set(must(await svc.from('hk_touches').select('brand_id').eq('business_id', hk.id).eq('state', 'sent')).data.map(t => t.brand_id));
const replied = new Set(must(await svc.from('hk_replies').select('brand_id').eq('business_id', hk.id)).data.map(r => r.brand_id));
const cands = live.filter(b => b.owner_user_id === jackId && b.relationship === 'prospect' && !b.owner_unclear && b.status !== 'passed' && !sent.has(b.id) && !replied.has(b.id));
const target = cands.find(b => !b.domain) || cands[0];
if (!target) { console.log('ABORT: no brand Jack owns that passes can_contact'); process.exit(1); }
const other = live.find(b => b.id !== target.id && b.owner_user_id !== jackId) || live.find(b => b.id !== target.id);
const before = { counts: await counts(), seen: await prefsSeen(), target };
log(`baseline taken · draft target has domain: ${!!target.domain} (Gmail cap ${target.domain ? 2 : 0})`);

let owner, browser, srv, clientId = null, access = null, refresh = null, familyRevoked = false;
const results = { checks: [], errors: [], numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (clientId) {
    await svc.from('hk_oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('client_id', clientId).is('revoked_at', null);
    const d = await svc.from('hk_oauth_clients').delete().eq('client_id', clientId);
    log(`test client deleted (cascade): ${d.error ? d.error.message : 'ok'}`); clientId = null;
  }
  const ev = await svc.from('hk_events').delete().eq('business_id', hk.id).eq('actor_user_id', jackId).gte('created_at', START).like('action', 'connector.%').select('id');
  log(`connector.* activity rows from this run deleted: ${ev.error ? ev.error.message : ev.data.length}`);
  await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId);
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });
fs.mkdirSync(OUT, { recursive: true });

const verifier = crypto.randomBytes(48).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const form = body => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
let rpcId = 0;
const mcp = async (method, params, tok = access) => {
  const r = await fetch(`${PROD}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  return { status: r.status, www: r.headers.get('www-authenticate'), body: await r.json().catch(() => null) };
};
const tool = async (name, args = {}) => { const r = await mcp('tools/call', { name, arguments: args }); const t = r.body?.result?.content?.[0]?.text; return { status: r.status, isError: !!r.body?.result?.isError, data: t ? JSON.parse(t) : r.body }; };

try {
  owner = await ownerSession(svc);
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const api = async (p, init = {}) => { const r = await fetch(`${PROD}${p}`, { ...init, headers: { cookie, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };

  // 1 discovery + the 401 shape
  const pr = await (await fetch(`${PROD}/.well-known/oauth-protected-resource`)).json();
  ok('protected-resource metadata: resource = the exact MCP URL, our origin as the authorization server', pr.resource === `${PROD}/mcp` && pr.authorization_servers[0] === PROD, JSON.stringify(pr));
  const as = await (await fetch(`${PROD}/.well-known/oauth-authorization-server`)).json();
  ok('authorization-server metadata: S256, none, CIMD advertised, endpoints on our origin', as.issuer === PROD && as.code_challenge_methods_supported.join() === 'S256' && as.token_endpoint_auth_methods_supported.join() === 'none' && as.client_id_metadata_document_supported === true && as.token_endpoint === `${PROD}/oauth/token`);
  const anon = await mcp('tools/list', {}, null);
  ok('/mcp without a token: 401 + WWW-Authenticate Bearer resource_metadata', anon.status === 401 && anon.www === `Bearer resource_metadata="${PROD}/.well-known/oauth-protected-resource"`, anon.www);

  // 2 the OAuth dance: DCR -> authorize -> consent (server-held) -> code -> tokens -> refresh
  const reg = await fetch(`${PROD}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Verify script (hkos-mcp-connector-v1)', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }) });
  const regBody = await reg.json(); clientId = regBody.client_id || null;
  ok('DCR register: 201, public client', reg.status === 201 && regBody.token_endpoint_auth_method === 'none', `${reg.status}`);
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'verify-state', scope: 'hk', resource: `${PROD}/mcp` });
  const t1 = Date.now(); const az = await fetch(`${PROD}/oauth/authorize?${q}`, { headers: { cookie }, redirect: 'manual' }); const azMs = Date.now() - t1;
  const loc = az.headers.get('location') || '';
  const reqId = new URL(loc, PROD).searchParams.get('id');
  ok(`authorize: 302 to /oauth/consent?id=… in ${azMs} ms (< 10 s)`, az.status === 302 && /^\/oauth\/consent\?id=/.test(loc) && azMs < 10000, loc.replace(/id=.*/, 'id=<id>'));
  const cg = await api(`/api/oauth/consent/${reqId}`);
  ok('consent GET: server-supplied client name, redirect host and workspace', cg.status === 200 && cg.body.client_name === 'Verify script (hkos-mcp-connector-v1)' && cg.body.redirect_host === '127.0.0.1:53682' && cg.body.workspace_name === 'HumanKind', JSON.stringify(cg.body));
  const extra = await api(`/api/oauth/consent/${reqId}`, { method: 'POST', body: JSON.stringify({ decision: 'allow', redirect_uri: 'https://evil.example/cb' }) });
  ok('consent POST with any field beyond decision: 400', extra.status === 400);
  const cp = await api(`/api/oauth/consent/${reqId}`, { method: 'POST', body: JSON.stringify({ decision: 'allow' }) });
  const back = new URL(cp.body.redirect);
  ok('consent POST allow: redirect to the registered loopback with code + state + iss', cp.status === 200 && back.origin + back.pathname === REDIRECT && back.searchParams.get('state') === 'verify-state' && back.searchParams.get('iss') === PROD && !!back.searchParams.get('code'));
  const again = await api(`/api/oauth/consent/${reqId}`, { method: 'POST', body: JSON.stringify({ decision: 'allow' }) });
  ok('consent is single-use: a second POST is 409', again.status === 409);
  const code = back.searchParams.get('code');
  const wrong = await (await fetch(`${PROD}/oauth/token`, form({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: crypto.randomBytes(48).toString('base64url') }))).json();
  ok('token with the wrong PKCE verifier: invalid_grant', wrong.error === 'invalid_grant');
  const t2 = Date.now(); const tok = await (await fetch(`${PROD}/oauth/token`, form({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }))).json(); const tokMs = Date.now() - t2;
  ok(`token (code + verifier): Bearer pair, 1 h, in ${tokMs} ms`, tok.token_type === 'Bearer' && tok.expires_in === 3600 && !!tok.refresh_token && tokMs < 10000);
  const reuse = await (await fetch(`${PROD}/oauth/token`, form({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }))).json();
  ok('code reuse: invalid_grant', reuse.error === 'invalid_grant');
  const rf = await (await fetch(`${PROD}/oauth/token`, form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tok.refresh_token }))).json();
  ok('refresh: a new pair, rotated', !!rf.access_token && rf.refresh_token !== tok.refresh_token);
  access = rf.access_token; refresh = rf.refresh_token;
  const stored = must(await svc.from('hk_oauth_tokens').select('token_hash, business_id, user_id').eq('client_id', clientId)).data;
  ok('stored hashed only, scoped to HumanKind + Jack', stored.length === 4 && stored.every(t => /^[0-9a-f]{64}$/.test(t.token_hash) && t.business_id === hk.id && t.user_id === jackId) && !JSON.stringify(stored).includes(access));

  // 3 the tools, read-only, as Jack
  const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify', version: '0' } });
  ok('initialize: humankind-grow', init.status === 200 && init.body.result.serverInfo.name === 'humankind-grow');
  const list = await mcp('tools/list', {});
  ok('tools/list: the 7 hk_* tools', list.body?.result?.tools?.map(t => t.name).join() === 'hk_settings,hk_check,hk_claim,hk_brand,hk_draft_save,hk_due,hk_update');
  const settings = await tool('hk_settings');
  const row = must(await svc.from('hk_settings').select('members_stat, completions_stat, max_email_touches').eq('business_id', hk.id).maybeSingle()).data;
  ok('hk_settings = the DB row (pitch stats, caps); mailbox statuses only (no address)', !settings.isError && settings.data.pitch.members_stat === row.members_stat && settings.data.pitch.completions_stat === row.completions_stat && settings.data.caps.max_email_touches === row.max_email_touches && !JSON.stringify(settings.data.mailboxes).includes('@'), JSON.stringify(settings.data.mailboxes));
  const due = await tool('hk_due');
  const mine = new Set(live.filter(b => b.owner_user_id === jackId).map(b => b.id));
  const dueIds = ['urgent_replies', 'replies', 'drafts_to_review', 'could_not_draft', 'dm_ready', 'follow_ups_due'].flatMap(k => due.data[k] || []).map(x => x.brand_id);
  results.numbers.due = Object.fromEntries(['urgent_replies', 'replies', 'drafts_to_review', 'could_not_draft', 'dm_ready', 'follow_ups_due'].map(k => [k, (due.data[k] || []).length]));
  ok(`hk_due: only brands Jack owns (${dueIds.length} items)`, !due.isError && dueIds.every(id => mine.has(id)), JSON.stringify(results.numbers.due));
  const names = [{ name: target.name }, { name: other.name }];
  const chk = await tool('hk_check', { brands: names });
  const addBrand = await api(`/api/hk/${hk.id}/brands/check`, { method: 'POST', body: JSON.stringify(names) });
  ok('hk_check on 2 real names = the Add brand verdicts', !chk.isError && addBrand.status === 200 && chk.data.results.map(r => r.verdict).join() === addBrand.body.results.map(r => r.verdict).join(), chk.data.results.map(r => r.verdict).join());
  const br = await tool('hk_brand', { brand: target.name });
  ok('hk_brand: the DB row (status, owner)', !br.isError && br.data.brand.id === target.id && br.data.brand.status === target.status && br.data.brand.owner_user_id === jackId);
  const touchesBefore = num('hk_touches', await svc.from('hk_touches').select('*', { count: 'exact', head: true }).eq('business_id', hk.id));
  const draft = await tool('hk_draft_save', { brand: target.name, kind: 'cold', subject: `HumanKind x ${target.name} - a challenge`, body_markdown: LINT_FAIL_BODY });
  const touchesAfter = num('hk_touches', await svc.from('hk_touches').select('*', { count: 'exact', head: true }).eq('business_id', hk.id));
  ok('hk_draft_save with a lint-failing body: the problems come back, nothing saved (0 Gmail drafts)', draft.isError && Array.isArray(draft.data.problems) && draft.data.problems.length > 0 && touchesAfter === touchesBefore, (draft.data.problems || []).map(p => p.rule).join() || draft.data.error);
  const acts = must(await svc.from('hk_events').select('action, actor_kind, detail').eq('business_id', hk.id).eq('actor_user_id', jackId).gte('created_at', START).like('action', 'connector.%')).data;
  ok(`Activity: one connector.* row per tool call (${acts.length}), actor_kind claude, via connector`, acts.length === 5 && acts.every(a => a.actor_kind === 'claude' && a.detail?.via === 'connector'), acts.map(a => a.action).join());

  // 4 the screens: the local build against the real DB, GET-only, while the test connection is live
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${LOCAL}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const shoot = async ({ width, height, viewer = false, tag }) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    const seen = [];
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal) seen.push(`${req.method()} ${u.pathname}`);
      if ((isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont)) return route.abort();
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const r = await route.fetch(); const j = await r.json(); j.me = { ...j.me, role: 'viewer' }; return route.fulfill({ response: r, json: j }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${LOCAL}/`);
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell]').waitFor({ timeout: 20000 });
    await page.evaluate(() => { window.history.pushState(null, '', '#hk/settings/connections'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.locator('[data-hk-claude-connector]').waitFor({ timeout: 20000 });
    if (!viewer) await page.locator('[data-hk-connection], [data-hk-connector-empty]').first().waitFor({ timeout: 20000 });
    await page.locator('[data-hk-claude-connector]').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/connector-${tag}.png`, animations: 'disabled', caret: 'hide' });
    const out = { errors, seen };
    out.rows = await page.locator('[data-hk-connection]').count();
    out.rowText = out.rows ? await page.locator('[data-hk-connection]').first().innerText() : '';
    out.url = (await page.locator('[data-hk-connector-url]').count()) ? await page.locator('[data-hk-connector-url]').innerText() : null;
    out.viewerNote = await page.locator('[data-hk-connector-viewer]').count();
    out.scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    out.contrast = summarize(await page.evaluate(measureScript({ scope: '[data-hk-claude-connector]' })));
    if (!viewer && width === 1440) {
      await page.evaluate(() => { window.history.pushState(null, '', '#hk/activity'); window.dispatchEvent(new PopStateEvent('popstate')); });
      await page.locator('[data-hk-activity]').waitFor(); await page.getByLabel('Action').selectOption('connector.');
      await page.locator('[data-hk-actor-connector], [data-hk-empty]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
      out.activityRows = await page.locator('[data-hk-actor-connector]').count();
      out.activityText = out.activityRows ? await page.locator('[data-hk-actor-connector]').first().innerText() : '';
      await page.screenshot({ path: `${OUT}/activity-connector-1440.png`, animations: 'disabled', caret: 'hide' });
    }
    await ctx.close();
    return out;
  };
  for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
    const s = await shoot({ width: w, height: h, tag });
    results.numbers[`ui_${tag}`] = { rows: s.rows, contrast: { textFails: s.contrast.textFails, controlFails: s.contrast.controlFails }, scrollW: s.scrollW };
    ok(`Settings › Claude connector at ${tag}: URL ${s.url}, ${s.rows} connection row ("${s.rowText.replace(/\s+/g, ' ').slice(0, 80)}"), contrast fails text ${s.contrast.textFails} / controls ${s.contrast.controlFails}, no horizontal scroll, 0 page errors`, s.url === `${LOCAL}/mcp` && s.rows === 1 && /Verify script/.test(s.rowText) && s.contrast.textFails === 0 && s.contrast.controlFails === 0 && s.scrollW <= w && !s.errors.length, s.errors.join(' | '));
    if (tag === '1440') ok(`Activity › Claude connector filter: ${s.activityRows} rows read "${s.activityText.replace(/\s+/g, ' ')}"`, s.activityRows >= 5 && /^C?Claude via connector \(Jack\)$/.test(s.activityText.replace(/\s+/g, ' ').trim()));
  }
  const v = await shoot({ width: 1440, height: 900, viewer: true, tag: 'viewer-1440' });
  ok('Viewer (intercept): the note, no URL, no /connector call', v.viewerNote === 1 && v.url === null && !v.seen.some(s => s.endsWith('/connector')) && !v.errors.length);
  await browser.close(); browser = null; srv.kill(); srv = null;

  // 5 revoke from Settings (the prod route) -> the token dies on the next call
  const listed = await api(`/api/hk/${hk.id}/connector`);
  const fam = listed.body?.connections?.find(c => c.client_name === 'Verify script (hkos-mcp-connector-v1)');
  ok('GET /connector on prod lists the test connection with last used', listed.status === 200 && !!fam?.last_used_at);
  const rv = await api(`/api/hk/${hk.id}/connector/${fam.family_id}/revoke`, { method: 'POST', body: '{}' });
  familyRevoked = rv.status === 200;
  ok(`revoke: ${rv.body?.revoked} tokens`, rv.status === 200 && rv.body.revoked >= 2);
  const dead = await mcp('tools/list', {});
  ok('after revoke: /mcp 401 invalid_token', dead.status === 401 && /invalid_token/.test(dead.www || ''));
  const deadRefresh = await (await fetch(`${PROD}/oauth/token`, form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh }))).json();
  ok('after revoke: refresh -> invalid_grant', deadRefresh.error === 'invalid_grant');
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await counts();
    const moved = [...HK_TABLES, ...OAUTH_TABLES].filter(t => before.counts[t] !== after[t]).map(t => `${t} ${before.counts[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if ((await prefsSeen()) !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    const t = must(await svc.from('hk_brands').select('status, owner_user_id, updated_at').eq('id', target.id).single()).data;
    if (t.status !== target.status || t.owner_user_id !== target.owner_user_id || t.updated_at !== target.updated_at) throw new Error('the draft target brand changed');
    restored = true; line = `yes (${HK_TABLES.length} HumanKind + ${OAUTH_TABLES.length} hk_oauth_* counts identical; the test connection was revoked, then its client deleted with its request / code / tokens; this run's connector.* Activity rows deleted; the draft brand untouched; last_seen_at restored; sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report-stage3.json'), JSON.stringify({ ...results, restored, revoked: familyRevoked, when: new Date().toISOString() }, null, 2));
  console.log(`\nhkos-mcp-connector-v1 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · Gmail drafts 0 · Gmail API cap ${target.domain ? 2 : 0}\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
