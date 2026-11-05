import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CompaniesView from './CompaniesView';
import { memberLookup } from './goalsUi';

// goals-surface-v1 Stage 2: companies with no headcount (all weeks) behind a
// "Missing headcount (N)" chip, filled inline; the scorecard links to it.
const members = [{ user_id: 'u-jack', name: 'Jack Carlson' }];
const lookup = memberLookup(members);
const co = (id, name, week, employees = null) => ({ account_id: id, name, week_start: week, employees, sequenced_by: 'u-jack', cohort: null });
const ALL = [co('a', 'Acme', '2026-09-14'), co('b', 'Bravo', '2026-09-28'), co('c', 'Charlie', '2026-09-28', 400), co('d', 'Alpha', '2026-09-28')];

function Harness({ canEdit = true, onSave = jest.fn() }) {
  const [all, setAll] = useState(ALL);
  const [open, setOpen] = useState(false);
  return (
    <CompaniesView weekStart="2026-10-05" companies={[]} allCompanies={all} missingOpen={open} onMissingOpen={setOpen} cadences={[]} lookup={lookup}
      members={members} owner="team" whoLabel="Team" canEdit={canEdit} onCreateCadence={jest.fn()} onDeleteCadence={jest.fn()}
      onSaveEmployees={async (id, n) => { await onSave(id, n); setAll(xs => xs.map(x => (x.account_id === id ? { ...x, employees: n } : x))); }} />
  );
}

test('chip counts companies with no headcount across all weeks; list is newest week first, then name', () => {
  render(<Harness />);
  const chip = screen.getByRole('button', { name: /Missing headcount \(3\)/ });
  fireEvent.click(chip);
  expect(chip.getAttribute('aria-expanded')).toBe('true');
  const rows = within(screen.getByRole('region', { name: 'Missing headcount' })).getAllByRole('row').slice(1).map(r => r.textContent);
  expect(rows.map(r => r.match(/Acme|Bravo|Alpha/)[0])).toEqual(['Alpha', 'Bravo', 'Acme']);
  expect(rows.join()).not.toMatch(/Charlie/);
});

test('typing a number and pressing Enter saves it; the row stays with a tick and the count drops', async () => {
  const onSave = jest.fn().mockResolvedValue();
  render(<Harness onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: /Missing headcount/ }));
  const input = screen.getByLabelText('Employees at Bravo');
  fireEvent.change(input, { target: { value: '1,250' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('b', 1250));
  await waitFor(() => expect(screen.getByText('✓ 1,250')).toBeTruthy());
  expect(screen.getByRole('button', { name: /Missing headcount \(2\)/ })).toBeTruthy();
});

test('bad input is refused without saving; blank does nothing', async () => {
  const onSave = jest.fn().mockResolvedValue();
  render(<Harness onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: /Missing headcount/ }));
  const input = screen.getByLabelText('Employees at Acme');
  fireEvent.change(input, { target: { value: '12.5' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(await screen.findByText('Whole number')).toBeTruthy();
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.blur(input);
  expect(onSave).not.toHaveBeenCalled();
});

test('viewers see the list without inputs', () => {
  render(<Harness canEdit={false} />);
  fireEvent.click(screen.getByRole('button', { name: /Missing headcount/ }));
  expect(screen.queryByLabelText(/Employees at/)).toBeNull();
});
