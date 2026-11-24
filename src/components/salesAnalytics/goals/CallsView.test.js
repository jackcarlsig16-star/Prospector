import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CallsView, { statusText, attendeeText } from './CallsView';
import { goalsApi, OPEN_PIPELINE_RECORD } from './goalsApi';

// fathom-notes-v1 REV 2 F11 - Dashboard > Calls: the table, the count line, the chips, a Viewer's read, the phone
// cards and the drawer it opens. Made-up names.
jest.mock('./goalsApi', () => ({ goalsApi: { calls: jest.fn() }, OPEN_PIPELINE_RECORD: 'prospector:open-pipeline-record' }));
jest.mock('./today/NoteReview', () => ({ __esModule: true, default: ({ noteId, extractNow, onClose }) => <div data-testid="review" data-note={noteId} data-extract={String(extractNow)}><button type="button" onClick={onClose}>close review</button></div> }));
let mockNarrow = false;
jest.mock('../../../utils/useMediaQuery', () => ({ __esModule: true, default: () => mockNarrow }));

const call = (over = {}) => ({ id: 'n1', call_date: '2026-11-23', title: 'Northwind weekly', source: 'Fathom', member: { id: 'u-jack', name: 'Jack' }, attendees: { names: ['Dana Reyes', 'Jack', 'Sam Ito', 'Lee Park'], total: 4, external: 2 },
  record: { type: 'partner', id: 'p1', name: 'Northwind' }, duration_seconds: 1920, status: 'unreviewed', status_label: 'Unreviewed', reviewed_at: null, fathom_url: 'https://fathom.test/share/a', ...over });
const CALLS = [call(), call({ id: 'n2', call_date: '2026-11-18', title: 'Pasted notes', source: 'Pasted', member: { id: 'u-cy', name: 'Cyrus' }, attendees: { names: [], total: 0, external: 0 }, record: null, duration_seconds: null, status: 'reviewed', status_label: 'Reviewed', reviewed_at: '2026-11-18T20:00:00Z', fathom_url: null }),
  call({ id: 'n3', call_date: '2026-10-02', title: 'Old call', record: null, duration_seconds: null, status: 'no_proposal', status_label: 'No proposal' })];
const reply = (calls = CALLS, total = 3) => ({ calls, total, counts: { calls: calls.length, unreviewed: calls.filter(c => c.status !== 'reviewed').length, no_company: calls.filter(c => !c.record).length } });
const show = async (props = {}) => { const r = render(<CallsView businessId="b1" canEdit {...props} />); await waitFor(() => expect(goalsApi.calls).toHaveBeenCalled()); await screen.findByRole('heading', { name: 'Calls' }); return r; };
beforeEach(() => { jest.clearAllMocks(); mockNarrow = false; goalsApi.calls.mockResolvedValue(reply()); });

test('the words: a reviewed call carries its date; attendees are three names, the rest counted, and the external count', () => {
  expect(statusText(CALLS[1])).toBe('Reviewed Nov 18');
  expect(statusText(CALLS[0])).toBe('Unreviewed');
  expect(attendeeText(CALLS[0].attendees)).toBe('Dana Reyes, Jack, Sam Ito +1 · 2 external');
  expect(attendeeText(CALLS[1].attendees)).toBe('—');
});

test('one row per call, newest first, with the count line, the company, the duration, the status and the Fathom link', async () => {
  await show();
  expect(document.querySelector('[data-calls-count]')).toHaveTextContent('3 calls · 2 unreviewed · 2 without a company');
  const rows = [...document.querySelectorAll('tr[data-call]')];
  expect(rows.map(r => r.getAttribute('data-call'))).toEqual(['n1', 'n2', 'n3']);
  const first = within(rows[0]);
  expect(rows[0]).toHaveTextContent('Nov 23');
  expect(rows[0]).toHaveTextContent('Northwind weekly');
  expect(rows[0]).toHaveTextContent('32 min');
  expect(rows[0].querySelector('[data-status]')).toHaveAttribute('data-status', 'warn');
  expect(first.getByRole('link', { name: 'Open Northwind weekly in Fathom' })).toHaveAttribute('href', 'https://fathom.test/share/a');
  expect(first.getByRole('link', { name: 'Open Northwind weekly in Fathom' })).toHaveAttribute('target', '_blank');
  expect(rows[1]).toHaveTextContent('Reviewed Nov 18');
  expect(within(rows[1]).queryByRole('link')).toBeNull();
  expect(rows[2].querySelector('[data-status]')).toHaveAttribute('data-status', 'off');
  // only a Fathom note with no proposal offers Extract
  expect(within(rows[2]).getByRole('button', { name: 'Extract Old call' })).toBeInTheDocument();
  expect(first.queryByRole('button', { name: /^Extract/ })).toBeNull();
  const heard = jest.fn();
  window.addEventListener(OPEN_PIPELINE_RECORD, heard);
  fireEvent.click(first.getByRole('button', { name: 'Northwind' }));
  expect(heard.mock.calls[0][0].detail).toEqual({ key: 'partner-p1' });
  window.removeEventListener(OPEN_PIPELINE_RECORD, heard);
});

test('chips: Mine / Team, Unreviewed, This week, and With a company / No company exclude each other; search is sent', async () => {
  await show();
  expect(goalsApi.calls).toHaveBeenLastCalledWith('b1', { who: 'team', unreviewed: '', week: '', company: '', q: '' });
  expect(screen.getByRole('button', { name: 'Team' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
  await waitFor(() => expect(goalsApi.calls).toHaveBeenLastCalledWith('b1', expect.objectContaining({ who: 'mine' })));
  fireEvent.click(screen.getByRole('button', { name: 'Unreviewed' }));
  fireEvent.click(screen.getByRole('button', { name: 'This week' }));
  fireEvent.click(screen.getByRole('button', { name: 'With a company' }));
  await waitFor(() => expect(goalsApi.calls).toHaveBeenLastCalledWith('b1', { who: 'mine', unreviewed: '1', week: '1', company: 'with', q: '' }));
  fireEvent.click(screen.getByRole('button', { name: 'No company' }));
  await waitFor(() => expect(goalsApi.calls).toHaveBeenLastCalledWith('b1', expect.objectContaining({ company: 'none' })));
  expect(screen.getByRole('button', { name: 'With a company' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.change(screen.getByLabelText('Search calls by title or company'), { target: { value: ' north ' } });
  await waitFor(() => expect(goalsApi.calls).toHaveBeenLastCalledWith('b1', expect.objectContaining({ q: 'north' })));
});

test('Open and Extract open the review drawer on that note; closing it reloads the list', async () => {
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Open Northwind weekly' }));
  expect(screen.getByTestId('review')).toHaveAttribute('data-note', 'n1');
  expect(screen.getByTestId('review')).toHaveAttribute('data-extract', 'false');
  const before = goalsApi.calls.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'close review' }));
  expect(screen.queryByTestId('review')).toBeNull();
  await waitFor(() => expect(goalsApi.calls.mock.calls.length).toBe(before + 1));
  fireEvent.click(screen.getByRole('button', { name: 'Extract Old call' }));
  expect(screen.getByTestId('review')).toHaveAttribute('data-extract', 'true');
});

test('a Viewer reads the list and gets no Open and no Extract', async () => {
  await show({ canEdit: false });
  expect(document.querySelectorAll('tr[data-call]')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Extract/ })).toBeNull();
  expect(screen.getByRole('link', { name: 'Open Northwind weekly in Fathom' })).toBeInTheDocument();
});

test('empty and failed: no calls yet, no match under the filters, and the server’s words', async () => {
  goalsApi.calls.mockResolvedValue(reply([], 0));
  const { unmount } = await show();
  expect(await screen.findByText('No calls yet. A Fathom recording or pasted call notes land here.')).toBeInTheDocument();
  unmount();
  goalsApi.calls.mockResolvedValue(reply([], 3));
  const second = await show();
  expect(await screen.findByText('No call matches these filters.')).toBeInTheDocument();
  second.unmount();
  goalsApi.calls.mockRejectedValue(new Error('relation "sales_calls_v" does not exist'));
  await show();
  expect(await screen.findByText(/sales_calls_v/)).toBeInTheDocument();
});

test('390: cards, the same calls and actions, no table', async () => {
  mockNarrow = true;
  await show();
  await waitFor(() => expect(document.querySelectorAll('li[data-call]')).toHaveLength(3));
  expect(document.querySelector('table')).toBeNull();
  const card = document.querySelector('li[data-call="n1"]');
  expect(card).toHaveTextContent('Jack · Fathom · 32 min');
  expect(card).toHaveTextContent('Dana Reyes, Jack, Sam Ito +1 · 2 external');
  expect(within(card).getByRole('button', { name: 'Open Northwind weekly' })).toBeInTheDocument();
});
