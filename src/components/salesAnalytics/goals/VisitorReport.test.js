import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import VisitorReport from './VisitorReport';
import { goalsApi } from './goalsApi';
import { FUNNEL } from './funnelFixture';

jest.mock('./goalsApi', () => ({ goalsApi: {
  visitReport: jest.fn(), visitStatus: jest.fn(), visitPull: jest.fn(), visitSkip: jest.fn(), addVisitSkip: jest.fn(), removeVisitSkip: jest.fn(),
  visitExportUrl: id => `/api/sales/${id}/goals/visits/export`, uploadVisitedPeople: jest.fn(),
  visitorsExportUrl: (id, p) => `/api/sales/${id}/goals/visits/export-visitors?window=${p.window}&format=csv`, visitorsExport: jest.fn(), visitorsTrend: jest.fn(), funnel: jest.fn(),
} }));
// visitor-trend-v1 T2 / T6: the 30-day trend the chart draws and the PDF's summary line reads.
const TREND = { days: 30, today: '2026-11-06', since: '2026-10-21', windows: [{ start: '2026-11-05', end: '2026-11-06', days: ['2026-11-05'], label: 'Thu Nov 5', merged: 1, companies: 25, new: 9, returning: 16, visits_7d: 68, company_keys: [], new_keys: [], record_keys: [] }], summary: { windows: 1, companies: 25, company_windows: 25, new: 9, returning: 16, visits_7d: 68, busiest: { label: 'Thu Nov 5', start: '2026-11-05', companies: 25 } } };

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
  goalsApi.visitorsTrend.mockResolvedValue(TREND);
  goalsApi.funnel.mockResolvedValue({ ready: false });
});
afterEach(() => jest.clearAllMocks());

test('headline, Hot, Apollo-labeled uniques, P4 hidden until asked; the 30-day chart sits between the summary and the lists and hands a bar pick up', async () => {
  const pick = jest.fn();
  render(<VisitorReport businessId="b1" canEdit onPickWindow={pick} />);
  const table = await screen.findByRole('table');
  const chart = await screen.findByRole('region', { name: 'Visitors, last 30 days' });
  expect(chart.dataset.bars).toBe('1');
  const regions = [...document.querySelectorAll('[data-visitor-report] > section')].map(s => s.getAttribute('aria-label'));
  expect(regions.slice(0, 3)).toEqual(['Website visitors summary', 'Visitors, last 30 days', 'Hot']);
  const svg = chart.querySelector('svg');
  svg.getBoundingClientRect = () => ({ left: 0, width: 1340 });
  fireEvent.click(svg, { clientX: 670 });
  expect(pick).toHaveBeenCalledWith(TREND.windows[0]);
  expect(within(table).getByRole('columnheader', { name: 'Unique visitors (Apollo)' })).toBeInTheDocument();
  expect(within(table).getByRole('columnheader', { name: 'Visits (7 d)' })).toBeInTheDocument();
  expect(screen.getByText("On Brad's list")).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Hot' })).getByText('Harbor Lane')).toBeInTheDocument();
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

test('companies-v2 C5 / homelover-flow-v1 F2: the band words come from BAND_WORD (no local copy)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'VisitorReport.js'), 'utf8');
  expect(src).toMatch(/import \{ BAND_WORD \} from '..\/..\/..\/constants\/fitLevels'/);
  expect(src).not.toMatch(/const (PRIORITY|BAND)_WORD\s*=/);
});

// FIX visitor-email-period-v1 P4 / P5 - the fundraising export: owner / admin only; Window × CSV (the route's file) · PDF
// (the rows rendered into the print area, then window.print); headcount "unknown" never blank; the headcount-known line.
test('Export visitors: a Member has no button; an admin picks the window, CSV fetches the route file, PDF renders the print area with the 11 columns + "unknown" headcount + the headcount-known line and prints', async () => {
  const { unmount } = render(<VisitorReport businessId="b1" canEdit />);
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: 'Export visitors' })).toBeNull();
  unmount();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['x'])), headers: { get: () => 'attachment; filename="website-visitors-7-2026-11-06.csv"' } });
  URL.createObjectURL = jest.fn(() => 'blob:x'); URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  window.print = jest.fn();
  goalsApi.visitorsExport.mockResolvedValue({ title: 'HomeLover website visitors · last 7 days (2026-10-31 – 2026-11-06) · generated 2026-11-06', summary: 'headcount known for 1 of 2 companies', companies: 2, rows: [
    { company: 'Acme Health', industry: 'NAICS 6216', headcount: '1,250 (typed)', first_seen: '2026-10-20', last_seen: '2026-11-06', days_visited: 2, visits_7d: 6, pages: ['/pricing', '/employers'], people: 2, band: 'P1 · Hot', in_prospector: 'Employer · Contacted' },
    { company: 'Nobody Co', industry: '—', headcount: 'unknown', first_seen: '2026-11-05', last_seen: '2026-11-06', days_visited: 1, visits_7d: 1, pages: [], people: 0, band: 'P4 · Cold', in_prospector: '—' },
  ] });
  render(<VisitorReport businessId="b1" canEdit isAdmin />);
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: 'Export visitors' }));
  const panel = screen.getByRole('region', { name: 'Export visitors' });
  fireEvent.change(within(panel).getByLabelText('Window'), { target: { value: '7' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'CSV' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/sales/b1/goals/visits/export-visitors?window=7&format=csv'));
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(document.getElementById('sales-analytics-print-area')).toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: 'PDF' }));
  await waitFor(() => expect(goalsApi.visitorsExport).toHaveBeenCalledWith('b1', '7'));
  const print = await waitFor(() => { const el = document.getElementById('sales-analytics-print-area'); if (!el) throw new Error('no print area'); return el; });
  expect(print).toHaveTextContent('HomeLover website visitors · last 7 days (2026-10-31 – 2026-11-06) · generated 2026-11-06');
  expect(print).toHaveTextContent('headcount known for 1 of 2 companies');
  expect(print.querySelector('[data-print-trend]')).toHaveTextContent('Last 30 days: 25 companies identified · 9 new · 16 returning · busiest: Thu Nov 5 (25)');
  expect(print.textContent.indexOf('Last 30 days:')).toBeLessThan(print.textContent.indexOf('headcount known'));
  for (const h of ['Company', 'Industry code (NAICS/SIC)', 'Headcount', 'First seen', 'Last seen', 'Days visited', 'Visits (Apollo, rolling 7 d at last seen)', 'Pages (top 3, last pull)', 'People identified', 'Band', 'In Prospector']) expect(within(print).getByRole('columnheader', { name: h })).toBeInTheDocument();
  expect(within(print).getByText('unknown')).toBeInTheDocument();
  expect(within(print).getByText('1,250 (typed)')).toBeInTheDocument();
  expect(within(print).getByText('/pricing, /employers')).toBeInTheDocument();
  expect(print.closest('.no-print')).toBeNull();
  await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
  expect(within(panel).getByRole('status')).toHaveTextContent('2 companies · headcount known for 1 of 2 companies');
  expect(print.textContent).not.toMatch(/@/);
  click.mockRestore();
});

// email-funnel-v1 F5: the funnel section (three tables + the rate chart) sits directly above the 30-day trend chart.
test('F5: the email funnel section sits above the trend chart, from GET goals/funnel', async () => {
  goalsApi.funnel.mockResolvedValue(FUNNEL);
  render(<VisitorReport businessId="b1" canEdit isAdmin onPickWindow={() => {}} />);
  const funnel = await screen.findByRole('region', { name: 'Email to site funnel' });
  const trend = await screen.findByRole('region', { name: 'Visitors, last 30 days' });
  expect(funnel.compareDocumentPosition(trend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(funnel.querySelectorAll('[data-funnel-table]')).toHaveLength(3);
  expect(funnel.querySelector('[data-rate-chart]')).not.toBeNull();
});
