import { randomUUID } from 'crypto';
import { getSupabase } from './goalsShared.js';

// todo-events-v1 T3 / T4 - the ONE writer of a to-do (sales_week_goals kind 'todo'; rulings R1-R9 of 2026-11-10).
// Every create and every change of a tracked field goes through here and leaves exactly one sales_todo_events row:
//   kind    create · done · undone · reassign · due · drop · snooze · unsnooze · link · undo
//   before  what the changed fields held        after  what they hold now      (changed fields only)
// The fields are structured (status, owner, dates, link, person key) - a to-do's text never lands in an event, so no
// address or phone can. The actor is a user id; names resolve at read time.
// A write that changes several tracked fields at once is ONE event, named for the first that changed in the order
// status > snooze > owner > due > link, holding all of them - its Undo puts all of them back.
// Fields with no kind in the table (text, week, sort order, category, the plan marks ...) are written here too and
// leave no event: there is nothing in T1 to call them.
// expect = what the caller's screen showed ({ updated_at } or field values): a row that differs is refused with 409
// and the current row, never overwritten. The update itself is compare-and-set on the fields it changes.
// Undo (T4): within UNDO_WINDOW_MS, only while the row still holds the event's `after` (409 'drift' otherwise);
// restores `before`, stamps the event undone, adds an 'undo' row. Undo of a create = status 'dropped', never a delete
// (R3: a USER's undo). rollbackCreates is the other case - a request that failed half-way removing rows it inserted
// moments ago, which never existed from the user's side: the rows are deleted and each leaves one 'undo' event.
// Commitments, waiting rows and flags are not to-dos here (R1); steps are out of scope (R4).
export const TODO_ORIGINS = ['manual', 'scout', 'call_notes', 'signal', 'tidy', 'panel', 'plan', 'nudge', 'carry_over', 'import', 'system'];
export const TODO_EVENT_KINDS = ['create', 'done', 'undone', 'reassign', 'due', 'drop', 'snooze', 'unsnooze', 'link', 'undo'];
export const UNDO_WINDOW_MS = 2 * 60e3; // screens show 10 s; the slack covers slow networks
export const TRACKED = ['status', 'completed_at', 'owner_user_id', 'due_date', 'snooze_until', 'link_type', 'link_id', 'person_key'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_COLS = 'id, todo_id, kind, before, after, actor_user_id, origin, batch_id, at, undone_at, undone_by, undo_of';

export class TodoError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
const must = r => { if (r.error) throw new TodoError(r.error.message, 500, r.error.code ? { code: r.error.code } : {}); return r.data; };
const same = (a, b) => (a ?? null) === (b ?? null);
const snapshot = (row, keys = TRACKED) => Object.fromEntries(keys.map(k => [k, row[k] ?? null]));
export const isTodo = row => !!row && row.kind === 'todo' && !row.prospect_contact_id;

// What a set of changed fields is called.
export function kindOf(changed, existing) {
  if ('status' in changed) return changed.status === 'done' ? 'done' : changed.status === 'dropped' ? 'drop' : 'undone';
  if ('snooze_until' in changed) return changed.snooze_until ? 'snooze' : 'unsnooze';
  if ('owner_user_id' in changed) return 'reassign';
  if ('due_date' in changed) return 'due';
  if (['link_type', 'link_id', 'person_key'].some(k => k in changed)) return 'link';
  return existing ? null : 'create';
}

function checkOrigin(origin) { if (!TODO_ORIGINS.includes(origin)) throw new TodoError(`origin must be one of ${TODO_ORIGINS.join('|')}`, 400); }
async function logEvents(supabase, rows) {
  return must(await supabase.from('sales_todo_events').insert(rows).select(EVENT_COLS));
}

// rows = the to-dos to insert (their columns, validated by the caller). -> { todos, events } in the rows' order.
export async function createTodos(supabase, { businessId, rows, actor = null, origin, batchId = null, now = new Date() }) {
  checkOrigin(origin);
  if (!rows.length) return { todos: [], events: [] };
  if (rows.some(r => r.kind && r.kind !== 'todo')) throw new TodoError('createTodos writes to-dos only', 400);
  const todos = must(await supabase.from('sales_week_goals').insert(rows.map(r => ({ kind: 'todo', ...r, business_id: businessId, origin }))).select());
  let events;
  try {
    events = await logEvents(supabase, todos.map(t => ({ business_id: businessId, todo_id: t.id, kind: 'create', before: {}, after: snapshot(t), actor_user_id: actor, origin, batch_id: batchId, at: now.toISOString() })));
  } catch (e) {
    // no event, no to-do: the rows this call just inserted come off again (they were never shown)
    await supabase.from('sales_week_goals').delete().in('id', todos.map(t => t.id));
    throw e;
  }
  const byTodo = new Map(events.map(e => [e.todo_id, e]));
  return { todos, events: todos.map(t => byTodo.get(t.id)) };
}

export async function loadTodo(supabase, businessId, todoId) {
  if (!UUID.test(todoId || '')) return null;
  return must(await supabase.from('sales_week_goals').select('*').eq('business_id', businessId).eq('id', todoId).maybeSingle());
}

// -> { todo, event } (event null when no tracked field changed). create: one row -> createTodos.
export async function applyTodo(supabase, { businessId, todoId = null, create = null, row = null, patch = {}, kind = null, expect = null, actor = null, origin, batchId = null, now = new Date() }) {
  checkOrigin(origin);
  if (create) { const r = await createTodos(supabase, { businessId, rows: [create], actor, origin, batchId, now }); return { todo: r.todos[0], event: r.events[0] }; }
  const existing = row || await loadTodo(supabase, businessId, todoId);
  if (!existing) throw new TodoError('to-do not found', 404);
  if (!isTodo(existing)) throw new TodoError('not a to-do', 400);
  if (expect) {
    const off = Object.keys(expect).find(k => (k === 'updated_at' ? Date.parse(expect[k]) !== Date.parse(existing.updated_at) : !same(expect[k], existing[k])));
    if (off) throw new TodoError('This to-do changed since you opened it - reloaded', 409, { code: 'changed', todo: existing });
  }
  const next = { ...patch };
  if ('status' in next && !same(next.status, existing.status)) next.completed_at = next.status === 'done' ? (existing.completed_at || now.toISOString()) : null;
  const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => !same(v, existing[k])));
  if (!Object.keys(changed).length) return { todo: existing, event: null };
  const tracked = Object.keys(changed).filter(k => TRACKED.includes(k));
  const eventKind = tracked.length ? kind || kindOf(changed, existing) : null;
  if (eventKind && !TODO_EVENT_KINDS.includes(eventKind)) throw new TodoError(`kind must be one of ${TODO_EVENT_KINDS.join('|')}`, 400);
  let q = supabase.from('sales_week_goals').update({ ...changed, updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', existing.id);
  for (const k of tracked) q = existing[k] == null ? q.is(k, null) : q.eq(k, existing[k]);
  const rows = must(await q.select());
  if (!rows.length) throw new TodoError('This to-do changed since you opened it - reloaded', 409, { code: 'changed', todo: await loadTodo(supabase, businessId, existing.id) });
  if (!eventKind) return { todo: rows[0], event: null };
  const [event] = await logEvents(supabase, [{ business_id: businessId, todo_id: existing.id, kind: eventKind, before: snapshot(existing, tracked), after: snapshot(rows[0], tracked), actor_user_id: actor, origin, batch_id: batchId, at: now.toISOString() }]);
  return { todo: rows[0], event };
}

// The same change on several to-dos as ONE batch (the cascades, R2). A row that changed meanwhile is skipped.
export async function applyTodos(supabase, { businessId, todos, patch, kind = null, actor = null, origin, batchId = randomUUID(), now = new Date() }) {
  const done = [];
  for (const row of todos) {
    try {
      const r = await applyTodo(supabase, { businessId, row, patch: typeof patch === 'function' ? patch(row) : patch, kind, actor, origin, batchId, now });
      if (r.event) done.push(r);
    } catch (e) { if (e.status !== 409) throw e; }
  }
  return { batchId, todos: done.map(r => r.todo), events: done.map(r => r.event) };
}

// R3: a request that failed half-way takes back the to-dos it inserted moments ago.
export async function rollbackCreates(supabase, { businessId, todos, actor = null, origin, now = new Date() }) {
  if (!todos.length) return;
  await supabase.from('sales_week_goals').delete().in('id', todos.map(t => t.id));
  await supabase.from('sales_todo_events').insert(todos.map(t => ({ business_id: businessId, todo_id: t.id, kind: 'undo', before: snapshot(t), after: {}, actor_user_id: actor, origin, at: now.toISOString() })));
}

// R3: a USER's undo of something that made a to-do (a signal or Tidy accept, Scout's mark contacted): the to-do is
// dropped, never deleted - its create event is stamped undone and an 'undo' row says who. where = the caller's own
// guard on the row (still a Tidy to-do of the caller's ...). -> the dropped row, or null when there was nothing to undo.
export async function undoCreate(supabase, { businessId, todoId, actor = null, now = new Date(), where = () => true }) {
  const row = await loadTodo(supabase, businessId, todoId);
  if (!row || !isTodo(row) || !['open', 'done'].includes(row.status) || !where(row)) return null;
  const made = must(await supabase.from('sales_todo_events').select(EVENT_COLS).eq('business_id', businessId).eq('todo_id', row.id).eq('kind', 'create')).find(e => !e.undone_at) || null;
  const rows = must(await supabase.from('sales_week_goals').update({ status: 'dropped', completed_at: null, updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', row.id).eq('status', row.status).select());
  if (!rows.length) return null;
  if (made) must(await supabase.from('sales_todo_events').update({ undone_at: now.toISOString(), undone_by: actor }).eq('id', made.id).select('id'));
  await logEvents(supabase, [{ business_id: businessId, todo_id: row.id, kind: 'undo', before: snapshot(row, ['status', 'completed_at']), after: { status: 'dropped', completed_at: null }, actor_user_id: actor, origin: row.origin || 'manual', batch_id: made?.batch_id || null, undo_of: made?.id || null, at: now.toISOString() }]);
  return rows[0];
}

// R2: every row that points at one record now points at another (or at nothing: to = null) - to-dos as ONE batch of
// 'link' events, waiting rows and flags (not to-dos, R1) by a plain update. -> { batchId, ids, undo() }.
export async function relinkAll(supabase, { businessId, from, to = null, actor = null, origin, now = new Date() }) {
  const rows = must(await supabase.from('sales_week_goals').select('*').eq('business_id', businessId).eq('link_type', from.link_type).eq('link_id', from.link_id));
  const patch = { link_type: to?.link_type ?? null, link_id: to?.link_id ?? null };
  const batch = await applyTodos(supabase, { businessId, todos: rows.filter(isTodo), patch, kind: 'link', actor, origin, now });
  const others = rows.filter(r => !isTodo(r)).map(r => r.id);
  if (others.length) must(await supabase.from('sales_week_goals').update({ ...patch, updated_at: now.toISOString() }).in('id', others).select('id'));
  const ids = [...batch.todos.map(t => t.id), ...others];
  return { batchId: batch.batchId, ids, undo: async () => {
    if (batch.events.length) await applyTodos(supabase, { businessId, todos: batch.todos, patch: from, kind: 'link', actor, origin, batchId: batch.batchId });
    if (others.length) await supabase.from('sales_week_goals').update(from).in('id', others);
  } };
}

// T9: an admin's physical delete - the row is dropped first (its event is the log), then removed.
export async function deleteTodo(supabase, { businessId, row, actor, now = new Date() }) {
  const dropped = row.status === 'dropped' ? { todo: row, event: null } : await applyTodo(supabase, { businessId, row, patch: { status: 'dropped' }, actor, origin: 'manual', now });
  must(await supabase.from('sales_week_goals').delete().eq('business_id', businessId).eq('id', row.id));
  console.log(`[todo] deleted ${row.id} by ${actor} (drop event ${dropped.event?.id || 'already dropped'})`);
  return dropped;
}

async function eventOr(supabase, businessId, eventId) {
  if (!UUID.test(eventId || '')) throw new TodoError('event not found', 404);
  const ev = must(await supabase.from('sales_todo_events').select(`${EVENT_COLS}, business_id`).eq('business_id', businessId).eq('id', eventId).maybeSingle());
  if (!ev) throw new TodoError('event not found', 404);
  return ev;
}

// -> { todo, event (the 'undo' row), undid }. windowMs: the signal / tidy undos keep their own 10 minutes.
export async function undoTodoEvent(supabase, { businessId, eventId, event = null, actor = null, now = new Date(), windowMs = UNDO_WINDOW_MS }) {
  const ev = event || await eventOr(supabase, businessId, eventId);
  if (ev.kind === 'undo') throw new TodoError('an undo cannot be undone', 409);
  if (ev.undone_at) throw new TodoError('already undone', 409);
  if (now - Date.parse(ev.at) > windowMs) throw new TodoError('too late to undo - change the to-do instead', 409, { code: 'expired' });
  const cur = await loadTodo(supabase, businessId, ev.todo_id);
  if (!cur) throw new TodoError('to-do not found', 404);
  const after = ev.after || {};
  const drift = Object.keys(after).find(k => !same(after[k], cur[k]));
  if (drift) throw new TodoError(`${drift.replace(/_/g, ' ')} changed since - undo skipped`, 409, { code: 'drift', todo: cur });
  const restore = ev.kind === 'create' ? { status: 'dropped', completed_at: null } : ev.before || {};
  let q = supabase.from('sales_week_goals').update({ ...restore, updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', cur.id);
  for (const k of Object.keys(after)) q = after[k] == null ? q.is(k, null) : q.eq(k, after[k]);
  const rows = must(await q.select());
  if (!rows.length) throw new TodoError('changed since - undo skipped', 409, { code: 'drift' });
  must(await supabase.from('sales_todo_events').update({ undone_at: now.toISOString(), undone_by: actor }).eq('id', ev.id).select('id'));
  const [undo] = await logEvents(supabase, [{ business_id: businessId, todo_id: cur.id, kind: 'undo', before: snapshot(cur, Object.keys(restore)), after: snapshot(rows[0], Object.keys(restore)), actor_user_id: actor, origin: ev.origin, batch_id: ev.batch_id, undo_of: ev.id, at: now.toISOString() }]);
  return { todo: rows[0], event: undo, undid: { id: ev.id, kind: ev.kind, todo_id: ev.todo_id } };
}

// Every event of the batch as one, newest first. A to-do that fails is named; the rest stay undone.
export async function undoTodoBatch(supabase, { businessId, batchId, actor = null, now = new Date(), windowMs = UNDO_WINDOW_MS }) {
  if (!UUID.test(batchId || '')) throw new TodoError('batch not found', 404);
  const events = must(await supabase.from('sales_todo_events').select(`${EVENT_COLS}, business_id`).eq('business_id', businessId).eq('batch_id', batchId).order('at', { ascending: false }))
    .filter(e => e.kind !== 'undo' && !e.undone_at);
  if (!events.length) throw new TodoError('nothing to undo', 409);
  const undone = [], failed = [];
  for (const ev of events) {
    try { const r = await undoTodoEvent(supabase, { businessId, event: ev, actor, now, windowMs }); undone.push({ todo: r.todo, event: r.event }); }
    catch (e) { if (!e.status || e.status >= 500) throw e; failed.push({ todo_id: ev.todo_id, error: e.message }); }
  }
  return { batch_id: batchId, undone, failed };
}

// The newest events of a workspace, a to-do, or a set of to-dos (names resolve at the caller).
export async function listTodoEvents(supabase, businessId, { todoIds = null, from = null, to = null, limit = 200 } = {}) {
  let q = supabase.from('sales_todo_events').select(EVENT_COLS).eq('business_id', businessId);
  if (todoIds) q = q.in('todo_id', todoIds);
  if (from) q = q.gte('at', from);
  if (to) q = q.lt('at', to);
  return must(await q.order('at', { ascending: false }).limit(limit));
}

const send = (res, fn) => fn().then(body => res.json(body)).catch(e => res.status(e.status || 500).json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.todo ? { goal: e.todo } : {}) }));
// POST goals/week/events/:id/undo -> { goal, event, undid }
export function undoTodoEventRoute(req, res) {
  return send(res, async () => { const r = await undoTodoEvent(getSupabase(), { businessId: req.params.businessId, eventId: req.params.id, actor: req.auth.user.id }); return { goal: r.todo, event: r.event, undid: r.undid }; });
}
// POST goals/week/events/batch/:batchId/undo -> { batch_id, undone: [{ goal, event }], failed: [{ todo_id, error }] }
export function undoTodoBatchRoute(req, res) {
  return send(res, async () => { const r = await undoTodoBatch(getSupabase(), { businessId: req.params.businessId, batchId: req.params.batchId, actor: req.auth.user.id }); return { batch_id: r.batch_id, undone: r.undone.map(u => ({ goal: u.todo, event: u.event })), failed: r.failed }; });
}
