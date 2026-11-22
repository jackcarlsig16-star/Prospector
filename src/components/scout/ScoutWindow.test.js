import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ScoutWindow, { ScoutPage } from './ScoutWindow';
import { saveThread, readThread } from './scoutModel';
import { OPEN_ATTENTION } from '../salesAnalytics/goals/goalsApi';

// app-shell-v2 Stage 3 (W1 / W2) - the Scout window and the Scout page over invented replies (0 server, 0 model): the
// window opens on the day's thread with a follow-up input (no search, no scope pill), a follow-up carries the thread,
// a command plans its card in the window, Esc / the close button / an opened record close it, shut it stays mounted;
// the page is the same thread with no field of its own. Names and to-do texts only.
jest.mock('../salesAnalytics/goals/goalsApi', () => ({ OPEN_TASKS: 'test:open-tasks', OPEN_ATTENTION: 'test:open-attention', goalsApi: { members: () => Promise.resolve([{ user_id: 'u1', name: 'Ana Member', color: '#6F8CF0' }]) } }));
jest.mock('../salesAnalytics/goals/priorities/ComposePanel', () => () => null);

const B1 = { id: 'b1', name: 'Northwind', color: '#E2418A', features: { goals_sales: true } };
const member = { profile: { id: 'u1' }, memberships: [{ business_id: 'b1', role: 'member' }] };
const task = (i, text, due) => ({ entity: 'todos', id: `t${i}`, title: text, date: due, workspace_id: 'b1', open: { page: 'sales', params: { tab: 'actions', open: `todo:t${i}` } }, why: text, row: { kind: 'task', id: `t${i}`, text, due, overdue: true, owner: 'mine', owner_user_id: 'u1', link: null } });
const TASKS = [task(1, 'Send the joint note', '2026-11-08'), task(2, 'Intro two partners', '2026-11-10'), task(3, 'Create the reporting draft', '2026-11-11')];
const base = { usage: { input_tokens: 3000, output_tokens: 300, cost_usd: 0.014 }, withheld: false, ask: { sort: null }, context_stats: { reads: ['openTodos (3 open, mine)'], rows_by_entity: { todos: 3 } }, cap: { used: 3, max: 40 }, scope: 'b1' };
const LIST = { ...base, answer_md: 'Three are overdue.', summary: 'Three are overdue.', sections: [{ title: 'Tasks', count: 3, total: 3, rule: 'Open to-dos ranked overdue first.', read: 'openTodos (3 open, mine)', rows: TASKS, line: null, brief: null }], items: TASKS };
const SECOND = { ...base, answer_md: 'the second one → Intro two partners. It is two days late.', summary: 'the second one → Intro two partners. It is two days late.', sections: [{ title: 'Tasks', count: 1, total: 1, rule: null, read: 'openTodos', rows: [TASKS[1]], line: null, brief: null }], items: [TASKS[1]] };
const turnOf = (at, q, r) => ({ at, q, scope: 'b1', elapsed: 2, answer_md: r.answer_md, summary: r.summary, sections: r.sections, items: r.items, usage: r.usage, ask: r.ask, cap: r.cap, context_stats: r.context_stats });
const SNOOZE = { plan_id: 'plan-s', verb: 'snooze', label: 'Snooze', to: '2026-11-16', when: { date: '2026-11-16', past: false, phrase: 'next week' }, rows: TASKS.map(t => ({ key: `todos:${t.id}`, kind: 'task', title: t.title, from: 'not snoozed', to: 'until 2026-11-16', skipped: null, note: null })), summary: { will: 3, skipped: 0 }, note: null };

let replies;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const calls = path => global.fetch.mock.calls.filter(c => String(c[0]).split('?')[0] === path);
const times = (el, text) => el.textContent.split(text).length - 1;
beforeEach(() => {
  localStorage.clear();
  replies = { ask: () => json(200, SECOND), plan: () => json(200, SNOOZE) };
  global.fetch = jest.fn(url => { const k = String(url).split('/').pop().split('?')[0]; return replies[k] ? replies[k]() : json(200, { groups: [] }); });
});
const win = (props = {}) => {
  const p = { open: true, seed: { openLast: true, at: 1 }, compact: false, workspace: B1, me: member, businesses: [B1], onOpen: jest.fn(), onClose: jest.fn(), ...props };
  const utils = render(<ScoutWindow {...p} />);
  return { ...p, ...utils, dialog: screen.getByRole('dialog', { name: 'Scout', hidden: true }) };
};

test('window: a drawer on the day\'s thread - the last answer with each to-do once, a follow-up input that never searches, no scope pill; a follow-up carries the thread and is saved', async () => {
  saveThread('u1', [turnOf(Date.now() - 5000, 'my overdue to-dos', LIST)]);
  const w = win();
  expect(w.dialog.getAttribute('data-scout-window')).toBe('drawer');
  expect(w.dialog.hasAttribute('aria-modal')).toBe(false);
  const answer = w.dialog.querySelector('[data-scout-answer]');
  expect(answer).toBeTruthy();
  for (const t of TASKS) expect(times(answer.querySelector('.scout-panel'), t.title)).toBe(1);
  const input = within(w.dialog).getByRole('textbox', { name: 'Ask a follow-up or give a command' });
  expect(document.activeElement).toBe(input);
  expect(within(w.dialog).queryByRole('combobox')).toBeNull();
  expect(w.dialog.querySelector('.scout-scope:not([data-static])')).toBeNull();
  // the input sits under the thread
  expect(w.dialog.querySelector('[data-scout-pop]').compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(input, { target: { value: 'intro' } });
  await new Promise(r => setTimeout(r, 320));
  expect(calls('/api/scout/search')).toHaveLength(0);
  expect(w.dialog.querySelector('[data-scout-answer]')).toBeTruthy();
  fireEvent.change(input, { target: { value: 'what about the second one' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(w.dialog.textContent).toContain('It is two days late.'));
  const sent = JSON.parse(calls('/api/scout/ask')[0][1].body);
  expect(sent).toEqual(expect.objectContaining({ q: 'what about the second one', scope: 'b1' }));
  expect(sent.thread.map(m => m.role)).toEqual(['user', 'assistant']);
  expect(sent.rows.map(r => r.id)).toEqual(['t1', 't2', 't3']);
  expect(input.value).toBe('');
  expect(readThread('u1').map(t => t.q)).toEqual(['my overdue to-dos', 'what about the second one']);
  expect(JSON.stringify(localStorage)).not.toMatch(/@/);
});

test('window: Esc and the close button hand focus back (onClose(true)); an opened record closes it without; shut, it stays mounted and deaf to Esc; another drawer opening shuts it', async () => {
  saveThread('u1', [turnOf(Date.now() - 5000, 'my overdue to-dos', LIST)]);
  const w = win();
  const input = within(w.dialog).getByRole('textbox');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(w.onClose).toHaveBeenLastCalledWith(true);
  fireEvent.click(within(w.dialog).getByRole('button', { name: 'Close Scout' }));
  expect(w.onClose).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(w.onClose).toHaveBeenCalledTimes(3);
  fireEvent.click(within(w.dialog).getByRole('button', { name: 'Open Send the joint note' }));
  expect(w.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  expect(w.onClose).toHaveBeenLastCalledWith(false);
  window.dispatchEvent(new CustomEvent(OPEN_ATTENTION));
  expect(w.onClose).toHaveBeenCalledTimes(5);
  expect(w.onClose).toHaveBeenLastCalledWith(false);
  w.rerender(<ScoutWindow open={false} seed={w.seed} compact={false} workspace={B1} me={member} businesses={[B1]} onOpen={w.onOpen} onClose={w.onClose} />);
  expect(w.dialog.hidden).toBe(true);
  expect(w.dialog.querySelector('[data-scout-answer]')).toBeTruthy();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(w.onClose).toHaveBeenCalledTimes(5);
});

test('window: a command sent from the field plans in the window - the confirm card under the answer it points at; Esc cancels the card before it closes the window', async () => {
  saveThread('u1', [turnOf(Date.now() - 5000, 'my overdue to-dos', LIST)]);
  const w = win({ seed: { q: 'snooze those until next week', at: 2 } });
  await waitFor(() => expect(w.dialog.querySelector('[data-scout-card="snooze"]')).toBeTruthy());
  const planned = JSON.parse(calls('/api/scout/plan')[0][1].body);
  expect(planned).toEqual(expect.objectContaining({ text: 'snooze those until next week', scope: 'b1' }));
  expect(planned.rows.map(r => r.id)).toEqual(['t1', 't2', 't3']);
  expect(calls('/api/scout/ask')).toHaveLength(0);
  expect(w.dialog.querySelector('[data-scout-answer]')).toBeTruthy();
  const input = within(w.dialog).getByRole('textbox');
  expect(input.value).toBe('');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(w.onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(w.dialog.querySelector('[data-scout-card]')).toBeNull());
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(w.onClose).toHaveBeenCalledWith(true);
});

test('window: nothing asked yet shows one line; on a phone it is a full sheet (modal) with a 44 px close', () => {
  const w = win({ compact: true });
  expect(w.dialog.getAttribute('data-scout-window')).toBe('sheet');
  expect(w.dialog.getAttribute('aria-modal')).toBe('true');
  expect(w.dialog.querySelector('[data-scout-empty]').textContent).toMatch(/stay in this window/);
  expect(within(w.dialog).getByRole('textbox')).toBeTruthy();
});

test('page: the thread at the page\'s width with no field of its own - the header\'s line (seed) is asked here and joins the thread; past asks are listed and reopen', async () => {
  const { container, rerender } = render(<ScoutPage seed={null} compact={false} workspace={B1} me={member} businesses={[B1]} onOpen={jest.fn()} />);
  const page = container.querySelector('[data-scout-page]');
  expect(page.style.maxWidth).toBe('960px');
  expect(page.querySelector('input')).toBeNull();
  expect(page.querySelector('[data-scout-empty]').textContent).toMatch(/Type in the field at the top/);
  replies.ask = () => json(200, LIST);
  rerender(<ScoutPage seed={{ q: 'my overdue to-dos', at: 5 }} compact={false} workspace={B1} me={member} businesses={[B1]} onOpen={jest.fn()} />);
  await waitFor(() => expect(page.querySelector('[data-scout-answer]')).toBeTruthy());
  expect(calls('/api/scout/ask')).toHaveLength(1);
  replies.ask = () => json(200, SECOND);
  rerender(<ScoutPage seed={{ q: 'what about the second one', at: 6 }} compact={false} workspace={B1} me={member} businesses={[B1]} onOpen={jest.fn()} />);
  await waitFor(() => expect(page.textContent).toContain('It is two days late.'));
  expect(calls('/api/scout/ask')).toHaveLength(2);
  expect(JSON.parse(calls('/api/scout/ask')[1][1].body).thread).toHaveLength(2);
  const thread = page.querySelector('[data-scout-thread]');
  expect(thread.textContent).toContain('my overdue to-dos');
  fireEvent.click(within(thread).getByRole('button', { name: 'reopen' }));
  await waitFor(() => expect(page.querySelector('.scout-q').textContent).toContain('my overdue to-dos'));
  expect(page.querySelector('input')).toBeNull();
  // the same seed again (a re-render) asks nothing new
  rerender(<ScoutPage seed={{ q: 'what about the second one', at: 6 }} compact={false} workspace={B1} me={member} businesses={[B1]} onOpen={jest.fn()} />);
  expect(calls('/api/scout/ask')).toHaveLength(2);
});
