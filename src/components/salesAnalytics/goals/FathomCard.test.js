import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import FathomCard, { statusLine, HELP } from './FathomCard';
import { fathomApi } from './fathomApi';

// fathom-notes-v1 Stage 2 - the Settings › Connections › Fathom card, one test per state: not connected, connected,
// an action that failed, disconnected, a Member next to an Owner's row, a Viewer. Made-up names; no key is real.
jest.mock('./fathomApi', () => ({ fathomApi: { status: jest.fn(), connect: jest.fn(), test: jest.fn(), register: jest.fn(), pull: jest.fn(), disconnect: jest.fn(), setCap: jest.fn() } }));

const ME = 'u-jack', CY = 'u-cy';
const member = (over = {}) => ({ user_id: ME, name: 'Jack', connected: true, status: 'connected', connected_at: '2026-11-20T17:00:00Z', last_event_at: '2026-11-20T18:12:00Z', webhook: true, webhook_id_tail: '3456', pull: { started: false, more: false, finished: false }, stored: 4, last_recording: '2026-11-19', ...over });
const state = (over = {}) => ({ connected: true, me: ME, owner: true, members: [member()], others: [{ user_id: CY, name: 'Cyrus' }], extracts: { cap: 10, used: 2, left: 8 }, stored: 4, ...over });
const show = async (data, props = {}) => { fathomApi.status.mockResolvedValue(data); const r = render(<FathomCard businessId="b1" canEdit {...props} />); await screen.findByRole('heading', { name: 'Fathom' }); return r; };
const KEY = 'k'.repeat(40);
beforeEach(() => jest.clearAllMocks());

test('the status line: connected with the recording and event dates, and the disconnected words', () => {
  expect(statusLine(member(), undefined)).toMatch(/^Connected · last recording Nov 19 · last event Nov 20, /);
  expect(statusLine(member({ last_event_at: null }), '2026-11-20')).toBe('Connected · last recording Nov 20');
  expect(statusLine(member({ last_recording: null, last_event_at: null }), undefined)).toBe('Connected · no recording stored yet');
  expect(statusLine(member({ last_event_at: null }), null)).toBe('Connected · no recording in Fathom yet');
  expect(statusLine(member({ connected: false }), undefined)).toBe('Disconnected · to reconnect, paste the key again');
});

test('not connected: paste the key and Connect - the key goes to the server once and is never drawn again', async () => {
  await show(state({ connected: false, members: [], stored: 0 }));
  expect(document.querySelector('[data-fathom-row="new"]')).toHaveTextContent('Not connected');
  const field = screen.getByLabelText('Your Fathom API key');
  expect(field).toHaveAttribute('type', 'password');
  expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  fathomApi.connect.mockResolvedValue({ connected: true });
  fathomApi.status.mockResolvedValue(state({ members: [member({ webhook: false, webhook_id_tail: null, stored: 0, last_recording: null, last_event_at: null })] }));
  fireEvent.change(field, { target: { value: ` ${KEY} ` } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByText('Connected - press Test to check the key');
  expect(fathomApi.connect).toHaveBeenCalledWith('b1', KEY);
  expect(document.body.innerHTML).not.toContain(KEY);
  expect(document.querySelector('[data-fathom-row="connected"] [data-fathom-status]')).toHaveTextContent('Connected · no recording stored yet');
  expect(screen.getByText(/webhook not registered - new recordings do not arrive until it is/)).toBeInTheDocument();
});

test('connected: one row per member; Test answers in the status line; Register is the live site’s; Pull says what it stored; Disconnect', async () => {
  await show(state({ members: [member({ webhook: false, webhook_id_tail: null }), member({ user_id: CY, name: 'Cyrus', stored: 1, last_recording: null, last_event_at: null })], others: [] }));
  const rows = [...document.querySelectorAll('[data-fathom-row]')];
  expect(rows.map(r => r.getAttribute('data-fathom-row'))).toEqual(['connected', 'connected']);
  expect(rows[0]).toHaveTextContent('Jack (you)'); expect(rows[0]).toHaveTextContent('4 recordings stored');
  expect(rows[1]).toHaveTextContent('Cyrus'); expect(rows[1]).toHaveTextContent('1 recording stored · webhook registered (id …3456)');
  const mine = within(rows[0]);
  // jsdom is http: the register button waits for the live site
  expect(mine.getByRole('button', { name: 'Register webhook' })).toBeDisabled();
  expect(mine.getByText('Register the webhook from the live site (https).')).toBeInTheDocument();
  fathomApi.test.mockResolvedValue({ ok: true, last_recording: '2026-11-20' });
  fireEvent.click(mine.getByRole('button', { name: 'Test' }));
  await waitFor(() => expect(rows[0].querySelector('[data-fathom-status]')).toHaveTextContent('Connected · last recording Nov 20 · last event'));
  expect(fathomApi.test).toHaveBeenCalledWith('b1', null);
  fathomApi.pull.mockResolvedValue({ stored: 10, already: 2, skipped: 0, pages: 5, page_size: 10, more: true, stopped: null });
  fireEvent.click(mine.getByRole('button', { name: 'Pull my last 30 days' }));
  await screen.findByText('10 recordings stored · 2 already here · more exist - Pull again continues');
  // the Owner acts on the other member's row with their id
  fathomApi.disconnect.mockResolvedValue({ connected: false, webhook_deleted: true });
  fireEvent.click(within(rows[1]).getByRole('button', { name: 'Disconnect' }));
  await screen.findByText('Disconnected - the webhook was removed from Fathom');
  expect(fathomApi.disconnect).toHaveBeenCalledWith('b1', CY);
});

test('error: a failed Test is said on the row, in words, and the row stays connected', async () => {
  await show(state());
  fathomApi.test.mockRejectedValue(new Error('Fathom refused the API key'));
  fireEvent.click(screen.getByRole('button', { name: 'Test' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Test failed: Fathom refused the API key');
  expect(document.querySelector('[data-fathom-row="error"] [data-fathom-status]')).toHaveTextContent(/^Connected/);
  expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
});

test('disconnected: the row says reconnect = paste again, and offers the key field', async () => {
  await show(state({ connected: false, members: [member({ connected: false, status: 'disconnected', webhook: false, webhook_id_tail: null })] }));
  const row = document.querySelector('[data-fathom-row="disconnected"]');
  expect(row).toHaveTextContent('Disconnected · to reconnect, paste the key again');
  expect(within(row).getByLabelText('Fathom API key for Jack')).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Test' })).toBeNull();
  expect(document.querySelector('[data-fathom-row="new"]')).toBeNull();
});

test('an Owner connects for another member; a Member only acts on their own row; a Viewer reads', async () => {
  const { unmount } = await show(state());
  fireEvent.change(screen.getByLabelText('Connect Fathom for another member'), { target: { value: CY } });
  fathomApi.connect.mockResolvedValue({ connected: true });
  fireEvent.change(screen.getByLabelText('Their Fathom API key'), { target: { value: KEY } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(fathomApi.connect).toHaveBeenCalledWith('b1', KEY, CY));
  expect(screen.getByLabelText('Daily cap')).toBeInTheDocument();
  unmount();
  // Cyrus, a Member, next to Jack's row
  const asMember = await show(state({ connected: false, me: CY, owner: false, others: [] }));
  expect(within(document.querySelector('[data-fathom-row="connected"]')).queryByRole('button')).toBeNull();
  expect(screen.getByLabelText('Your Fathom API key')).toBeInTheDocument();
  expect(screen.queryByLabelText('Connect Fathom for another member')).toBeNull();
  expect(screen.queryByLabelText('Daily cap')).toBeNull();
  asMember.unmount();
  await show(state({ me: 'u-viewer', owner: false, others: [] }), { canEdit: false });
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByLabelText('Your Fathom API key')).toBeNull();
  expect(document.querySelector('[data-fathom-status]')).toHaveTextContent(/^Connected/);
});

test('the help text: where the key is, that it travels with the database, who connects for others, reconnect = paste again; the cap line', async () => {
  await show(state());
  const help = document.querySelector('[data-fathom-help]');
  expect(help.querySelectorAll('li')).toHaveLength(HELP.length);
  expect(help).toHaveTextContent('encrypted with the app’s FATHOM_TOKEN_KEY');
  expect(help).toHaveTextContent('It travels with the database: if the database moves without that key, every connection has to be pasted again.');
  expect(help).toHaveTextContent('only an Owner connects it for another member');
  expect(help).toHaveTextContent('To reconnect, paste the key again.');
  expect(document.querySelector('[data-fathom-cap]')).toHaveTextContent('Calls read automatically today: 2 of 10');
  fathomApi.setCap.mockResolvedValue({});
  fireEvent.change(screen.getByLabelText('Daily cap'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set cap' }));
  await screen.findByText('Daily cap is now 6');
  expect(fathomApi.setCap).toHaveBeenCalledWith('b1', 6);
});

test('the card could not be read: the error, nothing else', async () => {
  fathomApi.status.mockRejectedValue(new Error('Request failed (500)'));
  render(<FathomCard businessId="b1" canEdit />);
  expect(await screen.findByText(/Request failed \(500\)/)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Fathom' })).toBeNull();
});
