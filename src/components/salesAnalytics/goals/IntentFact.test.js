import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IntentFact from './IntentFact';
import { goalsApi } from './goalsApi';

// intent-score-v1 S4 - the company window's Intent fact: score · band · source, the expandable breakdown, Recompute.
jest.mock('./goalsApi', () => ({ goalsApi: { scoreOf: jest.fn(), recomputeScores: jest.fn() } }));
const ROW = { type: 'target', id: 't1', name: 'Quarry Labs' };
const SCORE = { row: { score: 72, band: 'P1', source_label: 'website', closed: false, live: false, trend: 'up', band_changed: true, prev_band: 'P2', components: {} }, lines: ['+17 visits (6 in 7 d, 3 people)', '+15 fit (US 500+)', '-3 not researched'] };
afterEach(() => jest.clearAllMocks());

test('shows Intent 72 · P1 with the source and the since-yesterday marker; the breakdown lines expand; Recompute re-reads', async () => {
  goalsApi.scoreOf.mockResolvedValue(SCORE);
  goalsApi.recomputeScores.mockResolvedValue({ ran: true, row: { score: 80, band: 'P1' } });
  render(<IntentFact businessId="b1" row={ROW} canEdit />);
  expect(await screen.findByText('72 · P1')).toBeInTheDocument();
  expect(screen.getByText('Website')).toBeInTheDocument();
  expect(screen.getByText('▲ since P2')).toBeInTheDocument();
  expect(screen.getByText('+17 visits (6 in 7 d, 3 people)')).toBeInTheDocument();
  expect(screen.getByText('-3 not researched')).toHaveStyle({ color: 'var(--sa-bad)' });
  fireEvent.click(screen.getByRole('button', { name: 'Recompute' }));
  await waitFor(() => expect(goalsApi.recomputeScores).toHaveBeenCalledWith('b1', { type: 'target', id: 't1' }));
  await waitFor(() => expect(goalsApi.scoreOf).toHaveBeenCalledTimes(2));
});

test('no score yet (404) reads "No score yet"; a Viewer gets no Recompute', async () => {
  goalsApi.scoreOf.mockRejectedValue(new Error('No score yet - recompute'));
  render(<IntentFact businessId="b1" row={ROW} canEdit={false} />);
  expect(await screen.findByText('No score yet')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Recompute' })).not.toBeInTheDocument();
});
