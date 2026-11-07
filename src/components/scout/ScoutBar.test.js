import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PersistentScout from '../PersistentScout';
import DataTable from '../../ui/DataTable';
import { goalsApi } from '../salesAnalytics/goals/goalsApi';
import { SCOPE_KEY, THREAD_KEY, readThread, saveThread, splitMatch, isQuestion, answerSort, taskBody, footerParts } from './scoutModel';
import { openKeyOf, readOpenKey, writeOpenParams, readAccountParam } from './scoutOpen';

// scout-v2 REV3 Stage 2 - the bar to the mockups: grouped hits with neon match text, the scope pill (a listbox, no
// <select>) remembered per user, the keyboard path, Open -> the opener, the answer as the kit table with Scout's sort
// marked, Records / footer / thread, + Task (D14) and the Viewer, every edge state, the thread per day, the 390 sheet.
const mockPhone = { on: false };
jest.mock('../../utils/useMediaQuery', () => () => mockPhone.on);
jest.mock('../salesAnalytics/goals/goalsApi', () => ({ goalsApi: { createWeekGoal: jest.fn(() => Promise.resolve({ id: 'new' })) } }));

const B1 = { id: 'b1', name: 'HomeLover', color: '#E2418A', features: { goals_sales: true } };
const B2 = { id: 'b2', name: 'Other', color: '#4FD1C5', features: { hk_sales: true } };
const member = { profile: { id: 'u1' }, memberships: [{ business_id: 'b1', role: 'member' }, { business_id: 'b2', role: 'member' }] };
const viewer = { profile: { id: 'u2' }, memberships: [{ business_id: 'b1', role: 'viewer' }] };
const company = (type, id) => ({ page: 'sales', params: { tab: 'pipeline', view: 'companies', open: `${type}-${id}` } });
const HIT = (ws = B1) => ({
  groups: [
    { entity: 'employers', label: 'Employers', items: [{ id: 'e1', title: 'Cloudflare', subtitle: 'Contacted · Cyrus', workspace_id: ws.id, workspace_name: ws.name, open: company('employer', 'e1') }] },
    { entity: 'people', label: 'People', items: [
      { id: 'prospect:p1', title: 'Danilea Mayer', subtitle: 'Cloudflare · clicked', workspace_id: ws.id, workspace_name: ws.name, open: { page: 'sales', params: { tab: 'pipeline', view: 'people', open: 'person:prospect:p1' } } },
      { id: 'prospect:p2', title: 'Frank Wagner', subtitle: 'Cloudflare · opened', workspace_id: ws.id, workspace_name: ws.name, open: { page: 'sales', params: { tab: 'pipeline', view: 'people', open: 'person:prospect:p2' } } },
    ] },
    { entity: 'todos', label: 'To-dos', items: [{ id: 't1', title: 'Follow up with Danilea Mayer', subtitle: 'open · due 2026-11-06', workspace_id: ws.id, workspace_name: ws.name, open: { page: 'sales', params: { tab: 'actions', open: 'todo:t1' } } }] },
  ],
});
const ANSWER = {
  answer_md: 'You have **3 open tasks** on partners due this week. Sorted by due date.',
  items: [
    { entity: 'todos', id: 't2', title: 'Intro Upside to Justworks', date: '2026-11-07', workspace_id: 'b1', workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'actions', open: 'todo:t2' } }, why: 'open to-do · due 2026-11-07' },
    { entity: 'todos', id: 't1', title: 'Send 24HF joint note to Upside', date: '2026-11-06', workspace_id: 'b1', workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'actions', open: 'todo:t1' } }, why: 'open to-do · due 2026-11-06' },
    { entity: 'partners', id: 'pa1', title: 'Upside', date: '2026-11-08', workspace_id: 'b1', workspace_name: 'HomeLover', open: company('partner', 'pa1'), why: 'partner · Proposal / pilot' },
  ],
  usage: { input_tokens: 4100, output_tokens: 210, cost_usd: 0.01545 },
  withheld: false, ask: { sort: null, mine: true, entity: 'todos' },
  context_stats: { reads: ['openTodos (12 open, mine)', 'partners', 'notes 14 d'], rows_by_entity: { todos: 12, partners: 17, call_notes: 2 } },
  cap: { used: 3, max: 40 }, scope: 'b1',
};

let replies;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  localStorage.clear();
  mockPhone.on = false;
  goalsApi.createWeekGoal.mockClear();
  replies = { search: () => json(200, HIT()), ask: () => json(200, ANSWER) };
  global.fetch = jest.fn(url => (String(url).startsWith('/api/scout/search') ? replies.search(url) : replies.ask(url)));
});

const mount = (props = {}) => {
  const onOpen = jest.fn();
  const utils = render(<PersistentScout compact businesses={[B1, B2]} activeBusiness={B1} me={member} onOpen={onOpen} {...props} />);
  return { ...utils, onOpen, input: screen.getByRole('combobox', { name: 'Search or ask Scout' }) };
};
const type = (input, v) => { fireEvent.focus(input); fireEvent.change(input, { target: { value: v } }); };
const asked = () => global.fetch.mock.calls.filter(c => c[0] === '/api/scout/ask');

test('B1/B2: idle shows the ⌘K chip; focus swaps it for the scope pill (a listbox, never a <select>), remembered per user', async () => {
  const { input, container } = mount();
  expect(container.querySelector('kbd').textContent).toBe('⌘K');
  expect(input.placeholder).toBe('Search or ask Scout');
  fireEvent.focus(input);
  expect(input.placeholder).toBe('Search, or ask a question…');
  const pill = screen.getByRole('button', { name: 'Scope: HomeLover' });
  fireEvent.click(pill);
  const list = screen.getByRole('listbox', { name: 'Scout scope' });
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['HomeLover', 'Other', 'All my workspaces']);
  expect(container.querySelector('select')).toBeNull();
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  fireEvent.keyDown(list, { key: 'Enter' });
  expect(JSON.parse(localStorage.getItem(SCOPE_KEY))).toEqual({ u1: 'all' });
  expect(screen.getByRole('button', { name: 'Scope: All my workspaces' })).toBeTruthy();
});

test('B3: grouped hits in the server order with the match in neon <mark>, first row active, workspace tags when scope = all', async () => {
  localStorage.setItem(SCOPE_KEY, JSON.stringify({ u1: 'all' }));
  const { input, container } = mount();
  type(input, 'Clou');
  await waitFor(() => expect(container.querySelectorAll('[data-scout-row]').length).toBe(4));
  expect(global.fetch.mock.calls[0][0]).toBe('/api/scout/search?q=Clou&scope=all');
  expect([...container.querySelectorAll('[data-scout-group]')].map(g => g.dataset.scoutGroup)).toEqual(['employers', 'people', 'todos']);
  expect([...container.querySelectorAll('.scout-row mark')].map(m => m.textContent)).toEqual(['Clou', 'Clou', 'Clou']);
  expect(container.querySelector('.scout-row.is-active').textContent).toContain('Cloudflare');
  expect(input.getAttribute('aria-activedescendant')).toBe(container.querySelector('.scout-row.is-active').id);
  expect(container.querySelectorAll('.scout-ws').length).toBe(4);
  expect(screen.getByText(/as a question/).textContent).toContain('Ask “Clou…” as a question');
});

test('B3 keyboard: ↓ moves, ↵ opens the row through the opener (navTo by key), Esc closes', async () => {
  const { input, container, onOpen } = mount();
  type(input, 'Clou');
  await waitFor(() => expect(container.querySelectorAll('[data-scout-row]').length).toBe(4));
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(container.querySelector('.scout-row.is-active').textContent).toContain('Danilea Mayer');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'prospect:p1', open: { page: 'sales', params: { tab: 'pipeline', view: 'people', open: 'person:prospect:p1' } } }));
  expect(container.querySelector('[data-scout-pop]')).toBeNull();
  type(input, 'Cloud');
  await waitFor(() => expect(container.querySelector('[data-scout-pop]')).toBeTruthy());
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(container.querySelector('[data-scout-pop]')).toBeNull();
  fireEvent.change(input, { target: { value: 'Clou' } });
  await waitFor(() => expect(container.querySelectorAll('[data-scout-row]').length).toBe(4));
  fireEvent.click(container.querySelectorAll('[data-scout-row]')[0]);
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'e1', open: company('employer', 'e1') }));
});

test('B4: a question asks once on Enter -> working sweep + elapsed, then the answer: kit table sorted on Scout\'s field marked in neon, Records, footer from the usage row, thread', async () => {
  let release;
  replies.ask = () => new Promise(r => { release = () => r({ ok: true, status: 200, json: async () => ANSWER }); });
  const { input, container } = mount();
  type(input, 'show me my open tasks');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(container.querySelector('[data-scout-working]')).toBeTruthy();
  expect(container.querySelector('.scout-think')).toBeTruthy();
  expect(container.querySelector('[data-scout-elapsed]').textContent).toBe('0 s');
  await act(async () => { release(); });
  await waitFor(() => expect(container.querySelector('[data-scout-answer]')).toBeTruthy());
  expect(asked()).toHaveLength(1);
  expect(JSON.parse(asked()[0][1].body)).toEqual({ q: 'show me my open tasks', scope: 'b1', thread: [] });
  expect(container.querySelector('[data-scout-prose] b').textContent).toBe('3 open tasks');
  const table = screen.getByRole('table', { name: "Scout's records" });
  const mark = table.querySelector('.scout-sortmark');
  expect(mark.dataset.scoutSort).toBe('date');
  expect(mark.textContent).toBe('Date');
  expect(mark.closest('th').getAttribute('aria-sort')).toBe('ascending');
  expect([...table.querySelectorAll('tbody tr[data-row]')].map(r => r.textContent.split('To-do')[0].split('Partner')[0])).toEqual(['Send 24HF joint note to Upside', 'Intro Upside to Justworks', 'Upside']);
  expect(container.querySelector('[data-scout-records]').textContent).toContain('Upside — partner · Proposal / pilot');
  expect(container.querySelector('[data-scout-footer]').textContent).toContain('31 records read · 3 reads: openTodos (12 open, mine) · partners · notes 14 d');
  expect(container.querySelector('[data-scout-cost]').textContent).toBe('$0.015');
  expect(container.querySelector('[data-scout-asks]').textContent).toBe('3 of 40 asks today');
  expect(container.querySelector('.scout-turn.is-now').textContent).toContain('show me my open tasks');
  expect(container.querySelector('select')).toBeNull();
});

test('B4 / D14: Open goes through the opener; + Task = the quick-capture create, linked for a partner, title-only for a to-do', async () => {
  const { input, container, onOpen } = mount();
  type(input, 'show me my open tasks');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(container.querySelector('[data-scout-answer]')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Open Upside' }));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'pa1', open: company('partner', 'pa1') }));
  fireEvent.focus(input);
  await waitFor(() => expect(container.querySelector('[data-scout-answer]')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Add a task for Upside' }));
  await waitFor(() => expect(goalsApi.createWeekGoal).toHaveBeenCalledTimes(1));
  expect(goalsApi.createWeekGoal.mock.calls[0][0]).toBe('b1');
  expect(goalsApi.createWeekGoal.mock.calls[0][1]).toMatchObject({ kind: 'todo', text: 'Follow up: Upside', owner_user_id: 'u1', link_type: 'partner', link_id: 'pa1' });
  fireEvent.click(screen.getByRole('button', { name: 'Add a task for Intro Upside to Justworks' }));
  await waitFor(() => expect(goalsApi.createWeekGoal).toHaveBeenCalledTimes(2));
  expect(goalsApi.createWeekGoal.mock.calls[1][1]).not.toHaveProperty('link_type');
  expect(goalsApi.createWeekGoal.mock.calls[1][1].text).toBe('Follow up: Intro Upside to Justworks');
});

test('B5 Viewer: search and ask read-only - Open, no + Task, the read-only line; scope lists only their workspaces', async () => {
  const { input, container } = mount({ me: viewer, businesses: [B1] });
  fireEvent.focus(input);
  fireEvent.click(screen.getByRole('button', { name: 'Scope: HomeLover' }));
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['HomeLover', 'All my workspaces']);
  fireEvent.keyDown(screen.getByRole('listbox', { name: 'Scout scope' }), { key: 'Escape' });
  type(input, 'show me my open tasks');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(container.querySelector('[data-scout-answer]')).toBeTruthy());
  expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(3);
  expect(screen.queryAllByRole('button', { name: /^Add a task/ })).toHaveLength(0);
  expect(container.querySelector('[data-scout-viewer]')).toBeTruthy();
});

test('B5 edge states: no hits (+ Ask anyway), withheld (+ Retry re-asks), daily cap, offline (+ Retry), empty scope', async () => {
  replies.search = () => json(200, { groups: [] });
  let r = mount();
  type(r.input, 'Clouflare');
  await waitFor(() => expect(r.container.querySelector('[data-scout-edge="nohits"]')).toBeTruthy());
  expect(r.container.querySelector('[data-scout-edge="nohits"]').textContent).toContain('Nothing matches “Clouflare”. Try fewer letters');
  replies.ask = () => json(200, { ...ANSWER, withheld: true, answer_md: 'Answer withheld: it contained an address or phone number.' });
  fireEvent.click(screen.getByRole('button', { name: 'Ask “Clouflare” anyway' }));
  await waitFor(() => expect(r.container.querySelector('[data-scout-edge="withheld"]')).toBeTruthy());
  expect(r.container.textContent).not.toContain('Answer withheld: it contained');
  fireEvent.click(screen.getByRole('button', { name: 'Retry without contact details' }));
  await waitFor(() => expect(asked()).toHaveLength(2));
  expect(JSON.parse(asked()[1][1].body).q).toBe('Clouflare');
  r.unmount();

  replies.ask = () => json(429, { error: 'cap', cap: 40, used: 40 });
  r = mount();
  type(r.input, 'who visited yesterday');
  fireEvent.keyDown(r.input, { key: 'Enter' });
  await waitFor(() => expect(r.container.querySelector('[data-scout-edge="cap"]')).toBeTruthy());
  expect(r.container.querySelector('[data-scout-edge="cap"]').textContent).toContain("You've used 40 of 40 asks today. Search still works; asking opens again at midnight PT.");
  r.unmount();

  replies.ask = () => Promise.reject(new TypeError('Failed to fetch'));
  r = mount();
  type(r.input, 'who visited yesterday');
  fireEvent.keyDown(r.input, { key: 'Enter' });
  await waitFor(() => expect(r.container.querySelector('[data-scout-edge="offline"]')).toBeTruthy());
  expect(r.container.querySelector('[data-scout-edge="offline"]').textContent).toContain("Scout can't reach the server · try again");
  replies.ask = () => json(200, ANSWER);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(r.container.querySelector('[data-scout-answer]')).toBeTruthy());
  r.unmount();

  r = mount({ businesses: [], activeBusiness: null });
  fireEvent.focus(r.input);
  expect(r.container.querySelector('[data-scout-edge="empty"]').textContent).toContain('No workspace yet — ask the owner to add you');
  type(r.input, 'Clou');
  await new Promise(res => setTimeout(res, 300));
  expect(global.fetch.mock.calls.filter(c => String(c[0]).startsWith('/api/scout/search') && c[0].includes('q=Clou&')).length).toBe(0);
});

test('D12: the thread keeps the last 6 turns per user per LA day; the next ask sends the last turns; Clear empties it', async () => {
  const day = new Date('2026-11-06T18:00:00Z');
  saveThread('u1', Array.from({ length: 8 }, (_, i) => ({ at: i, q: `q${i}`, answer_md: `a${i}.` })), day);
  expect(readThread('u1', day).map(t => t.q)).toEqual(['q2', 'q3', 'q4', 'q5', 'q6', 'q7']);
  expect(readThread('u1', new Date('2026-11-07T18:00:00Z'))).toEqual([]);
  expect(readThread('u2', day)).toEqual([]);
  localStorage.setItem(THREAD_KEY, '{oops');
  expect(readThread('u1', day)).toEqual([]);

  saveThread('u1', [{ at: 1, q: 'what do my notes say about Hilton', answer_md: 'Two notes mention Hilton.' }]);
  const { input, container } = mount();
  type(input, 'show me my open tasks');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(container.querySelector('[data-scout-answer]')).toBeTruthy());
  expect(JSON.parse(asked()[0][1].body).thread).toEqual([{ role: 'user', content: 'what do my notes say about Hilton' }, { role: 'assistant', content: 'Two notes mention Hilton.' }]);
  expect(readThread('u1').map(t => t.q)).toEqual(['what do my notes say about Hilton', 'show me my open tasks']);
  expect(container.querySelector('[data-scout-thread]').textContent).toContain('what do my notes say about Hilton → Two notes mention Hilton.');
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(readThread('u1')).toEqual([]);
});

test('B1/B6 390: the header shows only the neon star; it opens the sheet (Scout · scope · ✕, then the bar); answers are cards, no table', async () => {
  mockPhone.on = true;
  const { container } = render(<PersistentScout compact businesses={[B1]} activeBusiness={B1} me={member} onOpen={() => {}} />);
  expect(container.querySelector('input')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Search or ask Scout' }));
  const sheet = screen.getByRole('dialog', { name: 'Scout' });
  expect(sheet.querySelector('.scout-sheet__handle')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Scope: HomeLover' })).toBeTruthy();
  const input = screen.getByRole('combobox', { name: 'Search or ask Scout' });
  expect(document.activeElement).toBe(input);
  type(input, 'Clou');
  await waitFor(() => expect(sheet.querySelectorAll('[data-scout-row]').length).toBe(4));
  type(input, 'show me my open tasks');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(sheet.querySelector('[data-scout-answer]')).toBeTruthy());
  expect(sheet.querySelector('table')).toBeNull();
  expect(sheet.querySelectorAll('.scout-card')).toHaveLength(3);
  expect(sheet.querySelector('[data-scout-sort="date"]').textContent).toBe('by date');
  fireEvent.click(screen.getByRole('button', { name: 'Close Scout' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('model: match split, question sense, the sort Scout chose, footer, task body', () => {
  expect(splitMatch('Cloudflare', 'clou')).toEqual([{ text: 'Clou', hit: true }, { text: 'dflare', hit: false }]);
  expect(isQuestion('Clou')).toBe(false);
  expect(isQuestion('who visited yesterday')).toBe(true);
  expect(isQuestion('hot targets Brad referred')).toBe(true);
  expect(answerSort({ sort: 'score' }, [{ score: 3 }])).toEqual({ id: 'score', dir: 'desc', label: 'Score' });
  expect(answerSort({ sort: null }, [{ entity: 'todos', date: '2026-11-06' }])).toEqual({ id: 'date', dir: 'asc', label: 'Due' });
  expect(answerSort({ sort: null }, [{ entity: 'todos' }])).toBeNull();
  expect(footerParts({ usage: { cost_usd: null } }).cost).toBeNull();
  expect(taskBody({ entity: 'employers', id: 'e1', title: 'Cloudflare' }, 'u1', new Date('2026-11-06T18:00:00Z'))).toEqual({ kind: 'todo', week_start: '2026-11-02', text: 'Follow up: Cloudflare', owner_user_id: 'u1', link_type: 'opportunity', link_id: 'e1' });
});

test('B7: the openers\' keys - URL params written, read back by prefix; the kit table opens a row from outside', () => {
  window.history.replaceState(null, '', '/?tab=dashboard&company=partner:x&cname=X');
  writeOpenParams({ tab: 'pipeline', view: 'people', open: 'person:prospect:p1' });
  expect(window.location.search).toBe('?tab=pipeline&view=people&open=person%3Aprospect%3Ap1');
  expect(readOpenKey('person')).toBe('prospect:p1');
  expect(readOpenKey('todo')).toBeNull();
  expect(openKeyOf('todo', 'todo:t1')).toBe('t1');
  writeOpenParams({ account: 'a1' });
  expect(readAccountParam()).toBe('a1');
  const rows = [{ k: 'a', name: 'Alpha' }, { k: 'b', name: 'Beta' }];
  const columns = [{ id: 'name', label: 'Name', detail: true, render: r => r.name, title: r => r.name }];
  const { container } = render(<DataTable label="T" columns={columns} rowKey={r => r.k} groups={[{ id: 'g', header: 'G', rows }]} renderDetail={r => <span>detail {r.name}</span>} openKey="b" />);
  expect(container.querySelector('[data-detail="b"]').textContent).toBe('detail Beta');
});
