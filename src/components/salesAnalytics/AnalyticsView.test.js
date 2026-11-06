import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AnalyticsView, { EMAIL_TILES } from './AnalyticsView';
import { goalsApi } from './goals/goalsApi';
import { fetchInsights, fetchEntities, fetchMetrics, fetchSequenceSteps, fetchRuns, triggerSync } from './salesApi';

jest.mock('./salesApi', () => ({ fetchInsights: jest.fn(), fetchEntities: jest.fn(), fetchMetrics: jest.fn(), fetchSequenceSteps: jest.fn(), fetchRuns: jest.fn(), triggerSync: jest.fn(), dismissInsight: jest.fn(), setSequenceAudience: jest.fn() }));
jest.mock('./goals/goalsApi', () => ({ goalsApi: { pulse: jest.fn() } }));
jest.mock('./goals/ExplorerView', () => ({ __esModule: true, default: ({ context, defaults }) => <section aria-label="Explorer" data-explorer={context} data-defaults={JSON.stringify(defaults)} /> }));
jest.mock('../../utils/useMediaQuery', () => () => false);

// dashboard-v3 Stage 4 - the Email page: tools in the frame row (Period · Sync now for a Member · Export), the title line
// (this week vs the same weekdays), seven email tiles with the route's digits and directions (bounce down = good), the
// Explorer with the email defaults, WHY + Mailboxes side by side, Sequences; a Period change re-reads the pulse.
const m = (value, prev, series, extra = {}) => ({ value, prev, delta: value - prev, delta_pct: null, series, kind: 'count', better: 'up', source: 'src', ...extra });
const PULSE = {
  scope: 'email', period: 'this_week', label: 'This week', from: '2026-11-02', to: '2026-11-05', prev: { from: '2026-10-26', to: '2026-10-29' }, synced_at: new Date(Date.now() - 3 * 3600e3).toISOString(), apollo_calls: 21,
  metrics: {
    sent: m(229, 229, [0, 0, 0, 292, 229], { delivered: 226, mailboxes: 2 }),
    delivered_rate: m(0.987, 0.983, [null, null, null, 0.983, 0.987], { kind: 'rate', delivered: 226, sent: 229 }),
    hard_bounce_rate: m(0.004, 0.017, [null, null, null, 0.017, 0.004], { kind: 'rate', better: 'down', hard_bounced: 1, sent: 229 }),
    spam_blocks: m(2, 0, [0, 0, 0, 0, 2], { better: 'down', rate: 0.009, top_mailbox: 'Cyrus' }),
    human_open_rate: m(0.027, 0.066, [null, null, null, 0.066, 0.027], { kind: 'rate', opens_tracked: 12, opens_human: 12 }),
    reply_rate: m(0, 0, [null, null, null, 0, 0], { kind: 'rate', replied: 0, delivered: 229 }),
    meetings: m(2, 1, [3, 0, 3, 1, 2], { upcoming: 1, next_at: '2026-11-09T20:30:00Z', source: 'Outlook · external domain' }),
  },
  mailboxes: [{ key: 'mailbox:jack', label: 'Jack', sent: 77, delivered: 76, delivered_rate: 0.987, spam_rate: 0, hard_bounce_rate: 0.013, spam_blocked: 0, per_weekday: 19.25, cap: 50, weekdays: 4, status: 'healthy', why: null }],
};
beforeEach(() => {
  goalsApi.pulse.mockResolvedValue(PULSE);
  fetchInsights.mockResolvedValue({ insights: [{ id: 'R5', scope_key: 'week:2026-10-26', severity: 'bad', title: 'Sends may have stalled', evidence: 'e', cause: 'c', action: 'a', affected: [] }], not_enough_data: [], dismissed: [], computed_at: 'now' });
  fetchEntities.mockResolvedValue({ sequences: [{ id: 's1', name: 'HomeLover 5-Step · Fitness', active: true, cohort: 'Fitness', archived: false, num_steps: 5, is_performing_poorly: false, audience: 'employer', sender_email: 'jack@x' }], mailboxes: [] });
  fetchMetrics.mockResolvedValue([{ metric_key: 'unique_delivered', dim_type: 'sequence', dim_value: 's1', value: 316, metric_date: '2026-11-05' }]);
  fetchSequenceSteps.mockResolvedValue({ sequences: { s1: { own: true, sender_label: 'Jack', mailboxes: ['Jack'], messages: 400, delivered: 316, steps: [] } }, totals: { messages: 400, delivered: 316 } });
  fetchRuns.mockResolvedValue([]);
  triggerSync.mockResolvedValue({ status: 'success' });
  if (!document.getElementById('sales-frame-tools')) { const slot = document.createElement('div'); slot.id = 'sales-frame-tools'; document.body.appendChild(slot); }
});
afterEach(() => jest.clearAllMocks());

test('Member: tools, title line, seven tiles = the route\'s digits with bounce down = good, Explorer email defaults, WHY + Mailboxes + Sequences; Period re-reads; Sync now runs the existing sync', async () => {
  render(<AnalyticsView businessId="b1" canEdit />);
  await screen.findByText('229');
  expect(goalsApi.pulse).toHaveBeenCalledWith('b1', { period: 'this_week', scope: 'email' });
  const slot = document.getElementById('sales-frame-tools');
  expect(within(slot).getByRole('group', { name: 'Period' })).toBeInTheDocument();
  expect(within(slot).getByRole('button', { name: 'Sync now' })).toBeInTheDocument();
  expect(within(slot).getByRole('button', { name: 'Export' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Email');
  expect(document.querySelector('[data-email-title]')).toHaveTextContent('Nov 2 – Nov 5 vs Oct 26 – Oct 29 · Apollo sequences, opens, replies · synced 3 h ago · 21 Apollo calls');
  const tile = k => document.querySelector(`[data-pulse-tile="${k}"]`);
  expect(EMAIL_TILES.map(t => tile(t.key).querySelector('[data-value]').textContent)).toEqual(['229', '98.7%', '0.4%', '2', '2.7%', '0.0%', '2']);
  expect(tile('hard_bounce_rate').querySelector('[data-delta]')).toHaveAttribute('data-delta', 'good'); // fell, and down is good
  expect(tile('spam_blocks').querySelector('[data-delta]')).toHaveAttribute('data-delta', 'bad'); // rose
  expect(tile('sent')).toHaveTextContent('226 delivered · 2 mailboxes');
  expect(tile('spam_blocks')).toHaveTextContent('0.9% of sent · Cyrus');
  expect(tile('human_open_rate')).toHaveTextContent('12 tracked · bots hidden');
  expect(tile('reply_rate')).toHaveTextContent('0 of 229');
  const explorer = screen.getByRole('region', { name: 'Explorer' });
  expect(explorer).toHaveAttribute('data-explorer', 'email');
  expect(JSON.parse(explorer.dataset.defaults)).toEqual({ layers: ['sent', 'delivered_rate', 'hard_bounce_rate', 'spam_rate', 'human_open_rate', 'reply_rate'], show: 'lines', by: 'week', split: 'mailbox', height: 'tall' });
  await screen.findByText('Sends may have stalled');
  expect(screen.getByRole('region', { name: 'Mailboxes' })).toHaveTextContent('Jack');
  await screen.findByRole('region', { name: 'Sequences' });
  fireEvent.click(within(slot).getByRole('button', { name: 'Month' }));
  await waitFor(() => expect(goalsApi.pulse).toHaveBeenLastCalledWith('b1', { period: 'month', scope: 'email' }));
  fireEvent.click(within(slot).getByRole('button', { name: 'Sync now' }));
  await waitFor(() => expect(triggerSync).toHaveBeenCalledWith('b1'));
  await screen.findByText('Sync complete.');
  expect(document.body.textContent).not.toMatch(/@/);
});

test('a Viewer gets Period and Export but no Sync now', async () => {
  render(<AnalyticsView businessId="b1" canEdit={false} />);
  await screen.findByText('229');
  const slot = document.getElementById('sales-frame-tools');
  expect(within(slot).queryByRole('button', { name: 'Sync now' })).toBeNull();
  expect(within(slot).getByRole('button', { name: 'Export' })).toBeInTheDocument();
});
