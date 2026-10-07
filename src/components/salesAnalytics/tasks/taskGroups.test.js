import { buildTaskGroups, badgeCount, matchesFilter } from './taskGroups';

const ME = 'u-me';
const CY = 'u-cy';
const step = done => ({ id: Math.random().toString(36), done });
const todo = (id, over = {}) => ({ id, owner_user_id: ME, status: 'open', steps: [], due_date: null, ...over });
const ids = g => g.items.map(t => t.id);
const byId = groups => Object.fromEntries(groups.map(g => [g.id, g]));

test('filters by owner, team and unassigned', () => {
  expect(matchesFilter('me', ME, ME)).toBe(true);
  expect(matchesFilter('me', CY, ME)).toBe(false);
  expect(matchesFilter(CY, CY, ME)).toBe(true);
  expect(matchesFilter('unassigned', null, ME)).toBe(true);
  expect(matchesFilter('unassigned', ME, ME)).toBe(false);
  expect(matchesFilter('team', null, ME)).toBe(true);
});

test('groups: overdue by due date, done by status or all steps, dropped hidden', () => {
  const todos = [
    todo('a'),
    todo('b', { due_date: '2026-10-05' }),
    todo('c', { due_date: '2026-10-09' }),
    todo('d', { status: 'done' }),
    todo('e', { steps: [step(true), step(true)] }),
    todo('f', { status: 'dropped' }),
    todo('g', { owner_user_id: CY }),
  ];
  const g = byId(buildTaskGroups({ todos, flags: [], filter: 'me', meId: ME, today: '2026-10-07' }));
  expect(ids(g.overdue)).toEqual(['b']);
  expect(ids(g.week)).toEqual(['a', 'c']);
  expect(ids(g.done)).toEqual(['d', 'e']);
  expect(g.calls.items).toEqual([]);
});

test('open to-dos from call notes go in From calls; overdue and done ones stay in those groups', () => {
  const n = { source_note_id: 'n1' };
  const todos = [todo('a'), todo('k', n), todo('l', { ...n, due_date: '2026-10-05' }), todo('m', { ...n, status: 'done' }), todo('o', { ...n, owner_user_id: CY })];
  const g = byId(buildTaskGroups({ todos, flags: [], filter: 'me', meId: ME, today: '2026-10-07' }));
  expect(ids(g.week)).toEqual(['a']);
  expect(ids(g.calls)).toEqual(['k']);
  expect(ids(g.overdue)).toEqual(['l']);
  expect(ids(g.done)).toEqual(['m']);
  expect(ids(byId(buildTaskGroups({ todos, flags: [], filter: 'team', meId: ME, today: '2026-10-07' })).calls)).toEqual(['k', 'o']);
});

test('a flag shows once, in Flagged, even when it is also a this-week to-do', () => {
  const flag = todo('f1', { prospect_contact_id: 'p1' });
  const old = todo('f2', { prospect_contact_id: 'p2', week_start: '2026-09-28' });
  const g = byId(buildTaskGroups({ todos: [flag, todo('a')], flags: [flag, old], filter: 'me', meId: ME, today: '2026-10-07' }));
  expect(g.flagged.label).toBe('Flagged for me');
  expect(ids(g.flagged)).toEqual(['f1', 'f2']);
  expect(ids(g.week)).toEqual(['a']);
  const cy = byId(buildTaskGroups({ todos: [flag], flags: [flag], filter: CY, meId: ME, today: '2026-10-07' }));
  expect(cy.flagged.label).toBe('Flagged');
  expect(cy.flagged.items).toEqual([]);
});

test('badge = my open this-week to-dos + my flags, each once', () => {
  const flag = todo('f1', { prospect_contact_id: 'p1' });
  const todos = [flag, todo('a'), todo('d', { status: 'done' }), todo('g', { owner_user_id: CY })];
  expect(badgeCount({ todos, flags: [flag, todo('f2', { owner_user_id: CY })], meId: ME })).toBe(2);
});
