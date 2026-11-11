import { goalsApi, TODOS_CHANGED } from './goalsApi';
import { pipelineMoves } from './todayModel';
import { acceptSummary } from '../tasks/intakeBody';
import { buildTaskGroups, badgeCount } from '../tasks/taskGroups';
import { splitSnoozed, isSnoozed } from '../../../constants/todoSnooze';

// todo-events-v1 - the client's half: the API helpers (expect out, the event id back, a 409 that reloads every list),
// the week's lines, the snoozed to-dos off the Tasks badge by the one rule, and the intake's "which company?" line.
const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
beforeEach(() => { global.fetch = jest.fn(); });

test('updateWeekGoal sends the row\'s updated_at as expect and returns the goal with the event id; createWeekGoal the same; a 409 "changed" tells every list to reload', async () => {
  global.fetch.mockImplementation(() => reply(200, { goal: { id: 't1', status: 'done' }, event: { id: 'ev1', kind: 'done' } }));
  const g = await goalsApi.updateWeekGoal('b1', 't1', { status: 'done' }, { id: 't1', updated_at: '2026-11-10T10:00:00Z' });
  expect(g).toEqual({ id: 't1', status: 'done', event_id: 'ev1' });
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ status: 'done', expect: { updated_at: '2026-11-10T10:00:00Z' } });
  await goalsApi.updateWeekGoal('b1', 't1', { status: 'open' });
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ status: 'open' });
  global.fetch.mockImplementation(() => reply(201, { goal: { id: 't2' }, event: { id: 'ev2', kind: 'create' } }));
  expect((await goalsApi.createWeekGoal('b1', { text: 'x' })).event_id).toBe('ev2');
  global.fetch.mockImplementation(() => reply(201, { goal: { id: 'c1', kind: 'commitment' } }));
  expect((await goalsApi.createWeekGoal('b1', { text: 'x', kind: 'commitment' })).event_id).toBeNull();

  const heard = jest.fn();
  window.addEventListener(TODOS_CHANGED, heard);
  global.fetch.mockImplementation(() => reply(409, { error: 'This to-do changed since you opened it - reloaded', code: 'changed', goal: { id: 't1', status: 'dropped' } }));
  await expect(goalsApi.updateWeekGoal('b1', 't1', { status: 'done' }, { updated_at: 'x' })).rejects.toMatchObject({ status: 409, changed: true, goal: { status: 'dropped' }, message: 'This to-do changed since you opened it - reloaded' });
  expect(heard).toHaveBeenCalledTimes(1);
  window.removeEventListener(TODOS_CHANGED, heard);

  global.fetch.mockImplementation(() => reply(200, { goal: { id: 't1' }, event: { id: 'u1' }, undid: { kind: 'done' } }));
  await goalsApi.undoTodoEvent('b1', 'ev1'); await goalsApi.undoTodoBatch('b1', 'batch-1');
  expect(global.fetch.mock.calls.slice(-2).map(c => [c[0], c[1].method])).toEqual([['/api/sales/b1/goals/week/events/ev1/undo', 'POST'], ['/api/sales/b1/goals/week/events/batch/batch-1/undo', 'POST']]);
  global.fetch.mockImplementation(() => reply(200, { events: [{ id: 'e1' }] }));
  expect(await goalsApi.todoEvents('b1', { from: '2026-11-09', to: '2026-11-16' })).toEqual([{ id: 'e1' }]);
  expect(global.fetch.mock.calls.at(-1)[0]).toBe('/api/sales/b1/goals/week/events?from=2026-11-09&to=2026-11-16');
  global.fetch.mockImplementation(() => reply(200, { items: [] }));
  await goalsApi.actions('b1', { snoozed: true });
  expect(global.fetch.mock.calls.at(-1)[0]).toBe('/api/sales/b1/goals/actions?snoozed=1');
});

test('Pipeline moves this week: a to-do change is a line (its text, what happened, when); an undo and the change it took back are not', () => {
  const ev = (id, kind, words, extra = {}) => ({ id, kind, words, at: `2026-11-10T1${id}:00:00Z`, undone_at: null, todo: { text: `To-do ${id}` }, ...extra });
  const rows = pipelineMoves({ todoEvents: [ev(1, 'done', 'done'), ev(2, 'due', 'due Nov 20', { undone_at: '2026-11-10T12:00:05Z' }), ev(3, 'undo', 'undone'), ev(4, 'snooze', 'snoozed until Nov 16'), { ...ev(5, 'drop', 'dropped'), todo: null }] });
  expect(rows).toEqual([{ key: 't-4', name: 'To-do 4', kind: 'To-do', to: 'snoozed until Nov 16', at: '2026-11-10T14:00:00Z' }, { key: 't-1', name: 'To-do 1', kind: 'To-do', to: 'done', at: '2026-11-10T11:00:00Z' }]);
  expect(pipelineMoves({})).toEqual([]);
});

test('T6: a snoozed to-do is off the Tasks lists and badge until its day; T7: the accept summary says when a to-do names several companies', () => {
  const todo = (id, extra) => ({ id, kind: 'todo', status: 'open', text: id, owner_user_id: 'me', due_date: '2026-11-11', steps: [], contacts: [], ...extra });
  const todos = [todo('a'), todo('b', { snooze_until: '2026-11-16' })];
  const { shown, snoozed } = splitSnoozed(todos, '2026-11-11');
  expect([shown.map(t => t.id), snoozed.map(t => t.id)]).toEqual([['a'], ['b']]);
  expect(badgeCount({ todos: shown, flags: [], meId: 'me' })).toBe(badgeCount({ todos, flags: [], meId: 'me' }) - 1);
  expect(buildTaskGroups({ todos: shown, flags: [], filter: 'me', meId: 'me', today: '2026-11-11' }).flatMap(g => g.items || g.rows || g.todos || []).some(t => t.id === 'b')).toBe(false);
  expect(isSnoozed(todos[1], '2026-11-16')).toBe(false);
  expect(acceptSummary(2, { needs_link: [{ todo_id: 't1', text: 'Follow up', choices: [{ name: 'Access Development' }, { name: 'Justworks' }] }] })).toBe('2 tasks · 1 to-do names more than one company (Access Development · Justworks) - pick the link on the row');
  expect(acceptSummary(1, {})).toBe('1 task');
});
