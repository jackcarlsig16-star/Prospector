import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SuggestedList, { lastRunText } from './SuggestedList';
import { goalsApi } from '../goals/goalsApi';

jest.mock('../goals/goalsApi', () => ({ goalsApi: { runTidy: jest.fn(), acceptSuggestion: jest.fn(), dismissSuggestion: jest.fn() } }));

const row = (id, kind, text, extra) => ({ id, kind, ref_type: 'partner', ref_id: 'g1', ref_id2: null, text, reason: 'because', status: 'proposed', created_at: '2026-10-16T15:00:00Z', ...extra });
const data = {
  suggestions: [
    row('s1', 'research_or_drop', 'Research Fundrise or drop', { ref_type: 'target', ref_id: 't1', reason: 'Researching for 8 days with no research notes and no open to-do' }),
    row('s2', 'duplicate', 'Possible duplicate: Lockton / Lockton Inc', { ref_type: 'pair', ref_id: 'a', ref_id2: 'b' }),
    row('s3', 'follow_up', 'Follow up Gallagher'),
  ],
  last_run: { id: 'r1', started_at: '2026-10-16T15:04:00Z', status: 'ok', trigger: 'pageload', counts: { proposed: 3 } },
};
afterEach(() => jest.clearAllMocks());

test('lastRunText', () => {
  expect(lastRunText(null)).toBe('Tidy hasn’t run yet');
  expect(lastRunText(data.last_run)).toBe('Tidy ran Oct 16, 8:04 AM');
  expect(lastRunText({ ...data.last_run, status: 'error' })).toBe('Tidy ran Oct 16, 8:04 AM · failed');
});

test('a Viewer sees the rows, kind chips, reasons and the last run, but no Accept / Dismiss / Tidy now', () => {
  render(<SuggestedList businessId="b1" data={data} canEdit={false} onChanged={jest.fn()} />);
  expect(screen.getByText('Suggested · 3')).toBeInTheDocument();
  expect(screen.getByText('Research Fundrise or drop')).toBeInTheDocument();
  expect(screen.getByText('Researching for 8 days with no research notes and no open to-do')).toBeInTheDocument();
  expect(screen.getByText('Duplicate')).toBeInTheDocument();
  expect(screen.getByText('Tidy ran Oct 16, 8:04 AM')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('empty list says so', () => {
  render(<SuggestedList businessId="b1" data={{ suggestions: [], last_run: null }} canEdit onChanged={jest.fn()} />);
  expect(screen.getByText(/Nothing suggested/)).toBeInTheDocument();
  expect(screen.getByText('Tidy hasn’t run yet')).toBeInTheDocument();
});

test('Member: Accept creates the to-do through the route and says so; Dismiss parks it', async () => {
  goalsApi.acceptSuggestion.mockResolvedValue({ suggestion: { id: 's1', status: 'accepted' }, todo: { id: 'w1', text: 'Research Fundrise or drop' }, open: null });
  goalsApi.dismissSuggestion.mockResolvedValue({ suggestion: { id: 's3', status: 'dismissed' } });
  const onChanged = jest.fn();
  render(<SuggestedList businessId="b1" data={data} canEdit onChanged={onChanged} />);
  fireEvent.click(within(screen.getByText('Research Fundrise or drop').closest('li')).getByRole('button', { name: 'Accept → to-do' }));
  await waitFor(() => expect(goalsApi.acceptSuggestion).toHaveBeenCalledWith('b1', 's1'));
  await screen.findByText('To-do added: Research Fundrise or drop');
  expect(onChanged).toHaveBeenCalledTimes(1);
  fireEvent.click(within(screen.getByText('Follow up Gallagher').closest('li')).getByRole('button', { name: 'Dismiss · 7 d' }));
  await waitFor(() => expect(goalsApi.dismissSuggestion).toHaveBeenCalledWith('b1', 's3'));
  await screen.findByText('Dismissed for 7 days: Follow up Gallagher');
  expect(onChanged).toHaveBeenCalledTimes(2);
});

test('Accept on a duplicate pair opens both partners instead of adding a to-do', async () => {
  goalsApi.acceptSuggestion.mockResolvedValue({ suggestion: { id: 's2', status: 'accepted' }, todo: null, open: ['a', 'b'] });
  const onOpenPair = jest.fn();
  render(<SuggestedList businessId="b1" data={data} canEdit onChanged={jest.fn()} onOpenPair={onOpenPair} />);
  fireEvent.click(screen.getByRole('button', { name: 'Accept → open both' }));
  await waitFor(() => expect(onOpenPair).toHaveBeenCalledWith(['a', 'b'], 'Possible duplicate'));
  await screen.findByText('Opening both: Lockton / Lockton Inc');
});

test('Tidy now forces a run and reports what it added', async () => {
  goalsApi.runTidy.mockResolvedValue({ ran: true, created: 2, skipped: 5 });
  const onChanged = jest.fn();
  render(<SuggestedList businessId="b1" data={data} canEdit onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tidy now' }));
  await waitFor(() => expect(goalsApi.runTidy).toHaveBeenCalledWith('b1', { force: true }));
  await screen.findByText('Tidy: 2 new suggestions');
  expect(onChanged).toHaveBeenCalled();
});
