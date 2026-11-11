import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HomeView, { topInsights, TILES } from './HomeView';
import { tileValue, deltaOf } from './PulseTiles';
import { goalsApi } from './goalsApi';
import { fetchInsights } from '../salesApi';
import { FUNNEL } from './funnelFixture';

jest.mock('./goalsApi', () => ({ goalsApi: { pulse: jest.fn(), funnel: jest.fn() } }));
jest.mock('../salesApi', () => ({ fetchInsights: jest.fn() }));
// The Explorer has its own suite (ExplorerView.test.js); here it is a stand-in that reports what Home hands it.
jest.mock('./ExplorerView', () => ({ __esModule: true, default: ({ canEdit, context }) => <section aria-label="Explorer" data-explorer={context} data-can-edit={String(!!canEdit)} /> }));
// The small cards have their own suite (HomeCards.test.js); here a stand-in reports what Home hands them.
jest.mock('./HomeCards', () => ({ __esModule: true, default: ({ owner }) => <section aria-label="Small cards" data-home-cards-owner={owner || 'team'} /> }));

// dashboard-v3 Stage 2 - Home over an invented pulse: every tile = the route's digit, deltas by direction, the top three
// insights by severity with one action each, "Nothing to flag", the Explorer mounted with Home's context, the small cards
// (Stage 5) handed the person filter, a Viewer sees no write control.
const m = (value, prev, series, extra = {}) => ({ value, prev, delta: value == null || prev == null ? null : value - prev, delta_pct: extra.kind === 'rate' || prev == null || prev === 0 || value == null ? null : (value - prev) / prev, series, kind: 'count', better: 'up', source: 'src', ...extra });
const PULSE = {
  period: 'this_week', label: 'This week', today: '2026-11-05', owner: null, from: '2026-11-02', to: '2026-11-05', prev: { from: '2026-10-26', to: '2026-11-01' },
  synced_at: new Date(Date.now() - 3 * 3600e3).toISOString(), apollo_calls: 21, credits: { used: 0, cap: 500, month: '2026-11' },
  metrics: {
    sent: m(229, 292, [479, 499, 494, 292, 229], { source: 'Apollo · by send date' }),
    delivered_rate: m(0.987, 0.974, [0.98, 0.96, 0.97, 0.974, 0.987], { kind: 'rate', delivered: 226, sent: 229, source: 'delivered ÷ sent' }),
    human_open_rate: m(0.027, 0.066, [0.07, 0.046, 0.021, 0.066, 0.027], { kind: 'rate', apollo_open_rate: 0.026, human_share: 1, source: 'tracked, bots hidden' }),
    reply_rate: m(0, 0, [0, 0.002, 0, 0, 0], { kind: 'rate', replied: 0, delivered: 229, ever: 5, source: 'replies ÷ delivered' }),
    meetings: m(2, 1, [3, 0, 3, 1, 2], { upcoming: 18, next_at: '2026-11-09T20:30:00Z', source: 'Outlook events with an external domain', scope: 'team' }),
    visitors: m(64, 22, [null, null, 88, 22, 64], { pulled_days: 4, source: 'companies seen · pulls look back 7 d', scope: 'team' }),
    first_touched: m(8, 8, [17, 7, 3, 8, 8], { goal: 100, unit: 'people', carried: false, weeks_in: 3, source: 'people first-touched · month goal' }),
  },
};
const INS = {
  insights: [
    { id: 'R1', scope_key: 's1', severity: 'bad', title: 'Fitness: likely bad or outdated contact data', evidence: 'Hard bounce 8.6% (38 / 441 sent)', cause: 'Likely bad or outdated contact data in this list.', action: 'x', affected: [{ type: 'sequence', id: 's1', label: 'Fitness Employers' }] },
    { id: 'R5', scope_key: 'week:2026-10-26', severity: 'bad', title: 'Sends may have stalled', evidence: '292 sent vs 494', cause: 'A mailbox at its cap.', action: 'x', affected: [] },
    { id: 'R4', scope_key: '', severity: 'warn', title: 'No replies in the last 14 days', evidence: '0 replies on 711 sent', cause: 'Copy.', action: 'x', affected: [{ type: 'sequence', id: 's9', label: 'Best: Fitness' }] },
    { id: 'R9', scope_key: '', severity: 'warn', title: 'Open rate is inflated by automated opens', evidence: 'e', cause: 'c', action: 'x', affected: [] },
    { id: 'R10', scope_key: 'reply', severity: 'info', title: 'Replies are back in the green', evidence: 'e', cause: 'c', action: 'x', affected: [] },
  ],
  dismissed: [], not_enough_data: ['R2 x'], computed_at: '2026-11-05T17:00:00Z',
};
beforeEach(() => {
  goalsApi.pulse.mockResolvedValue(PULSE);
  goalsApi.funnel.mockResolvedValue({ ready: false });
  fetchInsights.mockResolvedValue(INS);
});
afterEach(() => jest.clearAllMocks());

test('tileValue / deltaOf: the route\'s digits, direction from the delta\'s sign (up = better for every tile), rates in points, the goal and calendar lines', () => {
  expect(tileValue('sent', PULSE.metrics.sent)).toEqual({ main: '229', unit: '' });
  expect(tileValue('delivered_rate', PULSE.metrics.delivered_rate)).toEqual({ main: '98.7', unit: '%' });
  expect(tileValue('first_touched', PULSE.metrics.first_touched)).toEqual({ main: '8', unit: '/100' });
  expect(tileValue('visitors', { ...PULSE.metrics.visitors, value: null })).toEqual({ main: '—', unit: '' });
  expect(deltaOf('sent', PULSE.metrics.sent, 'this_week')).toEqual({ dir: 'bad', text: '−63 (−22%) vs last wk' });
  expect(deltaOf('delivered_rate', PULSE.metrics.delivered_rate, 'this_week')).toEqual({ dir: 'good', text: '+1.3 pts vs last wk' });
  expect(deltaOf('human_open_rate', PULSE.metrics.human_open_rate, 'month')).toEqual({ dir: 'bad', text: '−3.9 pts vs last month' });
  expect(deltaOf('reply_rate', PULSE.metrics.reply_rate, 'this_week')).toEqual({ dir: 'flat', text: '0.0 pts vs last wk' });
  expect(deltaOf('visitors', PULSE.metrics.visitors, '4_weeks')).toEqual({ dir: 'good', text: '+42 (+191%) vs prior 4 wks' });
  expect(deltaOf('visitors', m(null, null, [null, null, null, null, null]), 'this_week')).toEqual({ dir: 'none', text: 'no pull in this window' });
  expect(deltaOf('meetings', PULSE.metrics.meetings, 'this_week')).toEqual({ dir: 'flat', text: '18 on the calendar · next Nov 9' });
  expect(deltaOf('first_touched', PULSE.metrics.first_touched, 'this_week')).toEqual({ dir: 'flat', text: '8% of goal · 3 wks in' });
  expect(deltaOf('first_touched', { ...PULSE.metrics.first_touched, goal: null }, 'this_week')).toEqual({ dir: 'flat', text: '0 vs last wk' });
  expect(deltaOf('sent', { ...PULSE.metrics.sent, better: 'down' }, 'this_week').dir).toBe('good');
});

test('top three by the route\'s order (severity)', () => {
  expect(topInsights(INS.insights).map(i => i.id)).toEqual(['R1', 'R5', 'R4']);
});

test('Home: the title line, seven tiles = the route\'s digits with their direction, the insights card (3 of 5, "All 5 in Email"), the Explorer mounted for Home', async () => {
  const onOpenEmail = jest.fn();
  render(<HomeView businessId="b1" period="this_week" owner={null} canEdit onOpenEmail={onOpenEmail} />);
  await screen.findByText('229');
  expect(goalsApi.pulse).toHaveBeenCalledWith('b1', { period: 'this_week', owner: null });
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This week');
  expect(document.querySelector('[data-home-meta]')).toHaveTextContent('Nov 2 – Nov 5 · synced 3 h ago · 21 Apollo calls · 0 of 500 credits');
  expect(document.querySelectorAll('[data-pulse-tile]')).toHaveLength(7);
  const tile = k => document.querySelector(`[data-pulse-tile="${k}"]`);
  const value = k => tile(k).querySelector('[data-value]').textContent;
  expect(TILES.map(t => value(t.key))).toEqual(['229', '98.7%', '2.7%', '0.0%', '2', '64', '8/100']);
  expect(tile('sent').querySelector('[data-delta]')).toHaveAttribute('data-delta', 'bad');
  expect(tile('delivered_rate').querySelector('[data-delta]')).toHaveAttribute('data-delta', 'good');
  expect(tile('reply_rate').querySelector('[data-delta]')).toHaveAttribute('data-delta', 'flat');
  expect(tile('human_open_rate')).toHaveTextContent('tracked, bots hidden · Apollo says 2.6%');
  expect(tile('reply_rate')).toHaveTextContent('0 of 229 · 5 ever');
  expect(tile('meetings')).toHaveTextContent('18 on the calendar · next Nov 9');
  expect(tile('visitors')).toHaveTextContent('team-wide');
  expect(tile('first_touched')).toHaveTextContent('8% of goal · 3 wks in');
  expect(tile('sent').querySelectorAll('svg path').length).toBeGreaterThan(0);
  const card = screen.getByRole('region', { name: /Insights/ });
  expect(card).toHaveTextContent('✦ generated · 10 rules · updated 3 h ago');
  expect(within(card).getAllByRole('img').map(e => e.getAttribute('aria-label'))).toEqual(['Problem', 'Problem', 'Watch']);
  expect(document.querySelectorAll('[data-insight]')).toHaveLength(3);
  expect(within(card).getByText('Fitness Employers')).toBeInTheDocument();
  expect(within(card).getByText('Cause: A mailbox at its cap. · Rule R5')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Pause sequence ↗' })).toHaveAttribute('href', 'https://app.apollo.io/#/sequences/s1');
  expect(within(card).getByRole('link', { name: 'Open mailboxes ↗' })).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: 'Open Email' }));
  fireEvent.click(within(card).getByRole('button', { name: 'All 5 in Email →' }));
  expect(onOpenEmail).toHaveBeenCalledTimes(2);
  const explorer = screen.getByRole('region', { name: 'Explorer' });
  expect(explorer).toHaveAttribute('data-explorer', 'home');
  expect(explorer).toHaveAttribute('data-can-edit', 'true');
  expect(screen.getByRole('region', { name: 'Small cards' })).toHaveAttribute('data-home-cards-owner', 'team');
  expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
});

test('a period change re-reads the pulse with that period and the person; "Nothing to flag" when no rule fired; no write controls (a Viewer sees the same)', async () => {
  fetchInsights.mockResolvedValue({ insights: [], dismissed: [], not_enough_data: ['R1 x', 'R2 y'], computed_at: '2026-11-05T17:00:00Z' });
  const { rerender } = render(<HomeView businessId="b1" period="this_week" owner={null} canEdit={false} onOpenEmail={jest.fn()} />);
  await screen.findByText('229');
  expect(await screen.findByText('Nothing to flag')).toBeInTheDocument();
  expect(screen.getByText('10 rules ran on the synced data · 2 waiting for more data')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /in Email/ })).toBeNull();
  goalsApi.pulse.mockResolvedValue({ ...PULSE, period: 'month', label: 'This month', from: '2026-11-01' });
  rerender(<HomeView businessId="b1" period="month" owner="u-jack" canEdit={false} onOpenEmail={jest.fn()} />);
  await waitFor(() => expect(goalsApi.pulse).toHaveBeenLastCalledWith('b1', { period: 'month', owner: 'u-jack' }));
  await screen.findByText('Nov 1 – Nov 5', { exact: false });
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This month');
  // Every control on Home reads: the only buttons are the two Email links (none here) - nothing posts.
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByRole('region', { name: 'Explorer' })).toHaveAttribute('data-can-edit', 'false');
  expect(screen.getByRole('region', { name: 'Small cards' })).toHaveAttribute('data-home-cards-owner', 'u-jack');
});

// email-funnel-v1 F6: ONE more tile, from the funnel route - the 30-day company rate with its fraction; absent until
// the route says ready; the seven pulse tiles are untouched.
test('F6 tile = route: "Email → site (30 d)" shows the 30-day company rate and "n of d companies" from GET goals/funnel; absent while not ready', async () => {
  goalsApi.funnel.mockResolvedValue(FUNNEL);
  const { unmount } = render(<HomeView businessId="b1" period="this_week" owner={null} canEdit lookup={{}} />);
  const tile = await waitFor(() => { const t = document.querySelector('[data-pulse-tile="email_site"]'); expect(t).not.toBeNull(); return t; });
  expect(goalsApi.funnel).toHaveBeenCalledWith('b1', { windows: '30d', days: 30 });
  const r = FUNNEL.windows['30d'].company_rate;
  expect(tile.textContent).toContain('Email → site (30 d)');
  expect(tile.querySelector('[data-value]').textContent).toBe(`${(r.rate * 100).toFixed(1)}%`);
  expect(tile.querySelector('[data-delta]').textContent).toBe(`${r.n} of ${r.d} companies`);
  expect(document.querySelectorAll('[data-pulse-tile]')).toHaveLength(8);
  unmount();
  goalsApi.funnel.mockResolvedValue({ ...FUNNEL, ready: false });
  render(<HomeView businessId="b1" period="this_week" owner={null} canEdit lookup={{}} />);
  await waitFor(() => expect(document.querySelectorAll('[data-pulse-tile]')).toHaveLength(7));
  expect(document.querySelector('[data-pulse-tile="email_site"]')).toBeNull();
});
