// person-owner-v1 Stage 1 - the one writer of a person's owner on the in-memory database: key resolution across the
// three tables, one event per assign, expect, the member check, Undo (restore, drift, window), the batch, the two
// routes, the Viewer gate, the Huddle PATCH rerouted, and the text enum never written. 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { memDb } from './todoTestDb.mjs';
import { goalsDeps } from './goalsShared.js';
import { applyPerson, applyPeople, undoPersonEvent, undoPersonBatch, loadPerson, assignPersonRoute, undoPersonEventRoute, PersonError, UNDO_WINDOW_MS } from './personWrite.js';
import { updateProspectRoute } from './huddleRoutes.js';

const B = 'b0000000-0000-4000-8000-000000000000', OTHER = 'b0000000-0000-4000-8000-000000000009';
const ANA = 'a0000000-0000-4000-8000-000000000000', BO = 'c0000000-0000-4000-8000-000000000000', ZED = 'd0000000-0000-4000-8000-000000000000';
const P1 = 'e0000000-0000-4000-8000-000000000001', P2 = 'e0000000-0000-4000-8000-000000000002', C1 = 'f0000000-0000-4000-8000-000000000001';
const fresh = () => memDb({
  business_members: [{ business_id: B, user_id: ANA, name: 'Ana Member', role: 'member' }, { business_id: B, user_id: BO, name: 'Bo Member', role: 'member' }, { business_id: OTHER, user_id: ZED, name: 'Zed Elsewhere', role: 'member' }],
  sales_prospect_state: [{ business_id: B, contact_id: 'c1', name: 'Dana Mayer', owner: 'jack', owner_user_id: ANA, status: 'new', updated_at: '2026-11-01T00:00:00Z' }, { business_id: B, contact_id: 'c2', name: 'Lee Stone', owner: 'unassigned', owner_user_id: null, status: 'new' }],
  sales_people: [{ id: P1, business_id: B, name: 'Sam Visitor', owner_user_id: null, archived_at: null }, { id: P2, business_id: B, name: 'Old Row', owner_user_id: null, archived_at: '2026-10-01T00:00:00Z' }],
  partner_contacts: [{ id: C1, business_id: B, name: 'Pat Partner', owner_user_id: BO }],
  sales_person_events: [],
});
const events = db => db.tables.sales_person_events;
const refuses = async (fn, status, code) => { await assert.rejects(fn, e => e instanceof PersonError && e.status === status && (!code || e.code === code)); };
const assign = (db, personKey, to, extra = {}) => applyPerson(db, { businessId: B, personKey, fields: { owner_user_id: to }, actor: ANA, origin: 'manual', ...extra });

test('person_key resolves to its table and row: prospect by contact id, person and contact by uuid; a bad key, another workspace, an archived person = not found', async () => {
  const db = fresh();
  assert.deepEqual(await loadPerson(db, B, 'prospect:c1'), { key: 'prospect:c1', table: 'sales_prospect_state', idCol: 'contact_id', id: 'c1', name: 'Dana Mayer', owner_user_id: ANA });
  assert.equal((await loadPerson(db, B, `person:${P1}`)).table, 'sales_people');
  assert.deepEqual([(await loadPerson(db, B, `contact:${C1}`)).table, (await loadPerson(db, B, `contact:${C1}`)).owner_user_id], ['partner_contacts', BO]);
  for (const k of ['', 'c1', 'todo:c1', 'person:not-a-uuid', `person:${P2}`, 'prospect:nobody', `contact:${P1}`]) assert.equal(await loadPerson(db, B, k), null, k);
  assert.equal(await loadPerson(db, OTHER, 'prospect:c1'), null);
  await refuses(() => assign(db, 'prospect:nobody', BO), 404);
});

test('assign: exactly one event with before / after = the owner ids, on each of the three tables; the same owner again = no event; Unassigned = null', async () => {
  const db = fresh();
  const r = await assign(db, 'prospect:c1', BO, { origin: 'scout' });
  assert.deepEqual(r.person, { key: 'prospect:c1', name: 'Dana Mayer', owner_user_id: BO });
  assert.deepEqual([r.event.kind, r.event.before, r.event.after, r.event.actor_user_id, r.event.origin, r.event.person_key], ['assign', { owner_user_id: ANA }, { owner_user_id: BO }, ANA, 'scout', 'prospect:c1']);
  assert.equal(db.tables.sales_prospect_state[0].owner_user_id, BO);
  assert.equal((await assign(db, 'prospect:c1', BO)).event, null);
  await assign(db, `person:${P1}`, ANA); await assign(db, `contact:${C1}`, null);
  assert.deepEqual([db.tables.sales_people[0].owner_user_id, db.tables.partner_contacts[0].owner_user_id], [ANA, null]);
  assert.equal(events(db).length, 3);
  assert.equal(JSON.stringify(events(db)).includes('Dana'), false, 'an event holds ids, never a name');
  assert.equal(JSON.stringify(events(db)).includes('@'), false);
});

test('expect: an owner that differs from what the screen showed is 409 with the current owner, never overwritten; the new owner must be a member of this workspace; origin and kind are checked', async () => {
  const db = fresh();
  await assert.rejects(() => assign(db, 'prospect:c1', BO, { expect: { owner_user_id: null } }), e => e.status === 409 && e.code === 'changed' && e.owner_user_id === ANA);
  assert.equal(db.tables.sales_prospect_state[0].owner_user_id, ANA); assert.equal(events(db).length, 0);
  assert.ok((await assign(db, 'prospect:c1', BO, { expect: { owner_user_id: ANA } })).event);
  await refuses(() => assign(db, 'prospect:c2', ZED), 400);
  await refuses(() => assign(db, 'prospect:c2', 'ana'), 400);
  await refuses(() => assign(db, 'prospect:c2', BO, { origin: 'somewhere' }), 400);
  await refuses(() => applyPerson(db, { businessId: B, personKey: 'prospect:c2', kind: 'rename', fields: { owner_user_id: BO }, origin: 'manual' }), 400);
  await refuses(() => applyPerson(db, { businessId: B, personKey: 'prospect:c2', fields: {}, origin: 'manual' }), 400);
  assert.equal(db.tables.sales_prospect_state[1].owner_user_id, null);
});

test('Undo: restores the owner before, stamps the event and adds an undo row; refused when the owner changed since, after the window, twice, and on an undo row', async () => {
  const db = fresh();
  const { event } = await assign(db, 'prospect:c1', BO);
  const u = await undoPersonEvent(db, { businessId: B, eventId: event.id, actor: BO });
  assert.deepEqual([u.person.owner_user_id, u.event.kind, u.event.undo_of, u.event.actor_user_id, u.event.before, u.event.after], [ANA, 'undo', event.id, BO, { owner_user_id: BO }, { owner_user_id: ANA }]);
  assert.equal(db.tables.sales_prospect_state[0].owner_user_id, ANA); assert.ok(events(db).find(e => e.id === event.id).undone_at);
  await refuses(() => undoPersonEvent(db, { businessId: B, eventId: event.id }), 409);
  await refuses(() => undoPersonEvent(db, { businessId: B, eventId: u.event.id }), 409);
  const second = await assign(db, 'prospect:c1', BO);
  db.tables.sales_prospect_state[0].owner_user_id = null;
  await refuses(() => undoPersonEvent(db, { businessId: B, eventId: second.event.id }), 409, 'drift');
  assert.equal(db.tables.sales_prospect_state[0].owner_user_id, null);
  const third = await assign(db, `person:${P1}`, BO);
  await refuses(() => undoPersonEvent(db, { businessId: B, eventId: third.event.id, now: new Date(Date.now() + UNDO_WINDOW_MS + 1000) }), 409, 'expired');
  await refuses(() => undoPersonEvent(db, { businessId: B, eventId: 'nope' }), 404);
  await refuses(() => undoPersonEvent(db, { businessId: OTHER, eventId: third.event.id }), 404);
});

test('a batch: several people to one owner under one batch id, a person already there or gone is skipped; undone as one with the drifted person named', async () => {
  const db = fresh();
  const batch = await applyPeople(db, { businessId: B, personKeys: ['prospect:c1', 'prospect:c2', `person:${P1}`, `contact:${C1}`, 'prospect:nobody'], fields: { owner_user_id: BO }, actor: ANA, origin: 'scout' });
  assert.deepEqual(batch.people.map(p => p.key), ['prospect:c1', 'prospect:c2', `person:${P1}`]);
  assert.equal(new Set(batch.events.map(e => e.batch_id)).size, 1); assert.equal(batch.events[0].batch_id, batch.batchId);
  db.tables.sales_prospect_state[1].owner_user_id = ANA;
  const r = await undoPersonBatch(db, { businessId: B, batchId: batch.batchId, actor: ANA });
  assert.deepEqual([r.undone.length, r.failed.map(f => f.person_key)], [2, ['prospect:c2']]);
  assert.deepEqual([db.tables.sales_prospect_state[0].owner_user_id, db.tables.sales_people[0].owner_user_id, db.tables.sales_prospect_state[1].owner_user_id], [ANA, null, ANA]);
  await refuses(() => undoPersonBatch(db, { businessId: B, batchId: 'a1111111-1111-4111-8111-111111111111' }), 409);
});

const call = async (route, { params = {}, body = {}, user = ANA, role = 'member' } = {}) => {
  let status = 200, out = null;
  const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; } };
  await route({ params: { businessId: B, ...params }, body, query: {}, method: 'POST', auth: { user: { id: user, email: 'never-stored' }, isPlatformOwner: false, roles: new Map([[B, role]]) } }, res);
  return { status, body: out };
};

test('routes: POST goals/people/:key/assign and events/:id/undo; a stale expect is 409 with the current owner; a missing owner or a foreign origin is 400; a Viewer is refused by the sales gate', async () => {
  const db = fresh(); goalsDeps.supabase = db;
  try {
    const a = await call(assignPersonRoute, { params: { key: 'prospect:c2' }, body: { owner_user_id: BO, expect: { owner_user_id: null } } });
    assert.deepEqual([a.status, a.body.person.owner_user_id, a.body.event.kind, a.body.event.origin], [200, BO, 'assign', 'manual']);
    const stale = await call(assignPersonRoute, { params: { key: 'prospect:c2' }, body: { owner_user_id: ANA, expect: { owner_user_id: null } } });
    assert.deepEqual([stale.status, stale.body.code, stale.body.owner_user_id], [409, 'changed', BO]);
    assert.equal((await call(assignPersonRoute, { params: { key: 'prospect:c2' }, body: {} })).status, 400);
    assert.equal((await call(assignPersonRoute, { params: { key: 'prospect:c2' }, body: { owner_user_id: ANA, origin: 'system' } })).status, 400);
    assert.equal((await call(assignPersonRoute, { params: { key: 'prospect:zz' }, body: { owner_user_id: ANA } })).status, 404);
    const un = await call(undoPersonEventRoute, { params: { id: a.body.event.id }, user: BO });
    assert.deepEqual([un.status, un.body.person.owner_user_id, un.body.undid.kind], [200, null, 'assign']);
    // the gate every /api/sales/:businessId write passes first
    const before = process.env.SALES_ANALYTICS_BUSINESS_IDS; process.env.SALES_ANALYTICS_BUSINESS_IDS = B;
    const { salesGate } = await import('../lib/requireAuth.js');
    const gate = role => { let status = 200, passed = false; const res = { status(s) { status = s; return res; }, json() { return res; } }; salesGate({ method: 'POST', params: { businessId: B }, auth: { isPlatformOwner: false, roles: new Map([[B, role]]) } }, res, () => { passed = true; }); return [status, passed]; };
    assert.deepEqual([gate('viewer'), gate('member')], [[403, false], [200, true]]);
    process.env.SALES_ANALYTICS_BUSINESS_IDS = before ?? '';
  } finally { goalsDeps.supabase = null; }
});

test('the Huddle PATCH: owner_user_id goes through the one writer (an event, expect honoured, with the other fields in the same call); the old text enum is refused and never written', async () => {
  const db = fresh(); goalsDeps.supabase = db;
  try {
    const r = await call(updateProspectRoute, { params: { contactId: 'c1' }, body: { owner_user_id: BO, status: 'claimed', expect: { owner_user_id: ANA } } });
    assert.deepEqual([r.status, r.body.prospect.owner_user_id, r.body.prospect.status, r.body.owner_event.kind], [200, BO, 'claimed', 'assign']);
    assert.equal(events(db).length, 1);
    const only = await call(updateProspectRoute, { params: { contactId: 'c1' }, body: { owner_user_id: null } });
    assert.deepEqual([only.status, only.body.prospect.owner_user_id, only.body.owner_event.after], [200, null, { owner_user_id: null }]);
    const stale = await call(updateProspectRoute, { params: { contactId: 'c1' }, body: { owner_user_id: ANA, expect: { owner_user_id: BO } } });
    assert.deepEqual([stale.status, stale.body.code], [409, 'changed']);
    assert.equal((await call(updateProspectRoute, { params: { contactId: 'c1' }, body: { owner: 'cyrus' } })).status, 400);
    assert.equal((await call(updateProspectRoute, { params: { contactId: 'c1' }, body: { owner_user_id: ZED } })).status, 400);
    assert.equal((await call(updateProspectRoute, { params: { contactId: 'zz' }, body: { owner_user_id: BO } })).status, 404);
    assert.deepEqual(db.tables.sales_prospect_state.map(p => p.owner), ['jack', 'unassigned'], 'the enum is as it was');
  } finally { goalsDeps.supabase = null; }
});

test('grep: owner_user_id on a people table is written only by personWrite.js, and no statement in api/ writes the text enum `owner` to sales_prospect_state', () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const WRITE = /from\(\s*'(sales_prospect_state|sales_people|partner_contacts)'\s*\)\s*\.\s*(?:insert|update|upsert)\s*\(([^;]*)/g;
  const owners = {}, enums = {};
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name)) {
    const rel = path.relative(path.join(dir, '..'), p);
    for (const m of fs.readFileSync(p, 'utf8').matchAll(WRITE)) { if (/\bowner_user_id\b/.test(m[2])) owners[rel] = (owners[rel] || 0) + 1; if (m[1] === 'sales_prospect_state' && /\bowner\s*[:,}]/.test(m[2])) enums[rel] = (enums[rel] || 0) + 1; }
  } } };
  walk(path.join(dir, '..'));
  // personWrite.js reaches the three tables through its TABLES map, so no statement that names one of them may set the owner
  assert.deepEqual(owners, {}, `a second writer of a person's owner: ${JSON.stringify(owners)}`);
  assert.match(fs.readFileSync(path.join(dir, 'personWrite.js'), 'utf8'), /update\(\{ owner_user_id: to, updated_at/);
  assert.deepEqual(enums, {}, 'the prospect owner enum is written');
  // the enum's two names are gone from the sales server code (the HumanKind importer has its own, unrelated hints)
  const named = [];
  const scan = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) scan(p); else if (/\.js$/.test(f.name) && /['"]cyrus['"]/.test(fs.readFileSync(p, 'utf8'))) named.push(f.name); } };
  scan(dir); scan(path.join(dir, '..', 'scout'));
  assert.deepEqual(named, []);
});
