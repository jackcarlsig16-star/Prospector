import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import VisitorReport from './VisitorReport';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: {
  visitReport: jest.fn(), visitStatus: jest.fn(), visitPull: jest.fn(), visitSkip: jest.fn(), addVisitSkip: jest.fn(), removeVisitSkip: jest.fn(),
  visitExportUrl: id => `/api/sales/${id}/goals/visits/export`, uploadVisitedPeople: jest.fn(),
} }));

const row = (name, priority, extra = {}) => ({
  company_key: name.toLowerCase(), company_name: name, domain: `${name.toLowerCase().replace(/\W/g, '')}.example`, priority, priority_rule: 'Rule', maybe_user: false, skipped: false,
  type: 'New', size: 'size unknown', match: null, visits_7d: 2, unique_visitors_apollo: 1, first_visit: '2026-10-19', last_visit: '2026-10-20', pulled_on: '2026-10-20',
  top_pages: ['/'], sources: [], next_action: 'Watch', people: [], created: false, filed_by_prospector: false, ...extra,
});
const REPORT = {
  today: '2026-10-20', since: '2026-10-14', days: 7,
  counts: { companies: 3, P1: 1, P2: 0, P3: 1, P4: 1, on_brads_list: 1, people_identified: 0, with_people: 0, created: 0, person_only: 0 },
  rows: [
    row('Harbor Lane', 'P1', { type: 'Partner · Benefits brokers', match: { type: 'partner', label: 'Partner', id: 'p1', record_id: 'HLU-0007', owner_team: 'upside', upside: true }, next_action: 'Reach out today', priority_rule: 'Matched partner visited' }),
    row('Sizeless Co', 'P3'),
    row('Portal User Inc', 'P4', { next_action: 'None - may already be a user' }),
  ],
};
beforeEach(() => {
  window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  goalsApi.visitReport.mockResolvedValue(REPORT);
  goalsApi.visitStatus.mockResolvedValue({ last_run: { la_date: '2026-10-20', status: 'ok' }, paused: null, spent: 0, cap: 500, today: { P1: 1, P2: 0, P3: 1, P4: 1 } });
  goalsApi.visitSkip.mockResolvedValue({ skip: [{ id: 's1', company_key: 'vendor', reason: 'Seed (D10)' }] });
});
afterEach(() => jest.clearAllMocks());

test('headline, Act today, Apollo-labeled uniques, P4 hidden until asked', async () => {
  render(<VisitorReport businessId="b1" canEdit />);
  const table = await screen.findByRole('table');
  expect(within(table).getByRole('columnheader', { name: 'Unique visitors (Apollo)' })).toBeInTheDocument();
  expect(within(table).getByRole('columnheader', { name: 'Visits (7 d)' })).toBeInTheDocument();
  expect(screen.getByText("On Brad's list")).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Act today' })).getByText('Harbor Lane')).toBeInTheDocument();
  expect(within(table).queryByText('Portal User Inc')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show P4 noise (1)' }));
  expect(within(table).getByText('Portal User Inc')).toBeInTheDocument();
  expect(within(table).getByText('Partner · Upside-owned · HLU-0007')).toBeInTheDocument();
});

test('Member: no standalone Not a fit button (it lives in the Pipeline priority dropdown); a hand-set row says so; skip list edits', async () => {
  goalsApi.visitReport.mockResolvedValue({ ...REPORT, rows: REPORT.rows.map((r, i) => (i === 1 ? { ...r, override: { priority: 2 } } : r)) });
  goalsApi.addVisitSkip.mockResolvedValue({ id: 's2' });
  render(<VisitorReport businessId="b1" canEdit />);
  const table = await screen.findByRole('table');
  expect(within(table).queryByRole('button', { name: 'Not a fit' })).not.toBeInTheDocument();
  expect(within(table).getByText('Set by hand')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Skip list' }));
  const skip = await screen.findByRole('region', { name: 'Skip list' });
  fireEvent.change(within(skip).getByLabelText('Company to skip'), { target: { value: 'Vendor Two' } });
  fireEvent.click(within(skip).getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(goalsApi.addVisitSkip).toHaveBeenCalledWith('b1', { name: 'Vendor Two', reason: 'Added by hand' }));
  goalsApi.removeVisitSkip.mockResolvedValue({ removed: 's1' });
  fireEvent.click(within(skip).getByRole('button', { name: 'Remove vendor from the skip list' }));
  await waitFor(() => expect(goalsApi.removeVisitSkip).toHaveBeenCalledWith('b1', 's1'));
});

test('Viewer: reads and exports, no Not a fit, skip list read-only', async () => {
  const blob = new Blob(['x']);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob), headers: { get: () => 'attachment; filename="website-visitors-2026-10-20.xlsx"' } });
  URL.createObjectURL = jest.fn(() => 'blob:x'); URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<VisitorReport businessId="b1" canEdit={false} />);
  const table = await screen.findByRole('table');
  expect(within(table).queryByRole('button', { name: 'Not a fit' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Export for Brad (.xlsx)' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/sales/b1/goals/visits/export'));
  await waitFor(() => expect(click).toHaveBeenCalled());
  click.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Skip list' }));
  const skip = await screen.findByRole('region', { name: 'Skip list' });
  expect(await within(skip).findByText('vendor')).toBeInTheDocument();
  expect(within(skip).queryByRole('button')).not.toBeInTheDocument();
  expect(within(skip).queryByLabelText('Company to skip')).not.toBeInTheDocument();
});

// visitor-to-record-v1 Stage 3 - V5: people on the row, Created / filed-by-Prospector chips, the filters, the CSV control.
test('V5 merged view: people identified expands to names + titles with HR / benefits flagged, Created and filed-by-Prospector chips, filters narrow the table, a Member uploads the Visited People CSV', async () => {
  const people = [{ name: 'Larry F.', title: 'Chief People Officer', buyer: true, partial: true, identified: false }, { name: 'Sam Rivera', title: 'Driver', buyer: false, partial: false, identified: true }];
  goalsApi.visitReport.mockResolvedValue({ ...REPORT, counts: { ...REPORT.counts, people_identified: 3, created: 1, person_only: 1, with_people: 2 }, rows: [
    row('Nimbus Freight', 'P1', { people, created: true, type: 'Target (employer)', match: { type: 'target', label: 'Target', id: 't1', record_id: null, owner_team: null, upside: false } }),
    row('Zz Calpine', null, { people: [{ name: 'Margo R.', title: 'Benefits Manager', buyer: true, partial: false, identified: true }], filed_by_prospector: true, priority_rule: 'Identified visitor only', visits_7d: 0, next_action: 'Review 1 identified person' }),
    row('Sizeless Co', 'P3'),
  ] });
  goalsApi.uploadVisitedPeople.mockResolvedValue({ companies: [{ name: 'Zz ADP', action: 'created', type: 'target', id: 'x', people_added: 2, already_in: 0 }, { name: 'Harbor Lane', action: 'matched', type: 'partner', id: 'p1', people_added: 1, already_in: 1 }], skipped: 1, header_row: 1, people: 4 });
  render(<VisitorReport businessId="b1" canEdit />);
  const table = await screen.findByRole('table');
  expect(within(table).getByRole('columnheader', { name: 'People identified' })).toBeInTheDocument();
  const nimbus = within(table).getByText('Nimbus Freight').closest('tr');
  expect(within(nimbus).getByText('Created')).toBeInTheDocument();
  fireEvent.click(within(nimbus).getByText('2 people · 1 HR / benefits'));
  expect(within(nimbus).getByText('Larry F.')).toBeInTheDocument();
  expect(within(nimbus).getByText('HR / benefits')).toBeInTheDocument();
  expect(within(nimbus).getByText('reveal to see full name')).toBeInTheDocument();
  const calpine = within(table).getByText('Zz Calpine').closest('tr');
  expect(within(calpine).getByText('filed by Prospector')).toBeInTheDocument();
  expect(within(calpine).getByText('—', { selector: '.ui-tag' })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Website visitors summary' })).getByText('People identified').nextSibling).toHaveTextContent('3');
  fireEvent.click(screen.getByRole('button', { name: 'Has people' }));
  expect(within(table).queryByText('Sizeless Co')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Created' }));
  expect(within(table).queryByText('Zz Calpine')).not.toBeInTheDocument();
  expect(within(table).getByText('Nimbus Freight')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  fireEvent.change(screen.getByLabelText('Priority filter'), { target: { value: 'P3' } });
  expect(within(table).getByText('Sizeless Co')).toBeInTheDocument();
  expect(within(table).queryByText('Nimbus Freight')).not.toBeInTheDocument();
  const file = new File(['First Name,Last Name,Company\nJean,Horton,Zz ADP'], 'visitors.csv', { type: 'text/csv' });
  file.text = () => Promise.resolve('First Name,Last Name,Company\nJean,Horton,Zz ADP');
  fireEvent.change(screen.getByLabelText('Upload Visited People CSV'), { target: { files: [file] } });
  await waitFor(() => expect(goalsApi.uploadVisitedPeople).toHaveBeenCalledWith('b1', 'First Name,Last Name,Company\nJean,Horton,Zz ADP'));
  expect(await screen.findByText('Filed 3 people from the export: 1 company created, 1 matched, 1 already on file, 1 row skipped')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/@/);
});

test('Viewer: no CSV upload control', async () => {
  render(<VisitorReport businessId="b1" canEdit={false} />);
  await screen.findByRole('table');
  expect(screen.queryByLabelText('Upload Visited People CSV')).not.toBeInTheDocument();
});
