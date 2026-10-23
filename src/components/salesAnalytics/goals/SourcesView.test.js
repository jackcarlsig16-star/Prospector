import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SourcesView from './SourcesView';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { sources: jest.fn(), sourcesExport: jest.fn(), sourcesExportCsvUrl: jest.fn(), sourcesBackfill: jest.fn(), applySourcesBackfill: jest.fn(), partners: jest.fn() } }));

// jsdom has no matchMedia; the view reads it for its phone list.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));

const UP = 'g-up', HUB = 'g-hub';
const bands = (o = {}) => ({ green: 0, yellow: 0, blue: 0, gray: 0, light: 0, faded: 0, ...o });
const group = (key, label, n, extra = {}) => ({ key, label, companies: n, bands: bands(extra.bands), meetings: extra.bands?.yellow || 0, pilot_live: extra.bands?.green || 0, covered_lives: extra.covered_lives || 0 });
const report = {
  totals: group('t', 't', 5, { bands: { yellow: 1, green: 1 }, covered_lives: 1200 }),
  by_kind: [group('partner_referral', 'Partner referral', 3, { bands: { yellow: 1 } }), group('not_set', 'Not set yet', 2)],
  by_partner: [group(UP, 'Upside', 3, { bands: { yellow: 1 }, covered_lives: 1200 })],
  by_person: [group(`${UP}|Brad Cillian`, 'Brad Cillian · Upside', 3)],
  by_office: [],
};
const partners = [{ id: UP, name: 'Upside' }, { id: HUB, name: 'HUB International' }];

beforeEach(() => {
  goalsApi.sources.mockResolvedValue(report);
  goalsApi.partners.mockResolvedValue(partners);
});
afterEach(() => jest.clearAllMocks());

test('Sources: by kind / partner / rep / office with bands; filters re-read; Export for <partner> prints structured fields only', async () => {
  goalsApi.sourcesExport.mockResolvedValue({
    partner: { id: UP, name: 'Upside' }, totals: report.by_partner[0],
    columns: [{ key: 'name', label: 'Company' }, { key: 'type_label', label: 'Type' }, { key: 'stage_label', label: 'Stage' }, { key: 'owner', label: 'Owner' }, { key: 'covered_lives', label: 'Covered lives' }, { key: 'source_person', label: 'Referred by' }, { key: 'source_office', label: 'Office' }],
    rows: [{ name: 'Elm Health', type_label: 'Employer', stage_label: 'Meeting', owner: 'Jack', covered_lives: 1200, source_person: 'Brad Cillian', source_office: null }],
  });
  render(<SourcesView businessId="b1" partners={partners} isAdmin={false} />);
  const byPartner = await screen.findByRole('region', { name: 'By referring partner' });
  expect(within(byPartner).getByText('Upside')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'By office' })).toHaveTextContent('No partner office named yet.');
  expect(screen.queryByRole('region', { name: 'Backfill sources' })).toBeNull();

  fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'upside' } });
  await waitFor(() => expect(goalsApi.sources).toHaveBeenLastCalledWith('b1', { days: '', team: 'upside', partner: '' }));

  fireEvent.click(within(byPartner).getByRole('button', { name: 'Export' }));
  const exp = await screen.findByRole('region', { name: 'Export for partner' });
  await within(exp).findByText('Companies referred by Upside');
  expect(document.getElementById('sales-analytics-print-area')).toHaveTextContent('Elm Health');
  expect(goalsApi.sourcesExport).toHaveBeenCalledWith('b1', UP);
  expect(document.getElementById('sales-analytics-print-area').textContent).not.toMatch(/route|@/i);
});

test('Backfill (Admins): nothing is applied until a group is confirmed; only confirmed groups are sent, with the edited mapping', async () => {
  goalsApi.sourcesBackfill.mockResolvedValue({
    total: 10, kept: 1,
    groups: [
      { key: 'Source: Upside (Brad)', value: 'Upside (Brad)', rule: 'partner Upside + person', count: 6, by_type: { employer: 6 }, proposed: { source_kind: 'partner_referral', source_partner_id: UP, partner_name: 'Upside', source_person: 'Brad Cillian' } },
      { key: 'Channel: import', value: 'import', rule: 'channel says nothing about who originated it', count: 3, by_type: { employer: 2, partner: 1 }, proposed: { source_kind: 'unknown', source_partner_id: null, partner_name: null, source_person: null } },
    ],
  });
  goalsApi.applySourcesBackfill.mockResolvedValue({ written: 3, skipped: 0, groups: 1 });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<SourcesView businessId="b1" partners={partners} isAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: 'Preview backfill' }));
  await screen.findByText('Source: Upside (Brad)');
  expect(screen.getByRole('button', { name: /^Apply 0 confirmed groups/ })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Confirm Channel: import'));
  fireEvent.change(screen.getByLabelText('Source kind for Channel: import'), { target: { value: 'homelover_outreach' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply 1 confirmed group (3 records)' }));
  await waitFor(() => expect(goalsApi.applySourcesBackfill).toHaveBeenCalled());
  expect(goalsApi.applySourcesBackfill.mock.calls[0][1]).toEqual({ 'Channel: import': { source_kind: 'homelover_outreach', source_partner_id: null, source_person: null } });
  await screen.findByText(/Wrote 3 sources from 1 group/);
  window.confirm.mockRestore();
});
