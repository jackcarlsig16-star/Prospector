import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AttentionDrawer, { withPageLoad, attentionN, windowText, peoplePullText } from './AttentionDrawer';
import { goalsApi, OPEN_TASKS, OPEN_ATTENTION, OPEN_CONNECTIONS } from './goalsApi';
import { triggerSync } from '../salesApi';

// actions-home-attention-v1 Stage 2 - the Needs attention button + drawer. Made-up data; no emails or phones.
jest.mock('./goalsApi', () => ({
  ...jest.requireActual('./goalsApi'),
  goalsApi: { attention: jest.fn(), visitPull: jest.fn(), visitPeoplePull: jest.fn(), runTidy: jest.fn() },
}));
jest.mock('../salesApi', () => ({ triggerSync: jest.fn() }));

const src = (id, label, status, extra = {}) => ({ id, label, status, last_at: '2026-10-22T16:00:00Z', error: null, ...extra });
const SOURCES = [
  src('apollo', 'Apollo (sequences, opens, replies)', 'stale', { last_at: '2026-10-15T18:05:00Z' }),
  src('outlook', 'Outlook (mail + calendar)', 'ok'),
  src('visitors', 'Website visitors', 'ok'),
  src('tidy', 'Tidy', 'failed', { error: 'x'.repeat(120) }),
  src('research', 'Research', 'ok'),
];
const COUNTS = { overdue_todos: 2, overdue_waiting: 0, held_apollo: 1, held_outlook: 0, campaign_sends: 3, campaign_replies: 0 };
const DATA = { today: '2026-10-22', sources: SOURCES, counts: COUNTS, n: 5 };
beforeEach(() => { jest.clearAllMocks(); goalsApi.attention.mockResolvedValue(DATA); });

test('model: a page-load failure shows as Failed until the source is OK again; n = stale/failed lines + non-zero counts', () => {
  const out = withPageLoad([src('visitors', 'Website visitors', 'stale'), src('tidy', 'Tidy', 'ok')], { visits: 'Apollo 500', tidy: 'boom' });
  expect(out.map(s => [s.status, s.error])).toEqual([['failed', 'on page load: Apollo 500'], ['ok', null]]);
  expect(attentionN(SOURCES, COUNTS)).toBe(5);
  expect(attentionN([src('a', 'A', 'running'), src('b', 'B', 'not_connected')], { x: 0 })).toBe(0);
});

test('Member: "Needs attention (n)" opens the drawer (fresh read), statuses in words, Sync now re-reads; counts open their lists', async () => {
  triggerSync.mockResolvedValue({ id: 'r1' });
  const onNav = jest.fn();
  const opened = jest.fn();
  window.addEventListener(OPEN_ATTENTION, opened);
  render(<AttentionDrawer businessId="b1" canEdit compact={false} pageLoadFailures={{}} onNav={onNav} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Needs attention (5)' }));
  expect(opened).toHaveBeenCalled();
  await waitFor(() => expect(goalsApi.attention).toHaveBeenLastCalledWith('b1', { fresh: true }));
  const drawer = screen.getByRole('dialog', { name: 'Needs attention (5)' });
  const apollo = drawer.querySelector('[data-source="apollo"]');
  expect(apollo).toHaveTextContent('Stale');
  const tidy = drawer.querySelector('[data-source="tidy"]');
  expect(tidy).toHaveTextContent('Failed');
  expect(within(tidy).getByRole('note')).toHaveTextContent(/x…/);
  fireEvent.click(within(tidy).getByRole('button', { name: 'more' }));
  expect(within(tidy).getByRole('note').textContent.length).toBeGreaterThan(120);
  expect(drawer.querySelector('[data-source="research"]').querySelector('button')).toBeNull();
  fireEvent.click(within(apollo).getByRole('button', { name: 'Sync now' }));
  await waitFor(() => expect(triggerSync).toHaveBeenCalledWith('b1'));
  await waitFor(() => expect(goalsApi.attention).toHaveBeenCalledTimes(3));
  expect(await within(drawer).findByRole('status')).toHaveTextContent('Apollo (sequences, opens, replies): done');

  const tasks = jest.fn();
  window.addEventListener(OPEN_TASKS, tasks);
  fireEvent.click(within(drawer.querySelector('[data-count="overdue_todos"]')).getByRole('button', { name: 'Your overdue to-dos: 2 - open' }));
  expect(tasks.mock.calls[0][0].detail).toMatchObject({ filter: 'me' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Needs attention (5)' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Your campaign sends due: 3 - open' }));
  expect(onNav).toHaveBeenCalledWith('pipeline', 'campaigns');
  fireEvent.click(screen.getByRole('button', { name: 'Needs attention (5)' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '📝 Paste call notes' }));
  expect(tasks.mock.calls[1][0].detail).toMatchObject({ paste: true });
  window.removeEventListener(OPEN_TASKS, tasks);
  window.removeEventListener(OPEN_ATTENTION, opened);
});

test('All clear when nothing needs you; Esc closes; the Tasks drawer opening closes it; Outlook not connected links to Connections', async () => {
  goalsApi.attention.mockResolvedValue({ ...DATA, sources: SOURCES.map(s => ({ ...s, status: s.id === 'outlook' ? 'not_connected' : 'ok', error: null })), counts: Object.fromEntries(Object.keys(COUNTS).map(k => [k, 0])) });
  const conn = jest.fn();
  window.addEventListener(OPEN_CONNECTIONS, conn);
  render(<AttentionDrawer businessId="b1" canEdit compact={false} pageLoadFailures={{}} onNav={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'All clear' }));
  const drawer = screen.getByRole('dialog', { name: 'All clear' });
  const outlook = drawer.querySelector('[data-source="outlook"]');
  expect(outlook).toHaveTextContent('Not connected');
  expect(within(outlook).queryByRole('button', { name: 'Sync Outlook' })).toBeNull();
  fireEvent.click(within(outlook).getByRole('button', { name: 'Connections' }));
  expect(conn).toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All clear' }));
  window.dispatchEvent(new CustomEvent(OPEN_TASKS, { detail: {} }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  window.removeEventListener(OPEN_CONNECTIONS, conn);
});

test('Viewer: statuses and counts, no manual buttons, no Quick add', async () => {
  render(<AttentionDrawer businessId="b1" canEdit={false} compact={false} pageLoadFailures={{}} onNav={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Needs attention (5)' }));
  const drawer = screen.getByRole('dialog');
  expect(drawer).toHaveTextContent('read-only');
  for (const name of ['Sync now', 'Sync Outlook', 'Pull now', 'Tidy now', '📝 Paste call notes']) expect(within(drawer).queryByRole('button', { name })).toBeNull();
  expect(drawer.querySelector('[data-source="tidy"]')).toHaveTextContent('Failed');
});

// FIX people-apollo-visibility-v1 F3c - a run that left a backlog says so, with Sync again (Members only).
test('Apollo backlog: "13 messages left — Sync again" runs the sync; Viewers see the count without the button', async () => {
  triggerSync.mockResolvedValue({ id: 'r2' });
  goalsApi.attention.mockResolvedValue({ ...DATA, sources: [src('apollo', 'Apollo (sequences, opens, replies)', 'ok', { left: 13 }), ...SOURCES.slice(1)] });
  const { unmount } = render(<AttentionDrawer businessId="b1" canEdit compact={false} pageLoadFailures={{}} onNav={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Needs attention/ }));
  const line = await screen.findByText('13 messages left');
  const row = line.closest('li');
  fireEvent.click(within(row).getByRole('button', { name: 'Sync again' }));
  await waitFor(() => expect(triggerSync).toHaveBeenCalledWith('b1'));
  unmount();
  render(<AttentionDrawer businessId="b1" canEdit={false} compact={false} pageLoadFailures={{}} onNav={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Needs attention/ }));
  const vrow = (await screen.findByText('13 messages left')).closest('li');
  expect(within(vrow).queryByRole('button', { name: 'Sync again' })).toBeNull();
});

// FIX visit-window-v1 W6 / W2 - the visitors line shows the last ok window and a gap warning; owners/admins get Backfill 14 days.
test('visitors window: "Window Oct 13–Oct 27 · 138 companies", a gap warning, Backfill 14 days (admin only) posts backfill_days 14 and reports the result', async () => {
  const window = { window_start: '2026-10-13', window_end: '2026-10-20', lookback_days: 1, kind: 'daily', companies: 138, last_ok_at: '2026-10-20T16:00:00Z', gap: true };
  expect(windowText(window)).toMatch(/^Window Oct 13–Oct 20 · 138 companies · last ok /);
  expect(windowText({ window_end: null })).toBe('No completed pull yet');
  goalsApi.attention.mockResolvedValue({ ...DATA, sources: SOURCES.map(s => (s.id === 'visitors' ? { ...s, status: 'stale', window } : s)) });
  goalsApi.visitPull.mockResolvedValue({ ran: true, window: { kind: 'backfill', window_start: '2026-10-08', window_end: '2026-10-22', lookback_days: 14 }, counts: { companies: 141, signals: 3 } });
  const { unmount } = render(<AttentionDrawer businessId="b1" canEdit isAdmin compact={false} pageLoadFailures={{}} onNav={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Needs attention/ }));
  const row = screen.getByRole('dialog').querySelector('[data-source="visitors"]');
  expect(row.querySelector('[data-visit-window]')).toHaveTextContent(/Window Oct 13–Oct 20 · 138 companies/);
  expect(row.querySelector('[data-visit-gap]')).toHaveTextContent('Gap: nothing pulled since Oct 20');
  fireEvent.click(within(row).getByRole('button', { name: 'Backfill 14 days' }));
  await waitFor(() => expect(goalsApi.visitPull).toHaveBeenCalledWith('b1', { backfillDays: 14 }));
  expect(await screen.findByRole('status')).toHaveTextContent('Backfilled Oct 8–Oct 22: 141 companies · 3 new signals');
  unmount();
  render(<AttentionDrawer businessId="b1" canEdit isAdmin={false} compact={false} pageLoadFailures={{}} onNav={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Needs attention/ }));
  const mrow = screen.getByRole('dialog').querySelector('[data-source="visitors"]');
  expect(mrow.querySelector('[data-visit-window]')).toHaveTextContent('138 companies');
  expect(within(mrow).queryByRole('button', { name: 'Backfill 14 days' })).toBeNull();
  expect(within(mrow).getByRole('button', { name: 'Pull now' })).toBeInTheDocument();
});

// visitor-to-record-v1 V2a - the visitor PEOPLE pull line under the window + "Pull visitor people now" (Members).
test('visitor people: the line reads the last pull, Pull visitor people now posts force and reports counts; Viewers see the line without the button', async () => {
  expect(peoplePullText(null)).toBeNull();
  expect(peoplePullText({ last_on: null, error: null })).toBe('Visitor people: not pulled yet');
  expect(peoplePullText({ last_on: null, error: 'Apollo has no contacts list named "x"' })).toBe('Visitor people: Apollo has no contacts list named "x"');
  const pp = { last_on: '2026-10-21', counts: { contacts: 66, people_added: 12, created: 3 }, list: 'Prospector · Website visitors (export)', error: null };
  expect(peoplePullText(pp)).toBe('Visitor people pulled Oct 21 · 66 contacts · 12 new · 3 companies created');
  goalsApi.attention.mockResolvedValue({ ...DATA, sources: SOURCES.map(s => (s.id === 'visitors' ? { ...s, people_pull: pp } : s)) });
  goalsApi.visitPeoplePull.mockResolvedValue({ ran: true, counts: { contacts: 66, people_added: 12, already_in: 54, matched: 40, created: 3 } });
  const { unmount } = render(<AttentionDrawer businessId="b1" canEdit compact={false} pageLoadFailures={{}} onNav={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Needs attention/ }));
  const row = screen.getByRole('dialog').querySelector('[data-source="visitors"]');
  expect(row.querySelector('[data-people-pull]')).toHaveTextContent('Visitor people pulled Oct 21 · 66 contacts · 12 new · 3 companies created');
  expect(within(row).getByRole('button', { name: 'Pull now' })).toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'Pull visitor people now' }));
  await waitFor(() => expect(goalsApi.visitPeoplePull).toHaveBeenCalledWith('b1', { force: true }));
  expect(await screen.findByRole('status')).toHaveTextContent('Visitor people: 66 contacts on the list · 12 new · 54 already on file · 40 companies matched · 3 created');
  unmount();
  render(<AttentionDrawer businessId="b1" canEdit={false} compact={false} pageLoadFailures={{}} onNav={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Needs attention/ }));
  const vrow = screen.getByRole('dialog').querySelector('[data-source="visitors"]');
  expect(vrow.querySelector('[data-people-pull]')).toHaveTextContent('66 contacts');
  expect(within(vrow).queryByRole('button', { name: 'Pull visitor people now' })).toBeNull();
});
