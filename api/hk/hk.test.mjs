import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHkGate } from '../lib/requireAuth.js';
import { shellPayload } from './shell.js';
import { HK_MODULES } from '../../src/constants/hkModules.js';

// hkos-project-shell-v1 Stage 1 - hkGate and the shell payload. req.auth is stubbed (Jack's ruling: no temp users).
const HK = 'biz-hk';
const auth = (roles = {}, isPlatformOwner = false) => ({ user: { id: 'u-me', name: 'Sam Rivers' }, isPlatformOwner, roles: new Map(Object.entries(roles)) });
const call = async (gate, { method = 'GET', path = '/shell', a = auth({ [HK]: 'viewer' }) } = {}) => {
  const out = { status: 200, body: null, next: false };
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  await gate({ method, path, params: { businessId: HK }, auth: a }, res, () => { out.next = true; });
  return out;
};
const gateWith = features => { let reads = 0; const g = makeHkGate(async () => { reads++; return features; }); g.reads = () => reads; return g; };

test('gate: 403 when hk_sales is off or the workspace has no features', async () => {
  for (const f of [{}, { hk_sales: false }, { goals_sales: true }, null]) {
    const r = await call(gateWith(f), { a: auth({ [HK]: 'owner' }, true) });
    assert.equal(r.status, 403); assert.equal(r.next, false);
    assert.equal(r.body.error, 'HumanKind Sales OS is not enabled for this workspace');
  }
});

test('gate: non-member 403, viewer GET passes, viewer POST/PATCH/DELETE 403 on any /api/hk path', async () => {
  const g = gateWith({ hk_sales: true });
  assert.equal((await call(g, { a: auth({ other: 'owner' }) })).status, 403);
  assert.equal((await call(g, { a: auth() })).status, 403);
  const v = await call(g); assert.equal(v.next, true);
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    for (const path of ['/shell', '/brands', '/anything/else']) {
      const r = await call(g, { method, path }); assert.equal(r.status, 403); assert.equal(r.next, false);
    }
  }
  assert.equal((await call(g, { method: 'POST', a: auth({ [HK]: 'member' }) })).next, true);
  assert.equal((await call(g, { method: 'POST', a: auth({}, true) })).next, true, 'platform owner passes like every other gate');
});

test('gate: the flag is read once per workspace per minute; a read error is a 500', async () => {
  const g = gateWith({ hk_sales: true });
  await call(g); await call(g); await call(g);
  assert.equal(g.reads(), 1);
  const bad = makeHkGate(async () => { throw new Error('db down'); });
  const r = await call(bad); assert.equal(r.status, 500); assert.equal(r.next, false);
});

const rows = [
  { user_id: 'u-me', name: 'Sam Rivers', role: 'owner', created_at: '2026-08-01T00:00:00Z', profile: { display_name: 'Sam Rivers' } },
  { user_id: null, name: 'typed-with-@-sign', role: 'member', created_at: '2026-09-01T00:00:00Z', profile: null },
  { user_id: 'u-3', name: 'Typed Name', role: 'viewer', created_at: '2026-09-02T00:00:00Z', profile: { display_name: '' } },
  { user_id: 'u-4', name: 'Dee', role: 'admin', created_at: '2026-09-03T00:00:00Z', profile: { display_name: 'Deandra   Lopez' } },
  { user_id: 'u-5', name: '', role: 'member', created_at: '2026-09-04T00:00:00Z', profile: null },
];

test('shell payload: no "@" anywhere, even when a member name has one typed into it', () => {
  const p = shellPayload(rows, auth({ [HK]: 'owner' }), HK);
  assert.ok(!JSON.stringify(p).includes('@'));
});

test('shell payload: first_name fallbacks (display_name, then member name, then "Invited member")', () => {
  const p = shellPayload(rows, auth({ [HK]: 'owner' }), HK);
  assert.deepEqual(p.members.map(m => m.first_name), ['Sam', 'Deandra', 'Invited member', 'Invited member', 'Typed']);
  assert.deepEqual(p.members.map(m => m.signed_up), [true, true, true, false, true]);
  assert.deepEqual(p.me, { user_id: 'u-me', role: 'owner', first_name: 'Sam', owner_filter: 'me', avatar_slot: null });
  assert.deepEqual(shellPayload(rows, auth({ [HK]: 'owner' }), HK, [{ user_id: 'u-me', avatar_slot: 3, owner_filter: 'all' }]).me, { user_id: 'u-me', role: 'owner', first_name: 'Sam', owner_filter: 'all', avatar_slot: 3 });
});

// FIX hkos-avatar-order-v1 - palette and list order: role, then signed up, then join date.
test('shell payload: the signed-in owner is slot 1 even when an invited member joined earlier', () => {
  const p = shellPayload([
    { user_id: null, name: 'Peter Example', role: 'member', created_at: '2026-08-13T00:00:00Z', profile: null },
    { user_id: 'u-me', name: 'Jack Example', role: 'owner', created_at: '2026-10-02T00:00:00Z', profile: { display_name: 'Jack Example' } },
  ], auth({ [HK]: 'owner' }), HK);
  assert.deepEqual(p.members.map(m => [m.first_name, m.palette_index]), [['Jack', 1], ['Peter', 2]]);
});

test('shell payload: palette by role, then signed up, then join date; wraps after four', () => {
  const p = shellPayload(rows, auth({ [HK]: 'owner' }), HK);
  assert.deepEqual(p.members.map(m => m.palette_index), [1, 2, 3, 4, 1]);
  const tie = shellPayload([
    { user_id: 'u-b', name: 'Bea', role: 'owner', created_at: '2026-09-02T00:00:00Z', profile: null },
    { user_id: 'u-a', name: 'Ari', role: 'owner', created_at: '2026-09-01T00:00:00Z', profile: null },
  ], auth({ [HK]: 'owner' }), HK);
  assert.deepEqual(tie.members.map(m => [m.first_name, m.palette_index]), [['Ari', 1], ['Bea', 2]]);
});

test('shell payload: platform owner without a membership reads as owner; modules = the read-only list', () => {
  const p = shellPayload(rows.slice(1), auth({}, true), HK);
  assert.equal(p.me.role, 'owner');
  assert.equal(p.me.first_name, 'Sam');
  assert.equal(p.modules, HK_MODULES);
  assert.deepEqual(HK_MODULES.filter(m => m.on).map(m => m.key), ['email']);
});

test('visual-nav-cleanup-v1 W2: the shell payload carries each member\'s last_seen_at; the stamp writes mine and a missing column (42703) is skipped quietly', async () => {
  const { shellPayload, stampSeen } = await import('./shell.js');
  const rows = [{ user_id: 'u-jack', name: 'Jack Carlson', role: 'owner', created_at: '2026-10-01T00:00:00Z', profile: { display_name: 'Jack Carlson' } }, { user_id: 'u-pete', name: 'Pete Zz', role: 'member', created_at: '2026-10-02T00:00:00Z', profile: { display_name: 'Pete Zz' } }];
  const auth = { user: { id: 'u-jack', name: 'Jack Carlson' }, roles: new Map([['b1', 'owner']]), isPlatformOwner: false };
  const out = shellPayload(rows, auth, 'b1', [{ user_id: 'u-pete', avatar_slot: 2, last_seen_at: '2026-10-20T12:00:00Z' }]);
  assert.deepEqual(out.members.map(m => [m.first_name, m.last_seen_at]), [['Jack', null], ['Pete', '2026-10-20T12:00:00Z']]);
  const calls = [];
  const fake = err => ({ from: t => ({ update: patch => ({ eq: (k1, v1) => ({ eq: async (k2, v2) => { calls.push([t, Object.keys(patch), v1, v2]); return { error: err }; } }) }) }) });
  await stampSeen(fake(null), 'b1', 'u-jack', new Date('2026-10-28T12:00:00Z'));
  assert.deepEqual(calls[0], ['hk_member_prefs', ['last_seen_at'], 'b1', 'u-jack']);
  const logged = []; const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
  await stampSeen(fake({ code: '42703', message: 'column does not exist' }), 'b1', 'u-jack');
  console.error = orig;
  assert.deepEqual(logged, [], 'a missing column before the migration runs is not an error');
});
