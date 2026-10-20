import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import VisitorReport from './VisitorReport';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: {
  visitReport: jest.fn(), visitStatus: jest.fn(), visitPull: jest.fn(), visitSkip: jest.fn(), addVisitSkip: jest.fn(), removeVisitSkip: jest.fn(),
  visitExportUrl: id => `/api/sales/${id}/goals/visits/export`,
} }));

const row = (name, priority, extra = {}) => ({
  company_key: name.toLowerCase(), company_name: name, domain: `${name.toLowerCase().replace(/\W/g, '')}.example`, priority, priority_rule: 'Rule', maybe_user: false, skipped: false,
  type: 'New', size: 'size unknown', match: null, visits_7d: 2, unique_visitors_apollo: 1, first_visit: '2026-10-19', last_visit: '2026-10-20', pulled_on: '2026-10-20',
  top_pages: ['/'], sources: [], next_action: 'Watch', ...extra,
});
const REPORT = {
  today: '2026-10-20', since: '2026-10-14', days: 7,
  counts: { companies: 3, P1: 1, P2: 0, P3: 1, P4: 1, on_brads_list: 1 },
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

test('Member: Not a fit adds the company to the skip list and reloads', async () => {
  goalsApi.addVisitSkip.mockResolvedValue({ id: 's2' });
  render(<VisitorReport businessId="b1" canEdit />);
  const table = await screen.findByRole('table');
  fireEvent.click(within(table).getAllByRole('button', { name: 'Not a fit' })[1]);
  await waitFor(() => expect(goalsApi.addVisitSkip).toHaveBeenCalledWith('b1', { company_key: 'sizeless co', reason: 'Not a fit' }));
  await waitFor(() => expect(goalsApi.visitReport).toHaveBeenCalledTimes(2));
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
