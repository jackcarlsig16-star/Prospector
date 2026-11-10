import { render, screen, fireEvent, within } from '@testing-library/react';
import VisitorTrendChart, { chartData, summaryLine, axisLabel, PHONE_BARS } from './VisitorTrendChart';
import { Chart } from './ExplorerView';
import { geometry, heightPx, niceMax } from './explorerModel';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { visitorsTrend: jest.fn() } }));
let mockPhone = false;
jest.mock('../../../utils/useMediaQuery', () => () => mockPhone);

// visitor-trend-v1 Stage 2 (T2 + R6): the bars are the route's windows, NEW over RETURNING stacked to the window's
// companies, the 7-day line on the right axis, the legend's counts = the summary's, hover = the window's facts, a click
// hands the window up (the Companies list filters on it), 390 shows PHONE_BARS of the bars and swipes for the rest.
// Invented windows, keys only.
const win = (start, end, days, label, companies, fresh, visits) => ({ start, end, days, label, merged: 1, companies, new: fresh, returning: companies - fresh, visits_7d: visits, company_keys: Array.from({ length: companies }, (_, i) => `${start}-k${i}`), new_keys: [], record_keys: [] });
const WINDOWS = [
  win('2026-11-03', '2026-11-04', ['2026-11-03'], 'Tue Nov 3', 22, 15, 44),
  win('2026-11-04', '2026-11-05', ['2026-11-04'], 'Wed Nov 4', 64, 34, 120),
  win('2026-11-05', '2026-11-06', ['2026-11-05'], 'Thu Nov 5', 25, 9, 68),
  win('2026-11-06', '2026-11-09', ['2026-11-06', '2026-11-07', '2026-11-08'], 'Fri–Sun Nov 6–8', 64, 28, 147),
];
const TREND = { days: 30, today: '2026-11-10', since: '2026-11-03', windows: WINDOWS, summary: { windows: 4, companies: 160, company_windows: 175, new: 86, returning: 89, visits_7d: 379, busiest: { label: 'Wed Nov 4', start: '2026-11-04', companies: 64 } } };
const many = n => ({ ...TREND, windows: Array.from({ length: n }, (_, i) => win(`2026-10-${String(10 + i).padStart(2, '0')}`, `2026-10-${String(11 + i).padStart(2, '0')}`, [`2026-10-${String(10 + i).padStart(2, '0')}`], `Day ${i}`, 10 + i, 3, 20)) });
beforeEach(() => { mockPhone = false; goalsApi.visitorsTrend.mockResolvedValue(TREND); });
afterEach(() => jest.clearAllMocks());

test('model: the axis word, the summary line, the chart data (two stacked count series + the flagged line series)', () => {
  expect(WINDOWS.map(axisLabel)).toEqual(['Tue 3', 'Wed 4', 'Thu 5', 'Fri–Sun 6–8']);
  expect(summaryLine(TREND)).toBe('Last 30 days: 160 companies identified · 86 new · 89 returning · busiest: Wed Nov 4 (64)');
  expect(summaryLine({ ...TREND, windows: [], summary: { ...TREND.summary, windows: 0 } })).toBe('Last 30 days: no pull windows yet');
  const d = chartData(TREND);
  expect(d.labels.map(l => l.key)).toEqual(['2026-11-03_2026-11-04', '2026-11-04_2026-11-05', '2026-11-05_2026-11-06', '2026-11-06_2026-11-09']);
  expect(d.series.map(s => [s.layer, s.kind, !!s.line])).toEqual([['returning', 'count', false], ['new', 'count', false], ['visits_7d', 'count', true]]);
  expect(d.series[1].values).toEqual([15, 34, 9, 28]);
  expect(d.series[0].values).toEqual([7, 30, 16, 36]);
  expect(d.series[2].values).toEqual([44, 120, 68, 147]);
});

test('R6 Chart: stacked = one column per bucket, NEW over RETURNING, heights summing to the window total on a left axis that tops out at the tallest stack; countLine = the flagged count series as a line on the right axis with count ticks; both off = the Explorer as before', () => {
  const data = chartData(TREND);
  const { container, rerender } = render(<Chart data={data} show="lines" height="standard" hover={null} pinned={null} onHover={() => {}} onPin={() => {}} stacked countLine />);
  const g = geometry(4, heightPx('standard'));
  const maxCount = niceMax(64);
  const cols = [...container.querySelectorAll('rect[data-col]')];
  expect(cols.length).toBe(8);
  for (let i = 0; i < 4; i++) {
    const n = cols.filter(r => r.dataset.col === 'new')[i];
    const r = cols.filter(r => r.dataset.col === 'returning')[i];
    expect([n.dataset.stack, r.dataset.stack]).toEqual(['1', '0']);
    expect(n.getAttribute('x')).toBe(r.getAttribute('x'));
    const h = Number(n.getAttribute('height')) + Number(r.getAttribute('height'));
    expect(h).toBeCloseTo((WINDOWS[i].companies / maxCount) * g.plotH, 3);
    expect(Number(r.getAttribute('y'))).toBeCloseTo(g.yCount(WINDOWS[i].returning, maxCount), 3, 'RETURNING sits on the axis');
    expect(Number(n.getAttribute('y'))).toBeCloseTo(g.yCount(WINDOWS[i].companies, maxCount), 3, 'NEW on top, reaching the window total');
  }
  expect(container.querySelectorAll('[data-line="visits_7d"] path').length).toBe(1);
  expect(container.querySelectorAll('[data-line="new"], [data-col="visits_7d"]').length).toBe(0);
  expect(container.querySelector('[data-end-label="visits_7d"]').textContent).toBe('147');
  const rightTicks = [...container.querySelectorAll('text')].map(t => t.textContent).filter(t => /^[\d,]+$/.test(t));
  expect(rightTicks).toContain(String(niceMax(147)));
  expect(rightTicks.some(t => t.includes('%'))).toBe(false);
  expect(container.querySelector('svg').getAttribute('aria-label')).toMatch(/^Companies identified per pull window, last 30 days/);
  // Both props off: side-by-side columns, no stack attribute, the count series all columns.
  rerender(<Chart data={{ ...data, label: null }} show="lines" height="standard" hover={null} pinned={null} onHover={() => {}} onPin={() => {}} />);
  expect(container.querySelectorAll('rect[data-stack]').length).toBe(0);
  expect(container.querySelectorAll('rect[data-col]').length).toBe(12);
  expect(container.querySelectorAll('[data-line]').length).toBe(0);
  expect(container.querySelector('svg').getAttribute('aria-label')).toMatch(/^Explorer: /);
});

test('the card: bars = the route\'s windows, the summary line from the route, legend counts = the summary, hover = the window\'s days · companies (new · returning) · 7-day visits, a click hands the window up', async () => {
  const pick = jest.fn();
  const { container } = render(<VisitorTrendChart businessId="b1" onPickWindow={pick} />);
  const card = await screen.findByRole('region', { name: 'Visitors, last 30 days' });
  expect(goalsApi.visitorsTrend).toHaveBeenCalledWith('b1', { days: 30 });
  expect(card.dataset.bars).toBe('4');
  expect(container.querySelectorAll('rect[data-col="new"]').length).toBe(4);
  expect(within(card).getByText(/Last 30 days: 160 companies identified · 86 new · 89 returning · busiest: Wed Nov 4 \(64\) · since Nov 3/)).toBeInTheDocument();
  const legend = card.querySelector('[data-trend-legend]');
  expect(legend.textContent).toMatch(/New 86/);
  expect(legend.textContent).toMatch(/Returning 89/);
  expect(legend.textContent).toMatch(/7-day visits, Apollo's rolling count 379/);
  const svg = container.querySelector('svg');
  svg.getBoundingClientRect = () => ({ left: 0, width: 1340 });
  const g = geometry(4, heightPx('standard'));
  fireEvent.mouseMove(svg, { clientX: g.center(3) });
  const hover = await screen.findByRole('status');
  expect(hover.textContent).toMatch(/Fri–Sun Nov 6–8/);
  expect(hover.textContent).toMatch(/64 \(28 new · 36 returning\)/);
  expect(hover.textContent).toMatch(/7-day visits147/);
  fireEvent.click(svg, { clientX: g.center(3) });
  expect(pick).toHaveBeenCalledWith(WINDOWS[3]);
  expect(container.querySelector('[data-trend-plot]').getAttribute('style')).toBeNull();
});

test('390: PHONE_BARS bars fill the width and the rest swipe; fewer bars than that fill the width as is', async () => {
  mockPhone = true;
  goalsApi.visitorsTrend.mockResolvedValue(many(30));
  const { container } = render(<VisitorTrendChart businessId="b1" />);
  const card = await screen.findByRole('region', { name: 'Visitors, last 30 days' });
  expect(card.dataset.bars).toBe('30');
  expect(container.querySelector('[data-trend-plot]').style.width).toBe(`${(30 / PHONE_BARS) * 100}%`);
  expect(screen.getByRole('region', { name: 'Chart (swipe sideways for all 30 days)' })).toBeInTheDocument();
  expect(container.querySelectorAll('rect[data-col="new"]').length).toBe(30);
});

test('no windows: the card says so; a failed read shows the error, never a dead chart', async () => {
  goalsApi.visitorsTrend.mockResolvedValue({ ...TREND, windows: [], since: null, summary: { ...TREND.summary, windows: 0, busiest: null } });
  render(<VisitorTrendChart businessId="b1" />);
  expect(await screen.findByText('No pull windows in the last 30 days.')).toBeInTheDocument();
  goalsApi.visitorsTrend.mockRejectedValue(new Error('trend down'));
  render(<VisitorTrendChart businessId="b2" />);
  expect(await screen.findByText(/trend down/)).toBeInTheDocument();
});
