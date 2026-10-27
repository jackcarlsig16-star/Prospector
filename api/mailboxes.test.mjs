// node --test api/mailboxes.test.mjs
// mailbox-connections-v1 REV2 (M5 + M7) - /api/mailboxes on the in-memory Supabase. Invented workspaces and addresses.
// The teammate fixture holds an address that must never serialize. 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
process.env.GOOGLE_TOKEN_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const { fakeSupabase } = await import('./sales/testing/fakeSupabase.mjs');
const G = await import('./lib/googleGrants.js');
const { default: handler } = await import('./mailboxes.js');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const JACK = randomUUID(), PETE = randomUUID(), HK = randomUUID(), HL = randomUUID(), KK = randomUUID();
const TEAMMATE_ADDRESS = 'peter.teammate@humankind.test';
let sb;
const fresh = () => {
  sb = fakeSupabase({
    google_grants: [], workspace_mailboxes: [],
    business_members: [{ business_id: HK, user_id: JACK, role: 'owner' }, { business_id: HL, user_id: JACK, role: 'owner' }, { business_id: KK, user_id: JACK, role: 'viewer' }, { business_id: HK, user_id: PETE, role: 'member' }],
    businesses: [{ id: HK, name: 'HumanKind', color: '#22c55e', features: { hk_sales: true } }, { id: HL, name: 'HomeLover', color: '#ec4899', features: { goals_sales: true, outlook_voice: true, outlook_reply_times: true } }, { id: KK, name: 'Kopi Kita', color: '#8B4513', features: {} }],
    sales_mailbox_owners: [{ business_id: HL, mailbox_email: 'jack.sales@homelover.test', user_id: JACK }],
    sales_raw_snapshots: [{ business_id: HL, entity: 'mailboxes', captured_at: '2026-10-20T00:00:00Z', payload: [{ email: 'apollo-one@homelover.test' }, { email: 'apollo-two@homelover.test' }] }],
  }, { unique: { google_grants: r => `${r.user_id}:${r.google_email}`, workspace_mailboxes: r => `${r.business_id}:${r.user_id}:${r.provider}` } });
  G.deps.supabase = () => sb;
};
const deps = (ms = null) => ({ supabase: sb, microsoftGrant: async uid => (uid === JACK ? ms : null), fetchFn: async () => ({ json: async () => ({}) }) });
const call = async (method, path, { user = JACK, body = {}, platformOwner = false } = {}, ms) => {
  const roles = new Map(sb.db.business_members.filter(m => m.user_id === user).map(m => [m.business_id, m.role]));
  const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; };
  await handler({ method, path, body, auth: { user: { id: user, email: 'login@example.test' }, isPlatformOwner: platformOwner, roles } }, r, deps(ms));
  return r;
};
const MS = { account_email: 'jack.sales@homelover.test', scopes: ['openid', 'offline_access', 'Mail.Read', 'Calendars.Read'], error: null };

test('GET: own accounts with states + linked workspaces, Microsoft derived from sales_mailbox_owners + feature flags, Apollo as a count, workspaces with roles', async () => {
  fresh();
  const a = await G.saveGrant(JACK, { googleEmail: 'personal@example.test', features: ['gmail', 'calendar'], refreshToken: 'rt-1' });
  const b = await G.saveGrant(JACK, { googleEmail: 'work@humankind.test', features: ['gmail'], refreshToken: 'rt-2' });
  await G.saveGrant(PETE, { googleEmail: TEAMMATE_ADDRESS, features: ['gmail'], refreshToken: 'rt-p' });
  await G.setTether(HK, JACK, b.id, ['drafts', 'inbox']);
  await G.flagReconnect(b.id);
  const r = await call('GET', '/api/mailboxes', {}, MS);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.accounts.map(x => [x.email, x.is_default, x.state, x.linked_business_ids]), [['personal@example.test', true, 'ok', []], ['work@humankind.test', false, 'needs_reconnect', [HK]]]);
  assert.deepEqual(r.body.microsoft, { email: 'jack.sales@homelover.test', features: ['Mail.Read', 'Calendars.Read'], state: 'ok', business_ids: [HL] });
  assert.deepEqual(r.body.apollo, [{ business_id: HL, mailbox_count: 2 }]);
  const ws = Object.fromEntries(r.body.workspaces.map(w => [w.name, w]));
  assert.deepEqual(ws.HumanKind.google_link, { account_id: b.id, purposes: ['drafts', 'inbox'], state: 'needs_reconnect' });
  assert.deepEqual([ws.HomeLover.google_link, ws.HomeLover.microsoft_derived, ws.HomeLover.apollo_derived, ws.HomeLover.role], [null, ['voice', 'sync'], true, 'owner']);
  assert.deepEqual([ws['Kopi Kita'].google_link, ws['Kopi Kita'].microsoft_derived, ws['Kopi Kita'].apollo_derived, ws['Kopi Kita'].role], [null, [], false, 'viewer']);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes(TEAMMATE_ADDRESS), "a teammate's address never serializes");
  assert.ok(!text.includes('apollo-one') && !text.includes('apollo-two'), 'Apollo mailbox addresses never serialize');
  assert.ok(!text.includes('refresh_token'));
});

test('PUT link: member+ on the workspace, own account only, purposes filtered by the granted features; viewer refused; DELETE link', async () => {
  fresh();
  const a = await G.saveGrant(JACK, { googleEmail: 'personal@example.test', features: ['gmail'], refreshToken: 'rt-1' });
  const p = await G.saveGrant(PETE, { googleEmail: TEAMMATE_ADDRESS, features: ['gmail'], refreshToken: 'rt-p' });
  let r = await call('PUT', '/api/mailboxes/link', { body: { business_id: HK, account_id: a.id, purposes: ['drafts', 'calendar'] } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.link.purposes, r.body.link.skipped, r.body.link.state], [['drafts'], ['calendar'], 'ok'], 'calendar needs the calendar scope');
  assert.equal((await call('PUT', '/api/mailboxes/link', { body: { business_id: KK, account_id: a.id, purposes: ['drafts'] } })).code, 403, 'viewer on Kopi Kita');
  assert.equal((await call('PUT', '/api/mailboxes/link', { body: { business_id: HK, account_id: p.id, purposes: ['drafts'] } })).code, 404, "a teammate's account is not yours");
  assert.equal((await call('PUT', '/api/mailboxes/link', { body: { business_id: HK, account_id: a.id, purposes: ['calendar'] } })).code, 409, 'no covered purpose');
  assert.equal((await call('PUT', '/api/mailboxes/link', { body: { business_id: HK, account_id: a.id, purposes: [] } })).code, 400);
  assert.equal((await call('PUT', '/api/mailboxes/link', { body: { business_id: KK, account_id: a.id, purposes: ['drafts'] }, platformOwner: true })).code, 200, 'platform owner links like every gate');
  r = await call('PUT', '/api/mailboxes/link', { body: { business_id: HK, account_id: a.id, purposes: ['inbox'] } });
  assert.deepEqual(r.body.link.purposes, ['inbox'], 'relink replaces the purposes');
  assert.equal(sb.db.workspace_mailboxes.filter(t => t.business_id === HK).length, 1);
  assert.equal((await call('DELETE', '/api/mailboxes/link', { body: { business_id: HK } })).code, 200);
  assert.equal(sb.db.workspace_mailboxes.filter(t => t.business_id === HK).length, 0);
  assert.equal((await call('DELETE', '/api/mailboxes/link', { body: { business_id: KK } })).code, 403);
  assert.equal((await call('PUT', '/api/mailboxes/link', { user: PETE, body: { business_id: HK, account_id: p.id, purposes: ['drafts'] } })).code, 200, 'a member links their own account');
});

test('POST default moves the flag between own accounts only; DELETE accounts/:id revokes + removes own account and its tethers, never promotes', async () => {
  fresh();
  const a = await G.saveGrant(JACK, { googleEmail: 'personal@example.test', features: ['gmail'], refreshToken: 'rt-1' });
  const b = await G.saveGrant(JACK, { googleEmail: 'work@humankind.test', features: ['gmail'], refreshToken: 'rt-2' });
  const p = await G.saveGrant(PETE, { googleEmail: TEAMMATE_ADDRESS, features: ['gmail'], refreshToken: 'rt-p' });
  await G.setTether(HK, JACK, b.id, ['drafts']);
  assert.equal((await call('POST', '/api/mailboxes/default', { body: { account_id: p.id } })).code, 404);
  assert.deepEqual((await call('POST', '/api/mailboxes/default', { body: { account_id: b.id } })).body, { ok: true, default_id: b.id });
  assert.deepEqual(sb.db.google_grants.filter(g => g.user_id === JACK).map(g => [g.google_email, g.is_default]), [['personal@example.test', false], ['work@humankind.test', true]]);
  assert.equal((await call('DELETE', `/api/mailboxes/accounts/${p.id}`)).code, 404);
  assert.equal((await call('DELETE', `/api/mailboxes/accounts/${b.id}`)).code, 200);
  assert.deepEqual(sb.db.google_grants.filter(g => g.user_id === JACK).map(g => [g.google_email, g.is_default]), [['personal@example.test', false]], 'the remaining account is NOT promoted');
  sb.db.workspace_mailboxes = sb.db.workspace_mailboxes.filter(t => t.google_grant_id !== b.id); // the DB cascade, mirrored for the fake
  assert.equal((await call('GET', '/api/mailboxes')).body.workspaces.find(w => w.id === HK).google_link, null);
});

test('every Problem-2 caller still goes through getGrant / googleTokenFor (the default); the invalid_grant delete is gone; no send path in api/mailboxes.js', () => {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['api/gmail-intent.js', 'api/learn-voice.js', 'api/gmail/draft.js']) assert.match(read(f), /googleTokenFor\(req, res, ['"]gmail['"]\)/, f);
  for (const f of ['api/google/status.js', 'api/google/disconnect.js']) assert.match(read(f), /getGrant\(req\.auth\.user\.id\)/, f);
  const lib = read('api/lib/googleGrants.js');
  assert.doesNotMatch(lib, /invalid_grant'\) \{ await deleteGrant/);
  assert.match(lib, /if \(data\.error === 'invalid_grant'\) \{ await flagReconnect\(grant\.id\);/);
  const routes = read('api/mailboxes.js');
  for (const n of ['drafts' + '.send', 'messages' + '.send', '/send', 'send' + 'Mail']) assert.ok(!routes.includes(n), n);
  assert.match(read('server.js'), /app\.get\('\/api\/mailboxes',\s+esHandler\('\.\/api\/mailboxes\.js'\)\);/);
});
