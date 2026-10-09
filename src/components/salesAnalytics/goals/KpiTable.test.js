import { render, within } from '@testing-library/react';
import KpiTable from './KpiTable';

// microsoft-connect-v1 Stage 4b - the calendar's count under the typed number.
const row = (key, label, source, extra = {}) => ({ key, label, source, last_week: 2, this_week: 3, change: 1, target: null, ...extra });

test('meeting rows show "from Outlook: N" under last week and this week only when the route sent it; typed number stays the value', () => {
  const rows = [
    row('meetings_held', 'Meetings held', 'Manual', { last_week_outlook: 1, this_week_outlook: 4 }),
    row('meetings_set', 'New meetings booked', 'Manual', { last_week_outlook: 0, this_week_outlook: 0 }),
    row('positive_responses', 'Positive responses', 'Apollo'),
  ];
  render(<KpiTable rows={rows} weekStart="2026-10-05" editable={false} onSaveTarget={() => {}} />);
  const held = within(document.querySelector('tbody').rows[0]);
  expect(held.getAllByRole('cell')[1].textContent).toBe('2from Outlook: 1');
  expect(held.getAllByRole('cell')[2].textContent).toBe('3from Outlook: 4');
  const booked = within(document.querySelector('tbody').rows[1]);
  expect(booked.getAllByRole('cell')[2].textContent).toBe('3from Outlook: 0');
  const positive = within(document.querySelector('tbody').rows[2]);
  expect(positive.getAllByRole('cell')[2].textContent).toBe('3');
});

test('feature off: no Outlook line anywhere', () => {
  render(<KpiTable rows={[row('meetings_held', 'Meetings held', 'Manual')]} weekStart="2026-10-05" editable onSaveTarget={() => {}} />);
  expect(document.body.textContent).not.toMatch(/from Outlook/);
});
