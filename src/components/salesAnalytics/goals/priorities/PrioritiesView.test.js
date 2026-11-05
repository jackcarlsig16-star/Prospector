import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PrioritiesView from './PrioritiesView';
import { goalsApi } from '../goalsApi';

// intent-score-v1 Stage 3 - the Priorities view on fixture scores (GET goals/scores mocked): the legend dims and
// keeps colors, the Y switch keeps the selection, unresearched dots are hollow, Upside rows disable the touching
// actions with the reason, the table mirrors the filters + legend, Share saves a view.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
jest.mock('../goalsApi', () => ({ ...jest.requireActual('../goalsApi'), goalsApi: { ...jest.requireActual('../goalsApi').goalsApi,
  scores: jest.fn(), recomputeScores: jest.fn(), brief: jest.fn(), scoreViews: jest.fn(), saveScoreView: jest.fn(), deleteScoreView: jest.fn(), composeStatus: jest.fn(), compose: jest.fn(), composeLint: jest.fn(),
  members: jest.fn(), pipelineBoard: jest.fn(), partnerSignal: jest.fn(), editCompanyFields: jest.fn(), createWeekGoal: jest.fn(), deleteWeekGoal: jest.fn(), setVisitPriority: jest.fn(), runCompanyResearch: jest.fn(), companyDetail: jest.fn(), source: jest.fn(), scoreOf: jest.fn(), sourcesFunnel: jest.fn(), reachAll: jest.fn(), deprioritize: jest.fn(), undoFlow: jest.fn(), bringBack: jest.fn(), fitOf: jest.fn(), reach: jest.fn(), flowEvents: jest.fn(), replySuggestion: jest.fn(), channelLinks: jest.fn(), referredBy: jest.fn(), clientFiles: jest.fn(),
  scoresCsvUrl: (id, p) => `/api/sales/${id}/goals/scores/export.csv?${new URLSearchParams(Object.entries(p).filter(([, v]) => v != null)).toString()}` } }));
jest.mock('../../pipelineApi', () => ({ fetchOpportunities: jest.fn(), createOpportunity: jest.fn(), updateOpportunity: jest.fn(), archiveOpportunity: jest.fn() }));

const comp = (visits, people, fit, research, engagement) => ({ visits: { points: visits, inputs: {} }, pages: { points: 0, inputs: {} }, apollo_intent: { points: 0, inputs: {} }, people: { points: people, inputs: {} }, fit: { points: fit, inputs: {} }, research: { points: research, inputs: {} }, source: { points: 12, inputs: {} }, engagement: { points: engagement, inputs: {} }, stage: { points: 0, inputs: {} }, recency: { points: 0, inputs: {} } });
const row = (type, id, name, score, band, source, extra = {}) => ({ type, id, key: `${type}-${id}`, name, score, band, source_label: source, source_kind: source, components: comp(17, 6, 15, 10, 0), owner_user_id: 'u1', owner: 'Jack Carlson', owner_team: 'homelover', co_owner_name: null, no_double_touch: false, upside_owned: false, touch_locked: false, closed: false, live: false, duplicate_of: null, stage: 'contacted', employees: 5000, visits_7d: 6, unique_visitors_7d: 3, last_visit: '2026-10-26', people: 2, last_touch_at: '2026-10-25T00:00:00Z', last_touch_who: 'Jack Carlson', last_touch_channel: 'call', days_since_touch: 2, researched: 'fresh', research_at: '2026-10-25T00:00:00Z', prev_score: 50, prev_band: 'P2', trend: 'up', band_changed: true, rank: 1, ...extra });
const ROWS = [
  row('target', 't1', 'Quarry Labs', 72, 'P1', 'website', { fit_level: 'good', fit_score: 64, first_seen: '2026-10-27', new_today: true, stage: 'researching' }),
  row('employer', 'e1', 'Hilton Example', 49, 'P2', 'upside', { owner_user_id: null, owner: null, owner_team: 'upside', no_double_touch: true, upside_owned: true, touch_locked: true, rank: 2, band_changed: false, trend: 'flat', fit_level: 'strong', fit_score: 78, stage: 'target' }),
  row('partner', 'p1', 'Harbor Lane', 37, 'P3', 'upside', { researched: 'none', components: comp(0, 0, 10, -3, 10), employees: null, rank: 3, days_since_touch: null, last_touch_at: null, band_changed: false }),
];
const DATA = { rows: ROWS, live: [row('partner', 'p2', 'Live Partner', 60, 'P1', 'inbound', { live: true, rank: 0 })], counts: { companies: 4, ranked: 3, shown: 3, live: 1, duplicates: 0, closed: 0, needs_touch: 1, band_changed: 1, segments: { all: 3, visitors: 2, partners: 1, employers: 1, targets: 1 }, P1: 1, P2: 1, P3: 1, P4: 0, new_today: 1, fit: { strong: 1, good: 1, low: 0, deprioritized: 0 }, due: { today: 0, week: 0, later: 0 } },
  sources: { upside: 2, partner_referral: 0, person_referral: 0, campaign: 0, website: 1, inbound: 0, homelover_outreach: 0, scout: 0, other: 0 }, owners: [{ user_id: 'u1', name: 'Jack Carlson' }],
  filters: {}, computed_at: '2026-10-27T18:00:00Z', stale: false, today: '2026-10-27', has_previous: true, thresholds: { P1: 60, P2: 40, P3: 15 }, caps: { visits: 25, pages: 10, apollo_intent: 5, people: 15, fit: 15, research: 10, source: 12, engagement: 10, stage: 10, recency: 10 }, needs_touch_rule: { min: 40, days: 14 }, source_order: ['upside', 'partner_referral', 'person_referral', 'campaign', 'website', 'inbound', 'homelover_outreach', 'scout', 'other'] };
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson', role: 'owner', color: '#3DBA8C' }, { user_id: 'u2', name: 'Cyrus Test', role: 'member', color: '#D9A441' }];

beforeEach(() => {
  localStorage.clear();
  goalsApi.scores.mockImplementation(async (_id, params = {}) => {
    const rows = ROWS.filter(r => (!params.segment || params.segment === 'all' || (params.segment === 'partners' ? r.type === 'partner' : params.segment === 'employers' ? r.type === 'employer' : params.segment === 'targets' ? r.type === 'target' : true)) && (!params.source || params.source.split(',').includes(r.source_label)));
    return { ...DATA, rows, counts: { ...DATA.counts, shown: rows.length } };
  });
  goalsApi.members.mockResolvedValue(MEMBERS);
  goalsApi.reachAll.mockResolvedValue({ 'target:t1': { known: 11, reached: 3, buyers_reached: 2, buyers_not_yet: 4, replies: 0 } });
  goalsApi.deprioritize.mockResolvedValue({ fit: { word: 'Too small' }, event: { id: 'ev-d' } });
  goalsApi.undoFlow.mockResolvedValue({});
  goalsApi.fitOf.mockResolvedValue(null); goalsApi.reach.mockResolvedValue(null); goalsApi.flowEvents.mockResolvedValue([]); goalsApi.replySuggestion.mockResolvedValue({ suggestion: null }); goalsApi.channelLinks.mockResolvedValue([]); goalsApi.clientFiles.mockResolvedValue([]);
  goalsApi.composeStatus.mockResolvedValue({ used: 2, max: 30, cost_estimate_usd: 0.03, research_cost_usd: 0.08, custom_prompt: false });
  goalsApi.scoreViews.mockResolvedValue([]);
  goalsApi.saveScoreView.mockResolvedValue({ view: { id: 'v1', name: 'Brad', filters: {}, y: 'intent', view: 'dots' }, views: [{ id: 'v1', name: 'Brad', filters: { source: ['upside'] }, y: 'intent', view: 'dots' }] });
  goalsApi.pipelineBoard.mockResolvedValue([]);
  goalsApi.brief.mockResolvedValue({ company: { type: 'target', id: 't1', name: 'Quarry Labs' }, score: { score: 72, band: 'P1' }, lines: [{ ref: 'B1', kind: 'company', text: 'Quarry Labs · target' }, { ref: 'B2', kind: 'next', text: 'Suggested next step: Make the first touch' }], markdown: '# Brief: Quarry Labs\n- [B1] Quarry Labs · target', next_step: 'Make the first touch', upside_owned: false, no_double_touch: false });
});
afterEach(() => jest.clearAllMocks());

const dots = () => document.querySelectorAll('[data-dot]');
const dot = name => [...dots()].find(d => d.getAttribute('aria-label').startsWith(name));

test('dots (homelover-flow-v1 F1 / F5): every ranked company as a dot in its OWNER color (Me, member, Other, dashed Unassigned), a NEW ring on a first-seen-today row, size = intent; the owner legend dims the others (never removes); All owners lights them back', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  expect(dot('Quarry Labs').getAttribute('data-owner')).toBe('me');
  expect(dot('Quarry Labs').querySelector('[data-core]').getAttribute('fill')).toBe('#3DBA8C');
  expect(dot('Quarry Labs').querySelector('[data-new-ring]')).toBeInTheDocument();
  expect(dot('Hilton Example').getAttribute('data-owner')).toBe('other');
  expect(dot('Hilton Example').querySelector('[data-new-ring]')).toBeNull();
  expect(Number(dot('Quarry Labs').querySelector('[data-core]').getAttribute('r'))).toBeGreaterThan(Number(dot('Harbor Lane').querySelector('[data-core]').getAttribute('r')));
  const legend = screen.getByRole('group', { name: 'Owner' });
  expect(within(legend).getAllByRole('button').map(b => b.textContent)).toEqual(['Me2', 'Other1', '+ 2 with 0']);
  expect(screen.getByText('1 NEW today')).toBeInTheDocument();
  fireEvent.click(within(legend).getByRole('button', { name: /^Other/ }));
  await waitFor(() => expect(dot('Quarry Labs').getAttribute('data-dimmed')).toBe('true'));
  expect(dots()).toHaveLength(3);
  expect(dot('Hilton Example').getAttribute('data-dimmed')).toBeNull();
  expect(dot('Quarry Labs').querySelector('[data-core]').getAttribute('fill')).toBe('#3DBA8C');
  expect(document.querySelectorAll('[data-thread="other"]')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'All owners' }));
  await waitFor(() => expect(dot('Quarry Labs').getAttribute('data-dimmed')).toBeNull());
  expect(document.querySelector('[data-rank-line]')).toBeInTheDocument();
  // priorities-v2 G: four band zones from the thresholds - the letter + count on the left, the band word inside
  // (homelover-flow-v1 F2: BAND_WORD - Hot · Warm · Cool · Cold, never time words).
  expect([...document.querySelectorAll('[data-band-zone]')].map(z => z.getAttribute('data-band-zone'))).toEqual(['P1', 'P2', 'P3', 'P4']);
  expect(document.querySelector('[data-band-count="P1"]').textContent).toBe('1');
  // FIX map-fill-space-v1: the Y range fits 37-72 (25-80), so P4 (0-15) sits under the range as an edge label and its guide is gone.
  expect([...document.querySelectorAll('[data-band-word]')].map(w => w.textContent)).toEqual(['Hot', 'Warm', 'Cool']);
  expect(document.querySelector('[data-band-edge="P4"]').textContent).toBe('Cold ↓ <15');
  expect(document.querySelectorAll('[data-band-guide]')).toHaveLength(2);
});

test('hollow when unresearched; rings off by default, Rings draws them on a researched dot; a halo on a touched one; the top direct labels; a since-yesterday marker', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  const harbor = dot('Harbor Lane');
  expect(harbor.getAttribute('data-hollow')).toBe('hollow');
  expect(harbor.querySelectorAll('[data-ring]')).toHaveLength(0);
  expect(harbor.querySelector('[data-core]').getAttribute('fill')).toMatch(/color-mix/); // unresearched = a wash of the owner color, outlined
  expect(harbor.getAttribute('data-halo')).toBeNull();
  const quarry = dot('Quarry Labs');
  expect(quarry.getAttribute('data-hollow')).toBe('solid');
  expect(quarry.querySelectorAll('[data-ring]')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: /^Rings/ }));
  expect([...dot('Quarry Labs').querySelectorAll('[data-ring]')].map(r => r.getAttribute('data-ring'))).toEqual(['visits', 'people', 'fit', 'research']);
  expect(JSON.parse(localStorage.getItem('prospector_priorities_view')).rings).toBe(true);
  expect(quarry.getAttribute('data-halo')).toBe('bright');
  expect(dot('Quarry Labs').querySelector('[data-direct-label]').textContent).toBe('72');
  expect(dot('Quarry Labs').querySelector('[data-trend]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Since yesterday/ }));
  expect(dot('Quarry Labs').querySelector('[data-trend="up"]')).toBeInTheDocument();
});

// FIX priorities-select-vs-open-v1: a click SELECTS (card pinned beside the dot with the quick menu inside, window closed);
// Open in the menu / the name in the card / a double-click / Enter on a selected mark / "o" open the window.
const BOARD = [{ type: 'target', id: 't1', name: 'Quarry Labs', stage: 'proposed', channel: 'website_visit', color: 'light', owner_team: null, owner: null, work: null, visited: null, channels: ['all'] }];
const NO_INTEREST = { items: [], strongest: null, newest_id: null, dismissed: false, show: false };
const DETAIL = { record: { type: 'target', id: 't1', name: 'Quarry Labs', stage: 'proposed' }, todos: [], waiting: [], visits: [], signals: [], recent: [], people: [], research: { runs: [], today: 0, cap: 5 }, decisions: [], terms: [], interest: NO_INTEREST, timeline: [], decision_makers: [] };
const windowMocks = () => { goalsApi.pipelineBoard.mockResolvedValue(BOARD); goalsApi.companyDetail.mockResolvedValue(DETAIL); goalsApi.source.mockResolvedValue(null); goalsApi.scoreOf.mockResolvedValue({ score: 72, band: 'P1', components: {}, source_label: 'website' }); };
test('click selects (ring + the card pinned beside the dot with the quick menu inside; the window stays closed); Open in the menu opens it; the Y switch keeps the selection and the lit set', async () => {
  windowMocks();
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(within(screen.getByRole('group', { name: 'Owner' })).getByRole('button', { name: /^Other/ }));
  fireEvent.click(dot('Quarry Labs'));
  expect(dot('Quarry Labs').getAttribute('data-selected')).toBe('true');
  expect(dot('Quarry Labs').getAttribute('aria-pressed')).toBe('true');
  expect(dot('Quarry Labs').querySelector('[data-selection-ring]')).toBeInTheDocument();
  const card = screen.getByRole('group', { name: 'Quarry Labs - selected' });
  expect(card.getAttribute('data-pinned-card')).toBe('target-t1');
  expect(card.getAttribute('data-html2canvas-ignore')).toBe('true');
  const menu = within(card).getByRole('toolbar', { name: 'Actions for Quarry Labs' });
  // homelover-flow-v1 F5: an owned target - Draft first email leads; Deprioritize…, then Brief / Write email at the end.
  expect(within(menu).getAllByRole('button').map(b => b.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Draft first email', 'Mark contacted', 'Research', 'To-do', 'Open account', '↓ Deprioritize…', 'Brief', 'Write email · ~$0.03 · 2/30 today']);
  expect(menu.getAttribute('data-flow-state')).toBe('target:researching');
  expect(menu.querySelector('[data-menu-summary]').textContent).toMatch(/visits? · \d+ people.*Fit Good 64 · reached 3 of 11$/);
  expect(goalsApi.pipelineBoard).toHaveBeenCalledWith('b1', true);
  expect(screen.queryByRole('tooltip')).toBeNull();
  await waitFor(() => expect(goalsApi.pipelineBoard).toHaveBeenCalled());
  expect(document.querySelector('[data-company-panel]')).toBeNull();
  fireEvent.click(within(menu).getByRole('button', { name: 'Open account' }));
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeTruthy());
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeNull());
  expect(dot('Quarry Labs').getAttribute('data-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Size' }));
  expect(dot('Quarry Labs').getAttribute('data-selected')).toBe('true');
  expect(dot('Quarry Labs').getAttribute('data-dimmed')).toBe('true');
  expect(dot('Harbor Lane').querySelector('[data-core]').getAttribute('stroke-dasharray')).toBe('2 2'); // size unknown on the baseline
  expect(screen.getByRole('group', { name: /Y axis Employees/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
  expect(screen.getByRole('group', { name: /Y axis Days since last touch/ })).toBeInTheDocument();
  expect(dot('Quarry Labs').getAttribute('data-selected')).toBe('true');
});

test('no observed costs yet: Write email shows a dash and Research reads cost: n/a yet (never a constant)', async () => {
  goalsApi.composeStatus.mockResolvedValue({ used: 0, max: 30, cost_estimate_usd: null, research_cost_usd: null, custom_prompt: false });
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(dot('Quarry Labs'));
  const menu = await screen.findByRole('toolbar', { name: 'Actions for Quarry Labs' });
  expect(within(menu).getByRole('button', { name: 'Write email · — · 0/30 today' })).toBeInTheDocument();
  expect(within(menu).getByRole('button', { name: 'Research' })).toBeInTheDocument();
});

test('Upside-owned with no double touch: the touching items (Draft, To-do) and Write email are disabled with the reason, Claim it is hidden; Brief, Research and Open stay', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(dot('Hilton Example'));
  const menu = await screen.findByRole('toolbar', { name: 'Actions for Hilton Example' });
  expect(within(menu).getByText(/Upside · no double touch/)).toBeInTheDocument();
  for (const name of [/Write email/, 'Draft first email', 'To-do']) {
    const b = within(menu).getByRole('button', { name });
    expect(b).toBeDisabled();
    expect(b.getAttribute('title')).toMatch(/no double touch - coordinate with Brad/);
  }
  expect(within(menu).queryByRole('group', { name: 'Claim it' })).toBeNull();
  for (const name of ['Brief', /^Research/, 'Open account']) expect(within(menu).getByRole('button', { name })).toBeEnabled();
});

test('quick actions: Brief shows the card with refs + Copy for Claude; To-do prefills the next step; Deprioritize… opens the reason chips inline and writes with Undo (the flow undo)', async () => {
  goalsApi.createWeekGoal.mockResolvedValue({ id: 'g1' });
  goalsApi.setVisitPriority.mockResolvedValue({});
  goalsApi.recomputeScores.mockResolvedValue({ counts: {} });
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(dot('Quarry Labs'));
  fireEvent.click(await screen.findByRole('button', { name: 'Brief' }));
  const card = await screen.findByRole('region', { name: 'Brief' });
  await within(card).findByText('Quarry Labs · target');
  expect(within(card).getByText('B2')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Copy for Claude' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'To-do' }));
  await waitFor(() => expect(goalsApi.createWeekGoal).toHaveBeenCalled());
  expect(goalsApi.createWeekGoal.mock.calls[0][1]).toMatchObject({ kind: 'todo', text: 'Make the first touch: Quarry Labs', link_type: 'target', link_id: 't1', owner_user_id: 'u1' });
  fireEvent.click(screen.getByRole('button', { name: '↓ Deprioritize…' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Too small' }));
  fireEvent.click(screen.getByRole('button', { name: 'Deprioritize', exact: true }));
  await waitFor(() => expect(goalsApi.deprioritize).toHaveBeenCalledWith('b1', 'target', 't1', { reason: 'too_small', expect: 'researching' }));
  expect(goalsApi.setVisitPriority).not.toHaveBeenCalled();
  const undo = await screen.findByRole('button', { name: 'Undo' });
  fireEvent.click(undo);
  await waitFor(() => expect(goalsApi.undoFlow).toHaveBeenCalledWith('b1', 'ev-d'));
});

test('table mirrors the filters and the legend: the Segment filter re-queries, a lit source narrows the table, Live rows sit in their own group, Change column with Since yesterday', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  const table = await screen.findByRole('table');
  expect(within(table).getByRole('columnheader', { name: 'Source' })).toBeInTheDocument();
  expect(within(table).getByText('Live · closed-won or pilot (1)')).toBeInTheDocument();
  expect(within(table).getAllByRole('button', { name: /^(Quarry Labs|Hilton Example|Harbor Lane|Live Partner)$/ })).toHaveLength(4);
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'upside' } });
  await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Quarry Labs')).not.toBeInTheDocument());
  expect(within(screen.getByRole('table')).getByText('Hilton Example')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: /^Partners/ }));
  await waitFor(() => expect(goalsApi.scores).toHaveBeenLastCalledWith('b1', expect.objectContaining({ segment: 'partners' })));
  await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Quarry Labs')).not.toBeInTheDocument());
  expect(within(screen.getByRole('table')).getByText('Harbor Lane')).toBeInTheDocument();
  expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: 'Change' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Since yesterday/ }));
  expect(within(screen.getByRole('table')).getByRole('columnheader', { name: 'Change' })).toBeInTheDocument();
});

test('Share saves the filter state as a named view and exposes the CSV link; a Viewer sees no Share and no touching buttons', async () => {
  window.open = jest.fn();
  window.html2canvas = jest.fn(async () => ({ toDataURL: () => 'data:image/png;base64,' }));
  HTMLAnchorElement.prototype.click = jest.fn();
  const { unmount } = render(<><div id="sales-frame-tools" /><PrioritiesView businessId="b1" canEdit isAdmin meId="u1" /></>);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: 'Brad' } });
  expect(screen.getByRole('link', { name: 'CSV only' }).getAttribute('href')).toMatch(/goals\/scores\/export\.csv/);
  fireEvent.click(screen.getByRole('button', { name: 'Save view + PNG + CSV' }));
  await waitFor(() => expect(goalsApi.saveScoreView).toHaveBeenCalledWith('b1', expect.objectContaining({ name: 'Brad', y: 'intent', view: 'dots' })));
  await waitFor(() => expect(window.open).toHaveBeenCalled());
  unmount();
  render(<><div id="sales-frame-tools" /><PrioritiesView businessId="b1" canEdit={false} isAdmin={false} meId="u3" /></>);
  await waitFor(() => expect(dots()).toHaveLength(3));
  expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Recompute now' })).not.toBeInTheDocument();
  fireEvent.click(dot('Quarry Labs'));
  const menu = await screen.findByRole('toolbar', { name: 'Actions for Quarry Labs' });
  expect(within(menu).getAllByRole('button').map(b => b.textContent)).toEqual(['Open account', 'Brief']);
});

// FIX priorities-labels-v1 - names without hovering.
const nameLabels = () => [...document.querySelectorAll('[data-name-label]')].map(t => t.textContent);

test('names: P1, P2 and the top 10 carry their name beside the dot by default; Off keeps only the selected; All names everyone and counts; the choice persists', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  expect(nameLabels().sort()).toEqual(['Harbor Lane', 'Hilton Example', 'Quarry Labs']);
  const label = document.querySelector('[data-name-label="target-t1"]');
  expect(label.getAttribute('fill')).toBe('var(--sa-text)');
  expect(document.querySelector('[data-names-count]')).toBeNull();
  const names = screen.getByRole('group', { name: 'Names' });
  fireEvent.click(within(names).getByRole('button', { name: 'Off' }));
  expect(nameLabels()).toEqual([]);
  fireEvent.click(dot('Hilton Example'));
  await waitFor(() => expect(nameLabels()).toEqual(['Hilton Example']));
  expect(JSON.parse(localStorage.getItem('prospector_priorities_view')).names).toBe('off');
  fireEvent.click(within(names).getByRole('button', { name: 'All' }));
  expect(nameLabels().sort()).toEqual(['Harbor Lane', 'Hilton Example', 'Quarry Labs']);
  expect(document.querySelector('[data-names-count]').textContent).toBe('3 of 3 named - see Table for all');
  expect(nameLabels()[0]).toBe('Hilton Example'); // the selected row is placed first
  expect(JSON.parse(localStorage.getItem('prospector_priorities_view')).names).toBe('all');
});

test('bars: the same name rule replaces the top-5 score labels (above the thin bars; inside only when the name fits)', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: 'Bars' }));
  await waitFor(() => expect(document.querySelectorAll('[data-bar]')).toHaveLength(3));
  expect(nameLabels().sort()).toEqual(['Harbor Lane', 'Hilton Example', 'Quarry Labs']);
  expect(document.querySelector('[data-bars-chart] [data-direct-label]')).toBeNull();
  expect(document.querySelectorAll('[data-label-inside]').length).toBe(3); // 3 bars across 960 px: wide enough to hold the names
  fireEvent.click(within(screen.getByRole('group', { name: 'Names' })).getByRole('button', { name: 'Off' }));
  expect(nameLabels()).toEqual([]);
});

test('phone: the table lands first; Dots names only P1 + the selected; a tap selects and keeps the breakdown card open', async () => {
  const desktop = window.matchMedia;
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
    await waitFor(() => expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Hilton Example')).toBeInTheDocument());
    expect(dots()).toHaveLength(0);
    expect(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Dots' }));
    await waitFor(() => expect(dots()).toHaveLength(3));
    expect(nameLabels()).toEqual(['Quarry Labs']);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(dot('Harbor Lane'));
    await waitFor(() => expect(nameLabels()).toEqual(['Harbor Lane', 'Quarry Labs']));
    const card = screen.getByRole('group', { name: 'Harbor Lane - selected' });
    expect(card).toHaveTextContent('Not researched yet');
    expect(within(card).getByRole('toolbar', { name: 'Actions for Harbor Lane' })).toBeInTheDocument();
    expect(document.querySelector('[data-company-panel]')).toBeNull();
  } finally { window.matchMedia = desktop; }
});

test('select vs open: a second click deselects (card gone); Esc deselects; the name in the card, a double-click, Enter on a selected dot and "o" open the window; the hover tooltip is suppressed while a card is pinned; a dot near the right edge gets its card on the left; the bar card sits above', async () => {
  windowMocks();
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(dot('Quarry Labs'));
  expect(screen.getByRole('group', { name: 'Quarry Labs - selected' }).getAttribute('data-card-side')).toBe('right');
  fireEvent.click(dot('Quarry Labs'));
  expect(screen.queryByRole('group', { name: /selected$/ })).toBeNull();
  expect(dot('Quarry Labs').getAttribute('data-selected')).toBeNull();
  fireEvent.click(dot('Harbor Lane'));
  expect(screen.getByRole('group', { name: 'Harbor Lane - selected' }).getAttribute('data-card-side')).toBe('left');
  fireEvent.mouseEnter(dot('Quarry Labs'));
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('group', { name: /selected$/ })).toBeNull();
  fireEvent.mouseEnter(dot('Quarry Labs'));
  expect(screen.getByRole('tooltip')).toHaveTextContent('Quarry Labs');
  fireEvent.mouseLeave(dot('Quarry Labs'));
  fireEvent.click(dot('Quarry Labs'));
  fireEvent.click(within(screen.getByRole('group', { name: 'Quarry Labs - selected' })).getByRole('button', { name: 'Quarry Labs' }));
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeTruthy());
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeNull());
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('group', { name: /selected$/ })).toBeNull();
  fireEvent.doubleClick(dot('Quarry Labs'));
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeTruthy());
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeNull());
  fireEvent.keyDown(dot('Quarry Labs'), { key: 'Enter' });
  expect(dot('Quarry Labs').getAttribute('data-selected')).toBe('true');
  expect(document.querySelector('[data-company-panel]')).toBeNull();
  fireEvent.keyDown(dot('Quarry Labs'), { key: 'Enter' });
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeTruthy());
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeNull());
  fireEvent.keyDown(dot('Harbor Lane'), { key: 'o' });
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeNull()); // Harbor Lane is not on the board fixture - the note shows instead
  expect(screen.getByText(/not on the Pipeline board any more/)).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' }); // Quarry Labs was still selected from the Enter sequence - a bar click would toggle it off
  expect(screen.queryByRole('group', { name: /selected$/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bars' }));
  await waitFor(() => expect(document.querySelectorAll('[data-bar]')).toHaveLength(3));
  fireEvent.click(document.querySelector('[data-bar="target-t1"]'));
  const bcard = screen.getByRole('group', { name: 'Quarry Labs - selected' });
  expect(bcard.getAttribute('data-card-side')).toBe('above');
  expect(bcard.style.transform).toBe('translateY(-100%)');
  expect(within(bcard).getByRole('toolbar', { name: 'Actions for Quarry Labs' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  const table = await screen.findByRole('table');
  fireEvent.click(within(table).getByRole('button', { name: 'Hilton Example' })); // priorities-v2 T: the Company name opens
  await waitFor(() => expect(screen.getByText(/not on the Pipeline board any more/)).toBeInTheDocument());
});

// FIX priorities-click-outside-v1 - a press anywhere else in the view deselects (pointerdown + pointerup on the view
// root, never a document listener); the card / menu / marks / Y / Names keep it; an open Assign dropdown closes first.
const press = el => { fireEvent.pointerDown(el); fireEvent.pointerUp(el); };
const chartSvg = () => document.querySelector('[data-dots-chart] svg');
const selectedCard = () => screen.queryByRole('group', { name: /selected$/ });

test('click outside: a press on empty chart space deselects (card gone, aria-pressed false); a press on another dot swaps the selection; inside the card keeps it; a cancelled press (touch scroll) keeps it', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(dot('Quarry Labs'));
  expect(selectedCard()).toHaveAttribute('data-pinned-card', 'target-t1');
  press(within(selectedCard()).getByText(/Intent 72/));
  expect(selectedCard()).toHaveAttribute('data-pinned-card', 'target-t1');
  fireEvent.pointerDown(chartSvg()); fireEvent.pointerCancel(chartSvg());
  expect(selectedCard()).toHaveAttribute('data-pinned-card', 'target-t1');
  press(chartSvg());
  expect(selectedCard()).toBeNull();
  expect(dot('Quarry Labs').getAttribute('aria-pressed')).toBe('false');
  expect(dot('Quarry Labs').getAttribute('data-selected')).toBeNull();
  fireEvent.click(dot('Quarry Labs'));
  fireEvent.pointerDown(dot('Harbor Lane')); fireEvent.pointerUp(dot('Harbor Lane')); fireEvent.click(dot('Harbor Lane'));
  expect(selectedCard()).toHaveAttribute('data-pinned-card', 'partner-p1');
  expect(dot('Quarry Labs').getAttribute('data-selected')).toBeNull();
  expect(dot('Harbor Lane').getAttribute('data-selected')).toBe('true');
});

test('click outside: an open Deprioritize sheet closes on the first outside press and the selection stays; the Y switch and Names keep it; a legend pill, a filter and the View switch deselect; the Brief card and the toast keep it', async () => {
  goalsApi.createWeekGoal.mockResolvedValue({ id: 'g1' });
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(dot('Quarry Labs'));
  fireEvent.click(screen.getByRole('button', { name: '↓ Deprioritize…' }));
  expect(screen.getByRole('group', { name: 'Deprioritize' })).toBeInTheDocument();
  press(chartSvg());
  expect(screen.queryByRole('group', { name: 'Deprioritize' })).toBeNull();
  expect(selectedCard()).toHaveAttribute('data-pinned-card', 'target-t1');
  press(screen.getByRole('button', { name: 'Size' })); fireEvent.click(screen.getByRole('button', { name: 'Size' }));
  expect(selectedCard()).toHaveAttribute('data-pinned-card', 'target-t1');
  const names = screen.getByRole('group', { name: 'Names' });
  press(within(names).getByRole('button', { name: 'All' })); fireEvent.click(within(names).getByRole('button', { name: 'All' }));
  expect(selectedCard()).toHaveAttribute('data-pinned-card', 'target-t1');
  fireEvent.click(within(selectedCard()).getByRole('button', { name: 'Brief' }));
  const brief = await screen.findByRole('region', { name: 'Brief' });
  press(within(brief).getByText(/Suggested next step/));
  expect(selectedCard()).toHaveAttribute('data-pinned-card', 'target-t1');
  fireEvent.click(within(selectedCard()).getByRole('button', { name: 'To-do' }));
  const undo = await screen.findByRole('button', { name: 'Undo' });
  press(undo);
  expect(selectedCard()).toHaveAttribute('data-pinned-card', 'target-t1');
  press(within(screen.getByRole('group', { name: 'Owner' })).getByRole('button', { name: /^Other/ }));
  expect(selectedCard()).toBeNull();
  fireEvent.click(dot('Quarry Labs'));
  press(screen.getByRole('button', { name: /^Partners/ }));
  expect(selectedCard()).toBeNull();
  fireEvent.click(dot('Quarry Labs'));
  press(screen.getByRole('button', { name: 'Bars' }));
  expect(selectedCard()).toBeNull();
});

test('the table (priorities-v2 T): a press on a row selects it, another row swaps; the Company name opens the window; no document or window pointerdown listener exists, before or after unmount', async () => {
  windowMocks();
  const docSpy = jest.spyOn(document, 'addEventListener'), winSpy = jest.spyOn(window, 'addEventListener');
  const { unmount } = render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  const table = await screen.findByRole('table');
  const rowOf = name => within(table).getByRole('button', { name }).closest('tr');
  press(rowOf('Quarry Labs').querySelector('td:last-child')); fireEvent.click(rowOf('Quarry Labs').querySelector('td:last-child'));
  expect(screen.getByRole('toolbar', { name: 'Actions for Quarry Labs' })).toBeInTheDocument();
  fireEvent.click(rowOf('Hilton Example').querySelector('td:first-child'));
  expect(screen.getByRole('toolbar', { name: 'Actions for Hilton Example' })).toBeInTheDocument();
  expect(document.querySelector('[data-company-panel]')).toBeNull();
  fireEvent.click(within(table).getByRole('button', { name: 'Quarry Labs' }));
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeTruthy());
  unmount();
  expect([...docSpy.mock.calls, ...winSpy.mock.calls].map(c => c[0])).not.toContain('pointerdown');
  docSpy.mockRestore(); winSpy.mockRestore();
});

test('click outside on a phone: a tap outside the pinned card closes it; a tap on the card keeps it', async () => {
  const desktop = window.matchMedia;
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
    await waitFor(() => expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Dots' }));
    await waitFor(() => expect(dots()).toHaveLength(3));
    fireEvent.click(dot('Harbor Lane'));
    expect(selectedCard()).toHaveAttribute('data-pinned-card', 'partner-p1');
    press(within(selectedCard()).getByText('Not researched yet'));
    expect(selectedCard()).toHaveAttribute('data-pinned-card', 'partner-p1');
    press(chartSvg());
    expect(selectedCard()).toBeNull();
    expect(dot('Harbor Lane').getAttribute('aria-pressed')).toBe('false');
  } finally { window.matchMedia = desktop; }
});

test('brad-attribution-v1 F5: the funnel is read once, when a pointer first reaches the chart; the selected card shows the chain as stage icons + dates, the full journey on hover', async () => {
  windowMocks();
  goalsApi.sourcesFunnel.mockResolvedValue({ companies: [{ type: 'target', id: 't1', referred: '2026-10-22', visited: '2026-10-24', replied: null, meeting: null, pilot: null, lost: null, journey: 'Referred by Brad (Upside) Oct 22 → Visited Oct 24 → Replied — → Meeting — → Pilot —' }] });
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  expect(goalsApi.sourcesFunnel).not.toHaveBeenCalled();
  const box = document.querySelector('[data-chart-box]');
  fireEvent.pointerEnter(box);
  fireEvent.pointerEnter(box);
  await waitFor(() => expect(goalsApi.sourcesFunnel).toHaveBeenCalledTimes(1));
  fireEvent.click(dot('Quarry Labs'));
  const chain = await waitFor(() => { const c = screen.getByRole('group', { name: 'Quarry Labs - selected' }).querySelector('[data-card-chain]'); expect(c).toBeTruthy(); return c; });
  expect(chain).toHaveTextContent('↪ Oct 22 · ◎ Oct 24');
  expect(chain.getAttribute('title')).toMatch(/^Referred by Brad \(Upside\) Oct 22 → Visited Oct 24/);
  fireEvent.click(dot('Hilton Example'));
  expect(screen.getByRole('group', { name: 'Hilton Example - selected' }).querySelector('[data-card-chain]')).toBeNull();
});

// priorities-v2 Stage 2 - the three control families, the chart heights, the detail table under the chart.
test('filter card: type chips carry counts.segments and filter; labeled selects; the active-filter line removes one filter or clears all', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  const type = screen.getByRole('group', { name: 'Type' });
  expect(within(type).getAllByRole('button').map(b => b.textContent)).toEqual(['All3', 'Web visitors2', 'Partners1', 'Employers1', 'Targets1']);
  expect(document.querySelector('[data-active-filters]')).toBeNull();
  fireEvent.click(within(type).getByRole('button', { name: /^Partners/ }));
  await waitFor(() => expect(goalsApi.scores).toHaveBeenLastCalledWith('b1', expect.objectContaining({ segment: 'partners' })));
  fireEvent.change(screen.getByLabelText('Band'), { target: { value: 'P3' } });
  const line = await waitFor(() => { const l = document.querySelector('[data-active-filters]'); expect(l).toBeTruthy(); return l; });
  expect(line).toHaveTextContent(/Showing 1 of 3 ·/);
  expect(within(line).getAllByRole('button').map(b => b.getAttribute('aria-label') || b.textContent)).toEqual(['Remove filter Type: Partners', 'Remove filter Band: P3', 'Clear all']);
  fireEvent.click(within(line).getByRole('button', { name: 'Remove filter Band: P3' }));
  await waitFor(() => expect(goalsApi.scores).toHaveBeenLastCalledWith('b1', { segment: 'partners', owner: null, source: null, band: null, needs_touch: null, min: null, window: null, q: null, fit: 'strong,good', due: null }));
  // homelover-flow-v1 F4 / F5: Fit chips (Strong + Good pressed by default, Deprioritized off) and the Due select.
  const fitChips = within(screen.getByRole('group', { name: 'Fit' })).getAllByRole('button');
  expect(fitChips.map(b => [b.textContent.replace(/\d+$/, ''), b.getAttribute('aria-pressed')])).toEqual([['Strong', 'true'], ['Good', 'true'], ['Low', 'false'], ['Deprioritized', 'false']]);
  fireEvent.click(fitChips[3]);
  await waitFor(() => expect(goalsApi.scores).toHaveBeenLastCalledWith('b1', expect.objectContaining({ fit: 'strong,good,deprioritized' })));
  expect(document.querySelector('[data-active-filters]')).toHaveTextContent(/Fit: Strong \+ Good \+ Deprioritized/);
  fireEvent.change(screen.getByLabelText('Due'), { target: { value: 'today' } });
  await waitFor(() => expect(goalsApi.scores).toHaveBeenLastCalledWith('b1', expect.objectContaining({ due: 'today' })));
  fireEvent.click(within(document.querySelector('[data-active-filters]')).getByRole('button', { name: 'Clear all' }));
  await waitFor(() => expect(document.querySelector('[data-active-filters]')).toBeNull());
  expect(within(type).getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true');
});

test('FIX map-fill-space-v1: the width observer attaches to the chart box once it mounts (after the data), the SVG viewBox follows the measured width with the 56 / 36 px gutters; the Y range toggle swaps fitted ticks for 0-100, the edge label for a band outside the range, and persists per viewer', async () => {
  const observed = [];
  const RO = jest.fn(cb => ({ observe: el => { observed.push(el); cb([{ contentRect: { width: 1200 } }]); }, disconnect: jest.fn() }));
  window.ResizeObserver = RO;
  try {
    render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
    await waitFor(() => expect(dots()).toHaveLength(3));
    expect(observed).toHaveLength(1);
    expect(observed[0].hasAttribute('data-chart-box')).toBe(true);
    await waitFor(() => expect(chartSvg().getAttribute('viewBox')).toBe('0 0 1200 560'));
    const zone = document.querySelector('[data-band-zone="P2"] rect');
    expect([zone.getAttribute('x'), zone.getAttribute('width')]).toEqual(['56', String(1200 - 56 - 36)]);
    const ticks = () => [...document.querySelectorAll('[data-y-tick]')].map(t => t.textContent);
    expect(ticks()).toEqual(['25', '30', '40', '50', '60', '70', '80']); // scores 37-72 -> 25-80
    expect(chartSvg().getAttribute('aria-label')).toContain('Intent (25-80 of 0-100, fitted to the data)');
    expect(document.querySelector('[data-band-edge]').textContent).toBe('Cold ↓ <15'); // P4 = 0-15 sits under the range
    const range = within(screen.getByRole('group', { name: 'Chart controls' })).getByRole('group', { name: 'Y range' });
    expect(within(range).getByRole('button', { name: 'Fit to data' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(range).getByRole('button', { name: '0–100' }));
    expect(ticks()).toEqual(['0', '25', '50', '75', '100']);
    expect(document.querySelector('[data-band-edge]')).toBeNull();
    expect(JSON.parse(localStorage.getItem('prospector_priorities_view')).yfit).toBe(false);
    fireEvent.click(within(range).getByRole('button', { name: 'Fit to data' }));
    expect(ticks()[0]).toBe('25');
    expect(JSON.parse(localStorage.getItem('prospector_priorities_view')).yfit).toBe(true);
    fireEvent.click(within(screen.getByRole('group', { name: 'Y axis' })).getByRole('button', { name: 'Size' }));
    expect(screen.queryByRole('group', { name: 'Y range' })).toBeNull();
  } finally { delete window.ResizeObserver; }
});

test('chart toolbar: View + Y as icon and word, "Ranked by intent", the Top stepper, height presets (persisted, the chart grows), band chips filter', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  const bar = screen.getByRole('group', { name: 'Chart controls' });
  expect(within(within(bar).getByRole('group', { name: 'View' })).getByRole('button', { name: 'Dots' }).querySelector('svg')).toBeTruthy();
  expect(within(bar).getByText('Ranked by intent')).toBeInTheDocument();
  expect(chartSvg().getAttribute('height')).toBe('560');
  fireEvent.click(within(bar).getByRole('button', { name: 'Tall, 800px' }));
  expect(chartSvg().getAttribute('height')).toBe('800');
  expect(JSON.parse(localStorage.getItem('prospector_priorities_view')).height).toBe('tall');
  fireEvent.click(within(bar).getByRole('button', { name: 'Compact, 360px' }));
  expect(chartSvg().getAttribute('height')).toBe('360');
  expect(document.querySelector('[data-top-n]').textContent).toBe('40');
  fireEvent.click(within(bar).getByRole('button', { name: 'Fewer' }));
  expect(document.querySelector('[data-top-n]').textContent).toBe('20');
  fireEvent.click(within(bar).getByRole('button', { name: 'More' })); fireEvent.click(within(bar).getByRole('button', { name: 'More' }));
  expect(document.querySelector('[data-top-n]').textContent).toBe('All');
  expect(within(bar).getByRole('button', { name: 'More' })).toBeDisabled();
  fireEvent.click(document.querySelector('[data-band-chip="P2"]'));
  await waitFor(() => expect(goalsApi.scores).toHaveBeenLastCalledWith('b1', expect.objectContaining({ band: 'P2' })));
  expect(document.querySelector('[data-band-chip="P2"]').getAttribute('aria-pressed')).toBe('true');
});

test('legend: owners with 0 fold into one dashed chip that expands (Me · members · Other · Unassigned)', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  expect([...document.querySelectorAll('[data-legend-source]')].map(b => b.getAttribute('data-legend-source'))).toEqual(['me', 'other']);
  const more = document.querySelector('[data-zero-sources]');
  expect(more).toHaveTextContent('+ 2 with 0');
  fireEvent.click(more);
  expect([...document.querySelectorAll('[data-legend-source]')].map(b => b.getAttribute('data-legend-source'))).toEqual(['me', 'u2', 'other', 'unassigned']);
});

test('detail table under the chart: # · Company · Source · Seen · Owner · Fit · Reached · Intent · … · Band (newest first by default); sort by a header; a row selects the dot and a dot highlights its row; the name opens; Show 11-40', async () => {
  windowMocks();
  const many = Array.from({ length: 14 }, (_, i) => row('employer', `x${i}`, `Zz Co ${String(i).padStart(2, '0')}`, 30 - i, 'P3', 'website', { rank: 4 + i }));
  goalsApi.scores.mockResolvedValue({ ...DATA, rows: [...ROWS, ...many], counts: { ...DATA.counts, ranked: 17, shown: 17 } });
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(17));
  const card = screen.getByRole('region', { name: 'Detail' });
  expect(card).toHaveTextContent('Top 40 · detail');
  expect(card).toHaveTextContent('Click a dot or a row — they select together');
  const table = within(card).getByRole('table');
  expect(within(table).getAllByRole('columnheader').map(h => h.textContent.replace(/[▲▼↕\s]+$/, '').trim())).toEqual(['#', 'Company', 'Source', 'Seen', 'Owner', 'Fit', 'Reached', 'Intent', 'Visits', 'People', 'Size pts', 'Research', 'Engagement', 'Touched', 'Band']);
  const names = () => [...table.querySelectorAll('[data-row-name]')].map(b => b.textContent);
  expect(names()).toHaveLength(10 + 1); // the first 10 ranked + the Live row
  expect(names().slice(0, 3)).toEqual(['Quarry Labs', 'Hilton Example', 'Harbor Lane']);
  const quarry = within(table).getByRole('button', { name: 'Quarry Labs' }).closest('tr');
  expect(quarry.textContent).toContain('15/15');
  expect(quarry.querySelector('[data-new-badge]')).toBeTruthy();
  expect(quarry.querySelector('[data-fit-cell="good"]').textContent).toBe('Good 64');
  expect(quarry.querySelector('[data-reached-cell]').textContent).toBe('3/11');
  expect(quarry.querySelector('[data-owner-cell="member"]').textContent).toBe('Me');
  expect(quarry.querySelector('[data-band-pill="P1"]')).toBeTruthy();
  fireEvent.click(within(card).getByRole('button', { name: 'Show 11–17 ▾' }));
  expect(names()).toHaveLength(17 + 1);
  fireEvent.click(within(table).getByRole('button', { name: /^Company/ }));
  expect(names()[0]).toBe('Harbor Lane');
  fireEvent.click(quarry.querySelector('td:last-child'));
  expect(dot('Quarry Labs').getAttribute('data-selected')).toBe('true');
  expect(screen.getByRole('group', { name: 'Quarry Labs - selected' })).toBeInTheDocument();
  fireEvent.click(dot('Hilton Example'));
  const hilton = within(table).getByRole('button', { name: 'Hilton Example' }).closest('tr');
  expect(hilton.getAttribute('style')).toMatch(/--ui-row-bar/);
  expect(quarry.getAttribute('style')).not.toMatch(/--ui-row-bar/);
  fireEvent.click(within(table).getByRole('button', { name: 'Quarry Labs' }));
  await waitFor(() => expect(document.querySelector('[data-company-panel]')).toBeTruthy());
});

test('a dot selected below the first 10 opens the rest of the detail table', async () => {
  const many = Array.from({ length: 14 }, (_, i) => row('employer', `x${i}`, `Zz Co ${String(i).padStart(2, '0')}`, 30 - i, 'P3', 'website', { rank: 4 + i }));
  goalsApi.scores.mockResolvedValue({ ...DATA, rows: [...ROWS, ...many], counts: { ...DATA.counts, ranked: 17, shown: 17 } });
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(17));
  const table = within(screen.getByRole('region', { name: 'Detail' })).getByRole('table');
  expect(within(table).queryByRole('button', { name: 'Zz Co 13' })).toBeNull();
  fireEvent.click(dot('Zz Co 13'));
  await waitFor(() => expect(within(table).getByRole('button', { name: 'Zz Co 13' })).toBeInTheDocument());
});

test('the frame line: "recomputed n ago" in minutes, hours, then days', () => {
  const { agoText } = require('./PrioritiesView');
  const now = Date.parse('2026-10-28T12:00:00Z');
  expect([agoText('2026-10-28T11:55:00Z', now), agoText('2026-10-28T10:00:00Z', now), agoText('2026-10-25T12:00:00Z', now), agoText(null, now)]).toEqual(['5 min ago', '2 h ago', '3 d ago', 'never']);
});

test('axe (jsdom, contrast checked by the dataviz validator): the filter card, chart card and detail table have 0 violations; so does Table view', async () => {
  const axe = require('axe-core');
  const { container } = render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(dot('Quarry Labs'));
  const run = async () => (await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 2).join(' | ')}`);
  expect(await run()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  await screen.findByRole('table');
  expect(await run()).toEqual([]);
});
