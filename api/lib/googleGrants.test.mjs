// node --test api/lib/googleGrants.test.mjs
// mailbox-connections-v1 REV2 (M3 + M7) - many Google accounts per person on the in-memory Supabase, with Google's
// token endpoint stubbed. Invented addresses; refresh tokens are sealed with a test GOOGLE_TOKEN_KEY. 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.GOOGLE_TOKEN_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.GMAIL_CLIENT_ID ||= 'test-client'; process.env.GMAIL_CLIENT_SECRET ||= 'test-secret';
const { fakeSupabase } = await import('../sales/testing/fakeSupabase.mjs');
const G = await import('./googleGrants.js');

const JACK = randomUUID(), PETE = randomUUID(), HK = randomUUID(), HL = randomUUID();
let sb, clock, tokenCalls;
const fresh = (seed = {}) => {
  sb = fakeSupabase({ google_grants: [], workspace_mailboxes: [], ...seed }, { now: () => clock, unique: { google_grants: r => `${r.user_id}:${r.google_email}`, workspace_mailboxes: r => `${r.business_id}:${r.user_id}:${r.provider}` } });
  G.deps.supabase = () => sb; G.deps.now = () => clock;
  tokenCalls = [];
  G.deps.fetch = async (url, init) => { const body = Object.fromEntries(new URLSearchParams(init.body)); tokenCalls.push(body.refresh_token); const bad = body.refresh_token.startsWith('dead'); return { json: async () => (bad ? { error: 'invalid_grant' } : { access_token: `at-${body.refresh_token}`, expires_in: 3600 }) }; };
};
clock = Date.UTC(2026, 9, 26, 20);
const res = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
const req = userId => ({ auth: { user: { id: userId, email: 'login@example.test' }, isPlatformOwner: false, roles: new Map() } });

test('first account is the default, the second is not; getGrant = the default; listGrants orders default first', async () => {
  fresh();
  const a = await G.saveGrant(JACK, { googleEmail: 'Personal@Example.test', features: ['gmail', 'calendar'], refreshToken: 'rt-personal' });
  const b = await G.saveGrant(JACK, { googleEmail: 'work@humankind.test', features: ['gmail'], refreshToken: 'rt-work' });
  assert.deepEqual([a.is_default, a.created, b.is_default, b.created], [true, true, false, true]);
  assert.equal((await G.getGrant(JACK)).google_email, 'personal@example.test');
  assert.deepEqual((await G.listGrants(JACK)).map(g => [g.google_email, g.is_default]), [['personal@example.test', true], ['work@humankind.test', false]]);
  assert.equal(await G.grantById(JACK, b.id).then(g => g.google_email), 'work@humankind.test');
  assert.equal(await G.grantById(PETE, b.id), null, 'another login never sees it');
});

test('reconnecting the same address updates in place: default flag and tethers kept, error cleared', async () => {
  fresh();
  const a = await G.saveGrant(JACK, { googleEmail: 'personal@example.test', features: ['gmail'], refreshToken: 'rt-1' });
  const b = await G.saveGrant(JACK, { googleEmail: 'work@humankind.test', features: ['gmail'], refreshToken: 'rt-2' });
  await G.setTether(HK, JACK, b.id, ['drafts', 'inbox']);
  await G.flagReconnect(b.id);
  assert.equal((await G.grantById(JACK, b.id)).error, 'needs_reconnect');
  const again = await G.saveGrant(JACK, { googleEmail: 'work@humankind.test', features: ['gmail', 'calendar'], refreshToken: 'rt-3' });
  assert.deepEqual([again.id === b.id, again.created, again.is_default], [true, false, false]);
  const row = await G.grantById(JACK, b.id);
  assert.deepEqual([row.error, row.error_at, row.features, row.is_default], [null, null, ['gmail', 'calendar'], false]);
  assert.equal((await G.listTethers(JACK)).length, 1, 'tether survived');
  assert.equal((await G.getGrant(JACK)).id, a.id, 'default unchanged');
});

test("an address already connected to another login is refused", async () => {
  fresh();
  await G.saveGrant(PETE, { googleEmail: 'shared@example.test', features: ['gmail'], refreshToken: 'rt-p' });
  await assert.rejects(() => G.saveGrant(JACK, { googleEmail: 'Shared@example.test', features: ['gmail'], refreshToken: 'rt-j' }), G.OtherLogin);
  assert.equal((await G.listGrants(JACK)).length, 0);
});

test('invalid_grant flags the account (row + tethers kept, nothing promoted) and drops its cached token', async () => {
  fresh();
  const a = await G.saveGrant(JACK, { googleEmail: 'personal@example.test', features: ['gmail'], refreshToken: 'rt-ok' });
  const b = await G.saveGrant(JACK, { googleEmail: 'work@humankind.test', features: ['gmail'], refreshToken: 'dead-work' });
  await G.setTether(HK, JACK, b.id, ['drafts']);
  const r = res();
  const token = await G.tokenForMailbox({ ...req(JACK) }, r, HK, 'drafts');
  assert.equal(token, null);
  assert.deepEqual([r.code, r.body.needs_reconnect, r.body.email], [409, b.id, 'work@humankind.test']);
  const row = await G.grantById(JACK, b.id);
  assert.deepEqual([row.error, !!row.error_at, row.is_default], ['needs_reconnect', true, false]);
  assert.equal((await G.listTethers(JACK)).length, 1);
  assert.equal((await G.getGrant(JACK)).id, a.id);
  assert.equal(sb.db.google_grants.length, 2, 'no row deleted');
});

test("a flagged DEFAULT reads as today's 409 needs_google for user-level callers, never a crash", async () => {
  fresh();
  const a = await G.saveGrant(JACK, { googleEmail: 'personal@example.test', features: ['gmail', 'calendar'], refreshToken: 'rt-ok' });
  await G.flagReconnect(a.id);
  const r = res();
  assert.equal(await G.googleTokenFor(req(JACK), r, 'gmail'), null);
  assert.deepEqual([r.code, r.body.needs_google], [409, 'gmail']);
});

test('googleTokenFor with two accounts resolves the DEFAULT (every Problem-2 caller), caches by grant id, stamps last_used_at at most every 10 min', async () => {
  fresh();
  const a = await G.saveGrant(JACK, { googleEmail: 'personal@example.test', features: ['gmail', 'calendar'], refreshToken: 'rt-personal' });
  const b = await G.saveGrant(JACK, { googleEmail: 'work@humankind.test', features: ['gmail'], refreshToken: 'rt-work' });
  await G.setTether(HK, JACK, b.id, ['drafts']);
  assert.equal(await G.googleTokenFor(req(JACK), res(), 'gmail'), 'at-rt-personal');
  assert.equal(await G.googleTokenFor(req(JACK), res(), 'gmail'), 'at-rt-personal');
  assert.deepEqual(tokenCalls, ['rt-personal'], 'second call served from the cache');
  assert.ok((await G.grantById(JACK, a.id)).last_used_at);
  assert.equal((await G.grantById(JACK, b.id)).last_used_at ?? null, null);
  assert.equal(await G.tokenForMailbox(req(JACK), res(), HK, 'drafts'), 'at-rt-work');
  assert.deepEqual(tokenCalls, ['rt-personal', 'rt-work'], 'the work account has its own cache entry');
  const stamp1 = (await G.grantById(JACK, a.id)).last_used_at;
  clock += 5 * 60_000; await G.googleTokenFor(req(JACK), res(), 'gmail');
  assert.equal((await G.grantById(JACK, a.id)).last_used_at, stamp1, 'not re-stamped within 10 min');
  clock += 6 * 60_000; await G.googleTokenFor(req(JACK), res(), 'gmail');
  assert.notEqual((await G.grantById(JACK, a.id)).last_used_at, stamp1);
});

test('mailboxFor never falls back to the default: no tether -> null; tether to a missing purpose -> null; tokenForMailbox 409 needs_mailbox', async () => {
  fresh();
  const a = await G.saveGrant(JACK, { googleEmail: 'personal@example.test', features: ['gmail', 'calendar'], refreshToken: 'rt-personal' });
  assert.equal(await G.mailboxFor(HK, JACK, 'drafts'), null);
  const r = res();
  assert.equal(await G.tokenForMailbox(req(JACK), r, HK, 'drafts'), null);
  assert.deepEqual([r.code, r.body.needs_mailbox], [409, 'drafts']);
  await G.setTether(HK, JACK, a.id, ['drafts']);
  assert.equal(await G.mailboxFor(HK, JACK, 'calendar'), null, 'calendar is not a linked purpose');
  const m = await G.mailboxFor(HK, JACK, 'drafts');
  assert.deepEqual([m.state, m.grant.id, m.tether.purposes], ['ok', a.id, ['drafts']]);
  assert.equal(await G.mailboxFor(HL, JACK, 'drafts'), null, 'another workspace has no tether');
  assert.equal(await G.tokenForMailbox(req(JACK), res(), HK, 'drafts'), 'at-rt-personal', 'the default can be the tethered one, by explicit link only');
});

test('deleteGrant without an id removes the default (today\'s Disconnect) and promotes nothing; with an id removes that account; setDefault moves the flag', async () => {
  fresh();
  const a = await G.saveGrant(JACK, { googleEmail: 'personal@example.test', features: ['gmail'], refreshToken: 'rt-1' });
  const b = await G.saveGrant(JACK, { googleEmail: 'work@humankind.test', features: ['gmail'], refreshToken: 'rt-2' });
  assert.equal(await G.deleteGrant(JACK, b.id), true);
  assert.deepEqual((await G.listGrants(JACK)).map(g => g.id), [a.id]);
  const c = await G.saveGrant(JACK, { googleEmail: 'work@humankind.test', features: ['gmail'], refreshToken: 'rt-3' });
  assert.equal((await G.setDefault(JACK, c.id)).is_default, true);
  assert.deepEqual((await G.listGrants(JACK)).map(g => [g.id === c.id, g.is_default]), [[true, true], [false, false]]);
  assert.equal(await G.setDefault(PETE, c.id), null);
  assert.equal(await G.deleteGrant(JACK), true, 'removes the default (now c)');
  assert.deepEqual((await G.listGrants(JACK)).map(g => [g.id === a.id, g.is_default]), [[true, false]], 'a is left but NOT promoted');
  assert.equal(await G.getGrant(JACK), null);
});

test('purposesCovered keeps only purposes the granted features allow', () => {
  assert.deepEqual(G.purposesCovered(['drafts', 'inbox', 'calendar', 'bogus'], ['gmail']), ['drafts', 'inbox']);
  assert.deepEqual(G.purposesCovered(['calendar'], ['gmail']), []);
  assert.deepEqual(G.purposesCovered(['calendar', 'drafts'], ['gmail', 'calendar']), ['calendar', 'drafts']);
});
