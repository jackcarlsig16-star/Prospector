import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import PersistentScout from '../PersistentScout';
import { readThread } from './scoutModel';
import { looksLikeCommand, planRows, cardTitle, menuFor, withResults, withoutResults, SCOUT_CAPTURE, copiedLine } from './scoutActions';

// scout-v3 Stage 2 - every state of the three mockups (specs/design/scout-v3): the sectioned answer with people and
// task rows, the ⋯ menus, a typed command -> the confirm card (single, batch with skipped rows) -> working -> the done
// line with the 10 s Undo and in-place rows, partial failure + Retry, can't-do with the pills and the nearest action,
// nothing to resolve, a card cancelled by a new ask, Undo expired, a batch over 25, a person brief + Copy for Claude,
// the opens (quick capture prefilled, draft bundle), the Viewer, and the 390 sheet with its action sheet.
// The four Scout routes are mocked: no request leaves the test, nothing is written.
const mockPhone = { on: false };
jest.mock('../../utils/useMediaQuery', () => () => mockPhone.on);
jest.mock('../salesAnalytics/goals/goalsApi', () => ({ goalsApi: {
  members: () => Promise.resolve([{ user_id: 'u1', name: 'Ana Member', color: '#6F8CF0' }, { user_id: 'u2', name: 'Bo Member', color: '#C97626' }]),
  copyBundle: () => Promise.resolve('# Cloudflare — employer\n'),
} }));
jest.mock('../salesAnalytics/goals/priorities/ComposePanel', () => ({ row, onClose }) => <div role="dialog" aria-label={`Write email · ${row.name}`}><button type="button" onClick={onClose}>Close draft</button></div>);

const B1 = { id: 'b1', name: 'HomeLover', color: '#E2418A', features: { goals_sales: true } };
const member = { profile: { id: 'u1' }, memberships: [{ business_id: 'b1', role: 'member' }] };
const viewer = { profile: { id: 'u9' }, memberships: [{ business_id: 'b1', role: 'viewer' }] };
const CO_OPEN = { page: 'sales', params: { tab: 'pipeline', view: 'companies', open: 'employer-e1' } };
const person = (i, name, heat, co = { entity: 'employers', type: 'employer', id: 'e1', name: 'Cloudflare', stage: 'contacted', open: CO_OPEN }) => ({ entity: 'people', id: `prospect:p${i}`, title: name, score: heat, workspace_id: 'b1', workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'pipeline', view: 'people', open: `person:prospect:p${i}` } }, why: `${name} · VP People`,
  row: { kind: 'person', key: `prospect:p${i}`, name, title: 'VP People', company: co, heat, heat_band: 'hot', last_visit: '2026-11-08', last_path: '/terms', last_email: { at: '2026-10-29', what: 'opened' }, status: 'new', sequenced: true } });
const task = (i, text, due, overdue = false, owner = 'mine', link = null) => ({ entity: 'todos', id: `t${i}`, title: text, date: due, workspace_id: 'b1', workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'actions', open: `todo:t${i}` } }, why: text, row: { kind: 'task', id: `t${i}`, text, due, overdue, owner, owner_user_id: { mine: 'u1', 'another owner': 'u2' }[owner] || null, link } });
const PEOPLE = [person(1, 'Dana Mayer', 48), person(2, 'Meg Earley', 46), person(3, 'Paola Ball', 46), person(4, 'James Curcio', 46), person(5, 'Lee Stone', 41, { type: 'account', id: null, name: 'Marriott', stage: null })];
const TASKS = [task(1, 'Send the joint note', '2026-11-08', true, 'mine', { entity: 'partners', type: 'partner', id: 'pa1', name: 'Upside', open: { page: 'sales', params: { tab: 'pipeline', view: 'companies', open: 'partner-pa1' } } }), task(2, 'Intro two partners', '2026-11-10'), task(3, 'Create the reporting draft', '2026-11-11', false, 'another owner'), task(4, 'Reach out to PerkSpot', '2026-11-12'), task(5, 'Find a contact', null, false, 'unassigned')];
const ANSWER = {
  answer_md: 'Two parts.', summary: 'Two parts: five hot prospects on the site and five tasks, one overdue.',
  sections: [
    { title: 'People on the site', count: 5, total: 19, rule: 'People ranked by heat, hottest first.', read: 'people whose company visited (7 d) · 19', rows: PEOPLE, line: null, brief: null },
    { title: 'Tasks', count: 5, total: 342, rule: 'Open to-dos ranked overdue first, then due soonest.', read: 'openTodos (342 open)', rows: TASKS, line: null, brief: null },
  ],
  items: [...PEOPLE, ...TASKS], usage: { input_tokens: 3000, output_tokens: 300, cost_usd: 0.014 }, withheld: false, ask: { sort: 'heat' },
  context_stats: { reads: ['people', 'openTodos'], rows_by_entity: { people: 19, todos: 342 } }, cap: { used: 3, max: 40 }, scope: 'b1',
};
const cardRow = (i, title, from, to, skipped = null, kind = 'employer') => ({ key: `employers:e${i}`, kind, title, from, to, skipped, note: null });
const CARD = { plan_id: 'plan-1', verb: 'assign', label: 'Assign', to: 'Bo', when: null, rows: [cardRow(1, 'Northrop Grumman', 'Ana', 'Bo'), cardRow(2, 'MetLife', 'Ana', 'Bo', null, 'partner'), cardRow(3, 'Flowserve', 'Ana', 'Bo'), cardRow(4, 'Mace', 'Bo', 'Bo', 'already Bo'), cardRow(5, 'IXL Learning', 'Bo', 'Bo', 'already Bo')], summary: { will: 3, skipped: 2 }, note: null };
const PILLS = [{ id: 'assign', label: 'Assign' }, { id: 'not_fit', label: 'Not a fit' }, { id: 'contacted', label: 'Mark contacted' }, { id: 'draft', label: 'Draft email' }, { id: 'snooze', label: 'Snooze' }, { id: 'add_task', label: 'Add task' }, { id: 'copy', label: 'Copy for Claude' }];

let replies, clip;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const calls = path => global.fetch.mock.calls.filter(c => c[0] === path).map(c => JSON.parse(c[1].body));
beforeEach(() => {
  localStorage.clear(); mockPhone.on = false; clip = [];
  Object.assign(navigator, { clipboard: { writeText: jest.fn(t => { clip.push(t); return Promise.resolve(); }) } });
  replies = { ask: () => json(200, ANSWER), plan: () => json(200, CARD), act: () => json(200, {}), undo: () => json(200, { line: 'undone', rows: [] }), pack: () => json(200, { text: 'Question: q', records: 1, chars: 2100, trimmed: 0 }) };
  global.fetch = jest.fn(url => { const k = String(url).split('/').pop().split('?')[0]; return replies[k] ? replies[k]() : json(200, { groups: [] }); });
});
afterEach(() => { jest.useRealTimers(); });

const mount = (props = {}) => {
  const onOpen = jest.fn();
  const utils = render(<PersistentScout compact businesses={[B1]} activeBusiness={B1} me={member} onOpen={onOpen} {...props} />);
  return { ...utils, onOpen, input: screen.getByRole('combobox', { name: 'Search or ask Scout' }) };
};
const enter = (input, v) => { fireEvent.focus(input); fireEvent.change(input, { target: { value: v } }); fireEvent.keyDown(input, { key: 'Enter' }); };
const answered = async (props) => { const m = mount(props); enter(m.input, 'pull me 5 most important prospects who are visiting and hot and show 5 most important tasks'); await waitFor(() => expect(m.container.querySelector('[data-scout-answer]')).toBeTruthy()); return m; };

test('the sectioned answer: summary, two numbered sections with count pills, people rows (name over title, company over stage, heat pill, sort mark), task rows, rule footers, no Records block', async () => {
  const { container, onOpen } = await answered();
  expect(container.querySelector('[data-scout-prose]').textContent).toBe('Two parts: five hot prospects on the site and five tasks, one overdue.');
  const [s1, s2] = container.querySelectorAll('[data-scout-section]');
  expect(s1.querySelector('.scout-num-badge').textContent).toBe('1');
  expect(s1.querySelector('.scout-section__title').textContent).toBe('People on the site');
  expect(s1.querySelector('[data-scout-count]').textContent).toBe('5 of 19 people');
  expect([...s1.querySelectorAll('thead th')].map(th => th.textContent.trim())).toEqual(['Person', 'Company', 'Heat ▼', 'Last visit', 'Last email', 'Actions']);
  const first = s1.querySelector('tbody tr');
  expect(first.querySelectorAll('td')[0].textContent).toBe('Dana MayerVP People');
  expect(first.querySelectorAll('td')[1].textContent).toBe('CloudflareContacted');
  expect(first.querySelector('[data-heat-band="hot"]').textContent).toContain('48');
  expect(first.querySelectorAll('td')[4].textContent).toBe('Oct 29 · opened');
  expect(s1.querySelector('[data-scout-sort]')).toBeTruthy();
  expect(s1.querySelector('tbody tr:last-child td:nth-child(2)').textContent).toBe('Marriottno company record');
  expect(s1.querySelector('[data-scout-rule]').textContent).toContain('People ranked by heat');
  expect(s2.querySelector('[data-scout-count]').textContent).toBe('5 of 342 open');
  expect(s2.querySelector('[data-scout-due="overdue"]').textContent).toBe('overdue · Nov 8');
  expect([...s2.querySelectorAll('thead th')].map(th => th.textContent.trim())).toEqual(['Task', 'Company', 'Owner', 'Due ▲', 'Actions']);
  expect([...s2.querySelectorAll('tbody tr')].map(tr => tr.querySelectorAll('td')[1].textContent)).toEqual(['Upside', '—', '—', '—', '—']);
  await waitFor(() => expect([...s2.querySelectorAll('tbody tr')].map(tr => tr.querySelectorAll('td')[2].textContent)).toEqual(['Ana', 'Ana', 'Bo', 'Ana', 'Unassigned']));
  expect(s2.querySelector('tbody tr td:nth-child(3) .scout-dot')).toBeTruthy();
  expect(first.querySelectorAll('td')[3].textContent).toBe('Nov 8 · /terms');

  expect(container.querySelector('[data-scout-records]')).toBeNull();
  expect(container.textContent).not.toMatch(/Records \(|@/);
  expect(readThread('u1')[0].sections).toHaveLength(2);
  expect(within(s2).getByRole('button', { name: 'Upside' }).className).toBe('scout-link');
  fireEvent.click(within(first).getByRole('button', { name: 'Cloudflare' }));
  expect(onOpen).toHaveBeenLastCalledWith({ entity: 'employers', id: 'e1', title: 'Cloudflare', open: CO_OPEN });
});

test('the ⋯ menu: a person row lists the seven verbs, Assign ▸ the members, Snooze ▸ the dates; a task row lists Done · Reassign · Snooze · Open and opens the task (no Scout write)', async () => {
  const { container, onOpen } = await answered();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Dana Mayer' }));
  const menu = screen.getByRole('menu', { name: 'Actions for Dana Mayer' });
  expect(within(menu).getAllByRole('menuitem').map(b => b.textContent.replace('▸', ''))).toEqual(['Assign', 'Task', 'Mark contacted', 'Not a fit', 'Draft email', 'Snooze', 'Copy for Claude']);
  fireEvent.click(within(menu).getByRole('menuitem', { name: /Assign/ }));
  await waitFor(() => expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Ana', 'Bo', 'Unassigned']));
  expect(screen.getByRole('menu').querySelectorAll('.scout-dot')).toHaveLength(2);
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Bo' }));
  await waitFor(() => expect(container.querySelector('[data-scout-card]')).toBeTruthy());
  expect(calls('/api/scout/plan')[0]).toMatchObject({ scope: 'b1', verb: 'assign', keys: ['people:prospect:p1'], args: { owner_user_id: 'u2' } });
  expect(calls('/api/scout/plan')[0].rows).toHaveLength(10);
  expect(calls('/api/scout/plan')[0].rows[0]).toEqual({ entity: 'people', id: 'prospect:p1', title: 'Dana Mayer', company: { type: 'employer', id: 'e1', name: 'Cloudflare' } });
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
  expect(container.querySelector('[data-scout-card]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Dana Mayer' }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Snooze/ }));
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Tomorrow', 'In a week', 'In 2 weeks', 'In a month']);
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'In a week' }));
  await waitFor(() => expect(calls('/api/scout/plan')).toHaveLength(2));
  expect(calls('/api/scout/plan')[1].args.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Send the joint note' }));
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Done', 'Reassign', 'Snooze', 'Open']);
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Done' }));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ entity: 'todos', id: 't1' }));
  expect(calls('/api/scout/plan')).toHaveLength(2);
  expect(calls('/api/scout/act')).toHaveLength(0);
});

test('a typed command -> the periwinkle confirm card (batch, skipped rows dimmed, the footer count) -> Confirm -> working with names ticking -> the done line, rows updated in place, Undo counting down from 10 s -> Undo', async () => {
  const { container, input } = await answered();
  enter(input, 'assign all five to Bo');
  await waitFor(() => expect(container.querySelector('[data-scout-card="assign"]')).toBeTruthy());
  expect(container.querySelector('[data-scout-answer]')).toBeTruthy();
  expect(calls('/api/scout/plan')[0]).toMatchObject({ scope: 'b1', text: 'assign all five to Bo' });
  expect(calls('/api/scout/ask')).toHaveLength(1);
  const card = container.querySelector('[data-scout-card]');
  expect(card.querySelector('.scout-confirm__title').textContent).toBe('Assign 5 companies to Bo');
  expect(card.querySelectorAll('[data-scout-card-row="will"]')).toHaveLength(3);
  expect([...card.querySelectorAll('[data-scout-card-row="skipped"]')].map(li => li.textContent)).toEqual(['Mace · Employeralready Bo · skipped', 'IXL Learning · Employeralready Bo · skipped']);
  expect(card.querySelector('[data-scout-card-row="will"]').textContent).toBe('Northrop Grumman · EmployerAna → Bo');
  expect(card.querySelector('[data-scout-card-foot]').textContent).toBe('3 will change · 2 skipped');
  expect(calls('/api/scout/act')).toHaveLength(0);
  let release;
  const result = { plan_id: 'plan-1', verb: 'assign', rows: [{ key: 'people:prospect:p1', title: 'Dana Mayer', ok: true, to: 'Bo', error: null, skipped: null }, { key: 'employers:e2', title: 'MetLife', ok: true, to: 'Bo', error: null, skipped: null }], done: 3, failed: 0, skipped: 2, line: 'Assigned 3 of 3 to Bo · 2 skipped', can_undo: true };
  replies.act = () => new Promise(r => { release = () => r({ ok: true, status: 200, json: async () => result }); });
  jest.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: /^Confirm/ }));
  expect(container.querySelector('[data-scout-acting]').textContent).toContain('Assigning 5 companies to Bo…');
  act(() => { jest.advanceTimersByTime(400); });
  expect(container.querySelector('[data-scout-acting] .scout-note').textContent).toContain('✓ Northrop Grumman');
  await act(async () => { release(); });
  await act(async () => {});
  expect(container.querySelector('[data-scout-done-line]').textContent).toBe('✓ Assigned 3 of 3 to Bo · 2 skipped');
  expect(container.querySelector('[data-scout-row="people:prospect:p1"] [data-scout-result="updated"]').textContent).toBe('Bo · updated');
  expect(container.querySelector('[data-scout-row="people:prospect:p1"]').className).toBe('is-updated');
  expect(container.querySelector('[data-scout-undo]').textContent).toBe('Undo 10 s');
  act(() => { jest.advanceTimersByTime(1000); });
  act(() => { jest.advanceTimersByTime(1000); });
  expect(container.querySelector('[data-scout-undo]').textContent).toBe('Undo 8 s');
  expect(container.querySelector('[data-scout-actions]').textContent).toBe('→ Assigned 3 of 3 to Bo · 2 skipped');
  expect(calls('/api/scout/ask')).toHaveLength(1);
  await act(async () => { fireEvent.click(container.querySelector('[data-scout-undo]')); });
  await act(async () => {});
  expect(calls('/api/scout/undo')).toEqual([{ plan_id: 'plan-1' }]);
  expect(container.querySelector('[data-scout-done-line]').textContent).toBe('Undone');
  expect(container.querySelector('[data-scout-result]')).toBeNull();
  expect(container.querySelector('[data-scout-actions]').textContent).toBe('→ Assigned 3 of 3 to Bo · 2 skipped · undone');
  expect(readThread('u1')[0].actions).toEqual(['Assigned 3 of 3 to Bo · 2 skipped · undone']);
});

test('a single-row card says "Nothing changes until you confirm."; Enter confirms; a past date is flagged on the card', async () => {
  const { container, input } = await answered();
  replies.plan = () => json(200, { ...CARD, verb: 'snooze', label: 'Snooze', to: '2026-11-03', when: { date: '2026-11-03', past: true }, rows: [{ key: 'people:prospect:p1', kind: 'person', title: 'Dana Mayer', from: 'not snoozed', to: 'until 2026-11-03', skipped: null, note: "that's in the past - confirm or edit" }], summary: { will: 1, skipped: 0 } });
  replies.act = () => json(200, { plan_id: 'plan-1', rows: [], done: 1, failed: 0, skipped: 0, line: 'Snoozed 1 until 2026-11-03', can_undo: true });
  enter(input, 'snooze Dana Mayer until Nov 3');
  await waitFor(() => expect(container.querySelector('[data-scout-card="snooze"]')).toBeTruthy());
  expect(container.querySelector('.scout-confirm__title').textContent).toBe('Snooze 1 person until Tue, Nov 3');
  expect(container.querySelector('[data-scout-past]').textContent).toBe('That date is in the past - confirm or edit.');
  expect(container.querySelector('[data-scout-card-foot]').textContent).toBe('Nothing changes until you confirm.');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(container.querySelector('[data-scout-done-line]').textContent).toBe('✓ Snoozed 1 until 2026-11-03'));
});

test('partial failure: the done line names the failed row and Retry runs that row only', async () => {
  const { container, input } = await answered();
  const failed = { plan_id: 'plan-1', rows: [{ key: 'employers:e1', title: 'Northrop Grumman', ok: true, to: 'Bo', error: null, skipped: null }, { key: 'employers:e2', title: 'MetLife', ok: false, to: 'Bo', error: 'the database said no', skipped: null }], done: 1, failed: 1, skipped: 0, line: 'Assigned 1 of 2 to Bo · MetLife failed: the database said no', can_undo: true };
  replies.act = () => json(200, failed);
  enter(input, 'assign all five to Bo');
  await waitFor(() => expect(container.querySelector('[data-scout-card]')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /^Confirm/ }));
  await waitFor(() => expect(container.querySelector('[data-scout-failed="employers:e2"]')).toBeTruthy());
  expect(container.querySelector('[data-scout-failed]').textContent).toContain('MetLife failed: the database said no');
  replies.act = () => json(200, { ...failed, rows: failed.rows.map(r => ({ ...r, ok: true, error: null })), done: 2, failed: 0, line: 'Assigned 2 of 2 to Bo' });
  fireEvent.click(within(container.querySelector('[data-scout-failed]')).getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(container.querySelector('[data-scout-failed]')).toBeNull());
  expect(calls('/api/scout/act')).toEqual([{ plan_id: 'plan-1' }, { plan_id: 'plan-1', keys: ['employers:e2'] }]);
  expect(container.querySelector('[data-scout-done-line]').textContent).toBe('✓ Assigned 2 of 2 to Bo');
});

test('can\'t-do: the reason, the WHAT I CAN DO pills, one nearest action that re-plans; nothing to resolve; a batch over 25; a Viewer (403)', async () => {
  const { container, input } = await answered();
  replies.plan = () => json(200, { cant: { reason: "I can't send email. Scout never sends, deletes, or moves a stage. I can open a draft for you to send yourself.", pills: PILLS, nearest: { id: 'draft', label: 'Draft email' } } });
  enter(input, 'email Dana Mayer about the savings plan');
  await waitFor(() => expect(container.querySelector('[data-scout-cant]')).toBeTruthy());
  expect(container.querySelector('[data-scout-cant]').textContent).toContain("I can't send email. Scout never sends, deletes, or moves a stage.");
  expect([...container.querySelectorAll('[data-scout-pill]')].map(p => p.textContent)).toEqual(PILLS.map(p => p.label));
  expect(container.querySelectorAll('[data-scout-nearest]')).toHaveLength(1);
  replies.plan = () => json(200, { verb: 'draft', label: 'Draft email', open: { copy: 'bundle', type: 'employer', id: 'e1', person: 'Dana Mayer' }, line: 'Draft bundle for Dana Mayer copied - paste it into Claude. Scout never sends.' });
  fireEvent.click(screen.getByRole('button', { name: 'Draft email instead' }));
  await waitFor(() => expect(container.querySelector('[data-scout-note="opened"]')).toBeTruthy());
  expect(calls('/api/scout/plan')[1]).toMatchObject({ verb: 'draft', text: 'email Dana Mayer about the savings plan' });
  expect(clip[0]).toContain('# Cloudflare — employer');
  expect(clip[0]).toContain('Draft one first email to Dana Mayer');
  replies.plan = () => json(200, { cant: { reason: 'That is 30 rows. Narrow it to 25 or fewer.', pills: PILLS, nearest: null } });
  enter(input, 'assign all to Bo');
  await waitFor(() => expect(container.querySelector('[data-scout-cant]').textContent).toContain('Narrow it to 25 or fewer'));
  expect(container.querySelector('[data-scout-nearest]')).toBeNull();
  replies.plan = () => json(403, { error: 'Viewers can read, not change', cant: { reason: "You have view access here, so I can't change records.", pills: PILLS, nearest: null } });
  enter(input, 'assign those to Bo');
  await waitFor(() => expect(container.querySelector('[data-scout-cant]').textContent).toContain('view access'));
});

test('nothing to resolve: a command with no answer on screen -> "Ask for a list first" in its own panel; a line that is not a command is asked instead', async () => {
  const { container, input } = mount();
  replies.plan = () => json(200, { cant: { reason: 'Ask for a list first, then tell me what to do with it.', pills: PILLS, nearest: null } });
  enter(input, 'assign those to Bo');
  await waitFor(() => expect(container.querySelector('[data-scout-actpanel] [data-scout-cant]')).toBeTruthy());
  expect(calls('/api/scout/plan')[0].rows).toEqual([]);
  expect(calls('/api/scout/ask')).toHaveLength(0);
  replies.plan = () => json(200, { command: false });
  enter(input, 'make sense of our week for me');
  await waitFor(() => expect(container.querySelector('[data-scout-answer]')).toBeTruthy());
  expect(calls('/api/scout/ask')).toHaveLength(1);
});

test('an open card is cancelled by a new ask; a plan that expired says so; Undo expires after 10 s', async () => {
  const { container, input } = await answered();
  enter(input, 'assign all five to Bo');
  await waitFor(() => expect(container.querySelector('[data-scout-card]')).toBeTruthy());
  enter(input, 'who visited yesterday');
  await waitFor(() => expect(container.querySelector('[data-scout-note="note"]')).toBeTruthy());
  expect(container.querySelector('[data-scout-note="note"]').textContent).toBe('Cancelled: Assign 5 companies to Bo');
  expect(container.querySelector('[data-scout-card]')).toBeNull();
  expect(calls('/api/scout/act')).toHaveLength(0);
  enter(input, 'assign all five to Bo');
  await waitFor(() => expect(container.querySelector('[data-scout-card]')).toBeTruthy());
  replies.act = () => json(410, { error: 'Plan expired - ask again', expired: true });
  fireEvent.click(screen.getByRole('button', { name: /^Confirm/ }));
  await waitFor(() => expect(container.querySelector('[data-scout-note="note"]').textContent).toBe('Plan expired · ask again'));
  enter(input, 'assign all five to Bo');
  await waitFor(() => expect(container.querySelector('[data-scout-card]')).toBeTruthy());
  replies.act = () => json(200, { plan_id: 'plan-1', rows: [], done: 3, failed: 0, skipped: 2, line: 'Assigned 3 of 3 to Bo', can_undo: true });
  jest.useFakeTimers();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Confirm/ })); });
  await act(async () => {});
  expect(container.querySelector('[data-scout-undo]')).toBeTruthy();
  for (let i = 0; i < 10; i++) act(() => { jest.advanceTimersByTime(1000); });
  expect(container.querySelector('[data-scout-undo]')).toBeNull();
  expect(container.querySelector('[data-scout-undo-expired]').textContent).toBe('Undo expired · open the record to change it');
});

test('a person brief: the brief header (Brief · 1 person · name · heat · Open · Copy for Claude) and "✓ Copied · 1 record · 2,100 chars"; a blocked pack is not copied', async () => {
  const p = PEOPLE[0];
  replies.ask = () => json(200, { ...ANSWER, answer_md: 'Dana replied last week.', summary: 'Dana replied last week.', sections: [{ title: 'Brief', count: 1, total: 1, rule: 'Everything on file.', read: 'goals/people/activity/prospect:p1', rows: [p], line: null, brief: { entity: 'people', id: 'prospect:p1' } }], items: [p] });
  const { container, input } = mount();
  enter(input, 'pull the intel on Dana Mayer');
  await waitFor(() => expect(container.querySelector('[data-scout-brief]')).toBeTruthy());
  const head = container.querySelector('[data-scout-brief]');
  expect(head.textContent).toContain('Brief · 1 person');
  expect(head.querySelector('[data-heat-band="hot"]')).toBeTruthy();
  expect(within(head).getByRole('button', { name: 'Open Dana Mayer' })).toBeTruthy();
  fireEvent.click(within(head).getByRole('button', { name: 'Copy for Claude' }));
  await waitFor(() => expect(container.querySelector('[data-scout-note="copied"]')).toBeTruthy());
  expect(container.querySelector('[data-scout-note="copied"]').textContent).toBe('✓ Copied · 1 record · 2,100 chars');
  expect(calls('/api/scout/pack')[0]).toEqual({ scope: 'b1', q: 'pull the intel on Dana Mayer', records: [{ entity: 'people', id: 'prospect:p1' }] });
  expect(clip).toEqual(['Question: q']);
  expect(calls('/api/scout/ask')).toHaveLength(1);
  replies.pack = () => json(422, { blocked: true, error: 'Not copied' });
  fireEvent.click(within(head).getByRole('button', { name: 'Copy for Claude' }));
  await waitFor(() => expect(container.querySelector('[data-scout-note="note"]').textContent).toBe('Not copied: the pack still held an address or phone shape.'));
  expect(clip).toHaveLength(1);
});

test('the opens write nothing: "+ Task" fires the prefilled quick capture with "Opened - save it there"; Draft email on a company opens the Write email panel', async () => {
  const { container, input } = await answered();
  const heard = [];
  const onCapture = e => heard.push(e.detail);
  window.addEventListener(SCOUT_CAPTURE, onCapture);
  replies.plan = () => json(200, { verb: 'add_task', label: 'Add task', open: { quick_capture: { text: 'Call MetLife', due_date: '2026-11-12', past: false, link: { type: 'partner', id: 'pa1', name: 'MetLife' } } }, line: 'Opened - save it there' });
  enter(input, 'add a task to call MetLife Thursday');
  await waitFor(() => expect(container.querySelector('[data-scout-note="opened"]')).toBeTruthy());
  expect(container.querySelector('[data-scout-note="opened"]').textContent).toBe('Opened - save it there');
  expect(heard).toEqual([{ businessId: 'b1', text: 'Call MetLife', due_date: '2026-11-12', past: false, link: { type: 'partner', id: 'pa1', name: 'MetLife' } }]);
  window.removeEventListener(SCOUT_CAPTURE, onCapture);
  replies.plan = () => json(200, { verb: 'draft', label: 'Draft email', open: { panel: 'compose', type: 'employer', id: 'e1', name: 'Cloudflare' }, line: 'Opened Write email for Cloudflare - one draft call under the Write email cap. Scout never sends.' });
  enter(input, 'draft an email to Cloudflare');
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Write email · Cloudflare' })).toBeTruthy());
  expect(calls('/api/scout/act')).toHaveLength(0);
});

test('a Viewer sees the rows and Open but no ⋯; the 390 sheet stacks cards (3 people + "2 more", 2 tasks + "3 more") and the ⋯ opens an action sheet', async () => {
  const v = await answered({ me: viewer });
  expect(screen.queryAllByRole('button', { name: /^Actions for/ })).toHaveLength(0);
  expect(screen.getAllByRole('button', { name: /^Open / }).length).toBe(10);
  v.unmount();
  mockPhone.on = true;
  render(<PersistentScout compact businesses={[B1]} activeBusiness={B1} me={member} onOpen={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search or ask Scout' }));
  const sheet = screen.getByRole('dialog', { name: 'Scout' });
  enter(screen.getByRole('combobox'), 'pull me 5 most important prospects and show 5 most important tasks');
  await waitFor(() => expect(sheet.querySelector('[data-scout-answer]')).toBeTruthy());
  expect(sheet.querySelector('table')).toBeNull();
  const [s1, s2] = sheet.querySelectorAll('[data-scout-section]');
  expect(s1.querySelectorAll('.scout-card')).toHaveLength(3);
  expect(s1.querySelector('.scout-more').textContent).toBe('2 more ');
  expect(s2.querySelectorAll('.scout-card')).toHaveLength(2);
  expect(s2.querySelector('.scout-more').textContent).toBe('3 more ');
  fireEvent.click(s1.querySelector('.scout-more'));
  expect(s1.querySelectorAll('.scout-card')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Dana Mayer' }));
  const menu = screen.getByRole('menu', { name: 'Actions for Dana Mayer' });
  expect(menu.closest('.scout-menu').className).toContain('scout-menu--sheet');
  expect(menu.closest('.scout-menu').querySelector('.scout-menu__title').textContent).toBe('Dana Mayer · Cloudflare');
  expect(within(menu).getAllByRole('menuitem')).toHaveLength(7);
});

test('model: what reads as a command, the rows /plan gets, the card titles, the menus, in-place results', () => {
  for (const t of ['assign those to Bo', 'Please mark Dana contacted', 'snooze row 2', 'add a task to call MetLife', 'copy this for Claude', 'pull everything on Northrop for Claude', 'send them an email', 'delete those']) expect(looksLikeCommand(t)).toBe(true);
  for (const t of ['who visited yesterday', 'show me my open tasks', 'give me the top 5 targets', 'hot targets Brad referred']) expect(looksLikeCommand(t)).toBe(false);
  expect(planRows(ANSWER)).toHaveLength(10);
  expect(planRows({ items: [PEOPLE[0]] })).toEqual([{ entity: 'people', id: 'prospect:p1', title: 'Dana Mayer', company: { type: 'employer', id: 'e1', name: 'Cloudflare' } }]);
  expect(cardTitle({ ...CARD, verb: 'contacted', rows: [{ kind: 'person' }, { kind: 'person' }] })).toBe('Mark 2 people contacted');
  expect(cardTitle({ ...CARD, verb: 'not_fit', rows: [{ kind: 'person' }, { kind: 'target' }] })).toBe('Mark 2 records not a fit');
  expect(menuFor({ entity: 'call_notes', id: 'n1' })).toEqual([]);
  expect(menuFor({ entity: 'employers', id: 'e1' }).map(m => m.id)).toEqual(['assign', 'add_task', 'contacted', 'not_fit', 'draft', 'snooze', 'copy']);
  const marked = withResults(ANSWER, [{ key: 'people:prospect:p1', ok: true, to: 'Bo' }, { key: 'todos:t1', ok: false, error: 'no', to: null }]);
  expect(marked.sections[0].rows[0].result).toEqual({ state: 'updated', text: 'Bo' });
  expect(marked.sections[1].rows[0].result).toEqual({ state: 'failed', text: 'no' });
  expect(withoutResults(marked).sections[0].rows[0].result).toBeUndefined();
  expect(copiedLine({ records: 2, chars: 5980 })).toBe('✓ Copied · 2 records · 5,980 chars');
});
