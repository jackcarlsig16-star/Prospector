// microsoft-connect-v1 Stage 1 check. Temp workspace + 2 temp users, their microsoft_grants rows, all deleted. FAKE Microsoft client/tenant/secret and a throwaway MICROSOFT_TOKEN_KEY - the real Render values are never read. ~4 calls to login.microsoftonline.com that fail on the fake client (no account touched). 0 AI calls, HomeLover untouched. ~30s, cap 4 min. The real consent screen is Jack's click on prod.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3955, tag = 'ms1-' + Date.now();
const FAKE = { MICROSOFT_CLIENT_ID: '00000000-0000-0000-0000-00000000c1d0', MICROSOFT_TENANT_ID: '00000000-0000-0000-0000-0000000071d0', MICROSOFT_CLIENT_SECRET: 'fake-secret-' + tag, MICROSOFT_TOKEN_KEY: crypto.randomBytes(32).toString('base64') };
Object.assign(process.env, FAKE);
const FAKE_RT = 'fake-refresh-token-' + tag;
const WATCH = ['businesses', 'business_members', 'microsoft_grants', 'google_grants', 'profiles', 'auth_events'];
const made = { users: [], biz: null };
let srv, serverLog = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (srv) srv.kill();
  for (const u of made.users) await svc.from('microsoft_grants').delete().eq('user_id', u);
  const b = made.biz;
  if (b) { await svc.from('business_members').delete().eq('business_id', b); await svc.from('auth_events').delete().eq('business_id', b); }
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(biz, name) {
  const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: biz, email, name: `${name} Test`, user_id: u.user.id, role: 'member' }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, email, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}

(async () => {
  const before = await snap();
  try {
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ MS ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag }).select().single()).id;
    const jack = await user(made.biz, 'Jack'), cy = await user(made.biz, 'Cyrus');
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, ...FAKE, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => { serverLog += d; }); srv.stderr.on('data', d => { serverLog += d; });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const get = (u, path, extraCookie = '') => fetch(`http://localhost:${PORT}${path}`, { redirect: 'manual', headers: u ? { Cookie: [u.cookie, extraCookie].filter(Boolean).join('; ') } : {} });
    const post = (u, path) => fetch(`http://localhost:${PORT}${path}`, { method: 'POST', headers: { Cookie: u.cookie } });
    const row = async u => (await svc.from('microsoft_grants').select('*').eq('user_id', u.id).maybeSingle()).data;
    const param = (res, k) => new URL(res.headers.get('location'), 'http://x').searchParams.get(k);

    ok('signed out -> 401', (await get(null, '/api/microsoft/status')).status === 401);
    let st = await (await get(jack, '/api/microsoft/status')).json();
    ok('status before connect: configured, nothing connected', st.configured === true && st.email === null && st.scopes.length === 0, JSON.stringify(st));

    const c = await get(jack, '/api/microsoft/connect?return=%2F');
    const loc = new URL(c.headers.get('location'));
    const p = loc.searchParams, setCookie = c.headers.get('set-cookie') || '';
    const [nonce, verifier] = setCookie.match(/prospector_microsoft_oauth=([^;]+)/)[1].split('.');
    ok('connect -> tenant authorize endpoint', c.status === 302 && loc.origin + loc.pathname === `https://login.microsoftonline.com/${FAKE.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`, loc.origin + loc.pathname);
    ok('asks only openid offline_access User.Read Mail.Read Calendars.Read', p.get('scope') === 'openid offline_access User.Read Mail.Read Calendars.Read', p.get('scope'));
    ok('redirect uri = /api/microsoft/callback on this host', p.get('redirect_uri') === `http://localhost:${PORT}/api/microsoft/callback`, p.get('redirect_uri'));
    ok('PKCE S256 matches the cookie verifier', p.get('code_challenge_method') === 'S256' && p.get('code_challenge') === crypto.createHash('sha256').update(verifier).digest('base64url'));
    ok('state cookie HttpOnly, 10 min; account picker; login hint = user', /HttpOnly/.test(setCookie) && /Max-Age=600/.test(setCookie) && p.get('prompt') === 'select_account' && p.get('login_hint') === jack.email);
    const state = p.get('state'), cookie = `prospector_microsoft_oauth=${nonce}.${verifier}`;

    let r = await get(jack, `/api/microsoft/callback?state=${state}&code=x`);
    ok('callback without the cookie -> refused', /expired or was started in another session/.test(param(r, 'microsoft_error') || '') && !(await row(jack)));
    r = await get(cy, `/api/microsoft/callback?state=${state}&code=x`, cookie);
    ok('callback signed in as someone else -> refused, no grant for either', /another session/.test(param(r, 'microsoft_error') || '') && !(await row(cy)) && !(await row(jack)));
    r = await get(jack, `/api/microsoft/callback?state=${state}&error=access_denied`, cookie);
    ok('consent declined -> "not granted"', param(r, 'microsoft_error') === 'Microsoft access was not granted');
    r = await get(jack, `/api/microsoft/callback?state=${state}&code=fake-code`, cookie);
    ok('bad code -> Microsoft error shown, no grant, cookie cleared', !!param(r, 'microsoft_error') && !(await row(jack)) && /Max-Age=0/.test(r.headers.get('set-cookie') || ''), param(r, 'microsoft_error'));

    const { saveGrant } = await import(ROOT + '/api/lib/microsoftGrants.js');
    await saveGrant(jack.id, { accountEmail: 'jack@homelover.ai', tenantId: FAKE.MICROSOFT_TENANT_ID, scopes: ['openid', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'], refreshToken: FAKE_RT });
    const g = await row(jack);
    ok('stored token encrypted (no plaintext in the row)', g && !JSON.stringify(g).includes(FAKE_RT) && /^v1:/.test(g.refresh_token_enc));
    st = await (await get(jack, '/api/microsoft/status')).json();
    ok('status shows the account + access, never the token', st.email === 'jack@homelover.ai' && st.scopes.includes('Mail.Read') && !!st.connected_at && st.error === null && !JSON.stringify(st).includes('v1:'), JSON.stringify(st));
    st = await (await get(cy, '/api/microsoft/status')).json();
    ok("another member sees nothing of Jack's grant", st.email === null && st.scopes.length === 0);
    r = await post(jack, '/api/microsoft/check');
    const body = await r.text();
    // Microsoft rejects the fake refresh token as invalid_grant - the dead-grant path.
    const dead = await row(jack);
    ok('check -> refresh at Microsoft rejects the fake token: 409 Reconnect, error kept on the row, token not echoed', r.status === 409 && /reconnect/.test(body) && /reconnect/.test(dead?.error || '') && !body.includes(FAKE_RT), `${r.status} ${body.slice(0, 120)}`);
    st = await (await get(jack, '/api/microsoft/status')).json();
    ok('status shows the account with the Reconnect error', st.email === 'jack@homelover.ai' && /reconnect/.test(st.error || ''));
    r = await post(jack, '/api/microsoft/check');
    const nb = await r.json();
    ok('dead grant -> 409 needs_microsoft (Reconnect), no Microsoft call', r.status === 409 && nb.needs_microsoft === true, JSON.stringify(nb));
    r = await post(cy, '/api/microsoft/check');
    ok('no grant -> 409 needs_microsoft', r.status === 409);
    r = await post(jack, '/api/microsoft/disconnect');
    st = await (await get(jack, '/api/microsoft/status')).json();
    ok('disconnect deletes the grant', r.status === 200 && !(await row(jack)) && st.email === null);
    ok('server log never has the refresh token, secret or key', ![FAKE_RT, FAKE.MICROSOFT_CLIENT_SECRET, FAKE.MICROSOFT_TOKEN_KEY, verifier].some(s => serverLog.includes(s)));
  } catch (e) { ok('run', false, e.stack.split('\n').slice(0, 2).join(' ')); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  console.log(`\n${pass}/${total} passed`);
  console.log(moved.length ? `restored: CHECK - counts moved on ${moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', ')}` : 'restored: yes');
  process.exit(pass === total ? 0 : 1);
})();
