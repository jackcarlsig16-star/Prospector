import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PersistentScout from '../PersistentScout';
import { cardTitle, countPill, menuFor, draftText, draftCost, focusLabel, looksLikeCommand, SCOUT_CAPTURE } from './scoutActions';

// scout-v3.1 Stage 2 - the screen states over invented replies (0 server, 0 model): the ask carries the rows on screen
// and the focus; the inline draft (ready, copied, regenerated, opened prefilled, withheld); the task card with Edit;
// task-row menus -> cards, one card + one Undo for a batch; "Which one?" on an ask and on a command; the fill pill;
// the brief grid before the prose; the focus chip; the phone; a Viewer. Names, titles and companies only.
const mockPhone = { on: false };
jest.mock('../../utils/useMediaQuery', () => () => mockPhone.on);
jest.mock('../salesAnalytics/goals/goalsApi', () => ({ goalsApi: {
  members: () => Promise.resolve([{ user_id: 'u1', name: 'Ana Member', color: '#6F8CF0' }, { user_id: 'u2', name: 'Bo Member', color: '#C97626' }]),
  copyBundle: () => Promise.resolve('# Cloudflare — employer\n'),
} }));
jest.mock('../salesAnalytics/goals/priorities/ComposePanel', () => ({ row, onClose }) => <div role="dialog" aria-label={`Write email · ${row.name}`} data-to={row.to || ''} data-person={row.person?.name || ''} data-prefill={row.prefill ? `${row.prefill.subject}|${row.prefill.cost}` : ''}><button type="button" onClick={onClose}>Close draft</button></div>);

const B1 = { id: 'b1', name: 'HomeLover', color: '#E2418A', features: { goals_sales: true } };
const member = { profile: { id: 'u1' }, memberships: [{ business_id: 'b1', role: 'member' }] };
const viewer = { profile: { id: 'u9' }, memberships: [{ business_id: 'b1', role: 'viewer' }] };
const CF = { entity: 'employers', type: 'employer', id: 'e1', name: 'Cloudflare', stage: 'contacted', open: { page: 'sales', params: { tab: 'pipeline', view: 'companies', open: 'employer-e1' } } };
const person = (i, name, heat, band = 'hot') => ({ entity: 'people', id: `prospect:p${i}`, title: name, score: heat, workspace_id: 'b1', workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'pipeline', view: 'people', open: `person:prospect:p${i}` } }, why: `${name} · VP People`,
  row: { kind: 'person', key: `prospect:p${i}`, name, title: 'VP People', company: CF, heat, heat_band: band, last_visit: '2026-11-08', last_path: '/terms', last_email: { at: '2026-10-29', what: 'opened' }, status: 'new', sequenced: true } });
const task = (i, text, due) => ({ entity: 'todos', id: `t${i}`, title: text, date: due, workspace_id: 'b1', workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'actions', open: `todo:t${i}` } }, why: text, row: { kind: 'task', id: `t${i}`, text, due, overdue: false, owner: 'mine', owner_user_id: 'u1', link: null } });
const PEOPLE = [person(1, 'Dana Mayer', 48), person(2, 'Meagan Earl', 36, 'warm'), person(3, 'Paola Ball', 34, 'warm'), person(4, 'James Curcio', 33, 'warm'), person(5, 'Lee Stone', 31, 'warm')];
const TASKS = [task(1, 'Send the joint note', '2026-11-08'), task(2, 'Intro two partners', '2026-11-10'), task(3, 'Create the reporting draft', '2026-11-11')];
const FILL = { asked: 5, strict: 1, counts: [{ band: 'hot', n: 1 }, { band: 'warm', n: 4 }], text: '5 people · 1 hot · 4 warm to make 5' };
const base = { usage: { input_tokens: 3000, output_tokens: 300, cost_usd: 0.014 }, withheld: false, ask: { sort: 'heat' }, context_stats: { reads: ['people whose company visited (7 d) · 5 · by heat · filled: 5 people · 1 hot · 4 warm to make 5', 'openTodos (342 open)'], rows_by_entity: { people: 19, todos: 342 } }, cap: { used: 3, max: 40 }, scope: 'b1' };
const ANSWER = { ...base, answer_md: 'Two parts.', summary: 'Two parts: five prospects on the site and three tasks.',
  sections: [
    { title: 'People on the site', count: 5, total: 5, fill: FILL, rule: 'People ranked by heat, hottest first.', read: 'people whose company visited (7 d) · 5 · by heat · filled: 5 people · 1 hot · 4 warm to make 5', rows: PEOPLE, line: null, brief: null },
    { title: 'Tasks', count: 3, total: 342, rule: 'Open to-dos ranked overdue first.', read: 'openTodos (342 open)', rows: TASKS, line: null, brief: null },
  ], items: [...PEOPLE, ...TASKS] };
const GRID = [{ label: 'Record', value: 'employer · stage contacted · owner Ana' }, { label: 'Visits', value: 'Visited 5 times in 7 d · 8 unique visitors' }, { label: 'Last touch', value: 'Last touch: 2 days ago (Ana, email)' }, { label: 'Notes', value: '—' }, { label: 'People', value: 'Dana Mayer — VP People · Meagan Earl — VP People' }];
const company = { entity: 'employers', id: 'e1', title: 'Cloudflare', score: 70, workspace_id: 'b1', workspace_name: 'HomeLover', open: CF.open, why: 'Cloudflare · employer', row: { kind: 'company', type: 'employer', id: 'e1', name: 'Cloudflare', score: 70, band: 'P1' } };
const BRIEF = { ...base, answer_md: 'Cloudflare is an employer at Contacted, owned by Ana.', summary: 'Cloudflare is an employer at Contacted, owned by Ana.', context_stats: { reads: ['goals/brief/employer'], rows_by_entity: { employers: 1 } },
  sections: [{ title: 'Brief', count: 1, total: 1, rule: 'Everything on file for the record named.', read: 'goals/brief/employer', rows: [company], line: null, brief: { entity: 'employers', id: 'e1', grid: GRID } }], items: [company] };
const FOLLOW = { ...base, answer_md: 'the second one → Meagan Earl, Cloudflare. She opened the last email on Oct 29.', summary: 'the second one → Meagan Earl, Cloudflare. She opened the last email on Oct 29.', context_stats: { reads: ['goals/people/activity/person'], rows_by_entity: { people: 1 } },
  resolved: { phrase: 'the second one', line: 'the second one → Meagan Earl, Cloudflare', rows: [{ entity: 'people', id: 'prospect:p2', title: 'Meagan Earl' }] },
  sections: [{ title: 'Brief', count: 1, total: 1, rule: null, read: 'goals/people/activity/person', rows: [PEOPLE[1]], line: null, brief: { entity: 'people', id: 'prospect:p2', grid: [{ label: 'Record', value: 'Person · VP People' }, { label: 'Company', value: 'Cloudflare · contacted' }] } }], items: [PEOPLE[1]] };
const WHICH = { answer_md: 'Which one? Say it like "the second one" or use a name.', summary: 'Which one?', sections: [], items: [], usage: null, withheld: false, scope: 'b1', cap: { used: 3, max: 40 },
  cant: { reason: 'Which one? Say it like "the second one" or use a name.', candidates: PEOPLE.slice(0, 3).map(p => ({ key: `people:${p.id}`, entity: 'people', id: p.id, title: p.title, sub: 'Cloudflare' })) } };
const BODY = 'Hi Meagan,\n\nSaw the People team on our relocation pages.\n\nWorth 15 minutes? [Tue 10am] [Thu 2pm]\n\nAna';
const DRAFT = { verb: 'draft', label: 'Draft email', line: 'Drafted to Meagan Earl — nothing sent',
  draft: { to: { person_key: 'prospect:p2', name: 'Meagan Earl', title: 'VP People' }, company: { type: 'employer', id: 'e1', name: 'Cloudflare' }, cost: { usd: 0.0182 }, cap: { used: 4, max: 30 }, subject: 'A housing benefit for the People team', body: BODY, lint: { ok: true, issues: 0 } },
  open: { panel: 'compose', type: 'employer', id: 'e1', name: 'Cloudflare', to: 'Meagan Earl', prefill: { subject: 'A housing benefit for the People team', body: BODY } } };
const WITHHELD = { ...DRAFT, line: 'Draft withheld — nothing sent', draft: { to: DRAFT.draft.to, company: DRAFT.draft.company, cost: { usd: 0.0171 }, cap: { used: 5, max: 30 }, withheld: true, reason: 'Draft withheld: it held an address or phone shape. Regenerate, or open Write email.' }, open: { panel: 'compose', type: 'employer', id: 'e1', name: 'Cloudflare', to: 'Meagan Earl' } };
const cardRow = (key, title, from, to, note = null) => ({ key, kind: 'task', title, from, to, skipped: null, note });
const TASK_CARD = { plan_id: 'plan-t', verb: 'add_task', label: 'Add task', to: null, when: { date: '2026-11-12', past: false, phrase: 'thursday' }, rows: [cardRow('todos:new', 'Call MetLife', null, 'open to-do · due 2026-11-12')], summary: { will: 1, skipped: 0 }, note: null,
  fields: { task: 'Call MetLife', linked_to: 'MetLife', linked_detail: 'Partner · First email sent', link: { type: 'partner', id: 'pa2', name: 'MetLife' }, person_key: null, owner: 'Ana', due: '2026-11-12', due_note: '"thursday" read as the next one' } };
const SNOOZE = n => ({ plan_id: 'plan-s', verb: 'snooze', label: 'Snooze', to: '2026-11-16', when: { date: '2026-11-16', past: false, phrase: 'next week' }, rows: TASKS.slice(0, n).map(t => cardRow(`todos:${t.id}`, t.title, 'not snoozed', 'until 2026-11-16', 'hidden from the open list until then')), summary: { will: n, skipped: 0 }, note: null });
const DONE = (card, line) => ({ plan_id: card.plan_id, verb: card.verb, rows: card.rows.map(r => ({ ...r, ok: true, error: null })), done: card.rows.length, failed: 0, skipped: 0, line, can_undo: true });

let replies, clip;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const calls = path => global.fetch.mock.calls.filter(c => c[0] === path).map(c => JSON.parse(c[1].body));
beforeEach(() => {
  localStorage.clear(); mockPhone.on = false; clip = [];
  Object.assign(navigator, { clipboard: { writeText: jest.fn(t => { clip.push(t); return Promise.resolve(); }) } });
  replies = { ask: () => json(200, ANSWER), plan: () => json(200, DRAFT), act: () => json(200, {}), undo: () => json(200, { line: 'undone', rows: [] }), pack: () => json(200, { text: 'Question: q', records: 1, chars: 2100, trimmed: 0 }) };
  global.fetch = jest.fn(url => { const k = String(url).split('/').pop().split('?')[0]; return replies[k] ? replies[k]() : json(200, { groups: [] }); });
});

const mount = (props = {}) => {
  const onOpen = jest.fn();
  const utils = render(<PersistentScout compact businesses={[B1]} activeBusiness={B1} me={member} onOpen={onOpen} {...props} />);
  return { ...utils, onOpen, input: screen.getByRole('combobox', { name: 'Search or ask Scout' }) };
};
const enter = (input, v) => { fireEvent.focus(input); fireEvent.change(input, { target: { value: v } }); fireEvent.keyDown(input, { key: 'Enter' }); };
const answered = async props => { const m = mount(props); enter(m.input, 'pull me 5 most important prospects who are visiting and hot and show my tasks'); await waitFor(() => expect(m.container.querySelector('[data-scout-answer]')).toBeTruthy()); return m; };
const $ = (c, sel) => c.querySelector(sel);

test('the model: card titles for the task verbs, the fill pill, the task menu, the draft text and cost, the focus label, what reads as a command', () => {
  expect(cardTitle(TASK_CARD)).toBe('Add 1 task');
  expect(cardTitle(SNOOZE(3))).toBe('Snooze 3 tasks until Mon, Nov 16');
  expect(cardTitle({ ...SNOOZE(1), verb: 'task_done' })).toBe('Mark 1 task done');
  expect(cardTitle({ ...SNOOZE(2), verb: 'task_drop' })).toBe('Drop 2 tasks');
  expect(cardTitle({ ...SNOOZE(1), verb: 'task_due', to: '2026-11-13' })).toBe('Move 1 task to Fri, Nov 13');
  expect(countPill(ANSWER.sections[0], 'people')).toBe('5 people · 1 hot · 4 warm to make 5');
  expect(countPill(ANSWER.sections[1], 'open')).toBe('3 of 342 open');
  expect(menuFor(TASKS[0]).map(m => [m.id, m.sub || null])).toEqual([['task_done', null], ['assign', 'members'], ['snooze', 'taskdates'], ['task_due', 'dues'], ['task_drop', null], ['open', null]]);
  expect(draftText(DRAFT.draft)).toBe(`Subject: A housing benefit for the People team\n\n${BODY}\n`);
  expect(draftCost(DRAFT.draft)).toBe('$0.018 · Write email 4 of 30 today');
  expect(focusLabel([{ title: 'Meagan Earl' }])).toBe('about Meagan Earl'); expect(focusLabel([{}, {}])).toBe('about 2 records');
  for (const t of ['mark the first task done', 'drop the last task', 'reschedule the second task to Friday', 'complete the first task', 'write an email to the second one']) expect(looksLikeCommand(t)).toBe(true);
  expect(looksLikeCommand('what is due this week')).toBe(false);
});

test('an ask carries the rows on screen; the fill pill reads the server\'s words; a follow-up shows the focus chip, sends the focus with the next ask, and clears on ×', async () => {
  const { container, input } = await answered();
  expect(calls('/api/scout/ask')[0].rows).toBeUndefined();
  expect($(container, '[data-scout-section="1"] [data-scout-count]').textContent).toBe('5 people · 1 hot · 4 warm to make 5');
  expect($(container, '[data-scout-section="1"] [data-scout-fill]')).toBeTruthy();
  expect($(container, '[data-scout-section="2"] [data-scout-count]').textContent).toBe('3 of 342 open');
  expect($(container, '[data-scout-focus]')).toBeNull();
  expect($(container, '[data-scout-footer]').textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|prospect:/);
  replies.ask = () => json(200, FOLLOW);
  enter(input, 'what do we know about the second one');
  await waitFor(() => expect($(container, '[data-scout-focus]')).toBeTruthy());
  const sent = calls('/api/scout/ask')[1];
  expect(sent.rows).toHaveLength(8);
  expect(sent.rows[1]).toEqual({ entity: 'people', id: 'prospect:p2', title: 'Meagan Earl', company: { type: 'employer', id: 'e1', name: 'Cloudflare' } });
  expect(sent.rows[5]).toEqual({ entity: 'todos', id: 't1', title: 'Send the joint note', company: null });
  expect(sent.focus).toBeUndefined();
  expect($(container, '[data-scout-focus]').textContent).toBe('about Meagan Earl×');
  expect($(container, '[data-scout-prose]').textContent).toMatch(/^the second one → Meagan Earl, Cloudflare\./);
  // the next ask sends the focus; a command does too
  enter(input, 'when did she last visit');
  await waitFor(() => expect(calls('/api/scout/ask')).toHaveLength(3));
  expect(calls('/api/scout/ask')[2].focus).toEqual([{ entity: 'people', id: 'prospect:p2', title: 'Meagan Earl' }]);
  await waitFor(() => expect($(container, '[data-scout-answer]')).toBeTruthy());
  enter(input, 'write an email to her');
  await waitFor(() => expect(calls('/api/scout/plan')).toHaveLength(1));
  expect(calls('/api/scout/plan')[0]).toMatchObject({ inline: true, text: 'write an email to her', focus: [{ entity: 'people', id: 'prospect:p2', title: 'Meagan Earl' }] });
  // × clears the focus: the next ask no longer carries it
  fireEvent.click(screen.getByRole('button', { name: 'Clear the focus (about Meagan Earl)' }));
  expect($(container, '[data-scout-focus]')).toBeNull();
  replies.ask = () => json(200, ANSWER);
  enter(input, 'who opened our emails');
  await waitFor(() => expect(calls('/api/scout/ask')).toHaveLength(4));
  expect(calls('/api/scout/ask')[3].focus).toBeUndefined();
  await waitFor(() => expect($(container, '[data-scout-section="2"]')).toBeTruthy());
  expect($(container, '[data-scout-focus]')).toBeNull();
});

test('the inline draft: to · subject · body · Copy · Open in Write email (prefilled, no second call) · Regenerate (one more plan) · cost; nothing sent; the action line joins the answer', async () => {
  const { container, input } = await answered();
  enter(input, 'write an email to the second one');
  await waitFor(() => expect($(container, '[data-scout-draft]')).toBeTruthy());
  const d = $(container, '[data-scout-draft]');
  expect(d.getAttribute('data-scout-draft')).toBe('ready');
  expect(d.getAttribute('aria-label')).toBe('Draft email to Meagan Earl');
  expect($(d, '[data-scout-draft-to]').textContent).toBe('To Meagan Earl · VP People · Cloudflare');
  expect($(d, '[data-scout-draft-subject]').textContent).toBe('A housing benefit for the People team');
  expect($(d, '[data-scout-draft-body]').textContent).toBe(BODY);
  expect($(d, '[data-scout-draft-cost]').textContent).toBe('$0.018 · Write email 4 of 30 today');
  expect(d.textContent).toMatch(/Draft · not sent/); expect(d.textContent).toMatch(/Nothing was sent\./);
  expect($(container, '[data-scout-actions]').textContent).toBe('→ Drafted to Meagan Earl — nothing sent');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click($(d, '[data-scout-draft-copy]'));
  await waitFor(() => expect($(container, '[data-scout-draft-copy]').textContent).toBe('✓ Copied'));
  expect(clip).toEqual([`Subject: A housing benefit for the People team\n\n${BODY}\n`]);
  fireEvent.click($(container, '[data-scout-draft-again]'));
  await waitFor(() => expect(calls('/api/scout/plan')).toHaveLength(2));
  expect(calls('/api/scout/plan')[1]).toMatchObject({ inline: true, text: 'write an email to the second one' });
  await waitFor(() => expect($(container, '[data-scout-draft-copy]').textContent).toBe('Copy'));
  fireEvent.click($(container, '[data-scout-draft-open]'));
  const panel = screen.getByRole('dialog', { name: 'Write email · Cloudflare' });
  expect([panel.getAttribute('data-to'), panel.getAttribute('data-person'), panel.getAttribute('data-prefill')]).toEqual(['Meagan Earl', 'Meagan Earl', 'A housing benefit for the People team|0.0182']);
  expect(calls('/api/scout/act')).toHaveLength(0);
  expect($(container, '[data-scout-draft]').textContent).not.toMatch(/@/);
});

test('a withheld draft: the reason, no subject or body, no Copy; Regenerate and Open in Write email remain; the cost of the call still shows', async () => {
  replies.plan = () => json(200, WITHHELD);
  const { container, input } = await answered();
  enter(input, 'write an email to the second one');
  await waitFor(() => expect($(container, '[data-scout-draft="withheld"]')).toBeTruthy());
  const d = $(container, '[data-scout-draft]');
  expect($(d, '[data-scout-draft-withheld]').textContent).toBe('Draft withheld: it held an address or phone shape. Regenerate, or open Write email.');
  expect($(d, '[data-scout-draft-subject]')).toBeNull(); expect($(d, '[data-scout-draft-body]')).toBeNull(); expect($(d, '[data-scout-draft-copy]')).toBeNull();
  expect($(d, '[data-scout-draft-again]')).toBeTruthy(); expect($(d, '[data-scout-draft-open]')).toBeTruthy();
  expect($(d, '[data-scout-draft-cost]').textContent).toBe('$0.017 · Write email 5 of 30 today');
  fireEvent.click($(d, '[data-scout-draft-open]'));
  expect(screen.getByRole('dialog', { name: 'Write email · Cloudflare' }).getAttribute('data-prefill')).toBe('');
});

test('the task card: Task · Linked to · Owner · Due with how the day was read; Confirm adds it with Undo; Edit opens quick capture prefilled and writes nothing; Cancel', async () => {
  replies.plan = () => json(200, TASK_CARD);
  replies.act = () => json(200, DONE(TASK_CARD, 'Added 1'));
  const { container, input } = await answered();
  enter(input, 'add a task to call MetLife Thursday');
  await waitFor(() => expect($(container, '[data-scout-taskcard]')).toBeTruthy());
  const card = $(container, '[data-scout-taskcard]');
  expect(card.getAttribute('aria-label')).toBe('Add 1 task');
  expect([...card.querySelectorAll('dt')].map(x => x.textContent)).toEqual(['Task', 'Linked to', 'Owner', 'Due']);
  expect([...card.querySelectorAll('dd')].map(x => x.textContent)).toEqual(['Call MetLife', 'MetLife · Partner · First email sent', 'Ana (you)', 'Thu, Nov 12']);
  expect($(card, '[data-scout-due-note]').textContent).toBe('“Thursday” read as the next one.');
  expect(within(card).getAllByRole('button').map(b => b.textContent)).toEqual(['Confirm ↵', 'Edit', 'Cancel esc']);
  // Edit: quick capture, prefilled; the card goes; nothing is written
  const seen = [];
  const on = e => seen.push(e.detail); window.addEventListener(SCOUT_CAPTURE, on);
  fireEvent.click($(card, '[data-scout-edit]'));
  window.removeEventListener(SCOUT_CAPTURE, on);
  expect(seen).toEqual([{ businessId: 'b1', text: 'Call MetLife', due_date: '2026-11-12', past: false, link: { type: 'partner', id: 'pa2', name: 'MetLife' }, person_key: null }]);
  expect($(container, '[data-scout-taskcard]')).toBeNull();
  expect($(container, '[data-scout-note="opened"]').textContent).toBe('Opened quick capture — save it there');
  expect(calls('/api/scout/act')).toHaveLength(0);
  // again, Confirm
  enter(input, 'add a task to call MetLife Thursday');
  await waitFor(() => expect($(container, '[data-scout-taskcard]')).toBeTruthy());
  fireEvent.click($(container, '[data-scout-confirm]'));
  await waitFor(() => expect($(container, '[data-scout-done-line]').textContent).toBe('✓ Added 1'));
  expect(calls('/api/scout/act')).toEqual([{ plan_id: 'plan-t' }]);
  fireEvent.click($(container, '[data-scout-undo]'));
  await waitFor(() => expect($(container, '[data-scout-done-line]').textContent).toBe('Undone'));
  expect(calls('/api/scout/undo')).toEqual([{ plan_id: 'plan-t' }]);
  // a task with no record and a past date
  replies.plan = () => json(200, { ...TASK_CARD, when: { date: '2026-11-03', past: true, phrase: 'nov 3' }, fields: { ...TASK_CARD.fields, linked_to: null, linked_detail: null, link: null, due: '2026-11-03', due_note: 'that date is in the past - confirm or edit' } });
  enter(input, 'add a task to review the deck Nov 3');
  await waitFor(() => expect($(container, '[data-scout-taskcard]')).toBeTruthy());
  expect([...container.querySelectorAll('[data-scout-taskcard] dd')].map(x => x.textContent)[1]).toBe('no record');
  expect($(container, '[data-scout-due-note]').className).toBe('scout-warn');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect($(container, '[data-scout-taskcard]')).toBeNull();
});

test('task-row menus -> cards: Done, Reassign ▸ a member, Snooze ▸ Next week or a picked date, Due ▸ Today, Drop - each a plan for that row; a typed batch is ONE card with ONE Undo', async () => {
  replies.plan = () => json(200, SNOOZE(1));
  const { container, input } = await answered();
  const menu = async () => { fireEvent.click(screen.getByRole('button', { name: 'Actions for Send the joint note' })); return screen.getByRole('menu'); };
  const sub = async name => { fireEvent.click(within(await menu()).getByRole('menuitem', { name: new RegExp(`^${name}`) })); return screen.getByRole('menu'); };
  const last = () => calls('/api/scout/plan').at(-1);
  fireEvent.click(within(await menu()).getByRole('menuitem', { name: 'Done' }));
  await waitFor(() => expect(calls('/api/scout/plan')).toHaveLength(1));
  expect(last()).toMatchObject({ verb: 'task_done', keys: ['todos:t1'], args: {}, text: '' });
  await waitFor(() => expect($(container, '[data-scout-card]')).toBeTruthy());
  let m = await sub('Reassign');
  await waitFor(() => expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Ana', 'Bo', 'Unassigned']));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Bo' }));
  await waitFor(() => expect(calls('/api/scout/plan')).toHaveLength(2));
  expect(last()).toMatchObject({ verb: 'assign', keys: ['todos:t1'], args: { owner_user_id: 'u2' } });
  await waitFor(() => expect($(container, '[data-scout-card]')).toBeTruthy());
  m = await sub('Snooze');
  expect(within(m).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Tomorrow', 'Next week']);
  expect(screen.getByLabelText('Snooze until')).toBeTruthy();
  fireEvent.click(within(m).getByRole('menuitem', { name: 'Next week' }));
  await waitFor(() => expect(calls('/api/scout/plan')).toHaveLength(3));
  expect(last().verb).toBe('snooze'); expect(last().args.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await waitFor(() => expect($(container, '[data-scout-card]')).toBeTruthy());
  m = await sub('Snooze');
  fireEvent.change(screen.getByLabelText('Snooze until'), { target: { value: '2026-12-01' } });
  await waitFor(() => expect(calls('/api/scout/plan')).toHaveLength(4));
  expect(last()).toMatchObject({ verb: 'snooze', keys: ['todos:t1'], args: { date: '2026-12-01' } });
  await waitFor(() => expect($(container, '[data-scout-card]')).toBeTruthy());
  m = await sub('Due');
  expect(within(m).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Today', 'Tomorrow', 'Next week']);
  expect(screen.getByLabelText('Due date')).toBeTruthy();
  fireEvent.click(within(m).getByRole('menuitem', { name: 'Today' }));
  await waitFor(() => expect(calls('/api/scout/plan')).toHaveLength(5));
  expect(last().verb).toBe('task_due'); expect(last().args.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await waitFor(() => expect($(container, '[data-scout-card]')).toBeTruthy());
  fireEvent.click(within(await menu()).getByRole('menuitem', { name: 'Drop' }));
  await waitFor(() => expect(calls('/api/scout/plan')).toHaveLength(6));
  expect(last()).toMatchObject({ verb: 'task_drop', keys: ['todos:t1'] });
  // a batch: one card, one act, one Undo
  replies.plan = () => json(200, SNOOZE(3));
  replies.act = () => json(200, DONE(SNOOZE(3), 'Snoozed 3 of 3 until 2026-11-16'));
  enter(input, 'snooze those tasks until next week');
  await waitFor(() => expect($(container, '[data-scout-card="snooze"]')?.getAttribute('aria-label')).toBe('Snooze 3 tasks until Mon, Nov 16'));
  expect(container.querySelectorAll('[data-scout-card-row="will"]')).toHaveLength(3);
  fireEvent.click($(container, '[data-scout-confirm]'));
  await waitFor(() => expect($(container, '[data-scout-done-line]').textContent).toBe('✓ Snoozed 3 of 3 until 2026-11-16'));
  expect(container.querySelectorAll('[data-scout-result="updated"]')).toHaveLength(3);
  expect(container.querySelectorAll('[data-scout-undo]')).toHaveLength(1);
  fireEvent.click($(container, '[data-scout-undo]'));
  await waitFor(() => expect(calls('/api/scout/undo')).toEqual([{ plan_id: 'plan-s' }]));
  expect(calls('/api/scout/act')).toEqual([{ plan_id: 'plan-s' }]);
});

test('"Which one?": an ask with several candidates shows them as buttons (no turn, no ask spent) and a pick asks again about that one row; a command with several candidates runs again on the pick', async () => {
  const { container, input } = await answered();
  replies.ask = () => json(200, WHICH);
  enter(input, 'what do we know about her');
  await waitFor(() => expect($(container, '[data-scout-which]')).toBeTruthy());
  expect($(container, '[data-scout-cant]').getAttribute('data-scout-cant')).toBe('which');
  expect(within($(container, '[data-scout-which]')).getAllByRole('button').map(b => b.textContent)).toEqual(['Dana Mayer · Cloudflare', 'Meagan Earl · Cloudflare', 'Paola Ball · Cloudflare']);
  expect($(container, '[data-scout-section="2"]')).toBeTruthy(); // the answer on screen stays
  expect(container.querySelectorAll('.scout-turn')).toHaveLength(1); // no new turn in the thread
  replies.ask = () => json(200, FOLLOW);
  fireEvent.click(within($(container, '[data-scout-which]')).getByRole('button', { name: /Meagan Earl/ }));
  await waitFor(() => expect(calls('/api/scout/ask')).toHaveLength(3));
  expect(calls('/api/scout/ask')[2]).toMatchObject({ q: 'what do we know about her', rows: [{ entity: 'people', id: 'prospect:p2', title: 'Meagan Earl', company: { type: 'employer', id: 'e1', name: 'Cloudflare' } }] });
  await waitFor(() => expect($(container, '[data-scout-focus]').textContent).toBe('about Meagan Earl×'));
  // a command
  replies.ask = () => json(200, ANSWER);
  fireEvent.click(screen.getByRole('button', { name: 'Clear the focus (about Meagan Earl)' }));
  enter(input, 'who is hot and what are my tasks');
  await waitFor(() => expect($(container, '[data-scout-section="2"]')).toBeTruthy());
  replies.plan = () => json(200, { cant: { reason: 'Which one? Say it like "the second one" or use a name.', pills: [], nearest: null, candidates: WHICH.cant.candidates } });
  enter(input, 'write an email to her');
  await waitFor(() => expect($(container, '[data-scout-which]')).toBeTruthy());
  replies.plan = () => json(200, DRAFT);
  fireEvent.click(within($(container, '[data-scout-which]')).getByRole('button', { name: /Meagan Earl/ }));
  await waitFor(() => expect($(container, '[data-scout-draft]')).toBeTruthy());
  expect(calls('/api/scout/plan').at(-1)).toMatchObject({ text: 'write an email to her', keys: ['people:prospect:p2'], inline: true });
  // nothing to point at: one plain line, no buttons
  replies.ask = () => json(200, { ...WHICH, cant: { reason: 'Ask for a list first, then point at a row, like "the second one".' } });
  enter(input, 'what about the ninth one');
  await waitFor(() => expect($(container, '[data-scout-cant]')?.textContent).toMatch(/^Ask for a list first/));
  expect($(container, '[data-scout-which]')).toBeNull();
});

test('the brief: header, then the label / value grid (a field with nothing on file is dimmed "—"), then the prose; Copy for Claude packs the record; the read line holds no id', async () => {
  replies.ask = () => json(200, BRIEF);
  const { container, input } = mount();
  enter(input, 'what do we know about Cloudflare');
  await waitFor(() => expect($(container, '[data-scout-brief-grid]')).toBeTruthy());
  const grid = $(container, '[data-scout-brief-grid]');
  expect([...grid.querySelectorAll('dt')].map(x => x.textContent)).toEqual(['Record', 'Visits', 'Last touch', 'Notes', 'People']);
  expect([...grid.querySelectorAll('dd')].map(x => x.textContent)).toEqual(GRID.map(g => g.value));
  expect(grid.querySelectorAll('dd.scout-dim')).toHaveLength(1);
  const order = [...container.querySelectorAll('[data-scout-brief], [data-scout-brief-grid], [data-scout-prose]')].map(el => (el.hasAttribute('data-scout-brief') ? 'head' : el.hasAttribute('data-scout-brief-grid') ? 'grid' : 'prose'));
  expect(order).toEqual(['head', 'grid', 'prose']);
  expect($(container, '[data-scout-brief]').textContent).toMatch(/^Brief · 1 companyCloudflare/);
  fireEvent.click($(container, '[data-scout-copy]'));
  await waitFor(() => expect(clip).toEqual(['Question: q']));
  expect(calls('/api/scout/pack')[0].records).toEqual([{ entity: 'employers', id: 'e1' }]);
  expect($(container, '[data-scout-footer]').textContent).toMatch(/1 read: goals\/brief\/employer/);
  expect($(container, '[data-scout-footer]').textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
});

test('390: the sheet shows the fill pill, the draft block, the task card and the picker as stacked blocks; the task menu is a bottom sheet with the date picker', async () => {
  mockPhone.on = true;
  const { container } = render(<PersistentScout compact businesses={[B1]} activeBusiness={B1} me={member} onOpen={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search or ask Scout' }));
  const input = screen.getByRole('combobox', { name: 'Search or ask Scout' });
  enter(input, 'pull me 5 most important prospects who are visiting and hot and show my tasks');
  await waitFor(() => expect($(document.body, '[data-scout-cards]')).toBeTruthy());
  const root = document.body;
  expect($(root, 'table')).toBeNull();
  expect($(root, '[data-scout-section="1"] [data-scout-count]').textContent).toBe('5 people · 1 hot · 4 warm to make 5');
  enter(input, 'write an email to the second one');
  await waitFor(() => expect($(root, '[data-scout-draft="ready"]')).toBeTruthy());
  expect($(root, '[data-scout-draft-body]').textContent).toBe(BODY);
  replies.plan = () => json(200, TASK_CARD);
  enter(input, 'add a task to call MetLife Thursday');
  await waitFor(() => expect($(root, '[data-scout-taskcard]')).toBeTruthy());
  expect([...root.querySelectorAll('[data-scout-taskcard] dt')]).toHaveLength(4);
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Send the joint note' }));
  expect($(root, '.scout-menu--sheet')).toBeTruthy();
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Due/ }));
  expect(screen.getByLabelText('Due date')).toBeTruthy();
  expect(container).toBeTruthy();
});

test('a Viewer: asks and follow-ups work (the rows ride along, the focus chip shows); no row menus, so no draft, no task card', async () => {
  const { container, input } = await answered({ me: viewer });
  expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  expect($(container, '[data-scout-viewer]')).toBeTruthy();
  replies.ask = () => json(200, FOLLOW);
  enter(input, 'what do we know about the second one');
  await waitFor(() => expect($(container, '[data-scout-focus]')).toBeTruthy());
  expect(calls('/api/scout/ask')[1].rows).toHaveLength(8);
  expect($(container, '[data-scout-brief-grid]')).toBeTruthy();
  expect($(container, '[data-scout-draft]')).toBeNull(); expect($(container, '[data-scout-taskcard]')).toBeNull();
});

// actions-v2 A6 / D41 - Scout opens Today's work panel on a to-do row: the ask is queued for the list and the page moves to Actions.
test('"what should I do next on the first task" opens the work panel on that row: the ask is handed to Today and Actions opens; no draft, no card', async () => {
  const { takeWork } = require('../salesAnalytics/goals/today/todayRows');
  const m = await answered();
  replies.plan = () => json(200, { verb: 'work', label: 'Open the work panel', open: { panel: 'today_work', key: 'todo:t1', verb: 'next_steps' }, line: 'Opened the work panel on "Send the deck" — nothing sent' });
  enter(m.input, 'what should I do next on the first task');
  await waitFor(() => expect(m.onOpen).toHaveBeenCalledWith(expect.objectContaining({ entity: 'todos', id: 't1', open: { page: 'sales', params: { tab: 'actions' } } })));
  expect(takeWork()).toEqual({ key: 'todo:t1', verb: 'next_steps' });
  expect(m.container.querySelector('[data-scout-draft]')).toBeNull();
  expect(m.container.querySelector('[data-scout-confirm]')).toBeNull();
  expect(m.container.textContent).toContain('Opened the work panel');
});
