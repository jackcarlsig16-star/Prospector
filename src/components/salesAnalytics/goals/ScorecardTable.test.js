import { render, screen, fireEvent, waitFor, within, cleanup as cleanupRender } from '@testing-library/react';
import ScorecardTable from './ScorecardTable';

// first-touch-people-v1 Stage 2 - the first-touched row follows the selected week's unit.
const m = (value, goal = null, extra = {}) => ({ value, goal, ...extra });
const base = { outbound_audience: m(100, 1000), total_in_sequence: m(50), sequences_running: m(2), meetings_set: m(1), open_rate: m(0.5), tier1_touched_pct: m(null), partner_meetings: m(0), partners_pilot_live: m(0) };
const data = (unitThisWeek, unitLast) => ({
  month: '2026-10-01',
  weeks: [
    { week_start: '2026-10-05', metrics: { ...base, partners_first_touched: m(5, 100, { unit: unitThisWeek }), people_first_touched: m(8) } },
    { week_start: '2026-10-12', metrics: { ...base, partners_first_touched: m(2, 100, { unit: unitLast }), people_first_touched: m(3) } },
  ],
  month_total: { ...Object.fromEntries(Object.keys(base).map(k => [k, m(0)])), partners_first_touched: m(7, 200), people_first_touched: m(11) },
  sources: {},
});

test('unit people: row reads "People first-touched" with people counts, the goal from the same row, and the people month total', async () => {
  const onSaveTarget = jest.fn().mockResolvedValue({});
  render(<ScorecardTable data={data('people', 'people')} weekStart="2026-10-05" canEdit onSaveTarget={onSaveTarget} />);
  const row = within(document.getElementById('score-row-partners_first_touched'));
  expect(row.getByText('People first-touched')).toBeTruthy();
  expect(screen.queryByText('Partners first-touched')).toBeNull();
  const cells = row.getAllByRole('cell');
  expect(cells[1].textContent).toMatch(/^8of 100/);
  expect(cells[2].textContent).toMatch(/^3of 100/);
  expect(cells[3].textContent).toMatch(/^11of 200/);
  fireEvent.click(row.getByLabelText('People first-touched goal, Wk 1 · Oct 5'));
  fireEvent.change(row.getByLabelText('People first-touched goal, Wk 1 · Oct 5'), { target: { value: '120' } });
  fireEvent.keyDown(row.getByLabelText('People first-touched goal, Wk 1 · Oct 5'), { key: 'Enter' });
  await waitFor(() => expect(onSaveTarget).toHaveBeenCalledWith({ period: 'week', period_start: '2026-10-05', metric_key: 'partners_first_touched', goal: 120, unit: 'people' }));
});

test('a first-touched week with no goal row shows the carried goal greyed, drives the %, and saving replaces it', async () => {
  const onSaveTarget = jest.fn().mockResolvedValue({});
  const d = data('people', 'people');
  d.weeks[1].metrics.partners_first_touched = { value: 2, goal: null, unit: 'people', carried_goal: 100 };
  render(<ScorecardTable data={d} weekStart="2026-10-05" canEdit onSaveTarget={onSaveTarget} />);
  const row = within(document.getElementById('score-row-partners_first_touched'));
  const cell = row.getAllByRole('cell')[2];
  expect(cell.textContent).toMatch(/^3of 100 · carried/);
  expect(cell.textContent).toMatch(/3%$/);
  const btn = row.getByLabelText('People first-touched goal, Wk 2 · Oct 12');
  expect(btn.textContent).toBe('of 100 · carried');
  fireEvent.click(btn);
  fireEvent.change(row.getByLabelText('People first-touched goal, Wk 2 · Oct 12'), { target: { value: '50' } });
  fireEvent.keyDown(row.getByLabelText('People first-touched goal, Wk 2 · Oct 12'), { key: 'Enter' });
  await waitFor(() => expect(onSaveTarget).toHaveBeenCalledWith({ period: 'week', period_start: '2026-10-12', metric_key: 'partners_first_touched', goal: 50, unit: 'people' }));
  cleanupRender();
  render(<ScorecardTable data={d} weekStart="2026-10-05" canEdit={false} onSaveTarget={jest.fn()} />);
  expect(within(document.getElementById('score-row-partners_first_touched')).getAllByRole('cell')[2].textContent).toMatch(/^3of 100 · carried/);
});

test('unit partners on the selected week: the row stays "Partners first-touched" with partner counts', () => {
  render(<ScorecardTable data={data('partners', 'people')} weekStart="2026-10-05" canEdit={false} onSaveTarget={jest.fn()} />);
  const row = within(document.getElementById('score-row-partners_first_touched'));
  expect(row.getByText('Partners first-touched')).toBeTruthy();
  const cells = row.getAllByRole('cell');
  expect(cells[1].textContent).toMatch(/^5of 100/);
  expect(cells[3].textContent).toMatch(/^7of 200/);
});

// microsoft-connect-v1 Stage 4b - the meetings_set week cell carries the calendar's count under the typed one.
test('meetings_set: "from Outlook: N" under the typed number only on weeks the route sent it', () => {
  cleanupRender();
  const d = data('people', 'people');
  d.weeks[0].metrics.meetings_set = m(1, 4, { outlook: 2 });
  render(<ScorecardTable data={d} weekStart="2026-10-05" canEdit={false} onSaveTarget={() => {}} />);
  const row = within(document.getElementById('score-row-meetings_set'));
  const cells = row.getAllByRole('cell');
  expect(cells[1].textContent).toMatch(/^1of 4from Outlook: 2/);
  expect(cells[2].textContent).not.toMatch(/from Outlook/);
});
