// node --test api/hk/prodWiring.test.mjs
// FIX inbox-tokenfor-v1 - every hk route handler called the way server.js calls it: hkRoute(file, name) passes
// (req, res) and NOTHING else, so each handler must resolve its own dependencies. The in-memory Supabase is set through
// the modules' real default paths (hkShared.seams, googleGrants.deps, the global fetch that gmailClient() reads), never
// through a third argument. Table-driven over every handler server.js wires; a 500 whose message reads like a
// TypeError ("d.tokenFor is not a function") is the bug this guards against. 0 network, 0 Claude, 0 Gmail, 0 DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.GOOGLE_TOKEN_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.GMAIL_CLIENT_ID ||= 'wiring-test'; process.env.GMAIL_CLIENT_SECRET ||= 'wiring-test';
const { seed, reqOf, resOf, HK, JACK, ID } = await import('./testing.mjs');
const shared = await import('./hkShared.js');
const grants = await import('../lib/googleGrants.js');
const MODULES = { brandsRoutes: await import('./brandsRoutes.js'), opsRoutes: await import('./opsRoutes.js'), gmailRoutes: await import('./gmailRoutes.js'), inboxRoutes: await import('./inboxRoutes.js'), importRoutes: await import('./importRoutes.js') };

const OWNER = 'jack.work@humankind.invalid', TOKEN = 'tok-jack-wiring';
const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const msg = (id, threadId, from, subject, labels = ['INBOX']) => ({
  id, threadId, labelIds: labels, snippet: 'Saw the app, would love to chat', internalDate: '1761490800000',
  payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: from }, { name: 'To', value: `HumanKind <${OWNER}>` }, { name: 'Subject', value: subject }, { name: 'Date', value: 'Mon, 26 Oct 2026 10:00:00 -0500' }, { name: 'Message-ID', value: `<${id}@mail.invalid>` }], body: { data: b64('Saw the app, would love to chat') } },
});
const THREADS = {
  'th-run': { id: 'th-run', historyId: '1', messages: [msg('m-r1', 'th-run', 'Sam Lee <sam@bluefinrun.example>', 'Run club x HumanKind?')] },
  'th-new': { id: 'th-new', historyId: '1', messages: [msg('m-n1', 'th-new', 'Ana Ortiz <ana@newbrand.invalid>', 'Partnership idea', ['INBOX', 'UNREAD'])] },
};
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (body == null ? '' : JSON.stringify(body)), json: async () => body });
const gmailCalls = [];
// Only Gmail's host answers; any other host is a real network call the routes must never make from a unit test.
const fakeFetch = async (url, init = {}) => {
  const u = new URL(url), method = init.method || 'GET';
  if (u.host === 'oauth2.googleapis.com') return json(200, { access_token: TOKEN, expires_in: 3600 });
  if (u.host !== 'gmail.googleapis.com') throw new Error(`unexpected network call ${method} ${u.host}`);
  assert.equal(init.headers?.Authorization, `Bearer ${TOKEN}`, 'the caller\'s own token');
  gmailCalls.push(`${method} ${u.pathname}`);
  const p = u.pathname.replace('/gmail/v1/users/me', '');
  if (method === 'GET' && p === '/threads') return json(200, { threads: Object.keys(THREADS).map(id => ({ id })) });
  if (method === 'GET' && p.startsWith('/threads/')) { const th = THREADS[decodeURIComponent(p.slice(9))]; return th ? json(200, th) : json(404, { error: { message: 'Requested entity was not found.' } }); }
  if (method === 'GET' && p === '/messages') return json(200, { messages: [] });
  if (method === 'GET' && p === '/drafts') return json(200, { drafts: [] });
  if (method === 'DELETE' && p.startsWith('/drafts/')) return json(204, null);
  if (method === 'GET' && p === '/profile') return json(200, { emailAddress: OWNER, historyId: '10' });
  if (method === 'POST') throw new Error(`the test never writes to Gmail: ${method} ${p}`);
  return json(404, { error: { message: `no fixture for ${method} ${p}` } });
};

let sb;
const fresh = () => {
  sb = seed({
    hk_touches: [
      { id: 't1', business_id: HK, brand_id: ID.yoga, sender_user_id: JACK, channel: 'email', kind: 'cold', subject: 'HumanKind x Harbor Yoga - a mat-time challenge', body_text: 'secret body', state: 'sent', sent_at: '2026-10-03T00:00:00Z', created_by: 'claude', created_at: '2026-10-03T00:00:00Z' },
      { id: 't-draft', business_id: HK, brand_id: ID.run, sender_user_id: JACK, channel: 'email', kind: 'cold', subject: 'HumanKind x Bluefin Run Club', body_text: 'draft body', state: 'drafted', gmail_draft_id: 'd-1', gmail_message_id: 'm-d1', drafted_at: '2026-10-25T00:00:00Z', created_by: 'user', created_at: '2026-10-25T00:00:00Z' },
    ],
    hk_replies: [{ id: 'r1', business_id: HK, brand_id: ID.yoga, touch_id: 't1', from_name: 'Ana', from_domain: 'harboryoga.example', from_email: 'ana@harboryoga.example', received_at: '2026-10-10T00:00:00Z', label: 'interested', handled: false, created_at: '2026-10-10T00:00:00Z' }],
    hk_ignored_senders: [{ id: 'ig1', business_id: HK, user_id: JACK, domain: 'news.invalid', created_at: '2026-10-20T00:00:00Z' }],
    hk_sync_runs: [], hk_gmail_sync_state: [],
    google_grants: [{ id: 'g-jack', user_id: JACK, google_email: OWNER, features: ['gmail'], refresh_token_enc: grants.encryptToken('refresh-wiring'), is_default: true, error: null, error_at: null, last_used_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }],
    workspace_mailboxes: [{ business_id: HK, user_id: JACK, provider: 'google', google_grant_id: 'g-jack', purposes: ['drafts', 'inbox'] }],
    business_members: [{ user_id: JACK, business_id: HK, name: 'Jack Carlson', role: 'owner', created_at: '2026-09-01T00:00:00Z' }], hk_import_runs: [],
  });
  shared.seams.supabase = () => sb;
  grants.deps.supabase = () => sb;
  grants.deps.fetch = fakeFetch;
  globalThis.fetch = fakeFetch;
  gmailCalls.length = 0;
  MODULES.inboxRoutes.inboxCache.clear();
};

const owner = o => reqOf({ role: 'owner', ...o });
const member = o => reqOf({ role: 'member', ...o });
// { module, handler, req, expect: the statuses the real logic answers for this request }. Every entry calls the
// handler with (req, res) only.
const TABLE = [
  ['brandsRoutes', 'listBrandsRoute', member(), [200]],
  ['brandsRoutes', 'checkBrandsRoute', member({ method: 'POST', body: [{ name: 'Harbor Yoga', domain: 'harboryoga.example' }] }), [200]],
  ['brandsRoutes', 'createBrandRoute', member({ method: 'POST', body: { name: 'Zz Wiring Brand' } }), [201]],
  ['brandsRoutes', 'getBrandRoute', member({ params: { id: ID.yoga } }), [200]],
  ['brandsRoutes', 'patchBrandRoute', member({ method: 'PATCH', params: { id: ID.run }, body: { notes: 'wiring' } }), [200]],
  ['brandsRoutes', 'listContactsRoute', member({ params: { id: ID.yoga } }), [200]],
  ['brandsRoutes', 'createContactRoute', member({ method: 'POST', params: { id: ID.yoga }, body: { name: 'Wiring Contact' } }), [201]],
  ['brandsRoutes', 'patchContactRoute', member({ method: 'PATCH', params: { id: ID.yoga, cid: 'c-ana' }, body: { title: 'Founder' } }), [200]],
  ['opsRoutes', 'sponsorsRoute', member(), [200]],
  ['opsRoutes', 'addPeriodRoute', member({ method: 'POST', params: { brandId: ID.juice }, body: { period: '2026-10' } }), [201]],
  ['opsRoutes', 'deletePeriodRoute', owner({ method: 'DELETE', params: { brandId: ID.juice, pid: 'no-such-period' } }), [404]],
  ['opsRoutes', 'duplicatesRoute', member(), [200]],
  ['opsRoutes', 'decideDuplicateRoute', member({ method: 'POST', body: { brand_a: ID.run, brand_b: ID.yoga, verdict: 'not_duplicate' } }), [200]],
  ['opsRoutes', 'warningsRoute', member(), [200]],
  ['opsRoutes', 'activityRoute', member(), [200]],
  ['opsRoutes', 'getSettingsRoute', member(), [200]],
  ['opsRoutes', 'patchSettingsRoute', owner({ method: 'PATCH', body: { bump_after_days: 5 } }), [200]],
  ['opsRoutes', 'confirmStatsRoute', member({ method: 'POST', body: { members_stat: 1200 } }), [200]],
  ['opsRoutes', 'getPrefsRoute', member(), [200]],
  ['opsRoutes', 'patchPrefsRoute', member({ method: 'PATCH', body: { avatar_slot: 2 } }), [200]],
  ['gmailRoutes', 'listDraftsRoute', member(), [200]],
  ['gmailRoutes', 'createDraftRoute', member({ method: 'POST', body: { brand_id: ID.run, channel: 'email', kind: 'cold', subject: 'HumanKind x Bluefin Run Club', body_markdown: 'Hi - a quick idea for your runners.' } }), [201, 409, 422]],
  ['gmailRoutes', 'lintPreviewRoute', member({ method: 'POST', body: { subject: 'Hello', body_markdown: 'Hi there' } }), [200]],
  ['gmailRoutes', 'previewDraftRoute', member({ params: { touchId: 't-draft' } }), [200]],
  ['gmailRoutes', 'relintDraftRoute', member({ method: 'POST', params: { touchId: 't-draft' } }), [200]],
  ['gmailRoutes', 'discardDraftRoute', member({ method: 'DELETE', params: { touchId: 't-draft' } }), [200]],
  ['gmailRoutes', 'syncRoute', member({ method: 'POST', query: { trigger: 'manual' } }), [200]],
  ['gmailRoutes', 'listRepliesRoute', member(), [200]],
  ['gmailRoutes', 'patchReplyRoute', member({ method: 'PATCH', params: { id: 'r1' }, body: { handled: true } }), [200]],
  ['gmailRoutes', 'gmailStatusRoute', member(), [200]],
  ['gmailRoutes', 'patchSignatureRoute', member({ method: 'PATCH', body: { signature_text: 'Jack' } }), [200]],
  ['importRoutes', 'listImportsRoute', member(), [200]],
  ['importRoutes', 'previewImportRoute', member({ method: 'POST', body: { name: 'Sheet8.csv', data: Buffer.from('Business Name,Website\nZz Wiring Supply,wiring.invalid\n').toString('base64') } }), [201]],
  ['importRoutes', 'commitImportRoute', owner({ method: 'POST', params: { id: 'no-such-run' } }), [404]],
  ['importRoutes', 'undoImportRoute', owner({ method: 'POST', params: { id: 'no-such-run' } }), [404]],
  ['inboxRoutes', 'listThreadsRoute', member({ query: { tab: 'inbox' } }), [200]],
  ['inboxRoutes', 'openThreadRoute', member({ params: { id: 'th-new' } }), [200]],
  ['inboxRoutes', 'linkThreadRoute', member({ method: 'POST', params: { id: 'th-run' }, body: { brand_id: ID.run } }), [201]],
  ['inboxRoutes', 'trackRoute', member({ method: 'POST', body: { name: 'Zz Wiring Track', domain: 'newbrand.invalid', thread_id: 'th-new' } }), [201]],
  ['inboxRoutes', 'listIgnoredRoute', member(), [200]],
  ['inboxRoutes', 'ignoreRoute', member({ method: 'POST', body: { domain: 'shop.invalid' } }), [200]],
  ['inboxRoutes', 'unignoreRoute', member({ method: 'DELETE', params: { domain: 'news.invalid' } }), [200]],
];
const TYPE_ERROR = /is not a function|Cannot read propert|is not defined|is not iterable|Cannot destructure/;

test('server.js wires every handler in the table, and the table covers every handler server.js wires', () => {
  const src = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const files = Object.fromEntries([...src.matchAll(/const (HK_[A-Z]+) = '\.\/api\/hk\/(\w+)\.js'/g)].map(m => [m[1], m[2]]));
  const extra = [...src.matchAll(/(HK_[A-Z]+) = '\.\/api\/hk\/(\w+)\.js'/g)].map(m => [m[1], m[2]]);
  for (const [k, v] of extra) files[k] = v;
  const wired = [...src.matchAll(/hkRoute\((HK_[A-Z]+), '(\w+)'\)/g)].map(m => `${files[m[1]]}.${m[2]}`).sort();
  assert.ok(wired.length >= 42, `found ${wired.length} wired hk routes`);
  assert.deepEqual(wired, TABLE.map(([m, h]) => `${m}.${h}`).sort());
  for (const [m, h] of TABLE) assert.equal(typeof MODULES[m][h], 'function', `${m}.${h} is exported`);
  assert.match(src, /return mod\[name\]\(req, res\);/, 'hkRoute passes (req, res) and nothing else');
});

for (const [mod, name, req, expect] of TABLE) {
  test(`${mod}.${name}(req, res) resolves its own deps: ${expect.join('/')} and no TypeError`, async () => {
    fresh();
    const res = resOf();
    await MODULES[mod][name](req, res);
    const body = JSON.stringify(res.body);
    assert.ok(!TYPE_ERROR.test(body), `${mod}.${name} -> ${res.code} ${body}`);
    assert.ok(expect.includes(res.code), `${mod}.${name} -> ${res.code} ${body}`);
  });
}

test('inbox list through the default path reads the caller\'s mailbox with the default Gmail client: chips per thread, 1 list + 1 metadata get each', async () => {
  fresh();
  const res = resOf();
  await MODULES.inboxRoutes.listThreadsRoute(member({ query: { tab: 'inbox' } }), res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const by = Object.fromEntries(res.body.threads.map(t => [t.thread_id, t.chip.kind]));
  assert.deepEqual(by, { 'th-run': 'matches', 'th-new': 'untracked' });
  assert.deepEqual(gmailCalls, ['GET /gmail/v1/users/me/threads', 'GET /gmail/v1/users/me/threads/th-run', 'GET /gmail/v1/users/me/threads/th-new']);
  assert.ok(!JSON.stringify(res.body).includes('@'));
});
