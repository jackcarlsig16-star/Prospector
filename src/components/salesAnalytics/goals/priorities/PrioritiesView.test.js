import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PrioritiesView from './PrioritiesView';
import { goalsApi } from '../goalsApi';

// intent-score-v1 Stage 3 - the Priorities view on fixture scores (GET goals/scores mocked): the legend dims and
// keeps colors, the Y switch keeps the selection, unresearched dots are hollow, Upside rows disable the touching
// actions with the reason, the table mirrors the filters + legend, Share saves a view.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
jest.mock('../goalsApi', () => ({ ...jest.requireActual('../goalsApi'), goalsApi: { ...jest.requireActual('../goalsApi').goalsApi,
  scores: jest.fn(), recomputeScores: jest.fn(), brief: jest.fn(), scoreViews: jest.fn(), saveScoreView: jest.fn(), deleteScoreView: jest.fn(), composeStatus: jest.fn(), compose: jest.fn(), composeLint: jest.fn(),
  members: jest.fn(), pipelineBoard: jest.fn(), partnerSignal: jest.fn(), editCompanyFields: jest.fn(), createWeekGoal: jest.fn(), deleteWeekGoal: jest.fn(), setVisitPriority: jest.fn(), runCompanyResearch: jest.fn(), companyDetail: jest.fn(), source: jest.fn(), scoreOf: jest.fn(), sourcesFunnel: jest.fn(),
  scoresCsvUrl: (id, p) => `/api/sales/${id}/goals/scores/export.csv?${new URLSearchParams(Object.entries(p).filter(([, v]) => v != null)).toString()}` } }));
jest.mock('../../pipelineApi', () => ({ fetchOpportunities: jest.fn(), createOpportunity: jest.fn(), updateOpportunity: jest.fn(), archiveOpportunity: jest.fn() }));

const comp = (visits, people, fit, research, engagement) => ({ visits: { points: visits, inputs: {} }, pages: { points: 0, inputs: {} }, apollo_intent: { points: 0, inputs: {} }, people: { points: people, inputs: {} }, fit: { points: fit, inputs: {} }, research: { points: research, inputs: {} }, source: { points: 12, inputs: {} }, engagement: { points: engagement, inputs: {} }, stage: { points: 0, inputs: {} }, recency: { points: 0, inputs: {} } });
const row = (type, id, name, score, band, source, extra = {}) => ({ type, id, key: `${type}-${id}`, name, score, band, source_label: source, source_kind: source, components: comp(17, 6, 15, 10, 0), owner_user_id: 'u1', owner: 'Jack Carlson', owner_team: 'homelover', co_owner_name: null, no_double_touch: false, upside_owned: false, touch_locked: false, closed: false, live: false, duplicate_of: null, stage: 'contacted', employees: 5000, visits_7d: 6, unique_visitors_7d: 3, last_visit: '2026-10-26', people: 2, last_touch_at: '2026-10-25T00:00:00Z', last_touch_who: 'Jack Carlson', last_touch_channel: 'call', days_since_touch: 2, researched: 'fresh', research_at: '2026-10-25T00:00:00Z', prev_score: 50, prev_band: 'P2', trend: 'up', band_changed: true, rank: 1, ...extra });
const ROWS = [
  row('target', 't1', 'Quarry Labs', 72, 'P1', 'website'),
  row('employer', 'e1', 'Hilton Example', 49, 'P2', 'upside', { owner_user_id: null, owner: null, owner_team: 'upside', no_double_touch: true, upside_owned: true, touch_locked: true, rank: 2, band_changed: false, trend: 'flat' }),
  row('partner', 'p1', 'Harbor Lane', 37, 'P3', 'upside', { researched: 'none', components: comp(0, 0, 10, -3, 10), employees: null, rank: 3, days_since_touch: null, last_touch_at: null, band_changed: false }),
];
const DATA = { rows: ROWS, live: [row('partner', 'p2', 'Live Partner', 60, 'P1', 'inbound', { live: true, rank: 0 })], counts: { companies: 4, ranked: 3, shown: 3, live: 1, duplicates: 0, closed: 0, needs_touch: 1, band_changed: 1, P1: 1, P2: 1, P3: 1, P4: 0 },
  sources: { upside: 2, partner_referral: 0, person_referral: 0, campaign: 0, website: 1, inbound: 0, homelover_outreach: 0, scout: 0, other: 0 }, owners: [{ user_id: 'u1', name: 'Jack Carlson' }],
  filters: {}, computed_at: '2026-10-27T18:00:00Z', stale: false, today: '2026-10-27', has_previous: true, thresholds: { P1: 60, P2: 40, P3: 15 }, caps: { visits: 25, pages: 10, apollo_intent: 5, people: 15, fit: 15, research: 10, source: 12, engagement: 10, stage: 10, recency: 10 }, needs_touch_rule: { min: 40, days: 14 }, source_order: ['upside', 'partner_referral', 'person_referral', 'campaign', 'website', 'inbound', 'homelover_outreach', 'scout', 'other'] };
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson', role: 'owner' }, { user_id: 'u2', name: 'Cyrus Test', role: 'member' }];

beforeEach(() => {
  localStorage.clear();
  goalsApi.scores.mockImplementation(async (_id, params = {}) => {
    const rows = ROWS.filter(r => (!params.segment || params.segment === 'all' || (params.segment === 'partners' ? r.type === 'partner' : params.segment === 'employers' ? r.type === 'employer' : params.segment === 'targets' ? r.type === 'target' : true)) && (!params.source || params.source.split(',').includes(r.source_label)));
    return { ...DATA, rows, counts: { ...DATA.counts, shown: rows.length } };
  });
  goalsApi.members.mockResolvedValue(MEMBERS);
  goalsApi.composeStatus.mockResolvedValue({ used: 2, max: 30, cost_estimate_usd: 0.03, research_cost_usd: 0.08, custom_prompt: false });
  goalsApi.scoreViews.mockResolvedValue([]);
  goalsApi.saveScoreView.mockResolvedValue({ view: { id: 'v1', name: 'Brad', filters: {}, y: 'intent', view: 'dots' }, views: [{ id: 'v1', name: 'Brad', filters: { source: ['upside'] }, y: 'intent', view: 'dots' }] });
  goalsApi.pipelineBoard.mockResolvedValue([]);
  goalsApi.brief.mockResolvedValue({ company: { type: 'target', id: 't1', name: 'Quarry Labs' }, score: { score: 72, band: 'P1' }, lines: [{ ref: 'B1', kind: 'company', text: 'Quarry Labs · target' }, { ref: 'B2', kind: 'next', text: 'Suggested next step: Make the first touch' }], markdown: '# Brief: Quarry Labs\n- [B1] Quarry Labs · target', next_step: 'Make the first touch', upside_owned: false, no_double_touch: false });
});
afterEach(() => jest.clearAllMocks());

const dots = () => document.querySelectorAll('[data-dot]');
const dot = name => [...dots()].find(d => d.getAttribute('aria-label').startsWith(name));

test('dots: every ranked company as a dot in its source color; legend toggle dims the others (never removes) and keeps colors; All sources lights them back', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  expect(dot('Quarry Labs').getAttribute('data-source')).toBe('website');
  expect(dot('Quarry Labs').querySelector('[data-core]').getAttribute('fill')).toBe('var(--sa-src-website)');
  expect(dot('Hilton Example').querySelector('[data-core]').getAttribute('fill')).toBe('var(--sa-src-upside)');
  fireEvent.click(screen.getByRole('button', { name: /^Brad \/ Upside/ }));
  await waitFor(() => expect(dot('Quarry Labs').getAttribute('data-dimmed')).toBe('true'));
  expect(dots()).toHaveLength(3);
  expect(dot('Hilton Example').getAttribute('data-dimmed')).toBeNull();
  expect(dot('Quarry Labs').querySelector('[data-core]').getAttribute('fill')).toBe('var(--sa-src-website)');
  expect(document.querySelectorAll('[data-thread="upside"]')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'All sources' }));
  await waitFor(() => expect(dot('Quarry Labs').getAttribute('data-dimmed')).toBeNull());
  expect(document.querySelector('[data-rank-line]')).toBeInTheDocument();
  expect(document.querySelector('[data-band-guide="P1"]').textContent).toBe('P1 · 1');
});

test('hollow when unresearched (no rings), rings + halo on a touched researched dot; the top-5 direct labels; a since-yesterday marker', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  const harbor = dot('Harbor Lane');
  expect(harbor.getAttribute('data-hollow')).toBe('hollow');
  expect(harbor.querySelectorAll('[data-ring]')).toHaveLength(0);
  expect(harbor.querySelector('[data-core]').getAttribute('fill')).toBe('none');
  expect(harbor.getAttribute('data-halo')).toBeNull();
  const quarry = dot('Quarry Labs');
  expect(quarry.getAttribute('data-hollow')).toBe('solid');
  expect([...quarry.querySelectorAll('[data-ring]')].map(r => r.getAttribute('data-ring'))).toEqual(['visits', 'people', 'fit', 'research']);
  expect(quarry.getAttribute('data-halo')).toBe('bright');
  expect(quarry.querySelector('[data-direct-label]').textContent).toBe('72');
  expect(quarry.querySelector('[data-trend]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Since yesterday/ }));
  expect(quarry.querySelector('[data-trend="up"]')).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: /^Brad \/ Upside/ }));
  fireEvent.click(dot('Quarry Labs'));
  expect(dot('Quarry Labs').getAttribute('data-selected')).toBe('true');
  expect(dot('Quarry Labs').getAttribute('aria-pressed')).toBe('true');
  expect(dot('Quarry Labs').querySelector('[data-selection-ring]')).toBeInTheDocument();
  const card = screen.getByRole('group', { name: 'Quarry Labs - selected' });
  expect(card.getAttribute('data-pinned-card')).toBe('target-t1');
  expect(card.getAttribute('data-html2canvas-ignore')).toBe('true');
  const menu = within(card).getByRole('toolbar', { name: 'Actions for Quarry Labs' });
  expect(within(menu).getAllByRole('button').map(b => b.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Brief', 'Write email · ~$0.03 · 2/30 today', 'Research · ~$0.08 per run', 'Assign to · Jack ▾', 'Add task', 'Not a fit', 'Open']);
  expect(goalsApi.pipelineBoard).toHaveBeenCalledWith('b1', true);
  expect(screen.queryByRole('tooltip')).toBeNull();
  await waitFor(() => expect(goalsApi.pipelineBoard).toHaveBeenCalled());
  expect(document.querySelector('[data-company-panel]')).toBeNull();
  fireEvent.click(within(menu).getByRole('button', { name: 'Open' }));
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
  expect(within(menu).getByRole('button', { name: 'Research · cost: n/a yet' })).toBeInTheDocument();
});

test('Upside-owned with no double touch: Assign, Write email and Add task are disabled with the reason; Brief, Research, Not a fit and Open stay', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(dot('Hilton Example'));
  const menu = await screen.findByRole('toolbar', { name: 'Actions for Hilton Example' });
  expect(within(menu).getByText(/Upside · no double touch/)).toBeInTheDocument();
  for (const name of [/Write email/, /Assign to/, 'Add task']) {
    const b = within(menu).getByRole('button', { name });
    expect(b).toBeDisabled();
    expect(b.getAttribute('title')).toMatch(/no double touch - coordinate with Brad/);
  }
  for (const name of ['Brief', /Research/, 'Not a fit', 'Open']) expect(within(menu).getByRole('button', { name })).toBeEnabled();
});

test('quick actions: Brief shows the card with refs + Copy for Claude; Add task prefills the next step; Not a fit writes the record override + recompute with Undo', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
  await waitFor(() => expect(goalsApi.createWeekGoal).toHaveBeenCalled());
  expect(goalsApi.createWeekGoal.mock.calls[0][1]).toMatchObject({ kind: 'todo', text: 'Make the first touch: Quarry Labs', link_type: 'target', link_id: 't1', owner_user_id: 'u1' });
  fireEvent.click(screen.getByRole('button', { name: 'Not a fit' }));
  await waitFor(() => expect(goalsApi.setVisitPriority).toHaveBeenCalledWith('b1', { record: { type: 'target', id: 't1' }, not_a_fit: true }));
  expect(goalsApi.recomputeScores).toHaveBeenCalledWith('b1', { type: 'target', id: 't1' });
  expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
});

test('table mirrors the filters and the legend: the Segment filter re-queries, a lit source narrows the table, Live rows sit in their own group, Change column with Since yesterday', async () => {
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  const table = await screen.findByRole('table');
  expect(within(table).getByRole('columnheader', { name: 'Source' })).toBeInTheDocument();
  expect(within(table).getByText('Live · closed-won or pilot (1)')).toBeInTheDocument();
  expect(within(table).getAllByRole('button', { name: /^(Quarry Labs|Hilton Example|Harbor Lane|Live Partner)$/ })).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: /^Brad \/ Upside/ }));
  await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Quarry Labs')).not.toBeInTheDocument());
  expect(within(screen.getByRole('table')).getByText('Hilton Example')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All sources' }));
  fireEvent.click(screen.getByRole('button', { name: 'Partners' }));
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
  expect(within(menu).getAllByRole('button').map(b => b.textContent)).toEqual(['Brief', 'Open']);
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
    await waitFor(() => expect(screen.getByRole('group', { name: 'Chart view' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Hilton Example')).toBeInTheDocument());
    expect(dots()).toHaveLength(0);
    expect(within(screen.getByRole('group', { name: 'Chart view' })).getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true');
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
  fireEvent.click(within(table).getByRole('button', { name: 'Open Hilton Example' }));
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

test('click outside: an open Assign dropdown closes on the first outside press and the selection stays; the Y switch and Names keep it; a legend pill, a filter and the View switch deselect; the Brief card and the toast keep it', async () => {
  goalsApi.createWeekGoal.mockResolvedValue({ id: 'g1' });
  render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(dot('Quarry Labs'));
  fireEvent.click(screen.getByRole('button', { name: /^Assign to/ }));
  expect(screen.getByRole('menu', { name: 'Assign to' })).toBeInTheDocument();
  press(chartSvg());
  expect(screen.queryByRole('menu', { name: 'Assign to' })).toBeNull();
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
  fireEvent.click(within(selectedCard()).getByRole('button', { name: 'Add task' }));
  const undo = await screen.findByRole('button', { name: 'Undo' });
  press(undo);
  expect(selectedCard()).toHaveAttribute('data-pinned-card', 'target-t1');
  press(screen.getByRole('button', { name: /^Brad \/ Upside/ }));
  expect(selectedCard()).toBeNull();
  fireEvent.click(dot('Quarry Labs'));
  press(screen.getByRole('button', { name: 'Partners' }));
  expect(selectedCard()).toBeNull();
  fireEvent.click(dot('Quarry Labs'));
  press(screen.getByRole('button', { name: 'Bars' }));
  expect(selectedCard()).toBeNull();
});

test('click outside: the table - a press on a cell deselects, the name of another row selects it; no document or window pointerdown listener exists, before or after unmount', async () => {
  const docSpy = jest.spyOn(document, 'addEventListener'), winSpy = jest.spyOn(window, 'addEventListener');
  const { unmount } = render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
  await waitFor(() => expect(dots()).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  const table = await screen.findByRole('table');
  fireEvent.click(within(table).getByRole('button', { name: 'Quarry Labs' }));
  expect(screen.getByRole('toolbar', { name: 'Actions for Quarry Labs' })).toBeInTheDocument();
  press(within(table).getByText('Hilton Example')); fireEvent.click(within(table).getByRole('button', { name: 'Hilton Example' }));
  expect(screen.getByRole('toolbar', { name: 'Actions for Hilton Example' })).toBeInTheDocument();
  press(within(table).getByRole('columnheader', { name: 'Score' }));
  expect(screen.queryByRole('toolbar')).toBeNull();
  expect(within(table).getByRole('button', { name: 'Hilton Example' }).getAttribute('aria-pressed')).toBe('false');
  unmount();
  expect([...docSpy.mock.calls, ...winSpy.mock.calls].map(c => c[0])).not.toContain('pointerdown');
  docSpy.mockRestore(); winSpy.mockRestore();
});

test('click outside on a phone: a tap outside the pinned card closes it; a tap on the card keeps it', async () => {
  const desktop = window.matchMedia;
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    render(<PrioritiesView businessId="b1" canEdit isAdmin meId="u1" />);
    await waitFor(() => expect(screen.getByRole('group', { name: 'Chart view' })).toBeInTheDocument());
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
