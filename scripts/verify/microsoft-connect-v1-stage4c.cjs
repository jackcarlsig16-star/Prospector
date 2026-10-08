// microsoft-connect-v1 Stage 4c check. Temp workspace (allowlisted for the spawned server only) + 2 temp users, their microsoft_grants / sales_mailbox_owners rows, all deleted. FAKE Microsoft creds + throwaway MICROSOFT_TOKEN_KEY; Graph AND the token endpoint are a local fixture server - 0 calls to Microsoft, 0 Apollo, exactly 1 real AI call (the voice analysis, max_tokens 1200), HomeLover READ-ONLY (its features row is read once). Proves: feature off -> 403 with no Graph call, on + no grant -> 409 needs_microsoft, the one Graph GET is Sent Items with a body $select + text Prefer, fewer than 3 external samples -> no profile and no AI call, the full set -> profile source outlook with the hand-counted sample count, the server stores nothing (voice_profiles / microsoft_messages counts unchanged), the log has no body / address / token, the Gmail default is untouched. ~40s, cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3972, FIX = 3973, tag = 'ms4c-' + Date.now();
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95';
const FAKE = { MICROSOFT_CLIENT_ID: '00000000-0000-0000-0000-00000000c1d0', MICROSOFT_TENANT_ID: '00000000-0000-0000-0000-0000000071d0', MICROSOFT_CLIENT_SECRET: 'fake-secret-' + tag, MICROSOFT_TOKEN_KEY: crypto.randomBytes(32).toString('base64'),
  MICROSOFT_GRAPH_URL: `http://localhost:${FIX}/v1.0`, MICROSOFT_AUTHORITY: `http://localhost:${FIX}` };
Object.assign(process.env, FAKE);
const FAKE_RT = 'fake-refresh-token-' + tag, FAKE_AT = 'fake-access-token-' + tag;
const MAILBOX = `jack.${tag}@homelover.ai`, CYRUS_BOX = `cyrus.${tag}@newco.test`;
const SECRET_EMAIL = `amy.${tag}@acme.com`, BODY_MARK = 'BODY-NEVER-STORED-' + tag;
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events', 'microsoft_grants', 'sales_mailbox_owners', 'microsoft_messages', 'voice_profiles'];
const made = { users: [], biz: null };
let srv, fix, serverLog = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);

// ── Graph fixture: Sent Items with text bodies, Graph's list shape ───────────
const a = address => ({ emailAddress: { address, name: address.split('@')[0] } });
const m = (id, to, body, over = {}) => ({ id, subject: `Subject ${id}`, sentDateTime: `2026-10-0${1 + (id.length % 7)}T10:00:00Z`, toRecipients: to.map(a), body: { contentType: 'text', content: body }, ...over });
const mine = n => `Hey there, quick one on the pilot number ${n} - can we grab fifteen minutes this week to walk through it?\n\nJack`;
const FEW = [m('f1', [SECRET_EMAIL], mine(1)), m('f2', ['bob@beta.io'], mine(2)), m('f-internal', ['team@homelover.io'], mine(3))];
const FULL = [
  m('x1', [SECRET_EMAIL], mine(1)),
  m('x2', ['bob@beta.io'], mine(2) + `\n\nOn Mon, Sep 29, 2026 Bob wrote:\n> ${BODY_MARK}-quoted`),
  m('x3', ['carl@gamma.co'], mine(3) + `\n\nFrom: Carl <carl@gamma.co>\nSent: Monday\nSubject: RE\n\n${BODY_MARK}-outlook-quoted`),
  m('x4', ['dee@delta.org', 'ed@delta.org'], mine(4)),
  m('x5', ['fay@epsilon.net'], mine(5)),
  m('x-internal', [SECRET_EMAIL, 'cyrus.' + tag + '@homelover.ai'], mine(6)),
  m('x-owner-domain', ['someone@newco.test'], mine(7)),
  m('x-noreply', ['noreply@vendor.com'], mine(8)),
  m('x-short', ['gus@zeta.io'], 'ok thanks'),
  m('x-quoted-only', ['hal@eta.io'], `> ${BODY_MARK}\n> only quoted`),
];
let SET = FEW;
const graphCalls = [];
function startFixture() {
  return new Promise(resolve => {
    fix = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${FIX}`);
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && u.pathname === '/token') return res.end(JSON.stringify({ access_token: FAKE_AT, expires_in: 3600, refresh_token: FAKE_RT + '-rotated' }));
      graphCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, prefer: req.headers.prefer });
      if (u.pathname !== '/v1.0/me/mailFolders/sentitems/messages' || req.headers.authorization !== `Bearer ${FAKE_AT}`) { res.statusCode = 404; return res.end(JSON.stringify({ error: { code: 'ResourceNotFound' } })); }
      res.end(JSON.stringify({ value: SET }));
    }).listen(FIX, resolve);
  });
}

async function cleanup() {
  if (srv) srv.kill();
  if (fix) fix.close();
  for (const u of made.users) { for (const t of ['microsoft_grants', 'sales_mailbox_owners']) await svc.from(t).delete().eq('user_id', u); }
  const b = made.biz;
  if (b) { for (const t of ['business_members', 'auth_events', 'sales_mailbox_owners']) await svc.from(t).delete().eq('business_id', b); }
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(biz, name, role) {
  const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: biz, email, name: `${name} Test`, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, email, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}

(async () => {
  const before = await snap();
  try {
    await startFixture();
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ MS4C ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag }).select().single()).id;
    const jack = await user(made.biz, 'Jack', 'member'), cy = await user(made.biz, 'Cyrus', 'member');
    ins(await svc.from('sales_mailbox_owners').insert([{ business_id: made.biz, mailbox_email: MAILBOX, user_id: jack.id }, { business_id: made.biz, mailbox_email: CYRUS_BOX, user_id: cy.id }]).select());
    const { saveGrant } = await import(ROOT + '/api/lib/microsoftGrants.js');

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, ...FAKE, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: [process.env.SALES_ANALYTICS_BUSINESS_IDS, made.biz].filter(Boolean).join(',') }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => { serverLog += d; }); srv.stderr.on('data', d => { serverLog += d; });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const learn = async (u, body) => { const r = await fetch(`http://localhost:${PORT}/api/learn-voice`, { method: 'POST', headers: { Cookie: u.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => ({})) }; };

    let r = await learn(jack, { mode: 'learn', source: 'outlook' });
    ok('A1 feature off -> 403, no Graph call', r.status === 403 && /isn't switched on/.test(r.data.error) && graphCalls.length === 0, `${r.status} ${r.data.error}`);

    ins(await svc.from('businesses').update({ features: { outlook_voice: true } }).eq('id', made.biz).select());
    r = await learn(jack, { mode: 'learn', source: 'outlook' });
    ok('A2 feature on, no grant -> 409 needs_microsoft, no Graph call', r.status === 409 && r.data.needs_microsoft === true && graphCalls.length === 0, `${r.status} ${JSON.stringify(r.data)}`);

    await saveGrant(jack.id, { accountEmail: MAILBOX, tenantId: FAKE.MICROSOFT_TENANT_ID, scopes: ['openid', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'], refreshToken: FAKE_RT });
    SET = FEW;
    r = await learn(jack, { mode: 'learn', source: 'outlook' });
    ok('A3 two external samples -> 200, no profile, "Only 2", no AI call', r.status === 200 && r.data.profile === null && /Only 2 external/.test(r.data.message), `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    const g = graphCalls[0];
    ok('A4 exactly one Graph GET: Sent Items, $select with body, Prefer text body, bearer token', graphCalls.length === 1 && g.method === 'GET' && /\/me\/mailFolders\/sentitems\/messages\?/.test(g.url) && /\$select=subject,sentDateTime,toRecipients,body/.test(g.url) && /\$top=50/.test(g.url) && g.prefer === 'outlook.body-content-type="text"' && g.auth === `Bearer ${FAKE_AT}`, `${graphCalls.length} ${g && g.url}`);

    SET = FULL; graphCalls.length = 0;
    r = await learn(jack, { mode: 'learn', source: 'outlook' });
    const p = r.data.profile || {};
    ok('A5 full set -> profile from the 5 external mails (internal / owner-domain / noreply / short / quoted-only dropped), source outlook, 1 AI call', r.status === 200 && p.source === 'outlook' && p.emailCount === 5 && Number(p.analyzedCount) === 5 && !!p.learnedAt && p.teachCount === 0 && typeof p.greeting === 'string' && graphCalls.length === 1, `${r.status} source=${p.source} emailCount=${p.emailCount} analyzed=${p.analyzedCount} ${r.data.error || ''}`);
    const profileText = JSON.stringify(p);
    ok('A6 the profile carries no quoted text and no address', !profileText.includes(BODY_MARK) && !profileText.includes(SECRET_EMAIL), profileText.slice(0, 100));

    const mid = await snap();
    ok('A7 the server stored nothing: voice_profiles and microsoft_messages counts unchanged', mid.voice_profiles === before.voice_profiles && mid.microsoft_messages === before.microsoft_messages, `${before.voice_profiles}->${mid.voice_profiles}, ${before.microsoft_messages}->${mid.microsoft_messages}`);
    ok('A8 server log: no body, no address, no token, no key', !serverLog.includes(BODY_MARK) && !serverLog.includes(SECRET_EMAIL) && !serverLog.includes(FAKE_AT) && !serverLog.includes(FAKE_RT) && !serverLog.includes(FAKE.MICROSOFT_TOKEN_KEY) && !serverLog.includes(FAKE.MICROSOFT_CLIENT_SECRET), serverLog.slice(-160).replace(/\n/g, ' '));

    r = await learn(cy, { mode: 'learn', source: 'outlook' });
    ok('A9 another member, feature on, no grant of their own -> 409 (never Jack\'s mailbox)', r.status === 409 && r.data.needs_microsoft === true, `${r.status}`);
    r = await learn(jack, { mode: 'learn' });
    ok('A10 Gmail default untouched: no source -> Google path (409 needs_google), no Graph call', r.status === 409 && r.data.needs_google === 'gmail' && graphCalls.length === 1, `${r.status} ${JSON.stringify(r.data)}`);

    const hl = (await svc.from('businesses').select('features').eq('id', HL).maybeSingle()).data;
    ok('B1 HomeLover READ-ONLY: outlook_voice is not on yet (Jack switches it on in Admin > Workspace features)', hl && hl.features?.outlook_voice !== true, JSON.stringify(hl && hl.features));
  } catch (e) { ok('run', false, e.stack.split('\n').slice(0, 3).join(' ')); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  console.log(`\n${pass}/${total} passed`);
  console.log(moved.length ? `restored: CHECK - counts moved on ${moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', ')}` : 'restored: yes');
  process.exit(pass === total ? 0 : 1);
})();
