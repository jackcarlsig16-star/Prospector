import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ScorecardView, { cellOf, prevGoalsLine, hasGoals, ROWS } from './ScorecardView';
import { changeOf, paceText, chartData, valueText, sparkLabel } from './scorecardWeekly';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { scorecard: jest.fn(), saveTarget: jest.fn(), weeklyByMember: jest.fn(), saveManual: jest.fn(), explorer: jest.fn(), explorerViews: jest.fn() } }));
jest.mock('../exportCsv', () => ({ exportWidgetCsv: jest.fn() }));
const mq = { phone: false };
jest.mock('../../../utils/useMediaQuery', () => () => mq.phone);
jest.mock('../periods', () => ({ laWeekStart: () => '2026-11-02' }));

// weekly-funnel-v1 Stage 2 - the Scorecard over an invented GET goals/weekly (Thursday Nov 5: day 4 of 7) and an invented
// November: every cell is a route's digit, This week reads as pace (counts projected, rates and levels never), the
// Change glyph follows the metric's direction beside a signed amount, the owner types a goal in place (a week that
// ended answers with the route's own words), a Member types the LinkedIn cells, each row carries its 12-week line and
// opens the chart; the Month column, the no-goals banner and Copy last month stay; the phone gets one tile per metric.
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const WEEKS = Array.from({ length: 12 }, (_, i) => addDays('2026-11-02', -7 * (11 - i)));
const wm = (key, name, group, unit, kind, values, { goals = {}, same = null, pace = null, source = 'Apollo', hint = null, ...extra } = {}) => {
  const series = WEEKS.map((w, i) => ({ week_start: w, value: values[i] ?? null, goal: goals[w] ?? null, ...(i === 11 ? { current: true } : {}) }));
  const cur = series[11], prev = series[10];
  return {
    key, name, group, source, unit, kind, direction: 'up', goalable: true, goal_key: key, hint, series,
    this_week: { week_start: WEEKS[11], to_date: cur.value, same_point_last_week: same, delta: cur.value == null || same == null ? null : cur.value - same, pace, goal: cur.goal, progress: cur.value != null && cur.goal ? cur.value / cur.goal : null },
    last_week: { week_start: WEEKS[10], value: prev.value, goal: prev.goal, hit: prev.value == null || prev.goal == null ? null : prev.value >= prev.goal },
    next_week: { week_start: '2026-11-09', goal: null },
    ...extra,
  };
};
const none = Array(10).fill(null);
const WEEKLY = {
  today: '2026-11-05', week_start: '2026-11-02', weeks: WEEKS, elapsed: { days: 4, share: 4 / 7 }, same_point: { from: '2026-10-26', to: '2026-10-29' }, groups: ['Outbound', 'Site', 'Pipeline', 'LinkedIn'],
  wording: { week: 'A week runs Monday to Sunday, Pacific time.', pace: 'Pace = this week to date ÷ the share of the week gone, for counts only.', goals: 'g', manual: 'LinkedIn numbers are typed by a member.' },
  metrics: [
    wm('delivered', 'Delivered', 'Outbound', 'count', 'flow', [310, 0, 455, 480, 479, 499, 494, 292, 300, 410, 420, 229], { goals: { '2026-10-26': 400, '2026-11-02': 450 }, same: 240, pace: 401, hint: 'emails delivered, by send date' }),
    wm('human_open_rate', 'Human open rate', 'Outbound', 'rate', 'flow', [...none, 0.132, 0.143], { goals: { '2026-11-02': 0.18 }, same: 0.121, hint: 'tracked opens ÷ delivered, bots hidden' }),
    wm('replies', 'Replies', 'Outbound', 'count', 'flow', [...none, 3, 1], { same: 1, pace: 2 }),
    wm('total_in_sequence', 'In sequence', 'Outbound', 'count', 'stock', [...none, 2724, 837], { same: 2600, context: true, hint: 'people in active sequences' }),
    wm('companies_visited', 'Companies visited', 'Site', 'count', 'flow', [...none, 11, 7], { same: 9, pace: 12, source: 'Website' }),
    wm('people_first_touched', 'People first-touched', 'Pipeline', 'count', 'flow', [...none, 8, 1], { goals: { '2026-11-02': 100 }, same: null, pace: 2, source: 'App', goal_key: 'partners_first_touched' }),
    wm('linkedin_requests', 'Connection requests', 'LinkedIn', 'count', 'manual', [...none, 40, null], { source: 'Typed', entered: { this_week: null, last_week: { by: 'Cyrus', at: '2026-11-03T17:00:00Z', note: null } } }),
    wm('linkedin_replies', 'Replies', 'LinkedIn', 'count', 'manual', [...none, null, null], { source: 'Typed', entered: { this_week: null, last_week: null } }),
  ],
};
WEEKLY.metrics[5].series[11].carried = true;
WEEKLY.metrics[5].next_week = { week_start: '2026-11-09', goal: 100, carried: true };
WEEKLY.metrics[1].next_week = { week_start: '2026-11-09', goal: 0.18 };
const byKey = k => WEEKLY.metrics.find(x => x.key === k);

const metric = (value, extra = {}) => ({ value, goal: null, ...extra });
const week = (week_start, over = {}) => ({ week_start, metrics: {
  total_in_sequence: metric(null), sequences_running: metric(null), human_open_rate: metric(null), meetings_set: metric(null, { next_at: null }),
  partners_first_touched: metric(null, { unit: 'people', carried_goal: 100 }), people_first_touched: metric(null), tier1_touched_pct: metric(null), partner_meetings: metric(null), partners_pilot_live: metric(null),
  ...over,
} });
const NOV = {
  month: '2026-11-01', owner_user_id: null, calendar: { members: ['Jack'], partial: true, none: false }, synced_at: new Date(Date.now() - 3 * 3600e3).toISOString(),
  weeks: [week('2026-11-02', { total_in_sequence: metric(2721) }), week('2026-11-09'), week('2026-11-16'), week('2026-11-23'), week('2026-11-30')],
  month_total: { total_in_sequence: metric(2721), sequences_running: metric(15), human_open_rate: metric(0.027), meetings_set: metric(0, { next_at: '2026-11-09T20:30:00Z' }), partners_first_touched: metric(null), people_first_touched: metric(8), tier1_touched_pct: metric(0.458), partner_meetings: metric(0), partners_pilot_live: metric(4) },
};
const OCT = {
  month: '2026-10-01', weeks: [week('2026-10-05', { total_in_sequence: metric(2109, { goal: 3500 }), sequences_running: metric(12, { goal: 12 }) }), week('2026-10-12'), week('2026-10-19'), week('2026-10-26')],
  month_total: { total_in_sequence: metric(2109, { goal: 3500 }), sequences_running: metric(12, { goal: 12 }), human_open_rate: metric(0.066, { goal: 0.135 }), meetings_set: metric(2, { goal: 2 }), partners_first_touched: metric(null, { goal: 100 }), people_first_touched: metric(31), tier1_touched_pct: metric(0.4), partner_meetings: metric(3), partners_pilot_live: metric(4) },
};
beforeEach(() => {
  mq.phone = false;
  goalsApi.scorecard.mockImplementation((b, month) => Promise.resolve(month === '2026-11-01' ? NOV : month === '2026-10-01' ? OCT : { ...NOV, month, weeks: [], month_total: {} }));
  goalsApi.weeklyByMember.mockResolvedValue(WEEKLY);
  goalsApi.saveTarget.mockResolvedValue({});
  goalsApi.saveManual.mockResolvedValue({});
});
afterEach(() => jest.clearAllMocks());
const slot = () => { const d = document.createElement('div'); d.id = 'slot'; document.body.appendChild(d); return d; };
const cell = k => document.querySelector(`[data-cell="${k}"]`);
const digit = k => cell(k).querySelector('[data-value]')?.textContent;

test('the model: month cells from the month route; the Change glyph by direction with a signed amount; pace words for counts only; the chart data carries the goals', () => {
  expect(cellOf(ROWS[0], NOV.weeks[0].metrics)).toMatchObject({ value: 2721, goal: null, p: null, status: null });
  expect(cellOf(ROWS[4], { people_first_touched: { value: 8 }, partners_first_touched: { goal: null, carried_goal: 100 } })).toMatchObject({ value: 8, goal: 100, carried: true, p: 0.08, status: 'bad' });
  expect(cellOf(ROWS[1], { sequences_running: { value: 11, goal: 12 } })).toMatchObject({ status: 'ok' });
  expect(cellOf(ROWS[1], { sequences_running: { value: 7, goal: 12 } })).toMatchObject({ status: 'warn' });
  expect(hasGoals(NOV)).toBe(false); expect(hasGoals(OCT)).toBe(true);
  expect(prevGoalsLine(OCT)).toBe('in sequence 3,500 · sequences running 12 · human open rate 13.5% · meetings set 2 · people first-touched 100');
  expect(changeOf(byKey('delivered'))).toEqual({ dir: 'bad', glyph: '▼', text: '−11', word: 'worse' });
  expect(changeOf(byKey('human_open_rate'))).toEqual({ dir: 'good', glyph: '▲', text: '+2.2 pts', word: 'better' });
  expect(changeOf(byKey('replies'))).toMatchObject({ dir: 'flat', glyph: '—', text: 'no change' });
  expect(changeOf(byKey('people_first_touched'))).toMatchObject({ dir: 'none' });
  expect(changeOf({ ...byKey('delivered'), direction: 'down' })).toMatchObject({ dir: 'good', glyph: '▲', text: '−11' });
  expect(paceText(byKey('delivered'))).toBe('on pace for ~401');
  expect(paceText(byKey('human_open_rate'))).toBeNull();
  expect(valueText(byKey('human_open_rate'), 0.143)).toBe('14.3%');
  expect(sparkLabel(byKey('linkedin_replies'))).toMatch(/^LinkedIn replies, last 12 weeks: Aug 17 —/);
  const d = chartData(byKey('delivered'));
  expect(d.labels).toHaveLength(12); expect(d.labels[11]).toEqual({ key: '2026-11-02', label: 'Nov 2', current: true });
  expect(d.series.map(s => [s.label, s.kind, s.line, !!s.goal])).toEqual([['Delivered', 'count', true, false], ['Goal', 'count', true, true]]);
  expect(d.series[0].values).toEqual(byKey('delivered').series.map(s => s.value));
  expect(d.series[0].end_note).toBe('to date · on pace for ~401');
  expect(d.series[1].values.filter(v => v != null)).toEqual([400, 450]);
  expect(chartData(byKey('replies')).series).toHaveLength(1);
  expect(chartData(byKey('human_open_rate')).series[0]).toMatchObject({ kind: 'rate', line: false, end_note: 'to date' });
});

test('1440: the rows are the route\'s, in its four groups, to the digit - Last week · This week as pace · Change · Goal + progress · the Month column; the open-rate hint names its formula', async () => {
  const s = slot();
  render(<ScorecardView businessId="b1" isOwner canEdit toolsSlot={s} />);
  await screen.findByRole('table');
  expect(goalsApi.weeklyByMember).toHaveBeenCalledTimes(1); expect(goalsApi.weeklyByMember).toHaveBeenCalledWith('b1');
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Scorecard');
  expect(screen.getByText(/November · week 1 of 5/)).toBeInTheDocument();
  expect([...document.querySelectorAll('[data-group], [data-row]')].map(r => r.getAttribute('data-group') || r.getAttribute('data-row'))).toEqual(
    ['Outbound', 'delivered', 'human_open_rate', 'replies', 'total_in_sequence', 'Site', 'companies_visited', 'Pipeline', 'people_first_touched', 'LinkedIn', 'linkedin_requests', 'linkedin_replies']);
  expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Metric', 'Last weekOct 26 – Nov 1', 'This week · paceNov 2 – Nov 5 · day 4 of 7', 'Changevs same point last wk', 'Goalthis week · progress · next', '12 weekssince Aug 17', 'Novemberto date / goal']);
  for (const m of WEEKLY.metrics.filter(x => x.kind !== 'manual')) {
    expect(digit(`${m.key}|last`)).toBe(valueText(m, m.last_week.value));
    expect(digit(`${m.key}|this`)).toBe(valueText(m, m.this_week.to_date));
  }
  expect(digit('delivered|last')).toBe('420'); expect(digit('delivered|this')).toBe('229'); expect(digit('human_open_rate|this')).toBe('14.3%'); expect(digit('total_in_sequence|last')).toBe('2,724');
  // pace: a count is projected and labelled; a rate and a level never are
  expect(cell('delivered|this').querySelector('[data-pace]')).toHaveAttribute('data-pace', 'pace');
  expect(cell('delivered|this')).toHaveTextContent('229paceon pace for ~401');
  expect(cell('human_open_rate|this').querySelector('[data-pace]')).toHaveTextContent(/^to date$/);
  expect(cell('total_in_sequence|this').querySelector('[data-pace]')).toHaveTextContent(/^as of today$/);
  expect(cell('human_open_rate|this').textContent).not.toMatch(/on pace/);
  // change: against the same point last week, the glyph beside the signed amount and a word for a screen reader
  expect(cell('delivered|change')).toHaveTextContent('▼ −11vs 240');
  expect(cell('delivered|change').querySelector('[data-change]')).toHaveAttribute('data-change', 'bad');
  expect(within(cell('delivered|change')).getByRole('img', { name: 'worse, −11' })).toBeInTheDocument();
  expect(within(cell('human_open_rate|change')).getByRole('img', { name: 'better, +2.2 pts' })).toHaveTextContent('▲ +2.2 pts');
  expect(cell('human_open_rate|change')).toHaveTextContent('vs 12.1%');
  expect(within(cell('replies|change')).getByRole('img', { name: 'no change' })).toHaveAttribute('data-change', 'flat');
  expect(cell('people_first_touched|change')).toHaveTextContent(/^—$/);
  // last week against its goal; this week's goal + progress
  expect(cell('delivered|last')).toHaveTextContent('420/ 400'); expect(within(cell('delivered|last')).getByRole('img', { name: 'goal met' })).toBeInTheDocument();
  expect(cell('delivered|goal')).toHaveTextContent('450'); expect(cell('delivered|goal')).toHaveTextContent('51%');
  expect(cell('human_open_rate|goal')).toHaveTextContent('18.0%'); expect(cell('human_open_rate|goal')).toHaveTextContent('! 79%');
  expect(within(cell('people_first_touched|goal')).getByRole('button', { name: 'People first-touched goal, Nov 2' })).toHaveTextContent('100 · carried');
  expect(within(cell('replies|goal')).getByRole('button', { name: 'Replies goal, Nov 2' })).toHaveTextContent('set goal');
  expect(within(cell('linkedin_replies|goal')).getByRole('button', { name: 'LinkedIn replies goal, Nov 2' })).toBeInTheDocument();
  // the hint is the route's and names the formula; the month column is the month route's
  expect(document.querySelector('[data-row="human_open_rate"] [data-hint]')).toHaveTextContent('tracked opens ÷ delivered, bots hidden');
  expect(digit('total_in_sequence|month')).toBe('2,721'); expect(digit('human_open_rate|month')).toBe('2.7%'); expect(digit('people_first_touched|month')).toBe('8');
  expect(cell('delivered|month')).toHaveTextContent(/^—$/);
  expect(document.querySelector('[data-pace-rule]')).toHaveTextContent('Pace = this week to date ÷ the share of the week gone, for counts only. A week runs Monday to Sunday, Pacific time. Synced 3 h ago.');
  expect(within(s).getByRole('button', { name: 'Print' })).toBeInTheDocument();
  expect(within(s).getByRole('button', { name: 'Set November goals' })).toBeInTheDocument();
  expect(within(s).getByRole('group', { name: 'Month' })).toBeInTheDocument();
  expect(document.getElementById('sales-analytics-print-area')).toBeInTheDocument();
});

test('the no-goals banner and Copy October\'s goals stay: one PUT per October goal, then both routes reload', async () => {
  render(<ScorecardView businessId="b1" isOwner canEdit toolsSlot={null} />);
  await screen.findByRole('table');
  const banner = await waitFor(() => { const el = document.querySelector('[data-goals-banner]'); if (!el?.textContent.includes("October's were")) throw new Error('no banner'); return el; });
  expect(banner).toHaveTextContent('! no November goals');
  expect(banner).toHaveTextContent("October's were: in sequence 3,500 · sequences running 12");
  fireEvent.click(screen.getByRole('button', { name: "Copy October's goals" }));
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenCalledTimes(7));
  expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'month', period_start: '2026-11-01', metric_key: 'total_in_sequence', goal: 3500 });
  expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'week', period_start: '2026-11-02', metric_key: 'total_in_sequence', goal: 3500 });
  expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'month', period_start: '2026-11-01', metric_key: 'partners_first_touched', goal: 100 });
  await waitFor(() => expect(goalsApi.scorecard).toHaveBeenCalledTimes(4));
  expect(goalsApi.weeklyByMember).toHaveBeenCalledTimes(2);
});

test('a goal typed in place: this week\'s goal through PUT goals/targets with the row\'s goal key (a rate as a share, first-touched as the partners row in people); a week that has ended shows the route\'s words', async () => {
  render(<ScorecardView businessId="b1" isOwner canEdit toolsSlot={null} />);
  await screen.findByRole('table');
  const type = (name, text) => {
    fireEvent.click(screen.getByRole('button', { name }));
    const input = screen.getByRole('textbox', { name });
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };
  type('Human open rate goal, Nov 2', '18.5');
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'week', period_start: '2026-11-02', metric_key: 'human_open_rate', goal: 0.185 }));
  await waitFor(() => expect(goalsApi.weeklyByMember).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Human open rate goal, Nov 2' })).toBeNull());
  type('People first-touched goal, Nov 2', '60');
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'week', period_start: '2026-11-02', metric_key: 'partners_first_touched', goal: 60, unit: 'people' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'People first-touched goal, Nov 2' })).toBeNull());
  expect(screen.queryByRole('alert')).toBeNull();
  // the page sat open past Sunday: the route refuses (409 week_ended) and its message is what the page says
  goalsApi.saveTarget.mockRejectedValueOnce(Object.assign(new Error('That week has ended - a goal is set before or during its week'), { status: 409 }));
  type('Delivered goal, Nov 2', '500');
  expect(await screen.findByRole('alert')).toHaveTextContent('That week has ended - a goal is set before or during its week');
  expect(screen.getByRole('textbox', { name: 'Delivered goal, Nov 2' })).toHaveValue('500');
  // a month goal still saves from the Month column
  type('In sequence goal, November', '3000');
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'month', period_start: '2026-11-01', metric_key: 'total_in_sequence', goal: 3000 }));
});

test('LinkedIn: a Member (not the owner) types this week\'s and last week\'s cells through PUT goals/weekly/manual - Enter or leaving the field saves, an unchanged number does not; empty is "—"; "entered by Cyrus Nov 3"; no goal buttons', async () => {
  render(<ScorecardView businessId="b1" isOwner={false} canEdit toolsSlot={null} />);
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: /goal, Nov 2$/ })).toBeNull();
  expect(cell('linkedin_requests|last')).toHaveTextContent('40entered by Cyrus Nov 3');
  expect(cell('linkedin_requests|this').querySelector('[data-entered]')).toBeNull();
  const thisWeek = 'LinkedIn connection requests, this week (week of Nov 2)', lastWeek = 'LinkedIn connection requests, last week (week of Oct 26)';
  expect(screen.getByRole('button', { name: thisWeek })).toHaveTextContent(/^—$/);
  expect(screen.getByRole('button', { name: 'LinkedIn replies, last week (week of Oct 26)' })).toHaveTextContent(/^—$/);
  fireEvent.click(screen.getByRole('button', { name: thisWeek }));
  fireEvent.change(screen.getByRole('textbox', { name: thisWeek }), { target: { value: '12' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: thisWeek }), { key: 'Enter' });
  await waitFor(() => expect(goalsApi.saveManual).toHaveBeenCalledWith('b1', { metric_key: 'linkedin_requests', week_start: '2026-11-02', value: 12 }));
  await waitFor(() => expect(goalsApi.weeklyByMember).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: thisWeek })).toBeNull());
  // leaving the field saves a changed number...
  fireEvent.click(screen.getByRole('button', { name: lastWeek }));
  expect(screen.getByRole('textbox', { name: lastWeek })).toHaveValue('40');
  fireEvent.change(screen.getByRole('textbox', { name: lastWeek }), { target: { value: '45' } });
  fireEvent.blur(screen.getByRole('textbox', { name: lastWeek }));
  await waitFor(() => expect(goalsApi.saveManual).toHaveBeenCalledWith('b1', { metric_key: 'linkedin_requests', week_start: '2026-10-26', value: 45 }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: lastWeek })).toBeNull());
  // ...an untouched one writes nothing (no new "entered by"), and clearing it sends null
  fireEvent.click(screen.getByRole('button', { name: lastWeek }));
  fireEvent.blur(screen.getByRole('textbox', { name: lastWeek }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: lastWeek })).toBeNull());
  expect(goalsApi.saveManual).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: lastWeek }));
  fireEvent.change(screen.getByRole('textbox', { name: lastWeek }), { target: { value: '' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: lastWeek }), { key: 'Enter' });
  await waitFor(() => expect(goalsApi.saveManual).toHaveBeenLastCalledWith('b1', { metric_key: 'linkedin_requests', week_start: '2026-10-26', value: null }));
});

test('a Viewer: the digits, no goal buttons, no typed cells, no Set goals, no Copy; the footer says read-only', async () => {
  const s = slot();
  render(<ScorecardView businessId="b1" isOwner={false} canEdit={false} toolsSlot={s} />);
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: /goal, Nov 2$/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /LinkedIn/ })).toBeNull();
  expect(digit('linkedin_requests|last')).toBe('40'); expect(digit('linkedin_requests|this')).toBe('—');
  expect(cell('delivered|goal')).toHaveTextContent('450'); expect(cell('replies|goal')).toHaveTextContent(/^—$/);
  expect(within(s).queryByRole('button', { name: 'Set November goals' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Copy October/ })).toBeNull();
  expect(screen.getByText(/Read-only on this account/)).toBeInTheDocument();
  expect(within(s).getByRole('button', { name: 'Print' })).toBeInTheDocument();
});

test('the 12-week line: one mark per week that has a number (a gap is a gap), this week hollow, a dotted segment per week goal; a click opens the chart with the goal line, the hollow point and hover = week · value · goal', async () => {
  render(<ScorecardView businessId="b1" isOwner canEdit toolsSlot={null} />);
  await screen.findByRole('table');
  const line = k => cell(`${k}|spark`).querySelector('svg');
  expect(line('delivered')).toHaveAttribute('width', '120');
  expect(line('delivered')).toHaveAttribute('aria-label', expect.stringMatching(/^Delivered, last 12 weeks: Aug 17 310, Aug 24 0, .* Oct 26 420, Nov 2 229$/));
  expect(line('delivered').querySelectorAll('[data-point]')).toHaveLength(12);
  expect(line('delivered').querySelectorAll('[data-point="current"]')).toHaveLength(1);
  expect(line('delivered').querySelector('path').getAttribute('d').match(/[ML]/g)).toHaveLength(12);
  expect(line('delivered').querySelectorAll('[data-goal-seg]')).toHaveLength(2);
  expect(line('human_open_rate').querySelectorAll('[data-point]')).toHaveLength(2);
  expect(line('human_open_rate').querySelectorAll('[data-goal-seg]')).toHaveLength(1);
  expect(line('linkedin_requests').querySelectorAll('[data-point]')).toHaveLength(1);
  expect(line('linkedin_requests').querySelector('[data-point="current"]')).toBeNull();
  expect(line('linkedin_replies').querySelectorAll('[data-point], path, [data-goal-seg]')).toHaveLength(0);
  expect(document.querySelector('[data-weekly-chart]')).toBeNull();
  const name = within(document.querySelector('[data-row="delivered"]')).getByRole('button', { name: 'Delivered' });
  expect(name).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(name);
  expect(name).toHaveAttribute('aria-expanded', 'true');
  const chart = document.querySelector('[data-expanded="delivered"] [data-weekly-chart="delivered"]');
  expect(chart.querySelectorAll('[data-goal-line] line')).toHaveLength(2);
  expect(chart.querySelectorAll('[data-line="delivered"] circle')).toHaveLength(12);
  expect(chart.querySelectorAll('[data-point="current"]')).toHaveLength(1);
  expect(chart.querySelector('[data-end-label="delivered"]')).toHaveTextContent('229 · to date · on pace for ~401');
  expect(chart.querySelectorAll('[data-col]')).toHaveLength(0);
  const svg = chart.querySelector('[data-explorer-chart]');
  svg.getBoundingClientRect = () => ({ left: 0, width: 1340, top: 0, height: 220 });
  fireEvent.mouseMove(svg, { clientX: 44 + ((1340 - 92) / 12) * 11.5 });
  const card = await waitFor(() => { const el = document.querySelector('[data-hover-card]'); if (!el) throw new Error('no card'); return el; });
  expect(card).toHaveTextContent('Week of Nov 2 · this week'); expect(card).toHaveTextContent('Delivered229'); expect(card).toHaveTextContent('Goal450');
  fireEvent.mouseMove(svg, { clientX: 44 + ((1340 - 92) / 12) * 9.5 });
  await waitFor(() => expect(document.querySelector('[data-hover-card]')).toHaveTextContent('Week of Oct 19'));
  expect(document.querySelector('[data-hover-card]')).toHaveTextContent('Delivered410'); expect(document.querySelector('[data-hover-card]')).toHaveTextContent('Goal—');
  // the line itself opens another row and closes this one; a second click closes
  fireEvent.click(cell('human_open_rate|spark'));
  expect(document.querySelector('[data-expanded="delivered"]')).toBeNull();
  expect(document.querySelector('[data-weekly-chart="human_open_rate"] [data-end-label="human_open_rate"]')).toHaveTextContent('14.3% · to date');
  fireEvent.click(cell('human_open_rate|spark'));
  expect(document.querySelector('[data-weekly-chart]')).toBeNull();
});

test('390: no table - one tile per metric in the route\'s groups, each with its line; This wk = to date + the change + pace, Last wk = the whole week against its goal, Month = the rows that have one; a Member can type a LinkedIn tile', async () => {
  mq.phone = true;
  render(<ScorecardView businessId="b1" isOwner={false} canEdit toolsSlot={null} />);
  await screen.findByText('Delivered');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('November');
  expect(screen.getByText('week 1 of 5 · Nov 2')).toBeInTheDocument();
  const picks = within(screen.getByRole('group', { name: 'Week' }));
  expect(picks.getAllByRole('button').map(b => b.textContent)).toEqual(['Last wk', 'This wk', 'Month']);
  const tile = k => document.querySelector(`[data-tile="${k}"]`);
  expect([...document.querySelectorAll('[data-tile]')].map(t => t.getAttribute('data-tile'))).toEqual(WEEKLY.metrics.map(m => m.key));
  expect(document.querySelectorAll('[data-tile] svg[role="img"]')).toHaveLength(8);
  expect(tile('delivered').querySelector('[data-value]')).toHaveTextContent('229 / 450');
  expect(tile('delivered')).toHaveTextContent('▼ −11vs 240 same point last wk');
  expect(tile('delivered').querySelector('[data-pace]')).toHaveTextContent('paceon pace for ~401');
  expect(tile('delivered')).toHaveTextContent('51%');
  expect(tile('human_open_rate').querySelector('[data-pace]')).toHaveTextContent(/^to date$/);
  expect(tile('linkedin_requests').querySelector('svg [data-point]')).not.toBeNull();
  expect(within(tile('linkedin_requests')).getByRole('button', { name: 'LinkedIn connection requests, this week (week of Nov 2)' })).toHaveTextContent('—');
  expect(document.querySelector('[data-pace-rule]')).toHaveTextContent('Pace = this week to date');
  fireEvent.click(picks.getByRole('button', { name: 'Last wk' }));
  expect(tile('delivered').querySelector('[data-value]')).toHaveTextContent('420 / 400');
  expect(within(tile('delivered')).getByRole('img', { name: 'goal met' })).toBeInTheDocument();
  expect(tile('delivered').querySelector('[data-pace]')).toBeNull();
  expect(tile('linkedin_requests')).toHaveTextContent('40entered by Cyrus Nov 3');
  fireEvent.click(picks.getByRole('button', { name: 'Month' }));
  await waitFor(() => expect(tile('total_in_sequence').querySelector('[data-value]')).toHaveTextContent('2,721'));
  expect([...document.querySelectorAll('[data-tile]')].map(t => t.getAttribute('data-tile'))).toEqual(['human_open_rate', 'total_in_sequence', 'people_first_touched']);
  expect(tile('human_open_rate').querySelector('[data-value]')).toHaveTextContent('2.7%');
  expect(document.querySelector('[data-goals-banner]')).toHaveTextContent('No November goals yet — the owner sets them on desktop.');
  expect(screen.getByText(/Read-only on this account · synced 3 h ago/)).toBeInTheDocument();
});

test('next week\'s goal can be typed ahead: the Goal cell carries a "next wk" line the owner types into (PUT goals/targets with next Monday); a reader sees it only once a goal is set', async () => {
  const first = render(<ScorecardView businessId="b1" isOwner canEdit toolsSlot={null} />);
  await screen.findByRole('table');
  expect(document.querySelectorAll('[data-next-goal]')).toHaveLength(8);
  expect(cell('human_open_rate|goal').querySelector('[data-next-goal]')).toHaveTextContent('next wk 18.0%');
  expect(cell('people_first_touched|goal').querySelector('[data-next-goal]')).toHaveTextContent('next wk 100 · carried');
  expect(cell('delivered|goal').querySelector('[data-next-goal]')).toHaveTextContent('next wk set goal');
  fireEvent.click(screen.getByRole('button', { name: 'Delivered goal, Nov 9' }));
  const input = screen.getByRole('textbox', { name: 'Delivered goal, Nov 9' });
  fireEvent.change(input, { target: { value: '500' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'week', period_start: '2026-11-09', metric_key: 'delivered', goal: 500 }));
  await waitFor(() => expect(goalsApi.weeklyByMember).toHaveBeenCalledTimes(2));
  first.unmount();
  render(<ScorecardView businessId="b1" isOwner={false} canEdit={false} toolsSlot={null} />);
  await screen.findByRole('table');
  expect([...document.querySelectorAll('[data-next-goal]')].map(e => e.textContent)).toEqual(['next wk 18.0%', 'next wk 100 · carried']);
  expect(screen.queryByRole('button', { name: /goal, Nov 9$/ })).toBeNull();
});

// email-by-member-v1 M4 - the same read with member rows (goals/weekly?member=all).
const memberOf = (id, name, delivered, open) => ({ id, name, metrics: [
  wm('delivered', 'Delivered', 'Outbound', 'count', 'flow', [...none, delivered[0], delivered[1]], { same: delivered[2], pace: delivered[3] }),
  wm('human_open_rate', 'Human open rate', 'Outbound', 'rate', 'flow', [...none, open[0], open[1]], { same: open[2] }),
] });
const WITH_MEMBERS = { ...WEEKLY, members: [{ id: 'u1', name: 'Jack' }, { id: 'u2', name: 'Cyrus' }], unassigned_mailboxes: 1, rows: [
  memberOf('u1', 'Jack', [300, 180, 190, 315], [0.14, 0.15, 0.13]),
  memberOf('u2', 'Cyrus', [110, 44, 50, 77], [0.11, 0.12, 0.1]),
  memberOf('unassigned', 'Unassigned mailbox', [10, 5, 0, 9], [null, 0.2, null]),
  { id: 'team', name: 'Team', metrics: WEEKLY.metrics.filter(m => ['delivered', 'human_open_rate'].includes(m.key)) },
] };

test('email-by-member-v1 M4: an Outbound row opens its member rows above the chart - the same cells to the digit, pace on a count and never on a rate, the goal column read-only; a row without member rows opens its chart alone', async () => {
  goalsApi.weeklyByMember.mockResolvedValue(WITH_MEMBERS);
  goalsApi.explorer.mockResolvedValue({}); goalsApi.explorerViews.mockResolvedValue([]);
  render(<ScorecardView businessId="b1" isOwner canEdit toolsSlot={slot()} />);
  await screen.findByRole('table');
  expect(document.querySelectorAll('[data-member-of]')).toHaveLength(0);
  const toggle = document.querySelector('[data-row="delivered"] [data-expand]');
  expect(toggle).toHaveAttribute('title', 'Show the member rows and the 12-week chart');
  fireEvent.click(toggle);
  const rows = [...document.querySelectorAll('[data-member-of="delivered"]')];
  expect(rows.map(r => r.getAttribute('data-member-row'))).toEqual(['u1', 'u2', 'unassigned']);
  expect(rows.map(r => [...r.querySelectorAll('[data-value]')].map(v => v.textContent))).toEqual([['300', '180'], ['110', '44'], ['10', '5']]);
  expect(rows[0]).toHaveTextContent('on pace for ~315');
  expect(rows[0]).toHaveTextContent('▼ −10');
  expect(rows[0].querySelector('[data-member-goal]')).toHaveTextContent('team goal');
  expect(rows.flatMap(r => [...r.querySelectorAll('button, input')])).toHaveLength(0);
  expect(within(rows[1]).getByRole('img', { name: /^Cyrus: Delivered, last 12 weeks/ })).toBeInTheDocument();
  expect(rows[0].nextElementSibling).toBe(rows[1]);
  expect(rows[2].nextElementSibling).toHaveAttribute('data-expanded', 'delivered');
  fireEvent.click(document.querySelector('[data-row="human_open_rate"] [data-expand]'));
  const rates = [...document.querySelectorAll('[data-member-of="human_open_rate"]')];
  expect(rates.map(r => r.querySelectorAll('[data-value]')[1].textContent)).toEqual(['15.0%', '12.0%', '20.0%']);
  expect(rates.flatMap(r => [...r.querySelectorAll('[data-pace="pace"]')])).toHaveLength(0);
  expect(document.querySelectorAll('[data-member-of="delivered"]')).toHaveLength(0);
  const site = document.querySelector('[data-row="companies_visited"] [data-expand]');
  expect(site).toHaveAttribute('title', 'Show the 12-week chart');
  fireEvent.click(site);
  expect(document.querySelectorAll('[data-member-of]')).toHaveLength(0);
  expect(document.querySelector('[data-expanded="companies_visited"]')).toBeInTheDocument();
  expect(document.querySelector('[data-scorecard-table]').textContent).not.toMatch(/@/);
});

test('email-by-member-v1 M4 at 390: an Outbound tile carries one line of member numbers for the week picked; Month has none', async () => {
  mq.phone = true;
  goalsApi.weeklyByMember.mockResolvedValue(WITH_MEMBERS);
  render(<ScorecardView businessId="b1" isOwner={false} toolsSlot={slot()} />);
  await waitFor(() => expect(document.querySelectorAll('[data-tile]').length).toBeGreaterThan(0));
  const line = k => document.querySelector(`[data-tile="${k}"] [data-member-line]`);
  expect(line('delivered')).toHaveTextContent('Jack 180 · Cyrus 44 · Unassigned mailbox 5');
  expect(line('human_open_rate')).toHaveTextContent('Jack 15.0% · Cyrus 12.0% · Unassigned mailbox 20.0%');
  expect(line('companies_visited')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Last wk' }));
  expect(line('delivered')).toHaveTextContent('Jack 300 · Cyrus 110 · Unassigned mailbox 10');
  fireEvent.click(screen.getByRole('button', { name: 'Month' }));
  expect(document.querySelectorAll('[data-member-line]')).toHaveLength(0);
});
