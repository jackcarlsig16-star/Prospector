import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SignalsList from './SignalsList';
import { goalsApi } from '../goals/goalsApi';

jest.mock('../goals/goalsApi', () => ({ goalsApi: { acceptSignal: jest.fn(), dismissSignal: jest.fn(), scoutImport: jest.fn() } }));

const sig = (id, company, extra) => ({ id, source: 'scout', company_name: company, kind: 'employer', kind_guessed: false, who: 'VP People · Avery Q.', signal: 'Hiring 40 drivers', why_now: 'New depot', first_line: 'Saw the depot news', score: 9, upside_joint: false, match: null, status: 'new', ...extra });
const signals = [
  sig('s1', 'Nimbus Freight'),
  sig('s2', 'Kestrel Pay', { kind: 'partner', match: { type: 'partner', id: 'g1', name: 'Kestrel Pay', archived: false, possible: false }, score: 8 }),
  sig('s3', 'Orchard Table', { kind: 'partner', kind_guessed: true, upside_joint: true, first_line: null, score: null }),
];
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
