import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PersistentScout from '../PersistentScout';
import { menuFor, SCOUT_CAPTURE, bundleLine, TASK_LINE } from './scoutActions';

// FIX scout-action-feedback-v1 - no silent path: every ⋯ item on a person, a company and a task row, and every way a
// pick or a typed command can resolve (card, open, copy, can't-do, refused clipboard, server error, offline, a reply
// Scout does not know), ends in a visible line inside the action block. The loop walks menuFor(), so a menu item
// added later is covered the day it is added. The Scout routes are mocked: nothing leaves the test.
jest.mock('../../utils/useMediaQuery', () => () => false);
jest.mock('../salesAnalytics/goals/goalsApi', () => ({ goalsApi: {
  members: () => Promise.resolve([{ user_id: 'u1', name: 'Ana Member', color: '#6F8CF0' }, { user_id: 'u2', name: 'Bo Member', color: '#C97626' }]),
  copyBundle: () => Promise.resolve('# Cloudflare — employer\n\n## What I need:\n\n'),
} }));
jest.mock('../salesAnalytics/goals/priorities/ComposePanel', () => ({ row, onClose, onToast }) => (
  <div role="dialog" aria-label={`Write email · ${row.name}`} data-to={row.to || ''}>
    <button type="button" onClick={() => onToast({ text: 'Draft copied' })}>Copy</button><button type="button" onClick={onClose}>Close draft</button>
  </div>
));

const B1 = { id: 'b1', name: 'HomeLover', color: '#E2418A', features: { goals_sales: true } };
const member = { profile: { id: 'u1' }, memberships: [{ business_id: 'b1', role: 'member' }] };
const CO_OPEN = { page: 'sales', params: { tab: 'pipeline', view: 'companies', open: 'employer-e1' } };
const PERSON = { entity: 'people', id: 'prospect:p1', title: 'Dana Mayer', workspace_id: 'b1', open: { page: 'sales', params: { tab: 'pipeline', view: 'people', open: 'person:prospect:p1' } },
  row: { kind: 'person', key: 'prospect:p1', name: 'Dana Mayer', title: 'VP People', company: { entity: 'employers', type: 'employer', id: 'e1', name: 'Cloudflare', stage: 'contacted', open: CO_OPEN }, heat: 48, heat_band: 'hot' } };
const COMPANY = { entity: 'employers', id: 'e1', title: 'Cloudflare', workspace_id: 'b1', open: CO_OPEN, row: { stage: 'contacted', owner: 'Ana', score: 71 } };
const TASK = { entity: 'todos', id: 't1', title: 'Send the joint note', workspace_id: 'b1', open: { page: 'sales', params: { tab: 'actions', open: 'todo:t1' } }, row: { kind: 'task', id: 't1', text: 'Send the joint note', due: '2026-11-12', overdue: false, owner: 'mine', owner_user_id: 'u1', link: null } };
const ROWS = { person: PERSON, company: COMPANY, task: TASK };
const section = (title, row) => ({ title, count: 1, total: 1, rule: null, read: null, rows: [row], line: null, brief: null });
const ANSWER = { answer_md: 'Three parts.', summary: 'Three parts.', sections: [section('People', PERSON), section('Companies', COMPANY), section('Tasks', TASK)], items: [PERSON, COMPANY, TASK], usage: { input_tokens: 10, output_tokens: 10, cost_usd: 0.001 }, ask: {}, context_stats: { reads: [], rows_by_entity: {} }, cap: { used: 1, max: 40 }, scope: 'b1' };
const CARD = verb => ({ plan_id: 'plan-1', verb, label: verb, to: verb === 'assign' ? 'Ana' : verb === 'snooze' ? '2026-11-11' : null, when: null, rows: [{ key: 'people:prospect:p1', kind: 'person', title: 'Dana Mayer', from: 'new', to: 'changed', skipped: null, note: null }], summary: { will: 1, skipped: 0 }, note: null });
const OPENS = {
  add_task: { open: { quick_capture: { text: 'Follow up with Dana Mayer', due_date: null, past: false, link: null } }, line: 'Opened quick capture — save it there' },
  draft: { open: { panel: 'compose', type: 'employer', id: 'e1', name: 'Cloudflare', to: 'Dana Mayer' }, line: 'Opened Write email for Cloudflare · address it to Dana Mayer' },
  bundle: { open: { copy: 'bundle', type: 'employer', id: 'e1', person: 'Dana Mayer' }, line: null },
};

let replies, clip, scrolled;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const bodies = path => global.fetch.mock.calls.filter(c => c[0] === path).map(c => JSON.parse(c[1].body));
beforeEach(() => {
  localStorage.clear(); clip = []; scrolled = jest.spyOn(window.Element.prototype, 'scrollIntoView');
  Object.assign(navigator, { clipboard: { writeText: jest.fn(t => { clip.push(t); return Promise.resolve(); }) } });
  replies = {
    ask: () => json(200, ANSWER),
    plan: body => json(200, OPENS[body.verb] ? { verb: body.verb, ...OPENS[body.verb] } : CARD(body.verb)),
    act: () => json(200, { plan_id: 'plan-1', verb: 'assign', rows: [{ key: 'people:prospect:p1', title: 'Dana Mayer', ok: true, to: 'Ana' }], done: 1, failed: 0, skipped: 0, line: 'Assigned 1 to Ana', can_undo: true }),
    pack: () => json(200, { text: 'Question: q\n\nDana Mayer', records: 1, chars: 2100, trimmed: 0 }),
  };
  global.fetch = jest.fn((url, init) => { const k = String(url).split('/').pop().split('?')[0]; return replies[k] ? replies[k](init?.body ? JSON.parse(init.body) : {}) : json(200, { groups: [] }); });
});
afterEach(() => { scrolled.mockRestore(); });

const answered = async () => {
  const onOpen = jest.fn();
  const utils = render(<PersistentScout compact businesses={[B1]} activeBusiness={B1} me={member} onOpen={onOpen} />);
  const input = screen.getByRole('combobox', { name: 'Search or ask Scout' });
  fireEvent.focus(input); fireEvent.change(input, { target: { value: 'who is hot and what is due' } }); fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(utils.container.querySelector('[data-scout-answer]')).toBeTruthy());
  return { ...utils, onOpen, input };
};
const type = (input, v) => { fireEvent.focus(input); fireEvent.change(input, { target: { value: v } }); fireEvent.keyDown(input, { key: 'Enter' }); };
const pick = async (row, id) => {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${row.title}` }));
  const item = menuFor(row).find(m => m.id === id);
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: new RegExp(`^${item.label}`) }));
  if (item.sub) { await waitFor(() => expect(screen.getByRole('menu').getAttribute('aria-label')).toBeTruthy()); await waitFor(() => expect(within(screen.getByRole('menu')).getAllByRole('menuitem')[0].textContent).not.toBe(item.label)); fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]); }
};
// The one rule: the action block holds a settled line (never empty, never still "working").
const settled = async container => {
  await waitFor(() => {
    const block = container.querySelector('[data-scout-actblock]');
    expect(block).toBeTruthy();
    expect(block.querySelector('[data-scout-note="planning"]')).toBeNull();
    expect(block.textContent.trim().length).toBeGreaterThan(8);
  });
  return container.querySelector('[data-scout-actblock]');
};

const CASES = Object.entries(ROWS).flatMap(([kind, row]) => menuFor(row).map(m => [kind, m.id, m.label]));
test('the menus under test: person 8 items, company 7, task 4', () => {
  expect(CASES.map(c => `${c[0]}:${c[1]}`)).toEqual([
    'person:assign', 'person:add_task', 'person:contacted', 'person:not_fit', 'person:draft', 'person:bundle', 'person:snooze', 'person:copy',
    'company:assign', 'company:add_task', 'company:contacted', 'company:not_fit', 'company:draft', 'company:snooze', 'company:copy',
    'task:task:done', 'task:task:reassign', 'task:task:snooze', 'task:open',
  ]);
});

test.each(CASES)('%s row · %s (%s) ends in a visible line, scrolled into view', async (kind, id) => {
  const { container, onOpen } = await answered();
  await pick(ROWS[kind], id);
  if (!TASK_LINE[id]) expect(container.querySelector('[data-scout-note="planning"] .scout-sweep')).toBeTruthy();
  const block = await settled(container);
  expect(scrolled).toHaveBeenCalled();
  expect(block.textContent).not.toMatch(/@|\d{3}[-.\s]\d{3}[-.\s]\d{4}/);
  if (['assign', 'contacted', 'not_fit', 'snooze'].includes(id)) {
    expect(block.querySelector('[data-scout-card]')).toBeTruthy();
    fireEvent.click(block.querySelector('[data-scout-confirm]'));
    await waitFor(() => expect(container.querySelector('[data-scout-done-line]').textContent).toBe('✓ Assigned 1 to Ana'));
    expect(container.querySelector('[data-scout-undo]')).toBeTruthy();
  } else if (id === 'add_task') expect(block.querySelector('[data-scout-note="opened"]').textContent).toBe('Opened quick capture — save it there');
  else if (id === 'draft') {
    expect(block.querySelector('[data-scout-note="opened"]').textContent).toBe('Opened Write email for Cloudflare · address it to Dana Mayer');
    expect(screen.getByRole('dialog', { name: 'Write email · Cloudflare' }).getAttribute('data-to')).toBe('Dana Mayer');
    expect(clip).toHaveLength(0);
  } else if (id === 'bundle') {
    expect(block.querySelector('[data-scout-note="copied"]').textContent).toBe(bundleLine('Dana Mayer', clip[0].length));
    expect(block.textContent).toMatch(/^✓ Copied the draft bundle for Dana Mayer · \d+ chars — paste it into Claude$/);
    expect(clip[0]).toContain('Draft one first email to Dana Mayer');
  } else if (id === 'copy') expect(block.querySelector('[data-scout-note="copied"]').textContent).toBe('✓ Copied · 1 record · 2,100 chars');
  else {
    expect(block.querySelector('[data-scout-note="opened"]').textContent).toBe(TASK_LINE[id]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ entity: 'todos', id: 't1' }));
    expect(container.querySelector('[data-scout-answer]')).toBeTruthy();
  }
});

test('every other way a pick resolves still shows a line: can\'t-do (and its nearest action keeps the row), a refused clipboard, a server error, offline, a reply Scout does not know, a pack with nothing in it', async () => {
  const { container } = await answered();
  const pills = [{ id: 'draft', label: 'Draft email' }];
  replies.plan = body => (body.verb === 'bundle' ? json(200, { verb: 'bundle', ...OPENS.bundle }) : json(200, { cant: { reason: 'Dana Mayer has no company record, so there is no Write email panel to open - add the company to the pipeline first.', pills, nearest: { id: 'bundle', label: 'Copy draft bundle' } } }));
  await pick(PERSON, 'draft');
  expect((await settled(container)).querySelector('[data-scout-cant]').textContent).toContain('no company record');
  fireEvent.click(screen.getByRole('button', { name: 'Copy draft bundle instead' }));
  await waitFor(() => expect(container.querySelector('[data-scout-note="copied"]')).toBeTruthy());
  expect(bodies('/api/scout/plan')[1]).toMatchObject({ verb: 'bundle', keys: ['people:prospect:p1'] });

  navigator.clipboard.writeText = jest.fn(() => Promise.reject(new Error('NotAllowedError')));
  await pick(PERSON, 'bundle');
  await waitFor(() => expect(container.querySelector('[data-scout-note="note"]').textContent).toBe('Not copied: the browser blocked the clipboard · click the page and try again'));
  await pick(COMPANY, 'copy');
  await waitFor(() => expect(container.querySelector('[data-scout-note="note"]').textContent).toBe('Not copied: the browser blocked the clipboard · click the page and try again'));

  replies.plan = () => json(500, { error: 'The card was blocked' });
  await pick(COMPANY, 'contacted');
  expect((await settled(container)).textContent).toBe('The card was blocked');
  replies.plan = () => Promise.reject(new TypeError('Failed to fetch'));
  await pick(COMPANY, 'not_fit');
  expect((await settled(container)).textContent).toBe("Scout can't reach the server · try again.");
  replies.plan = () => json(200, { verb: 'draft', open: { something_new: true }, line: null });
  await pick(COMPANY, 'draft');
  expect((await settled(container)).textContent).toBe("Scout can't open that here.");
  replies.pack = () => json(200, { cant: { reason: 'There is nothing to copy for Claude in this workspace yet.', pills: [], nearest: null } });
  await pick(COMPANY, 'copy');
  expect((await settled(container)).querySelector('[data-scout-cant]').textContent).toContain('nothing to copy');
});

test('a person with no company record: Copy draft bundle copies the person\'s own pack with the prompt; a typed command shows the sweep, then its line; the Write email panel\'s own Copy says so', async () => {
  const { container, input } = await answered();
  replies.plan = () => json(200, { verb: 'bundle', open: { copy: 'bundle', type: 'target', records: [{ entity: 'people', id: 'prospect:p1' }], person: 'Dana Mayer' }, line: null });
  await pick(PERSON, 'bundle');
  await waitFor(() => expect(container.querySelector('[data-scout-note="copied"]')).toBeTruthy());
  expect(bodies('/api/scout/pack')[0]).toEqual({ scope: 'b1', q: '', records: [{ entity: 'people', id: 'prospect:p1' }] });
  expect(clip[0]).toMatch(/^Question: q\n\nDana Mayer\n\n## What I need:\n\nDraft one first email to Dana Mayer, a company we want/);

  const heard = [];
  const onCapture = e => heard.push(e.detail);
  window.addEventListener(SCOUT_CAPTURE, onCapture);
  replies.plan = () => json(200, { verb: 'add_task', ...OPENS.add_task });
  type(input, 'add a task to follow up with Dana Mayer');
  expect(container.querySelector('[data-scout-note="planning"] .scout-sweep')).toBeTruthy();
  expect((await settled(container)).textContent).toBe('Opened quick capture — save it there');
  expect(heard).toHaveLength(1);
  window.removeEventListener(SCOUT_CAPTURE, onCapture);

  replies.plan = () => json(200, { verb: 'draft', ...OPENS.draft });
  type(input, 'draft an email to Dana Mayer');
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Write email · Cloudflare' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  expect(container.querySelector('[data-scout-toast]').textContent).toBe('Draft copied');
});
