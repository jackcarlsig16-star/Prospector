import test from 'node:test';
import assert from 'node:assert/strict';
import { memDb } from './todoTestDb.mjs';
import { applyTodo, applyTodos, createTodos, undoTodoEvent, undoTodoBatch, rollbackCreates, deleteTodo, kindOf, TodoError, UNDO_WINDOW_MS, TODO_EVENT_KINDS, TODO_ORIGINS } from './todoWrite.js';

const B = 'b0000000-0000-4000-8000-000000000000', ANA = 'a0000000-0000-4000-8000-000000000000', BO = 'c0000000-0000-4000-8000-000000000000';
const base = { week_start: '2026-11-09', text: 'Call MetLife', status: 'open', owner_user_id: ANA, due_date: '2026-11-12', sort_order: 0, created_by: ANA };
const setup = async (n = 1, extra = {}) => { const db = memDb(); const r = await createTodos(db, { businessId: B, rows: Array.from({ length: n }, (_, i) => ({ ...base, text: `To-do ${i + 1}`, ...extra })), actor: ANA, origin: 'manual' }); return { db, ...r, events: () => db.tables.sales_todo_events, row: id => db.tables.sales_week_goals.find(x => x.id === id) }; };
const refuses = async (fn, status, code) => { await assert.rejects(fn, e => e instanceof TodoError && e.status === status && (!code || e.code === code)); };

test('create: one event per to-do with the origin on both, the structured fields in after, never the text', async () => {
  const s = await setup(2);
  assert.equal(s.todos.length, 2); assert.equal(s.events().length, 2);
  assert.deepEqual(s.todos.map(t => t.origin), ['manual', 'manual']);
  const e = s.events()[0];
  assert.equal(e.kind, 'create'); assert.equal(e.origin, 'manual'); assert.equal(e.actor_user_id, ANA); assert.deepEqual(e.before, {});
  assert.deepEqual(e.after, { status: 'open', completed_at: null, owner_user_id: ANA, due_date: '2026-11-12', snooze_until: null, link_type: null, link_id: null, person_key: null });
  assert.equal(JSON.stringify(s.events()).includes('To-do'), false);
  await refuses(() => createTodos(s.db, { businessId: B, rows: [base], origin: 'somewhere' }), 400);
  await refuses(() => createTodos(s.db, { businessId: B, rows: [{ ...base, kind: 'commitment' }], origin: 'manual' }), 400);
  // an event that cannot be written takes the to-do with it
  const db = memDb({ __fail: { sales_todo_events: { insert: 'boom' } } });
  await assert.rejects(() => createTodos(db, { businessId: B, rows: [base], origin: 'manual' }));
  assert.equal(db.tables.sales_week_goals.length, 0);
});

test('every kind is exactly one event with before / after of the changed fields only', async () => {
  const s = await setup(1); const id = s.todos[0].id;
  const step = async (patch, kind, before, after) => {
    const n = s.events().length;
    const r = await applyTodo(s.db, { businessId: B, todoId: id, patch, actor: BO, origin: 'scout' });
    assert.equal(s.events().length, n + 1, kind);
    assert.equal(r.event.kind, kind); assert.equal(r.event.origin, 'scout'); assert.equal(r.event.actor_user_id, BO);
    assert.deepEqual(r.event.before, before); assert.deepEqual(Object.keys(r.event.after).sort(), Object.keys(after).sort());
    for (const k of Object.keys(after)) if (after[k] !== '*') assert.equal(r.event.after[k], after[k]);
    return r;
  };
  await step({ owner_user_id: BO }, 'reassign', { owner_user_id: ANA }, { owner_user_id: BO });
  await step({ due_date: '2026-11-20' }, 'due', { due_date: '2026-11-12' }, { due_date: '2026-11-20' });
  await step({ snooze_until: '2026-11-16' }, 'snooze', { snooze_until: null }, { snooze_until: '2026-11-16' });
  await step({ snooze_until: null }, 'unsnooze', { snooze_until: '2026-11-16' }, { snooze_until: null });
  await step({ link_type: 'partner', link_id: 'p1' }, 'link', { link_type: null, link_id: null }, { link_type: 'partner', link_id: 'p1' });
  const done = await step({ status: 'done' }, 'done', { status: 'open', completed_at: null }, { status: 'done', completed_at: '*' });
  assert.ok(done.todo.completed_at);
  await step({ status: 'open' }, 'undone', { status: 'done', completed_at: done.todo.completed_at }, { status: 'open', completed_at: null });
  await step({ status: 'dropped' }, 'drop', { status: 'open' }, { status: 'dropped' });
  await step({ status: 'open' }, 'undone', { status: 'dropped' }, { status: 'open' });
  // several tracked fields at once = ONE event named for the first in the order, holding all of them
  const multi = await step({ status: 'done', owner_user_id: ANA, due_date: '2026-11-21' }, 'done', { status: 'open', completed_at: null, owner_user_id: BO, due_date: '2026-11-20' }, { status: 'done', completed_at: '*', owner_user_id: ANA, due_date: '2026-11-21' });
  assert.equal(multi.todo.owner_user_id, ANA);
  // nothing changed = no write, no event; a field with no kind is written and leaves no event
  const n = s.events().length;
  assert.equal((await applyTodo(s.db, { businessId: B, todoId: id, patch: { owner_user_id: ANA }, origin: 'manual' })).event, null);
  const edit = await applyTodo(s.db, { businessId: B, todoId: id, patch: { text: 'Call MetLife again', sort_order: 3 }, origin: 'manual' });
  assert.equal(edit.event, null); assert.equal(edit.todo.text, 'Call MetLife again'); assert.equal(s.events().length, n);
  assert.deepEqual([...new Set(s.events().map(e => e.kind))].every(k => TODO_EVENT_KINDS.includes(k)), true);
  assert.equal(kindOf({ person_key: 'k' }, {}), 'link'); assert.equal(TODO_ORIGINS.length, 11);
  assert.equal(JSON.stringify(s.events()).includes('@'), false);
});

test('expect: a row that differs from what the screen showed is 409 with the current row, never overwritten; commitments and flags are refused', async () => {
  const s = await setup(1); const t = s.todos[0];
  await applyTodo(s.db, { businessId: B, todoId: t.id, patch: { owner_user_id: BO }, origin: 'manual' });
  await assert.rejects(() => applyTodo(s.db, { businessId: B, todoId: t.id, patch: { status: 'done' }, expect: { owner_user_id: ANA }, origin: 'manual' }),
    e => e.status === 409 && e.code === 'changed' && e.todo.owner_user_id === BO);
  await refuses(() => applyTodo(s.db, { businessId: B, todoId: t.id, patch: { status: 'done' }, expect: { updated_at: '2020-01-01T00:00:00.000Z' }, origin: 'manual' }), 409, 'changed');
  assert.equal(s.row(t.id).status, 'open');
  const ok = await applyTodo(s.db, { businessId: B, todoId: t.id, patch: { status: 'done' }, expect: { updated_at: s.row(t.id).updated_at, owner_user_id: BO }, origin: 'manual' });
  assert.equal(ok.todo.status, 'done');
  await refuses(() => applyTodo(s.db, { businessId: B, todoId: 'd0000000-0000-4000-8000-000000000000', patch: { status: 'done' }, origin: 'manual' }), 404);
  s.db.tables.sales_week_goals.push({ id: 'e0000000-0000-4000-8000-000000000000', business_id: B, kind: 'commitment', status: 'open' }, { id: 'f0000000-0000-4000-8000-000000000000', business_id: B, kind: 'todo', status: 'open', prospect_contact_id: 'c1' });
  await refuses(() => applyTodo(s.db, { businessId: B, todoId: 'e0000000-0000-4000-8000-000000000000', patch: { status: 'done' }, origin: 'manual' }), 400);
  await refuses(() => applyTodo(s.db, { businessId: B, todoId: 'f0000000-0000-4000-8000-000000000000', patch: { status: 'done' }, origin: 'manual' }), 400);
  // a teammate's write between the read and the update: compare-and-set refuses it
  const row = { ...s.row(t.id) }; s.row(t.id).status = 'open';
  await refuses(() => applyTodo(s.db, { businessId: B, row, patch: { status: 'dropped' }, origin: 'manual' }), 409, 'changed');
});

test('undo: restores before, stamps the event, adds an undo row; refuses on drift, twice, after the window, and an undo of an undo; undo of a create = dropped, origin kept', async () => {
  const s = await setup(1, { origin: 'ignored' }); const id = s.todos[0].id;
  const { event } = await applyTodo(s.db, { businessId: B, todoId: id, patch: { status: 'done', due_date: '2026-11-30' }, actor: ANA, origin: 'manual' });
  const u = await undoTodoEvent(s.db, { businessId: B, eventId: event.id, actor: BO });
  assert.equal(u.todo.status, 'open'); assert.equal(u.todo.completed_at, null); assert.equal(u.todo.due_date, '2026-11-12');
  assert.equal(u.event.kind, 'undo'); assert.equal(u.event.undo_of, event.id); assert.equal(u.event.actor_user_id, BO);
  const stamped = s.events().find(e => e.id === event.id);
  assert.ok(stamped.undone_at); assert.equal(stamped.undone_by, BO);
  await refuses(() => undoTodoEvent(s.db, { businessId: B, eventId: event.id }), 409);
  await refuses(() => undoTodoEvent(s.db, { businessId: B, eventId: u.event.id }), 409);
  await refuses(() => undoTodoEvent(s.db, { businessId: B, eventId: 'not-an-id' }), 404);
  const moved = await applyTodo(s.db, { businessId: B, todoId: id, patch: { owner_user_id: BO }, origin: 'manual' });
  await applyTodo(s.db, { businessId: B, todoId: id, patch: { owner_user_id: ANA }, origin: 'manual' });
  await refuses(() => undoTodoEvent(s.db, { businessId: B, eventId: moved.event.id }), 409, 'drift');
  const late = await applyTodo(s.db, { businessId: B, todoId: id, patch: { due_date: '2026-12-01' }, origin: 'manual' });
  await refuses(() => undoTodoEvent(s.db, { businessId: B, eventId: late.event.id, now: new Date(Date.now() + UNDO_WINDOW_MS + 1000) }), 409, 'expired');
  assert.equal((await undoTodoEvent(s.db, { businessId: B, eventId: late.event.id, now: new Date(Date.now() + UNDO_WINDOW_MS + 1000), windowMs: 10 * 60e3 })).todo.due_date, '2026-11-12');
  const made = await applyTodo(s.db, { businessId: B, create: { ...base, text: 'Follow up' }, actor: ANA, origin: 'scout' });
  const gone = await undoTodoEvent(s.db, { businessId: B, eventId: made.event.id, actor: ANA });
  assert.equal(gone.todo.status, 'dropped'); assert.equal(gone.todo.origin, 'scout');
  assert.ok(s.row(made.todo.id), 'the row is kept');
});

test('a batch is undone as one, newest first; a to-do that drifted is named and the rest stay undone', async () => {
  const s = await setup(3);
  const batch = await applyTodos(s.db, { businessId: B, todos: s.todos, patch: { status: 'dropped' }, actor: ANA, origin: 'panel' });
  assert.equal(batch.events.length, 3); assert.equal(new Set(batch.events.map(e => e.batch_id)).size, 1); assert.equal(batch.events[0].origin, 'panel');
  s.row(s.todos[1].id).status = 'open';
  const order = []; const realFrom = s.db.from;
  s.db.from = name => { const q = realFrom(name); if (name === 'sales_week_goals') { const upd = q.update; q.update = v => { if (v.status === 'open') order.push('restore'); return upd(v); }; } return q; };
  const r = await undoTodoBatch(s.db, { businessId: B, batchId: batch.batchId, actor: ANA });
  assert.equal(r.undone.length, 2); assert.deepEqual(r.failed.map(f => f.todo_id), [s.todos[1].id]); assert.match(r.failed[0].error, /status changed since/);
  assert.deepEqual(r.undone.map(u => u.todo.status), ['open', 'open']);
  await refuses(() => undoTodoBatch(s.db, { businessId: B, batchId: 'a1111111-1111-4111-8111-111111111111' }), 409);
  // a row that changed between the read and a cascade is skipped, not an error
  const s2 = await setup(2); const stale = s2.todos.map(t => ({ ...t })); s2.row(stale[0].id).status = 'done';
  assert.equal((await applyTodos(s2.db, { businessId: B, todos: stale, patch: { status: 'dropped' }, origin: 'panel' })).events.length, 1);
});

test('R3 rollback inside a failed request deletes the rows and logs one undo event each; T9 an admin delete drops first, then removes', async () => {
  const s = await setup(2);
  await rollbackCreates(s.db, { businessId: B, todos: s.todos, actor: ANA, origin: 'call_notes' });
  assert.equal(s.db.tables.sales_week_goals.length, 0);
  const undo = s.events().filter(e => e.kind === 'undo');
  assert.equal(undo.length, 2); assert.equal(undo[0].before.status, 'open'); assert.deepEqual(undo[0].after, {}); assert.equal(undo[0].origin, 'call_notes');
  const k = await setup(1);
  const d = await deleteTodo(k.db, { businessId: B, row: k.todos[0], actor: ANA });
  assert.equal(d.event.kind, 'drop'); assert.equal(k.db.tables.sales_week_goals.length, 0); assert.equal(k.events().length, 2);
});
