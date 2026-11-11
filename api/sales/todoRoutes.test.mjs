import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { memDb } from './todoTestDb.mjs';
import { goalsDeps } from './goalsShared.js';
import { createWeekGoalRoute, updateWeekGoalRoute, deleteWeekGoalRoute, carryOverWeekGoalsRoute } from './goalsRoutes.js';
import { undoTodoEventRoute, undoTodoBatchRoute } from './todoWrite.js';
import { todoEventLines } from './todoEvents.js';
import { openTodosFor } from './openTodos.js';
import { isSnoozed, splitSnoozed } from '../../src/constants/todoSnooze.js';
import { todoEventWords } from '../../src/constants/todoEventWords.js';
import { nudgeWaiting } from './waitingRoutes.js';

// todo-events-v1 Stage 1 - the to-do routes through the real handlers on an in-memory database: every write is one
// event, expect is a 409 with the row, Undo is the server's, a snoozed to-do is hidden by the one rule, and no file
// but todoWrite.js writes a to-do.
const B = 'b0000000-0000-4000-8000-000000000000', ANA = 'a0000000-0000-4000-8000-000000000000', BO = 'c0000000-0000-4000-8000-000000000000';
const W = '2026-11-09', NEXT = '2026-11-16';
const P = 'e0000000-0000-4000-8000-000000000000';
const fresh = () => { const db = memDb({ sales_goals: [{ id: P, business_id: B, name: 'MetLife', goal_type: 'partnership' }], business_members: [{ id: 'm1', business_id: B, user_id: ANA, name: 'Ana Member' }, { id: 'm2', business_id: B, user_id: BO, name: 'Bo Member' }] }); goalsDeps.supabase = db; return db; };
const call = async (route, { params = {}, body = {}, role = 'member', user = ANA, query = {} } = {}) => {
  const out = { status: 200, body: null };
  const res = { status(s) { out.status = s; return res; }, json(b) { out.body = b; return res; } };
  await route({ params: { businessId: B, ...params }, body, query, auth: { user: { id: user }, isPlatformOwner: false, roles: new Map([[B, role]]) } }, res);
  return out;
};
const todo = (db, body = {}) => call(createWeekGoalRoute, { body: { week_start: W, kind: 'todo', text: 'Call MetLife', owner_user_id: ANA, due_date: '2026-11-12', ...body } });
const events = db => db.tables.sales_todo_events || [];

test('POST goals/week: a to-do is created by the one writer with one create event and its origin; a commitment writes no event; to-do-only fields are refused on a commitment', async () => {
  const db = fresh();
  const r = await todo(db);
  assert.equal(r.status, 201); assert.equal(r.body.event.kind, 'create'); assert.equal(r.body.goal.origin, 'manual'); assert.equal(r.body.event.actor_user_id, ANA);
  const s = await todo(db, { origin: 'scout', person_key: 'prospect:c1', link_type: null });
  assert.deepEqual([s.body.goal.origin, s.body.event.origin, s.body.goal.person_key, s.body.event.after.person_key], ['scout', 'scout', 'prospect:c1', 'prospect:c1']);
  assert.equal((await todo(db, { origin: 'call_notes' })).status, 400);
  assert.equal((await todo(db, { person_key: 'someone@example.com' })).status, 400);
  const c = await call(createWeekGoalRoute, { body: { week_start: W, kind: 'commitment', text: 'Land two partners' } });
  assert.equal(c.status, 201); assert.equal(c.body.event, undefined);
  assert.equal((await call(createWeekGoalRoute, { body: { week_start: W, kind: 'commitment', text: 'x', snooze_until: NEXT } })).status, 400);
  assert.equal(events(db).length, 2);
  assert.equal(JSON.stringify(events(db)).includes('MetLife'), false, 'no to-do text in an event');
});

test('PATCH goals/week/:id: one event per change; expect that no longer holds is 409 with the current row and nothing written; a commitment honours expect with no event', async () => {
  const db = fresh();
  const { body: { goal } } = await todo(db);
  const done = await call(updateWeekGoalRoute, { params: { id: goal.id }, body: { status: 'done', expect: { updated_at: goal.updated_at } } });
  assert.equal(done.status, 200); assert.equal(done.body.event.kind, 'done'); assert.ok(done.body.goal.completed_at);
  const stale = await call(updateWeekGoalRoute, { params: { id: goal.id }, body: { owner_user_id: BO, expect: { status: 'open' } }, user: BO });
  assert.deepEqual([stale.status, stale.body.code, stale.body.goal.status, stale.body.goal.owner_user_id], [409, 'changed', 'done', ANA]);
  assert.equal((await call(updateWeekGoalRoute, { params: { id: goal.id }, body: { owner_user_id: BO, expect: 'x' } })).status, 400);
  const snooze = await call(updateWeekGoalRoute, { params: { id: goal.id }, body: { status: 'open', snooze_until: NEXT } });
  assert.equal(snooze.body.event.kind, 'undone'); assert.deepEqual(Object.keys(snooze.body.event.after).sort(), ['completed_at', 'snooze_until', 'status']);
  const text = await call(updateWeekGoalRoute, { params: { id: goal.id }, body: { text: 'Call MetLife again' } });
  assert.equal(text.status, 200); assert.equal(text.body.event, null);
  assert.deepEqual(events(db).map(e => e.kind), ['create', 'done', 'undone']);
  const { body: { goal: c } } = await call(createWeekGoalRoute, { body: { week_start: W, kind: 'commitment', text: 'Land two partners' } });
  assert.equal((await call(updateWeekGoalRoute, { params: { id: c.id }, body: { status: 'done', expect: { status: 'dropped' } } })).status, 409);
  assert.equal((await call(updateWeekGoalRoute, { params: { id: c.id }, body: { status: 'done', expect: { status: 'open' } } })).body.goal.status, 'done');
  assert.equal(events(db).length, 3);
});

test('Undo routes: one event restores before and refuses drift; a create-undo drops the to-do (origin kept); a batch is undone as one with the failed to-do named and, the commitment gone, the rest left unlinked', async () => {
  const db = fresh();
  const made = await todo(db, { origin: 'panel' });
  const due = await call(updateWeekGoalRoute, { params: { id: made.body.goal.id }, body: { due_date: '2026-11-20' } });
  const back = await call(undoTodoEventRoute, { params: { id: due.body.event.id }, user: BO });
  assert.deepEqual([back.status, back.body.goal.due_date, back.body.event.kind, back.body.undid.kind], [200, '2026-11-12', 'undo', 'due']);
  assert.equal((await call(undoTodoEventRoute, { params: { id: due.body.event.id } })).status, 409);
  const moved = await call(updateWeekGoalRoute, { params: { id: made.body.goal.id }, body: { owner_user_id: BO } });
  await call(updateWeekGoalRoute, { params: { id: made.body.goal.id }, body: { owner_user_id: ANA } });
  const drift = await call(undoTodoEventRoute, { params: { id: moved.body.event.id } });
  assert.deepEqual([drift.status, drift.body.code], [409, 'drift']);
  const made2 = await todo(db, { origin: 'panel' });
  const gone = await call(undoTodoEventRoute, { params: { id: made2.body.event.id } });
  assert.deepEqual([gone.body.goal.status, gone.body.goal.origin, db.tables.sales_week_goals.some(g => g.id === made2.body.goal.id)], ['dropped', 'panel', true]);
  assert.equal((await call(undoTodoEventRoute, { params: { id: 'nope' } })).status, 404);

  // a commitment deleted: the to-dos that pointed at it are unlinked as ONE batch of link events, undone as one
  const { body: { goal: c } } = await call(createWeekGoalRoute, { body: { week_start: W, kind: 'commitment', text: 'Land two partners' } });
  const linked = [];
  for (let i = 0; i < 3; i++) linked.push((await todo(db, { text: `Step ${i}`, link_type: 'commitment', link_id: c.id })).body.goal);
  const del = await call(deleteWeekGoalRoute, { params: { id: c.id }, user: ANA });
  assert.deepEqual([del.status, del.body.unlinked], [200, 3]);
  assert.deepEqual(db.tables.sales_week_goals.filter(g => linked.some(l => l.id === g.id)).map(g => g.link_type), [null, null, null]);
  db.tables.sales_week_goals.find(g => g.id === linked[1].id).link_type = 'partner';
  const batch = await call(undoTodoBatchRoute, { params: { batchId: del.body.batch_id } });
  // the commitment is gone (Stage 2 ruling): the two untouched to-dos stay unlinked and the result says so; the drifted one is named as failed
  assert.deepEqual([batch.status, batch.body.undone.length, batch.body.failed.map(f => f.todo_id), batch.body.left_unlinked.map(f => f.todo_id).sort()], [200, 0, [linked[1].id], [linked[0].id, linked[2].id].sort()]);
  assert.match(batch.body.left_unlinked[0].note, /commitment is gone/);
  assert.deepEqual([linked[0], linked[2]].map(l => db.tables.sales_week_goals.find(g => g.id === l.id).link_id), [null, null]);
});

test('T9 DELETE: a member cannot delete a to-do even within two minutes; an admin can, and the delete leaves a drop event', async () => {
  const db = fresh();
  const { body: { goal } } = await todo(db);
  const no = await call(deleteWeekGoalRoute, { params: { id: goal.id }, user: ANA, role: 'member' });
  assert.deepEqual([no.status, /Only an admin/.test(no.body.error), db.tables.sales_week_goals.length], [403, true, 1]);
  const yes = await call(deleteWeekGoalRoute, { params: { id: goal.id }, role: 'admin' });
  assert.deepEqual([yes.status, yes.body.event.kind, db.tables.sales_week_goals.length], [200, 'drop', 0]);
  assert.deepEqual(events(db).map(e => e.kind), ['create', 'drop']);
});

test('carry over: a to-do is carried by the one writer (origin carry_over, one create event, one batch) and is born linked to the carried commitment; a nudge is origin nudge', async () => {
  const db = fresh();
  const { body: { goal: c } } = await call(createWeekGoalRoute, { body: { week_start: W, kind: 'commitment', text: 'Land two partners', sort_order: 5 } });
  await todo(db, { link_type: 'commitment', link_id: c.id, sort_order: 0, snooze_until: '2026-11-30' });
  const r = await call(carryOverWeekGoalsRoute, { body: { week_start: NEXT } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.carried.length, 2);
  const [cc, tt] = [r.body.carried.find(g => g.kind === 'commitment'), r.body.carried.find(g => g.kind === 'todo')];
  assert.deepEqual([tt.origin, tt.link_id, tt.snooze_until, tt.week_start], ['carry_over', cc.id, '2026-11-30', NEXT]);
  assert.deepEqual(events(db).filter(e => e.todo_id === tt.id).map(e => [e.kind, e.origin, !!e.batch_id]), [['create', 'carry_over', true]]);
  assert.equal((await call(carryOverWeekGoalsRoute, { body: { week_start: NEXT } })).body.carried.length, 0);
  db.tables.sales_week_goals.push({ id: 'd0000000-0000-4000-8000-000000000000', business_id: B, kind: 'waiting', status: 'open', text: 'the deck', waiting_on: 'Brad', link_type: 'partner', link_id: 'p1' });
  const n = await nudgeWaiting(db, { businessId: B, userId: ANA, id: 'd0000000-0000-4000-8000-000000000000' });
  assert.deepEqual([n.status, n.body.todo.origin, n.body.event.kind, n.body.event.origin], [201, 'nudge', 'create', 'nudge']);
});

test('T6 snooze: hidden from the open to-dos until its LA day by the one rule; snoozed: only / all for the chip; the count rides with the read', async () => {
  const db = fresh();
  const a = (await todo(db, { text: 'A' })).body.goal, b = (await todo(db, { text: 'B' })).body.goal;
  await call(updateWeekGoalRoute, { params: { id: b.id }, body: { snooze_until: '2026-11-16' } });
  const read = (opts = {}) => openTodosFor(db, B, null, { today: '2026-11-11', ...opts });
  const hide = await read();
  assert.deepEqual([hide.rows.map(r => r.id), hide.total, hide.snoozed], [[a.id], 1, 1]);
  assert.deepEqual((await read({ snoozed: 'only' })).rows.map(r => r.id), [b.id]);
  assert.equal((await read({ snoozed: 'all' })).total, 2);
  assert.equal((await read({ today: '2026-11-16' })).total, 2, 'back on its day');
  assert.equal((await read({ cols: 'id, status, due_date, created_at' })).snoozed, 1);
  assert.deepEqual([isSnoozed({ snooze_until: '2026-11-16' }, '2026-11-15'), isSnoozed({ snooze_until: '2026-11-16' }, '2026-11-16'), isSnoozed({ snooze_until: null }, '2026-11-15'), isSnoozed({}, '2026-11-15')], [true, false, false, false]);
  assert.deepEqual(splitSnoozed([a, { ...b, snooze_until: '2026-11-16' }], '2026-11-11').snoozed.map(t => t.id), [b.id]);
  await call(updateWeekGoalRoute, { params: { id: b.id }, body: { snooze_until: null } });
  assert.deepEqual(events(db).filter(e => e.todo_id === b.id).map(e => e.kind), ['create', 'snooze', 'unsnooze']);
});

test('T8 readers: the lines carry the to-do\'s text and link from the row, the words per kind, a user id for the actor; a record\'s activity = its to-dos\' events', async () => {
  const db = fresh();
  const { body: { goal } } = await todo(db, { link_type: 'partner', link_id: P });
  await todo(db, { text: 'Other' });
  await call(updateWeekGoalRoute, { params: { id: goal.id }, body: { status: 'done' }, user: BO });
  const all = await todoEventLines(db, B, {});
  assert.equal(all.length, 3);
  const mine = await todoEventLines(db, B, { link: { type: 'partner', id: P } });
  assert.deepEqual(mine.map(e => [e.kind, e.words, e.by_user, e.todo.text]).sort(), [['create', 'added', ANA, 'Call MetLife'], ['done', 'done', BO, 'Call MetLife']]);
  assert.deepEqual(await todoEventLines(db, B, { link: { type: 'partner', id: 'f0000000-0000-4000-8000-000000000000' } }), []);
  assert.equal((await todoEventLines(db, B, { todoId: goal.id })).length, 2);
  assert.deepEqual(['create', 'done', 'undone', 'reassign', 'due', 'drop', 'snooze', 'unsnooze', 'link', 'undo'].map(kind => todoEventWords({ kind, after: { due_date: '2026-11-20', snooze_until: '2026-11-16', owner_user_id: ANA, link_type: 'partner' } })),
    ['added', 'done', 'reopened', 'reassigned', 'due Nov 20', 'dropped', 'snoozed until Nov 16', 'unsnoozed', 'linked', 'undone']);
  assert.equal(JSON.stringify(all).includes('@'), false);
});

// T3 / R1 / R5: no file but todoWrite.js writes sales_week_goals, except these - each named with what it writes.
const EXEMPT = {
  'goalsRoutes.js': 'commitments, waiting rows and flags: create, PATCH, the commitment delete, the carried commitment / flag (R1)',
  'huddleFlags.js': 'flags: their own events and delete (R1)',
  'intakeDeal.js': 'waiting rows from call notes and their rollback (R1)',
  'masterImport.js': 'the import\'s bulk insert, origin import (R5)',
  'weekPlanRoutes.js': 'commitments of a plan: insert, replace-open drop, rollback (R1)',
  'todoWrite.js': 'the one writer',
};
test('grep: a direct write to sales_week_goals lives only in todoWrite.js and the files exempt by name', () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const WRITE = /from\(\s*'sales_week_goals'\s*\)\s*\.\s*(insert|update|delete|upsert)\s*\(/g;
  const found = {};
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name)) { const n = (fs.readFileSync(p, 'utf8').match(WRITE) || []).length; if (n) found[path.relative(path.join(dir, '..'), p)] = n; } } };
  walk(path.join(dir, '..'));
  assert.deepEqual(Object.keys(found).filter(f => !EXEMPT[path.basename(f)] || !f.startsWith('sales/')), [], `a second writer of to-dos: ${JSON.stringify(found)}`);
  // the exempt files hold exactly the statements counted when they were named; one more needs a reason here
  assert.deepEqual(found, { 'sales/goalsRoutes.js': 4, 'sales/huddleFlags.js': 7, 'sales/intakeDeal.js': 2, 'sales/masterImport.js': 1, 'sales/weekPlanRoutes.js': 4, 'sales/todoWrite.js': 9 });
});
