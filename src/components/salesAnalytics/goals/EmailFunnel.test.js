import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import EmailFunnel, { RateChart, niceTop } from './EmailFunnel';
import { funnelTables, ratePoints, pointLabel, emailSiteMetric, pctOf, PAGE_WINDOWS } from './funnelModel';
import { FUNNEL } from './funnelFixture';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { funnel: jest.fn() } }));
beforeEach(() => goalsApi.funnel.mockResolvedValue(FUNNEL));
afterEach(() => jest.clearAllMocks());

// email-funnel-v1 Stage 2 (F5): the page's three tables are the route's numbers in the email's words, the rate chart's
// points are the route's series, a day with no company emailed is a gap, nothing shows until the route says ready.
const W = FUNNEL.windows;

test('tables = route: every step count and its share of delivered, both rates with their fractions, this week vs last week, the route\'s own sentences', async () => {
  render(<EmailFunnel businessId="b1" />);
  const section = await screen.findByRole('region', { name: 'Email to site funnel' });
  expect(goalsApi.funnel).toHaveBeenCalledWith('b1', { windows: PAGE_WINDOWS.join(','), days: 30 });
  const steps = section.querySelector('[data-funnel-table="steps"]');
  expect([...steps.querySelectorAll('thead th')].map(th => th.textContent)).toEqual(['Step', 'Yesterday', 'Last 7 d', 'Last 30 d']);
  expect([...steps.querySelectorAll('tbody tr')].map(tr => tr.dataset.row)).toEqual(FUNNEL.steps);
  for (const s of FUNNEL.steps) {
    const cells = [...steps.querySelector(`[data-row="${s}"]`).querySelectorAll('td')].map(td => td.textContent);
    expect(cells).toEqual([W.yesterday, W['7d'], W['30d']].map(w => (s === 'delivered' ? w[s].toLocaleString('en-US') : `${w[s]}· ${pctOf(w[s] / w.delivered)}`)));
  }
  expect(steps.querySelector('[data-row="delivered"] td:last-child').textContent).toBe('1,828');
  expect(steps.textContent).toContain(`opens, clicks, replies and meetings are ${FUNNEL.wording.cohort}.`);
  const rates = section.querySelector('[data-funnel-table="rates"]');
  expect([...rates.querySelector('[data-row="company_rate"]').querySelectorAll('td')].map(td => td.textContent)).toEqual(['1.5 %· 1 of 66 companies', '2.8 %· 5 of 178 companies', '3.2 %· 7 of 217 companies']);
  expect([...rates.querySelector('[data-row="person_rate"]').querySelectorAll('td')].map(td => td.textContent)).toEqual(['0.0 %· 0 of 87 people', '0.3 %· 1 of 400 people', '0.3 %· 2 of 780 people']);
  expect([...rates.querySelectorAll('[data-how]')].map(e => e.textContent)).toEqual([FUNNEL.wording.company, FUNNEL.wording.person]);
  expect(rates.querySelector('[data-arrow]')).toBeNull();
  const week = section.querySelector('[data-funnel-table="week"]');
  expect([...week.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('th, td')].map(c => c.textContent))).toEqual([['delivered', '135', '380', '−245'], ['companies visited', '2', '4', '−2'], ['replies', '0', '2', '−2'], ['meetings', '1', '4', '−3']]);
  expect(week.textContent).toContain('Mon Nov 9 → today against Mon Nov 2 → Sun Nov 8.');
  expect(section.querySelector('[data-funnel-since]').textContent).toBe(FUNNEL.wording.since);
  expect(section.textContent).not.toMatch(/@/);
});

test('rate line = series: one point per day row with a rate (n ÷ d of that row), a day with no company emailed is a gap; hover and arrow keys say the day\'s fraction', async () => {
  const pts = ratePoints(FUNNEL);
  expect(pts.map(p => [p.day, p.n, p.d])).toEqual(FUNNEL.series.map(r => [r.day, r.companies_visited, r.companies_emailed]));
  expect(pts.map(p => p.rate)).toEqual([1 / 40, null, null, 1 / 66, 2 / 25]);
  expect(niceTop(0.08)).toBe(0.1);
  expect(niceTop(0)).toBe(0.01);
  render(<EmailFunnel businessId="b1" />);
  const chart = (await screen.findByRole('region', { name: 'Email to site funnel' })).querySelector('[data-rate-chart]');
  expect(chart.dataset.points).toBe('5');
  const drawn = [...chart.querySelectorAll('[data-rate-point]')];
  expect(drawn.map(p => [p.dataset.ratePoint, Number(p.dataset.rate)])).toEqual(pts.filter(p => p.rate != null).map(p => [p.day, p.rate]));
  expect(chart.querySelector('path').getAttribute('d').match(/M/g)).toHaveLength(2); // the gap splits the line
  const plot = within(chart).getByRole('img');
  expect(plot.getAttribute('aria-label')).toBe('Company rate per day, last 5 days: 3 days with email delivered, latest Tue, Nov 10 · 8.0 % · 2 of 25 companies emailed that day visited that day');
  fireEvent.mouseEnter(chart.querySelector('[data-rate-day="2026-11-09"]'));
  expect(chart.querySelector('[data-rate-hover]').textContent).toBe(pointLabel(pts[3]));
  expect(pointLabel(pts[3])).toBe('Mon, Nov 9 · 1.5 % · 1 of 66 companies emailed that day visited that day');
  fireEvent.keyDown(plot, { key: 'ArrowLeft' });
  expect(chart.querySelector('[data-rate-hover]').textContent).toBe('Sun, Nov 8 · no email delivered');
  fireEvent.keyDown(plot, { key: 'Escape' });
  expect(chart.querySelector('[data-rate-hover]').textContent).toMatch(/^Each day: of the companies emailed that day/);
  render(<RateChart points={[]} />);
});

test('the 30-day arrow shows only when the route sends one; nothing renders until the route says ready; a failed read says so', async () => {
  expect(funnelTables({ ...FUNNEL, trend_30d: { now: 0.03, prior: 0.02, arrow: '▲' } }).rates.rows[0].cells.map(c => c.arrow)).toEqual([null, null, '▲']);
  expect(funnelTables({ ...FUNNEL, ready: false })).toBeNull();
  expect(funnelTables(null)).toBeNull();
  goalsApi.funnel.mockResolvedValue({ ...FUNNEL, ready: false });
  const { container, unmount } = render(<EmailFunnel businessId="b1" />);
  await waitFor(() => expect(goalsApi.funnel).toHaveBeenCalled());
  await act(async () => {});
  expect(container.querySelector('[data-email-funnel]')).toBeNull();
  unmount();
  goalsApi.funnel.mockRejectedValue(new Error('funnel read failed'));
  render(<EmailFunnel businessId="b1" />);
  expect(await screen.findByText(/funnel read failed/)).toBeInTheDocument();
});

test('tile model = route: the 30-day company rate, its fraction, the day rates as the sparkline; null while not ready', () => {
  const m = emailSiteMetric(FUNNEL);
  expect([m.kind, m.value, m.fraction, m.trend, m.vs_prior]).toEqual(['rate', W['30d'].company_rate.rate, '7 of 217 companies', 'flat', false]);
  expect(m.series).toEqual(ratePoints(FUNNEL).map(p => p.rate));
  expect(emailSiteMetric({ ...FUNNEL, trend_30d: { arrow: '▼' } }).trend).toBe('bad');
  expect(emailSiteMetric({ ...FUNNEL, ready: false })).toBeNull();
});
