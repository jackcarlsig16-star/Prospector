import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ScorecardView, { cellOf, prevGoalsLine, hasGoals, ROWS } from './ScorecardView';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { scorecard: jest.fn(), saveTarget: jest.fn() } }));
const mq = { phone: false };
jest.mock('../../../utils/useMediaQuery', () => () => mq.phone);
jest.mock('../periods', () => ({ laWeekStart: () => '2026-11-02' }));

// dashboard-v3 Stage 1 - the Scorecard sub-view over an invented November: every cell is the route's digit, the
// no-goals banner + Copy October's goals, owner-only goal edits, the phone tiles, the Viewer's read-only line.
const metric = (value, extra = {}) => ({ value, goal: null, ...extra });
const week = (week_start, over = {}) => ({ week_start, metrics: {
  total_in_sequence: metric(null), sequences_running: metric(null), human_open_rate: metric(null), meetings_set: metric(null, { next_at: null }),
  partners_first_touched: metric(null, { unit: 'people', carried_goal: 100 }), people_first_touched: metric(null), tier1_touched_pct: metric(null), partner_meetings: metric(null), partners_pilot_live: metric(null),
  ...over,
} });
const NOV = {
  month: '2026-11-01', owner_user_id: null, calendar: { members: ['Jack'], partial: true, none: false }, synced_at: new Date(Date.now() - 3 * 3600e3).toISOString(),
  weeks: [
    week('2026-11-02', { total_in_sequence: metric(2721), sequences_running: metric(15), human_open_rate: metric(0.027), meetings_set: metric(0, { next_at: '2026-11-09T20:30:00Z' }), people_first_touched: metric(8), tier1_touched_pct: metric(0.458), partner_meetings: metric(0), partners_pilot_live: metric(4) }),
    week('2026-11-09'), week('2026-11-16'), week('2026-11-23'), week('2026-11-30'),
  ],
  month_total: { total_in_sequence: metric(2721), sequences_running: metric(15), human_open_rate: metric(0.027), meetings_set: metric(0), partners_first_touched: metric(null), people_first_touched: metric(8), tier1_touched_pct: metric(0.458), partner_meetings: metric(0), partners_pilot_live: metric(4) },
};
const OCT = {
  month: '2026-10-01', weeks: [week('2026-10-05', { total_in_sequence: metric(2109, { goal: 3500 }), sequences_running: metric(12, { goal: 12 }) }), week('2026-10-12'), week('2026-10-19'), week('2026-10-26')],
  month_total: { total_in_sequence: metric(2109, { goal: 3500 }), sequences_running: metric(12, { goal: 12 }), human_open_rate: metric(0.066, { goal: 0.135 }), meetings_set: metric(2, { goal: 2 }), partners_first_touched: metric(null, { goal: 100 }), people_first_touched: metric(31), tier1_touched_pct: metric(0.4), partner_meetings: metric(3), partners_pilot_live: metric(4) },
};
beforeEach(() => {
  mq.phone = false;
  goalsApi.scorecard.mockImplementation((b, month) => Promise.resolve(month === '2026-11-01' ? NOV : month === '2026-10-01' ? OCT : { ...NOV, month, weeks: [], month_total: {} }));
  goalsApi.saveTarget.mockResolvedValue({});
});
afterEach(() => jest.clearAllMocks());
const slot = () => { const d = document.createElement('div'); d.id = 'slot'; document.body.appendChild(d); return d; };

test('cellOf: value / goal / status from the route digits; the first-touched goal is carried from the partners row; no goal = no bar', () => {
  expect(cellOf(ROWS[0], NOV.weeks[0].metrics)).toMatchObject({ value: 2721, goal: null, p: null, status: null });
  expect(cellOf(ROWS[4], NOV.weeks[0].metrics)).toMatchObject({ value: 8, goal: 100, carried: true, p: 0.08, status: 'bad' });
  expect(cellOf(ROWS[1], { sequences_running: { value: 11, goal: 12 } })).toMatchObject({ status: 'ok' });
  expect(cellOf(ROWS[1], { sequences_running: { value: 7, goal: 12 } })).toMatchObject({ status: 'warn' });
  expect(hasGoals(NOV)).toBe(false); expect(hasGoals(OCT)).toBe(true);
  expect(prevGoalsLine(OCT)).toBe('in sequence 3,500 · sequences running 12 · human open rate 13.5% · meetings set 2 · people first-touched 100');
});

test('1440: title · banner (October\'s goals + Copy) · table with the route\'s digits, this week tinted, future weeks "—", Outlook row says Jack\'s calendar; owner tools in the frame slot', async () => {
  const s = slot();
  render(<ScorecardView businessId="b1" isOwner toolsSlot={s} />);
  await screen.findByRole('table');
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Scorecard');
  expect(screen.getByText(/November · week 1 of 5/)).toBeInTheDocument();
  const banner = document.querySelector('[data-goals-banner]');
  expect(banner).toHaveTextContent('! no November goals');
  expect(banner).toHaveTextContent("October's were: in sequence 3,500 · sequences running 12");
  const cell = k => document.querySelector(`[data-cell="${k}"] [data-value]`)?.textContent;
  expect(cell('total_in_sequence|2026-11-02')).toBe('2,721');
  expect(cell('human_open_rate|2026-11-02')).toBe('2.7%');
  expect(cell('tier1_touched_pct|2026-11-02')).toBe('45.8%');
  expect(cell('people_first_touched|2026-11-02')).toBe('8/ 100');
  expect(within(document.querySelector('[data-cell="people_first_touched|2026-11-02"]')).getByText(/✕ 8%/)).toBeInTheDocument();
  expect(document.querySelector('[data-cell="total_in_sequence|2026-11-09"]')).toHaveTextContent('—');
  expect(cell('total_in_sequence|month')).toBe('2,721');
  expect(document.querySelector('[data-this-week]')).toHaveTextContent('Wk 1 · this week');
  expect(screen.getByText(/Outlook · Jack's calendar/)).toBeInTheDocument();
  expect(within(s).getByRole('button', { name: 'Print' })).toBeInTheDocument();
  expect(within(s).getByRole('button', { name: 'Set November goals' })).toBeInTheDocument();
  expect(within(s).getByRole('group', { name: 'Month' })).toBeInTheDocument();
  expect(document.getElementById('sales-analytics-print-area')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /goal, Nov 2$/ }).length).toBeGreaterThan(0);
  // Copy October's goals: one PUT per October goal (month goals + wk 1 goals), then the month reloads.
  fireEvent.click(screen.getByRole('button', { name: "Copy October's goals" }));
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenCalledTimes(7));
  expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'month', period_start: '2026-11-01', metric_key: 'total_in_sequence', goal: 3500 });
  expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'week', period_start: '2026-11-02', metric_key: 'total_in_sequence', goal: 3500 });
  expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'month', period_start: '2026-11-01', metric_key: 'partners_first_touched', goal: 100 });
  await waitFor(() => expect(goalsApi.scorecard).toHaveBeenCalledTimes(4));
});

test('a goal typed in place saves through PUT goals/targets with the row\'s key (people first-touched = the partners row, unit people)', async () => {
  render(<ScorecardView businessId="b1" isOwner toolsSlot={null} />);
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: 'Sequences running goal, Nov 2' }));
  const input = screen.getByRole('textbox', { name: 'Sequences running goal, Nov 2' });
  fireEvent.change(input, { target: { value: '12' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'week', period_start: '2026-11-02', metric_key: 'sequences_running', goal: 12 }));
});

test('a Viewer / member: digits, no goal buttons, no Set goals, no Copy; the footer says read-only', async () => {
  const s = slot();
  render(<ScorecardView businessId="b1" isOwner={false} toolsSlot={s} />);
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: /goal, Nov 2$/ })).toBeNull();
  expect(within(s).queryByRole('button', { name: 'Set November goals' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Copy October/ })).toBeNull();
  expect(screen.getByText(/Read-only on this account/)).toBeInTheDocument();
  expect(within(s).getByRole('button', { name: 'Print' })).toBeInTheDocument();
});

test('phone: month title, Wk / Month segmented, one tile per metric with the week\'s digit and "next Nov 9" on meetings, the banner for a non-owner, no table; Month shows the month column', async () => {
  mq.phone = true;
  render(<ScorecardView businessId="b1" isOwner={false} toolsSlot={null} />);
  await screen.findByText('In sequence');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('November');
  expect(screen.getByText('week 1 of 5 · Nov 2')).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Week' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Wk 1', 'Month']);
  expect(document.querySelectorAll('[data-tile]')).toHaveLength(8);
  expect(document.querySelector('[data-tile="total_in_sequence"] [data-value]')).toHaveTextContent('2,721');
  expect(document.querySelector('[data-tile="meetings_set"]')).toHaveTextContent('next Nov 9');
  expect(document.querySelector('[data-goals-banner]')).toHaveTextContent('No November goals yet — the owner sets them on desktop.');
  expect(screen.getByText(/Read-only on this account · synced 3 h ago/)).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('group', { name: 'Week' })).getByRole('button', { name: 'Month' }));
  expect(document.querySelector('[data-tile="people_first_touched"] [data-value]')).toHaveTextContent('8');
});
