import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SourcesView from './SourcesView';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { sources: jest.fn(), sourcesFunnel: jest.fn(), sourcesExport: jest.fn(), sourcesExportCsvUrl: jest.fn(), sourcesBackfill: jest.fn(), applySourcesBackfill: jest.fn(), partners: jest.fn() } }));

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
// brad-attribution-v1 Stage 2 - the funnel fixture (invented companies; names + dates only).
const rate = (n, m) => ({ n, m, pct: m >= 10 ? Math.round((n / m) * 100) : null });
const fgroup = (key, label, c) => ({ key, label, partner: null, companies: c.referred, ...c, conversion: { visited_of_referred: rate(c.visited, c.referred), replied_of_visited: rate(c.replied, c.visited), meeting_of_replied: rate(c.meeting, c.replied), pilot_of_meeting: rate(c.pilot, c.meeting) } });
const comp = (name, keys, d, extra = {}) => ({ type: 'employer', id: name, name, band: 'blue', score: 41, score_band: 'P2', score_source: 'upside', source_kind: 'partner_referral', source_person: 'Brad Cillian', partner: 'Upside', upside: true, keys, referred: null, visited: null, replied: null, meeting: null, pilot: null, lost: null, journey: `Referred by Brad Cillian (Upside) ${name}`, ...d, ...extra });
const BRAD = { rep: `${UP}|Brad Cillian`, partner: UP, source: 'partner_referral' };
const funnel = {
  today: '2026-10-28',
  totals: { referred: 12, visited: 3, replied: 1, meeting: 1, pilot: 0, lost: 1, companies: 13, conversion: {} },
  since_yesterday: { referred: 0, visited: 1, replied: 0, meeting: 0, pilot: 0, lost: 0 },
  by_rep: [fgroup(BRAD.rep, 'Brad Cillian · Upside', { referred: 12, visited: 3, replied: 1, meeting: 1, pilot: 0, lost: 1 })],
  by_partner: [fgroup(UP, 'Upside', { referred: 12, visited: 3, replied: 1, meeting: 1, pilot: 0, lost: 1 })],
  by_source_kind: [fgroup('partner_referral', 'Partner referral', { referred: 12, visited: 3, replied: 1, meeting: 1, pilot: 0, lost: 1 }), fgroup('website', 'Website', { referred: 0, visited: 1, replied: 0, meeting: 0, pilot: 0, lost: 0 })],
  companies: [
    comp('Zz Elm Health', BRAD, { referred: '2026-10-15', visited: '2026-10-24', replied: '2026-10-26', meeting: '2026-10-27' }),
    comp('Zz Birch Co', BRAD, { referred: '2026-10-15', visited: '2026-10-28' }),
    comp('Zz Cedar Inc', BRAD, { referred: '2026-10-15', visited: '2026-10-20' }, { score_band: null, score: null }),
    ...Array.from({ length: 9 }, (_, i) => comp(`Zz Plain ${i}`, BRAD, { referred: '2026-10-15', lost: i === 0 ? '2026-10-15' : null })),
    comp('Zz Web Co', { rep: null, partner: null, source: 'website' }, { visited: '2026-10-22' }, { source_kind: 'website', score_source: 'website', source_person: null, partner: null, upside: false }),
  ],
};

beforeEach(() => {
  goalsApi.sources.mockResolvedValue(report);
  goalsApi.sourcesFunnel.mockResolvedValue(funnel);
  goalsApi.partners.mockResolvedValue(partners);
});
afterEach(() => jest.clearAllMocks());

test('Sources: by kind / partner / rep / office with bands; filters re-read; Export for <partner> prints structured fields only', async () => {
  goalsApi.sourcesExport.mockResolvedValue({
    partner: { id: UP, name: 'Upside' }, totals: report.by_partner[0],
    columns: [{ key: 'name', label: 'Company' }, { key: 'type_label', label: 'Type' }, { key: 'stage_label', label: 'Stage' }, { key: 'owner', label: 'Owner' }, { key: 'covered_lives', label: 'Covered lives' }, { key: 'source_person', label: 'Referred by' }, { key: 'source_office', label: 'Office' },
      { key: 'referred', label: 'Referred on' }, { key: 'visited', label: 'Visited' }, { key: 'replied', label: 'Replied' }, { key: 'meeting', label: 'Meeting' }, { key: 'pilot', label: 'Pilot' }, { key: 'lost', label: 'Lost' }, { key: 'score_band', label: 'Score band' }],
    rows: [{ name: 'Elm Health', type_label: 'Employer', stage_label: 'Meeting', owner: 'Jack', covered_lives: 1200, source_person: 'Brad Cillian', source_office: null, referred: '2026-10-15', visited: '2026-10-24', replied: '2026-10-26', meeting: '2026-10-27', pilot: null, lost: null, score_band: 'P2' }],
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
  const print = document.getElementById('sales-analytics-print-area');
  for (const h of ['Referred on', 'Visited', 'Replied', 'Meeting', 'Pilot', 'Lost', 'Score band']) expect(within(print).getByRole('columnheader', { name: h })).toBeInTheDocument();
  expect(print).toHaveTextContent('2026-10-24');
  expect(print).toHaveTextContent('P2');
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

test('Funnel by rep: Brad\'s row has the six cumulative counts; a count opens its companies with the stage date + intent band, newest first; ▲ = entered today; the selected row\'s five bars carry "n of m"; groupings switch; Rep / Source filter the funnel', async () => {
  render(<SourcesView businessId="b1" partners={partners} isAdmin={false} />);
  const f = await screen.findByRole('region', { name: 'Funnel' });
  await within(f).findByRole('figure', { name: 'Brad Cillian · Upside funnel' });
  const tr = f.querySelector('tr[data-funnel-row="Brad Cillian · Upside"]');
  expect([...tr.querySelectorAll('[data-funnel-count]')].map(x => `${x.dataset.funnelCount}:${x.textContent}`)).toEqual(['referred:12', 'visited:3', 'replied:1', 'meeting:1', 'lost:1']);
  expect(tr.querySelector('[data-since-yesterday="visited"]')).toHaveTextContent('▲1');
  expect(tr.querySelector('[data-since-yesterday="referred"]')).toBeNull();
  const chart = within(f).getByRole('figure', { name: 'Brad Cillian · Upside funnel' });
  expect(chart.querySelectorAll('[data-funnel-bar]')).toHaveLength(5);
  expect(chart).toHaveTextContent('25% · 3 of 12');
  expect(chart).toHaveTextContent('1 of 3');
  expect(chart).not.toHaveTextContent('33%');

  fireEvent.click(within(tr).getByTitle('List the 3 visited for Brad Cillian · Upside'));
  const drawer = within(f).getByRole('region', { name: 'Brad Cillian · Upside - Visited' });
  expect([...drawer.querySelectorAll('[data-funnel-company]')].map(x => x.dataset.funnelCompany)).toEqual(['Zz Birch Co', 'Zz Elm Health', 'Zz Cedar Inc']);
  expect(drawer).toHaveTextContent('Visited Oct 24 · P2 (41) · Upside');
  expect(drawer.textContent).not.toMatch(/@/);
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
  expect(within(f).queryByRole('region', { name: 'Brad Cillian · Upside - Visited' })).toBeNull();

  fireEvent.click(within(f).getByRole('button', { name: 'By source' }));
  const web = f.querySelector('tr[data-funnel-row="Website"]');
  fireEvent.click(within(web).getByTitle('List the 1 visited for Website'));
  expect(within(f).getByRole('region', { name: 'Website - Visited' })).toHaveTextContent('Zz Web Co');

  fireEvent.change(screen.getByLabelText('Rep'), { target: { value: 'Brad Cillian' } });
  await waitFor(() => expect(goalsApi.sourcesFunnel).toHaveBeenLastCalledWith('b1', { days: '', team: '', partner: '', rep: 'Brad Cillian', source: '' }));
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'website' } });
  await waitFor(() => expect(goalsApi.sourcesFunnel).toHaveBeenLastCalledWith('b1', { days: '', team: '', partner: '', rep: 'Brad Cillian', source: 'website' }));
  expect(goalsApi.sources).toHaveBeenLastCalledWith('b1', { days: '', team: '', partner: '' });
  expect(screen.getByText(/Rep \/ Source filter the funnel only/)).toBeInTheDocument();
});

test('axe: the funnel (table, open drawer, bars) has 0 violations (color contrast is checked by the dataviz validator, jsdom cannot)', async () => {
  const axe = require('axe-core');
  const { container } = render(<SourcesView businessId="b1" partners={partners} isAdmin={false} />);
  const f = await screen.findByRole('region', { name: 'Funnel' });
  await within(f).findByRole('figure', { name: 'Brad Cillian · Upside funnel' });
  fireEvent.click(within(f).getByTitle('List the 3 visited for Brad Cillian · Upside'));
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  expect(r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 2).join(' | ')}`)).toEqual([]);
});
