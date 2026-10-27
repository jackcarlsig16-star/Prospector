import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SignalsList from './SignalsList';
import { goalsApi } from '../goals/goalsApi';

jest.mock('../goals/goalsApi', () => ({ goalsApi: { acceptSignal: jest.fn(), dismissSignal: jest.fn(), scoutImport: jest.fn(), visitStatus: jest.fn(), visitPull: jest.fn(), signals: jest.fn(), autoCreateSignal: jest.fn(), undoSignal: jest.fn() } }));

const sig = (id, company, extra) => ({ id, source: 'scout', company_name: company, kind: 'employer', kind_guessed: false, who: 'VP People · Avery Q.', signal: 'Hiring 40 drivers', why_now: 'New depot', first_line: 'Saw the depot news', score: 9, upside_joint: false, match: null, status: 'new', ...extra });
const signals = [
  sig('s1', 'Nimbus Freight'),
  sig('s2', 'Kestrel Pay', { kind: 'partner', match: { type: 'partner', id: 'g1', name: 'Kestrel Pay', archived: false, possible: false }, score: 8 }),
  sig('s3', 'Orchard Table', { kind: 'partner', kind_guessed: true, upside_joint: true, first_line: null, score: null }),
];
beforeEach(() => { goalsApi.visitStatus.mockResolvedValue(null); goalsApi.signals.mockResolvedValue([]); });
afterEach(() => jest.clearAllMocks());

test('a Viewer sees every field and the match hint, but no Accept / Dismiss / Upload', () => {
  render(<SignalsList businessId="b1" signals={signals} canEdit={false} onChanged={jest.fn()} />);
  expect(screen.getByText('Signals · 3 new')).toBeInTheDocument();
  expect(screen.getAllByText('VP People · Avery Q.')).toHaveLength(3);
  expect(screen.getByText('Already here: Kestrel Pay (partner)')).toBeInTheDocument();
  expect(screen.getByText('partner · kind guessed')).toBeInTheDocument();
  expect(screen.getByText('Upside joint')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Accept|Dismiss|Upload/ })).not.toBeInTheDocument();
});

test('Member: Accept says what it made; Dismiss parks it; both reload the list', async () => {
  goalsApi.acceptSignal.mockResolvedValue({ todo: { text: 'Reach out: Kestrel Pay — VP People · Avery Q.', due_date: '2026-10-23' }, via: 'partner', record: { type: 'partner', id: 'g1', name: 'Kestrel Pay' } });
  goalsApi.dismissSignal.mockResolvedValue({ signal: { id: 's3', status: 'dismissed' } });
  const onChanged = jest.fn();
  render(<SignalsList businessId="b1" signals={signals} canEdit onChanged={onChanged} />);
  fireEvent.click(within(screen.getByText('Kestrel Pay', { selector: 'span' }).closest('li')).getByRole('button', { name: 'Accept → to-do' }));
  await waitFor(() => expect(goalsApi.acceptSignal).toHaveBeenCalledWith('b1', 's2'));
  await screen.findByText('To-do added: Reach out: Kestrel Pay — VP People · Avery Q. · due Fri, Oct 23 · note on Kestrel Pay');
  fireEvent.click(within(screen.getByText('Orchard Table').closest('li')).getByRole('button', { name: 'Dismiss · 7 d' }));
  await waitFor(() => expect(goalsApi.dismissSignal).toHaveBeenCalledWith('b1', 's3'));
  await screen.findByText('Dismissed for 7 days: Orchard Table');
  expect(onChanged).toHaveBeenCalledTimes(2);
});

test('Open on a match hands the record up', () => {
  const onOpenRecord = jest.fn();
  render(<SignalsList businessId="b1" signals={signals} canEdit onChanged={jest.fn()} onOpenRecord={onOpenRecord} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(onOpenRecord).toHaveBeenCalledWith(signals[1].match);
});

test('empty list says so', () => {
  render(<SignalsList businessId="b1" signals={[]} canEdit onChanged={jest.fn()} />);
  expect(screen.getByText(/No signals to review/)).toBeInTheDocument();
});

// visitor-to-record-v1 Stage 3 - V1 on demand + V6: Create company on a new website-visit signal; the Auto-created strip with Undo.
test('Member: Create company on an unmatched website-visit signal; Auto-created strip lists auto signals with the chip, Open and Undo; a Viewer sees the chip only', async () => {
  const web = sig('s9', 'Nimbus Freight', { source: 'web_visit', match: null, who: null, first_line: null, score: null });
  const auto = { id: 'a1', source: 'web_visit', company_name: 'Ridgeline Health', status: 'accepted', auto: true, decided_at: '2026-10-27T17:00:00Z', match: { type: 'target', id: 't1', name: 'Ridgeline Health', via: 'new_target' } };
  goalsApi.signals.mockResolvedValue([auto, { id: 'a2', source: 'scout', company_name: 'Hand Accepted', status: 'accepted', auto: false }]);
  goalsApi.autoCreateSignal.mockResolvedValue({ record: { type: 'target', id: 't2', name: 'Nimbus Freight' }, people: 2, signal: { status: 'accepted' } });
  goalsApi.undoSignal.mockResolvedValue({ signal: { id: 'a1', status: 'new' }, archived: { target: 't1', people: 3 } });
  const onChanged = jest.fn(), onOpen = jest.fn();
  const { unmount } = render(<SignalsList businessId="b1" signals={[web, signals[1]]} canEdit onChanged={onChanged} onOpenRecord={onOpen} />);
  const strip = await screen.findByRole('region', { name: 'Auto-created' });
  expect(within(strip).getByText('Ridgeline Health')).toBeInTheDocument();
  expect(within(strip).getByText('Auto-created')).toBeInTheDocument();
  expect(within(strip).queryByText('Hand Accepted')).not.toBeInTheDocument();
  fireEvent.click(within(strip).getByRole('button', { name: 'Open' }));
  expect(onOpen).toHaveBeenCalledWith(auto.match);
  const nimbus = screen.getByText('Nimbus Freight', { selector: 'span' }).closest('li');
  fireEvent.click(within(nimbus).getByRole('button', { name: 'Create company' }));
  await waitFor(() => expect(goalsApi.autoCreateSignal).toHaveBeenCalledWith('b1', 's9'));
  await screen.findByText('Created Nimbus Freight as an employer target · 2 people found via Apollo');
  expect(within(screen.getByText('Kestrel Pay', { selector: 'span' }).closest('li')).queryByRole('button', { name: 'Create company' })).not.toBeInTheDocument();
  fireEvent.click(within(strip).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.undoSignal).toHaveBeenCalledWith('b1', 'a1'));
  await screen.findByText('Undone: Ridgeline Health archived with 3 people · signal back to review');
  expect(onChanged).toHaveBeenCalledTimes(2);
  unmount();
  render(<SignalsList businessId="b1" signals={[web]} canEdit={false} onChanged={jest.fn()} />);
  const vstrip = await screen.findByRole('region', { name: 'Auto-created' });
  expect(within(vstrip).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create company' })).not.toBeInTheDocument();
});
