import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VisitPullBar from './VisitPullBar';
import { goalsApi } from '../goals/goalsApi';

jest.mock('../goals/goalsApi', () => ({ goalsApi: { visitStatus: jest.fn(), visitPull: jest.fn() } }));

const okRun = { last_run: { la_date: '2026-10-20', status: 'ok' }, paused: null, spent: 3, cap: 500, today: { P1: 2, P2: 1, P3: 4, P4: 5 } };
afterEach(() => jest.clearAllMocks());

test('at the monthly cap the line says the pull is paused and there is no Pull now', async () => {
  goalsApi.visitStatus.mockResolvedValue({ ...okRun, paused: 'Visitor pull paused: 500 Apollo credits used this month' });
  render(<VisitPullBar businessId="b1" canEdit onPulled={jest.fn()} />);
  expect(await screen.findByText('Visitor pull paused: 500 Apollo credits used this month')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pull now' })).not.toBeInTheDocument();
});

test('Member: today\'s counts, and Pull now forces a pull and reports it', async () => {
  goalsApi.visitStatus.mockResolvedValue(okRun);
  goalsApi.visitPull.mockResolvedValue({ ran: true, counts: { companies: 12, signals: 2 }, credits: 0 });
  const onPulled = jest.fn();
  render(<VisitPullBar businessId="b1" canEdit onPulled={onPulled} />);
  expect(await screen.findByText('Website visits pulled Oct 20 · P1 2 · P2 1 · P3 4 · P4 5')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pull now' }));
  await waitFor(() => expect(goalsApi.visitPull).toHaveBeenCalledWith('b1', { force: true }));
  expect(await screen.findByText('Pulled 12 companies · 2 new signals')).toBeInTheDocument();
  expect(onPulled).toHaveBeenCalled();
});

test('Viewer sees the line but no Pull now', async () => {
  goalsApi.visitStatus.mockResolvedValue({ ...okRun, last_run: { la_date: '2026-10-20', status: 'error' } });
  render(<VisitPullBar businessId="b1" canEdit={false} onPulled={jest.fn()} />);
  expect(await screen.findByText('Website visits: the Oct 20 pull failed')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
