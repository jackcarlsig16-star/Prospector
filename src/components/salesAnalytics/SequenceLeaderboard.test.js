import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SequenceLeaderboard, { healthOf, summarize } from './SequenceLeaderboard';
import { setSequenceAudience } from './salesApi';
import { exportWidgetCsv } from './exportCsv';

jest.mock('./salesApi', () => ({ setSequenceAudience: jest.fn() }));
jest.mock('./exportCsv', () => ({ exportWidgetCsv: jest.fn() }));

// dashboard-v3 Stage 4 - Sequences on the DataTable: HomeLover's own only (the steps route's `own`), cohort chips with
// counts, Running / Paused / All, the summary line, Group by, the columns with the existing health rule and the 5 % bounce
// line, a row expanding to its per-step rows (sums = lifetime), the audience picker (Member) in the detail.
const metric = (id, key, value) => ({ metric_key: key, dim_type: 'sequence', dim_value: id, value, metric_date: '2026-11-05' });
const counters = (id, { delivered, opened, replied, bounced }) => [metric(id, 'unique_delivered', delivered), metric(id, 'unique_opened', opened), metric(id, 'unique_replied', replied), metric(id, 'unique_bounced', bounced)];
const allRows = [
  ...counters('s1', { delivered: 684, opened: 12, replied: 1, bounced: 26 }),
  ...counters('s2', { delivered: 316, opened: 121, replied: 4, bounced: 124 }),
  ...counters('s3', { delivered: 4, opened: 0, replied: 0, bounced: 0 }),
  ...counters('s9', { delivered: 900, opened: 90, replied: 9, bounced: 9 }),
];
const entities = { sequences: [
  { id: 's1', name: 'HomeLover — 5-Step Car Rental', active: true, cohort: 'Car Rental', archived: false, num_steps: 5, is_performing_poorly: true, audience: 'employer', sender_email: 'cyrus@x' },
  { id: 's2', name: 'HomeLover 5-Step · Fitness Employers / Gyms', active: true, cohort: 'Fitness', archived: false, num_steps: 5, is_performing_poorly: false, audience: 'employer', sender_email: 'jack@x' },
  { id: 's3', name: 'VP Total Rewards — Affordability Opener', active: false, cohort: 'Other', archived: false, num_steps: 3, is_performing_poorly: false, audience: 'channel_partner', sender_email: 'jack@x' },
  { id: 's9', name: "Brad's Upside sequence", active: true, cohort: 'Other', archived: false, num_steps: 4, is_performing_poorly: false, audience: 'employer', sender_email: 'brad@upside' },
], mailboxes: [] };
const steps = { sequences: {
  s1: { own: true, sender_label: 'Cyrus', mailboxes: ['Cyrus'], messages: 809, delivered: 690, steps: [
    { step: 1, messages: 441, delivered: 337, opened: 89, replied: 0, hard_bounced: 100, spam_blocked: 4, open_rate: 0.264, reply_rate: 0, bounce_rate: 0.236 },
    { step: 2, messages: 235, delivered: 226, opened: 16, replied: 1, hard_bounced: 9, spam_blocked: 0, open_rate: 0.071, reply_rate: 0.0044, bounce_rate: 0.038 },
    { step: 3, messages: 133, delivered: 127, opened: 25, replied: 0, hard_bounced: 6, spam_blocked: 0, open_rate: 0.197, reply_rate: 0, bounce_rate: 0.045 },
  ] },
  s2: { own: true, sender_label: 'Jack', mailboxes: ['Jack'], messages: 1429, delivered: 1403, steps: [{ step: 1, messages: 707, delivered: 682, opened: 8, replied: 0, hard_bounced: 25, spam_blocked: 0, open_rate: 0.012, reply_rate: 0, bounce_rate: 0.035 }] },
  s9: { own: false, sender_label: 'Mailbox 1', mailboxes: ['Mailbox 1'], messages: 950, delivered: 900, steps: [] },
}, totals: { messages: 2238, delivered: 2093 } };
beforeEach(() => { setSequenceAudience.mockResolvedValue({}); });
afterEach(() => jest.clearAllMocks());

test('healthOf keeps the existing rule; summarize weights over the shown rows and counts messages from the steps', () => {
  expect(healthOf({ isPerformingPoorly: true, delivered: 684 })).toBe('Underperforming');
  expect(healthOf({ isPerformingPoorly: false, delivered: 19 })).toBe('Low volume');
  expect(healthOf({ isPerformingPoorly: false, delivered: 20 })).toBe('OK');
  const s = summarize([{ id: 's1', delivered: 684, counters: { unique_opened: 12, unique_replied: 1, unique_bounced: 26 } }, { id: 's2', delivered: 316, counters: { unique_opened: 121, unique_replied: 4, unique_bounced: 124 } }], steps);
  expect(s).toMatchObject({ delivered: 1000, messages: 2238, opened: 133, replied: 5, bounced: 150 });
  expect(s.open_rate).toBe(0.133); expect(s.reply_rate).toBe(0.005); expect(s.bounce_rate).toBeCloseTo(150 / 1150);
});

test('Member: own sequences only (Brad\'s out), running by default, counts on chips and status, the summary line, sender names never addresses, bounce red from 5 %, the health pill; a row expands to its steps whose sums are the lifetime; the audience picker saves', async () => {
  const onDataChanged = jest.fn();
  render(<SequenceLeaderboard businessId="b1" allRows={allRows} entities={entities} steps={steps} canEdit onDataChanged={onDataChanged} />);
  const section = screen.getByRole('region', { name: 'Sequences' });
  expect(section).toHaveTextContent('2 running of 3 · HomeLover\'s own · lifetime');
  expect(screen.queryByText("Brad's Upside sequence")).toBeNull();
  const table = screen.getByRole('table', { name: 'Sequences' });
  expect(within(table).getAllByRole('columnheader').map(h => h.textContent.replace(/[↕↑↓▲▼]/g, '').trim())).toEqual(['Sequence', 'Cohort', 'Sender', 'Steps', 'Delivered', 'Open', 'Reply', 'Bounce', 'Health']);
  const names = () => [...table.querySelectorAll('tbody tr[data-row] td:first-child')].map(td => td.textContent.replace(/^(Show|Hide) details for /, ''));
  expect(names()).toEqual(['HomeLover — 5-Step Car Rental', 'HomeLover 5-Step · Fitness Employers / Gyms']); // running only, delivered desc
  expect(table.textContent).not.toMatch(/@/);
  expect(table).toHaveTextContent('Cyrus'); expect(table).toHaveTextContent('Jack');
  expect([...table.querySelectorAll('[data-health]')].map(e => e.dataset.health)).toEqual(['Underperforming', 'OK']);
  expect([...table.querySelectorAll('[data-bounce]')].map(e => e.dataset.bounce)).toEqual(['ok', 'bad']); // 26/710 = 3.7 % · 124/440 = 28.2 %
  expect(document.querySelector('[data-sequences-summary]')).toHaveTextContent('Delivered 1,000 unique · 2,238 messages · Open 13.3% · Reply 0.5% · Bounce 13.0%');
  expect(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: /All/ })).toHaveTextContent('3');
  expect(document.querySelector('[data-cohort-chip="Fitness"]')).toHaveTextContent('1');
  // Expand the Car Rental row: three step rows, delivered sums to the lifetime 777, bars against step 1.
  fireEvent.click(within(table).getByRole('button', { name: /Show details for HomeLover — 5-Step Car Rental/ }));
  const detail = document.querySelector('[data-sequence-detail="s1"]');
  const delivered = [...detail.querySelectorAll('[data-step-delivered]')].map(td => Number(td.textContent.replace(/,/g, '')));
  expect(delivered).toEqual([337, 226, 127]); expect(delivered.reduce((a, b) => a + b, 0)).toBe(690);
  expect(detail.querySelectorAll('[data-step]')).toHaveLength(3);
  expect(within(detail).getByRole('img', { name: '226 delivered, 67% of step 1' })).toBeInTheDocument();
  // Audience picker in the detail: a Member switches it (the one write), the parent reloads.
  fireEvent.click(within(detail).getByRole('button', { name: 'Membership org' }));
  await waitFor(() => expect(setSequenceAudience).toHaveBeenCalledWith('b1', 's1', 'membership'));
  await waitFor(() => expect(onDataChanged).toHaveBeenCalled());
  // Paused shows the paused one; All shows three; search narrows; Group by Sender groups by name.
  fireEvent.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: /Paused/ }));
  expect(names()).toEqual(['VP Total Rewards — Affordability Opener · paused']);
  fireEvent.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: /All/ }));
  expect(names()).toHaveLength(3);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search sequences' }), { target: { value: 'fitness' } });
  expect(names()).toEqual(['HomeLover 5-Step · Fitness Employers / Gyms']);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search sequences' }), { target: { value: '' } });
  fireEvent.click(within(screen.getByRole('group', { name: 'Group by' })).getByRole('button', { name: 'Sender' }));
  expect([...document.querySelectorAll('.ui-table__gh h3, .ui-table__toggle h3')].map(h => h.textContent).sort()).toEqual(['Cyrus · 1', 'Jack · 1', '— · 1'].sort()); // the paused one has no stored sends, so no sender
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  expect(exportWidgetCsv).toHaveBeenCalledWith('sequence_leaderboard', expect.any(Array), expect.any(Array));
});

test('a Viewer reads the table and the steps but gets no audience picker', () => {
  render(<SequenceLeaderboard businessId="b1" allRows={allRows} entities={entities} steps={steps} canEdit={false} />);
  const table = screen.getByRole('table', { name: 'Sequences' });
  fireEvent.click(within(table).getByRole('button', { name: /Show details for HomeLover 5-Step · Fitness/ }));
  const detail = document.querySelector('[data-sequence-detail="s2"]');
  expect(detail.querySelectorAll('[data-step]')).toHaveLength(1);
  expect(within(detail).queryByRole('button', { name: 'Membership org' })).toBeNull();
  expect(detail).toHaveTextContent('Employer');
});
