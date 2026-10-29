import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import PipelineView from './PipelineView';
import { goalsApi } from './goalsApi';
import { fetchOpportunities, createOpportunity, updateOpportunity } from '../pipelineApi';
import { OPEN_TASKS } from './goalsApi';

// pipeline-board-v1 Stage 2 - Goals > Pipeline; pipeline-wide-table-v1 Stage 2 - the board is a DataTable.
// jsdom has no matchMedia; PipelineView reads it for its phone list.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || jest.fn();
jest.mock('./goalsApi', () => ({ ...jest.requireActual('./goalsApi'), goalsApi: { ...jest.requireActual('./goalsApi').goalsApi, pipelineBoard: jest.fn(), partnerSignal: jest.fn(), partnerUndo: jest.fn(), updatePartner: jest.fn(), setVisitPriority: jest.fn(),
  members: jest.fn(), companyDetail: jest.fn(), addCompanyNote: jest.fn(), addToPipeline: jest.fn(), runCompanyResearch: jest.fn(), createWeekGoal: jest.fn(), deleteWeekGoal: jest.fn(), updateTarget: jest.fn(), copyBundle: jest.fn(), checkCompanyApollo: jest.fn(), addCompanyContact: jest.fn(), rejectTarget: jest.fn(), promoteTarget: jest.fn(), bookMeeting: jest.fn(), markContacted: jest.fn(), notNow: jest.fn(), updateWeekGoal: jest.fn(),
  addPerson: jest.fn(), createTarget: jest.fn(), createPartner: jest.fn(), partnerDupeCheck: jest.fn(), people: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ fetchOpportunities: jest.fn(), createOpportunity: jest.fn(), updateOpportunity: jest.fn(), archiveOpportunity: jest.fn() }));

const CHANNELS = { partner: ['all', 'partners'], employer: ['all'], target: ['all', 'targets'], apollo: ['apollo'], visitor: ['website'] };
const row = (id, type, color, extra = {}) => ({
  type, id, name: id, stage: 's', stage_label: 'Stage', color, owner_team: null, owner: null, tier: null,
  next_step: null, next_step_due: null, last_touch_at: null, top: false, record_id: null,
  channel: 'unknown', priority: null, priority_set_by: null, priority_set_at: null, covered_lives: null, visited: null, work: null, channels: CHANNELS[type], ...extra,
});
const ROWS = [
  row('Gallagher', 'partner', 'yellow', { top: true, owner_team: 'homelover', owner: 'Jack', tier: '1', stage: 'replied', stage_label: 'Replied', category: '4. Mid-Market Benefits Brokers', next_step: 'Send the one-pager' }),
  row('Solidcore', 'employer', 'yellow', { owner_team: 'upside', stage: 'target', stage_label: 'Target', next_step: 'Call', next_step_due: '2026-10-20' }),
  row('OneDigital', 'partner', 'blue', { owner_team: 'upside', tier: '2', stage: 'not_started', stage_label: 'Not started' }),
  row('New Target', 'target', 'light'),
  row('Old Union', 'employer', 'faded'),
];
const APOLLO = row('Fresh Co', 'apollo', 'gray', { last_touch_at: '2026-10-07T15:00:00Z' });

const VISITOR = row('Acme Visit', 'visitor', 'light', { channel: 'website_visit', stage: 'visited', stage_label: 'Website visit', priority: 1, visited: { last_visit: '2026-10-20', visits_7d: 6, pulled_on: '2026-10-20', priority: 1 } });
// sales-ia-v2 P4 - GET goals/company for the panel body (the header comes from the row).
const NO_INTEREST = { items: [], strongest: null, newest_id: null, dismissed: false, show: false };
const DETAIL = { todos: [{ id: 't1', text: 'Send the deck', owner: 'Jack Carlson', owner_user_id: 'u1', due_date: '2026-10-22' }], waiting: [], visits: [], signals: [],
  recent: [{ id: 'e1', event: 'note', at: '2026-10-15T10:00:00Z', note: 'Newest note' }], people: [], research: { runs: [], today: 0, cap: 5 }, decisions: [], terms: [],
  interest: NO_INTEREST, timeline: [], decision_makers: [] };
// company-panel-v2 L3 - a fresh click on Gallagher: the band, the People pill and the timeline row.
const CLICK = { id: 'ev-click', kind: 'click', count: 1, step: 1, at: '2026-10-19T12:00:00Z', person: { contact_id: 'c-pat', name: 'Pat Lee' }, text: 'Pat Lee clicked Step 1' };
const INTEREST_DETAIL = { ...DETAIL, interest: { items: [CLICK], strongest: CLICK, newest_id: 'ev-click', dismissed: false, show: true },
  timeline: [{ id: 'ev-click', kind: 'clicked', at: '2026-10-19T12:00:00Z', step: 1, person: CLICK.person, count: null, text: 'Pat Lee clicked Step 1' }],
  people: [{ id: 'p:c-pat', contact_id: 'c-pat', name: 'Pat Lee', title: 'VP', linkedin_url: null, source: 'apollo', status: 'new', signal: { kind: 'click', count: 1, step: 1, at: '2026-10-19T12:00:00Z', text: 'clicked Step 1' } }] };
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson', role: 'owner' }, { user_id: 'u2', name: 'Cyrus Test', role: 'member' }];

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  window.confirm = jest.fn(() => true);
  goalsApi.pipelineBoard.mockImplementation(() => Promise.resolve([...ROWS, APOLLO]));
  goalsApi.partnerSignal.mockResolvedValue({ event: { id: 'ev1' } });
  goalsApi.partnerUndo.mockResolvedValue({});
  goalsApi.updatePartner.mockResolvedValue({});
  goalsApi.members.mockResolvedValue(MEMBERS);
  goalsApi.companyDetail.mockImplementation((b, type, id) => Promise.resolve({ ...DETAIL, record: { type, id, name: id, stage: 's', next_step: type === 'partner' || type === 'employer' ? [...ROWS, APOLLO, VISITOR].find(r => r.id === id)?.next_step ?? null : undefined } }));
  goalsApi.addCompanyNote.mockResolvedValue({});
  goalsApi.createWeekGoal.mockResolvedValue({ id: 'wg1', owner_user_id: 'u2' });
  goalsApi.deleteWeekGoal.mockResolvedValue({});
  goalsApi.addToPipeline.mockResolvedValue({ created: { type: 'target', id: 't9', name: 'Acme Visit' } });
  goalsApi.runCompanyResearch.mockResolvedValue({ run: { status: 'running' } });
  updateOpportunity.mockResolvedValue({});
  fetchOpportunities.mockResolvedValue([{ id: 'Solidcore', organization: 'Solidcore', org_type: 'employer', stage: 'meeting' }]);
});
// sales-ia-v2: the screen's buttons portal into the frame row's tools slot.
// companies-v2 C4: most fixtures have no priority, so every group starts open unless a test asks for the defaults.
const setup = (extra = {}, { defaultGroups = false } = {}) => {
  if (!defaultGroups && localStorage.getItem('prospector_pipeline_groups') == null) localStorage.setItem('prospector_pipeline_groups', '[]');
  const props = { businessId: 'b1', canEdit: true, onOpenPartner: jest.fn(), onOpenCompanies: jest.fn(), ...extra };
  if (!document.getElementById('sales-frame-tools')) { const slot = document.createElement('div'); slot.id = 'sales-frame-tools'; document.body.appendChild(slot); }
  render(<PipelineView {...props} />);
  return props;
};
const channelBtn = name => within(screen.getByRole('group', { name: 'Channel' })).getByRole('button', { name: new RegExp(`^${name}`) });
// The rows of one group: everything after its header row up to the next header row.
const section = name => {
  let tr = screen.getByRole('heading', { name: new RegExp(`^${name}`) }).closest('tr').nextElementSibling;
  const box = document.createElement('div');
  while (tr && !tr.classList.contains('ui-table__group')) { box.appendChild(tr.cloneNode(true)); tr = tr.nextElementSibling; }
  return box;
};

// companies-v2 C4 - grouped by priority: "P1 · Act today n" headers in the pill hue, then No priority; empty groups drop out.
const PRIO_ROWS = [
  row('Hot Co', 'employer', 'green', { priority: 1 }), row('Warm Co', 'partner', 'yellow', { priority: 2 }), row('Warm Two', 'employer', 'blue', { priority: 2 }),
  row('Watch Co', 'employer', 'gray', { priority: 3 }), row('Noise Co', 'partner', 'faded', { priority: 4 }), row('Blank Co', 'employer', 'light'),
];
test('groups and counts come from the rows: P1-P4 in order, then No priority; words from PRIORITY_WORD in the pill hue; the row bar stays the stage band', async () => {
  goalsApi.pipelineBoard.mockResolvedValue(PRIO_ROWS);
  setup();
  await screen.findByText('Hot Co');
  const heads = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent.trim());
  expect(heads).toEqual(['P1 · Act today 1', 'P2 · This week 2', 'P3 · Watch 1', 'P4 · Noise 1', 'No priority 1']);
  expect(within(section('P2 · This week')).getByText('Warm Two')).toBeTruthy();
  expect(within(section('No priority')).getByText('Blank Co')).toBeTruthy();
  const word = screen.getByText('P1 · Act today', { selector: '.ui-table__gword' });
  expect(word).toHaveClass('ui-table__gword');
  expect(word.style.getPropertyValue('--gword-color')).toBe('var(--sa-prio-p1)');
  expect(screen.getByText('Hot Co').closest('tr').style.getPropertyValue('--ui-row-bar')).toBe('var(--sa-good)');
  expect(channelBtn('All').textContent).toBe('All6');
  cleanup();
  goalsApi.pipelineBoard.mockResolvedValue(PRIO_ROWS.slice(0, 3));
  setup();
  await screen.findByText('Hot Co');
  expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent.trim())).toEqual(['P1 · Act today 1', 'P2 · This week 2']);
});

test('P3, P4 and No priority start collapsed, P1 / P2 open; a toggle is remembered under prospector_pipeline_groups', async () => {
  goalsApi.pipelineBoard.mockResolvedValue(PRIO_ROWS);
  setup({}, { defaultGroups: true });
  await screen.findByText('Hot Co');
  const table = () => within(screen.getByRole('table'));
  const toggle = name => table().getByRole('button', { name: new RegExp(`^${name}`) });
  expect(toggle('P1 · Act today')).toHaveAttribute('aria-expanded', 'true');
  expect(toggle('P2 · This week')).toHaveAttribute('aria-expanded', 'true');
  expect(toggle('P3 · Watch')).toHaveAttribute('aria-expanded', 'false');
  expect(toggle('P4 · Noise')).toHaveAttribute('aria-expanded', 'false');
  expect(toggle('No priority')).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Watch Co')).toBeNull();
  expect(screen.queryByText('Blank Co')).toBeNull();
  fireEvent.click(toggle('P3 · Watch'));
  expect(screen.getByText('Watch Co')).toBeTruthy();
  fireEvent.click(toggle('P1 · Act today'));
  expect(screen.queryByText('Hot Co')).toBeNull();
  expect(JSON.parse(localStorage.getItem('prospector_pipeline_groups'))).toEqual(['p4', 'none', 'p1']);
  cleanup();
  setup({}, { defaultGroups: true });
  await screen.findByText('Watch Co');
  expect(screen.queryByText('Hot Co')).toBeNull();
  expect(toggle('P1 · Act today')).toHaveAttribute('aria-expanded', 'false');
  localStorage.setItem('prospector_pipeline_groups', '{bad json');
  cleanup();
  setup({}, { defaultGroups: true });
  await screen.findByText('Hot Co');
  expect(screen.queryByText('Watch Co')).toBeNull();
});

test('one filter row: type, team, owner, search; the channel counts follow the filters; Clear resets all', async () => {
  setup();
  await screen.findByText('Solidcore');
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'partner' } });
  expect(screen.queryByText('Solidcore')).toBeNull();
  expect(screen.getByText('OneDigital')).toBeTruthy();
  expect(channelBtn('All').textContent).toBe('All2');
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'upside' } });
  expect(screen.queryByText('Gallagher')).toBeNull();
  expect(screen.getByText('Solidcore')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Jack' } });
  expect(screen.queryByText('Solidcore')).toBeNull();
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Search companies'), { target: { value: 'one' } });
  expect(screen.getByText('OneDigital')).toBeTruthy();
  expect(screen.queryByText('Solidcore')).toBeNull();
  fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'Not started' } });
  expect(screen.getByText('OneDigital')).toBeTruthy();
  // companies-v2 C3: the active-filter line's Clear all resets every filter and the line leaves.
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  expect(screen.getByText('Solidcore')).toBeTruthy();
  expect(screen.getByLabelText('Search companies').value).toBe('');
  expect(document.querySelector('[data-active-filters]')).toBeNull();
});

test('active-filter line: only while something narrows the set; "Showing n of N · sorted by …"; each chip removes its one filter; Clear all', async () => {
  setup();
  await screen.findByText('Solidcore');
  expect(document.querySelector('[data-active-filters]')).toBeNull();
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Jack' } });
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'homelover' } });
  fireEvent.click(screen.getByRole('button', { name: 'Visited 7 d' }));
  fireEvent.click(screen.getByRole('button', { name: 'Visited 7 d' }));
  fireEvent.click(screen.getByRole('button', { name: 'Has open to-do' }));
  const line = () => within(document.querySelector('[data-active-filters]'));
  expect(document.querySelector('[data-active-filters]').textContent).toMatch(/^Showing 0 of 5 · sorted by priority ·/);
  expect(screen.getByLabelText('Owner').closest('.ui-filter--pill')).toHaveAttribute('data-active');
  expect(screen.getByLabelText('Stage').closest('.ui-filter--pill')).not.toHaveAttribute('data-active');
  fireEvent.click(line().getByRole('button', { name: 'Remove filter Has open to-do' }));
  expect(screen.getByRole('button', { name: 'Has open to-do' })).toHaveAttribute('aria-pressed', 'false');
  expect(document.querySelector('[data-active-filters]').textContent).toMatch(/^Showing 1 of 5 ·/);
  fireEvent.click(line().getByRole('button', { name: 'Remove filter Owner: Jack' }));
  expect(screen.getByLabelText('Owner').value).toBe('');
  expect(screen.getByLabelText('Team').value).toBe('homelover');
  expect(line().getAllByRole('button').map(b => b.textContent)).toEqual(['Team: HomeLover×', 'Clear all']);
  fireEvent.click(screen.getByRole('button', { name: /^Last touch/ }));
  expect(document.querySelector('[data-active-filters]').textContent).toMatch(/sorted by Last touch ·/);
  fireEvent.click(line().getByRole('button', { name: 'Clear all' }));
  expect(document.querySelector('[data-active-filters]')).toBeNull();
  expect(screen.getByLabelText('Team').value).toBe('');
  expect(screen.getByText('OneDigital')).toBeTruthy();
});

test('CHANNEL_ICON: a glyph on every channel chip and in the Channel cell (glyph + word); a channel with 0 is dashed and last', async () => {
  goalsApi.pipelineBoard.mockResolvedValue([...ROWS.slice(0, 2).map(r => ({ ...r, channel: 'website_visit' })), APOLLO]);
  setup();
  await screen.findByText('Solidcore');
  const chips = within(screen.getByRole('group', { name: 'Channel' })).getAllByRole('button');
  expect(chips.every(b => b.querySelector('svg'))).toBe(true);
  expect(chips.map(b => b.dataset.channel)).toEqual(['all', 'apollo', 'partners', 'website', 'scout', 'call_notes', 'targets']);
  expect(chips.filter(b => b.classList.contains('ui-chip--empty')).map(b => b.dataset.channel)).toEqual(['website', 'scout', 'call_notes', 'targets']);
  expect(within(screen.getByRole('group', { name: 'Filters' })).getAllByRole('button').map(b => [b.textContent, !!b.querySelector('svg')])).toEqual([['Visited 7 d', true], ['Has open to-do', true], ['Overdue', true]]);
  const cell = screen.getByText('Solidcore').closest('tr').querySelector('[data-channel-cell]');
  expect(cell.dataset.channelCell).toBe('website_visit');
  expect(cell.querySelector('svg')).toBeTruthy();
  expect(cell.textContent).toBe('Website visit');
});

test('channel buttons: All = records; Apollo outbound shows the Apollo-only company; ?channel= opens on that channel', async () => {
  setup();
  await screen.findByText('Solidcore');
  expect(goalsApi.pipelineBoard).toHaveBeenCalledWith('b1', true);
  expect(screen.queryByText('Fresh Co')).toBeNull();
  expect(channelBtn('All')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(channelBtn('Apollo outbound'));
  expect(await screen.findByText('Fresh Co')).toBeTruthy();
  expect(screen.queryByText('Solidcore')).toBeNull();
  expect(window.location.search).toContain('channel=apollo');
  fireEvent.click(channelBtn('All'));
  expect(window.location.search).not.toContain('channel=');
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/?tab=pipeline&channel=website_visit');
  goalsApi.pipelineBoard.mockResolvedValue([...ROWS, row('Acme Widgets', 'visitor', 'light', { priority: 1 })]);
  setup();
  expect(await screen.findByText('Acme Widgets')).toBeTruthy();
  expect(channelBtn('Website visitors')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Visitor report' })).toBeTruthy();
  window.history.replaceState(null, '', '/');
});

test('one line per company: aligned cells, record id on hover, sort by Due inside a band', async () => {
  goalsApi.pipelineBoard.mockResolvedValue([
    row('Beta Co', 'employer', 'yellow', { next_step_due: '2026-10-22', record_id: 'R-2', next_step: 'Send deck' }),
    row('Alpha Co', 'employer', 'yellow', { next_step_due: '2026-10-20', record_id: 'R-1' }),
    row('Gamma Co', 'partner', 'yellow'),
  ]);
  setup();
  await screen.findByText('Beta Co');
  const cells = tr => [...tr.querySelectorAll('td')].map(td => td.textContent);
  const beta = screen.getByText('Beta Co').closest('tr');
  expect(cells(beta).length).toBe(19); // company-workflow-v1: + Employees, Reach, Clients
  expect([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(i => cells(beta)[i])).toEqual(['☆', 'Beta Co', 'Employer', '—', 'Stage', '—', '—', '—', 'Send deck', 'Oct 22', '—', '—', '—', '—', '—']);
  expect(within(beta).getByLabelText('Priority for Beta Co').value).toBe('');
  expect(beta.querySelector('td.ui-table__sticky').title).toBe('Beta Co · R-2');
  expect(screen.getByRole('columnheader', { name: /^Company/ })).toHaveAttribute('aria-sort', 'none');
  const order = () => [...document.querySelectorAll('tr[data-row] td.ui-table__sticky')].map(td => td.textContent);
  expect(order()).toEqual(['Beta Co', 'Alpha Co', 'Gamma Co']);
  fireEvent.click(screen.getByRole('button', { name: /^Due/ }));
  expect(order()).toEqual(['Alpha Co', 'Beta Co', 'Gamma Co']);
  expect(screen.getByRole('columnheader', { name: /^Due/ })).toHaveAttribute('aria-sort', 'ascending');
  fireEvent.click(screen.getByRole('button', { name: /^Due/ }));
  expect(order()).toEqual(['Beta Co', 'Alpha Co', 'Gamma Co']);
  fireEvent.click(screen.getByRole('button', { name: /^Due/ }));
  expect(order()).toEqual(['Beta Co', 'Alpha Co', 'Gamma Co']);
  expect(screen.getByText('Beta Co').closest('tr').style.getPropertyValue('--ui-row-bar')).toBe('var(--sa-warn)');
});

test('★ a partner goes through the hot signal, an employer through is_top; the star fills', async () => {
  setup();
  await screen.findByText('Solidcore');
  fireEvent.click(screen.getByRole('button', { name: 'Star OneDigital' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'OneDigital', { type: 'hot', hot: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Star Solidcore' }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'Solidcore', { is_top: true }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Unstar Solidcore' })).toHaveAttribute('aria-pressed', 'true'));
  fireEvent.click(screen.getByRole('button', { name: 'Unstar Gallagher' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'Gallagher', { type: 'hot', hot: false }));
});

test('soft cap: starring a 26th asks to unstar one first and writes nothing', async () => {
  const full = Array.from({ length: 25 }, (_, i) => row(`P${i}`, 'partner', 'gray', { top: true }));
  goalsApi.pipelineBoard.mockResolvedValue([...full, row('Extra', 'partner', 'gray')]);
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Star Extra' }));
  expect((await screen.findByRole('status')).textContent).toMatch(/Top is full \(25\): unstar one first/);
  expect(goalsApi.partnerSignal).not.toHaveBeenCalled();
});

test('click-through: every row but a signal opens the company panel; Open full card goes to the record (partner card, Tasks, Companies week, employer panel)', async () => {
  const props = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'OneDigital' }));
  const panel = screen.getByRole('dialog', { name: 'OneDigital' });
  expect(panel.querySelector('[data-company-panel="partner"]')).toBeTruthy();
  expect(props.onOpenPartner).not.toHaveBeenCalled();
  expect(goalsApi.companyDetail).toHaveBeenCalledWith('b1', 'partner', 'OneDigital');
  fireEvent.click(screen.getByRole('button', { name: 'Open full card →' }));
  expect(props.onOpenPartner).toHaveBeenCalledWith('OneDigital', 'OneDigital');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New Target' }));
  expect(screen.getByRole('dialog', { name: 'New Target' }).querySelector('[data-company-panel="target"]')).toBeTruthy();
  const seen = [];
  const listen = e => seen.push(e.detail);
  window.addEventListener(OPEN_TASKS, listen);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Tasks →' }));
  window.removeEventListener(OPEN_TASKS, listen);
  expect(seen).toEqual([{ link: { type: 'target', id: 'New Target' }, filter: 'team' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Solidcore' }));
  expect(screen.getByRole('dialog', { name: 'Solidcore' }).querySelector('[data-company-panel="employer"]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open full card →' }));
  expect(await screen.findByText('Edit opportunity')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(channelBtn('Apollo outbound'));
  fireEvent.click(await screen.findByRole('button', { name: 'Fresh Co' }));
  expect(screen.getByRole('dialog', { name: 'Fresh Co' }).querySelector('[data-company-panel="apollo"]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open in Companies →' }));
  expect(props.onOpenCompanies).toHaveBeenCalledWith('2026-10-05');
});

// FIX pipeline-quick-fixes-v1 A - the one primary "+ Add ▾" opens a menu; Employer = the existing panel.
const openAdd = item => { fireEvent.click(screen.getByRole('button', { name: '+ Add ▾' })); fireEvent.click(within(screen.getByRole('menu', { name: 'Add' })).getByRole('menuitem', { name: item })); };
test('+ Add ▾ › Employer opens a blank panel; save creates through the route and reloads; a reuse says so', async () => {
  setup();
  await screen.findByText('Solidcore');
  createOpportunity.mockResolvedValueOnce({ opportunity: { id: 'n1', organization: 'Zeta Labs' } });
  openAdd('Employer');
  expect(screen.getByText('Add opportunity')).toBeTruthy();
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Zeta Labs' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(createOpportunity).toHaveBeenCalledWith('b1', expect.objectContaining({ organization: 'Zeta Labs' })));
  await waitFor(() => expect(screen.queryByText('Add opportunity')).toBeNull());
  expect(goalsApi.pipelineBoard).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('status')).toBeNull();

  createOpportunity.mockResolvedValueOnce({ opportunity: { id: 'Solidcore', organization: 'Solidcore' }, reused: true });
  openAdd('Employer');
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'solidcore inc' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('status')).textContent).toBe('Solidcore is already in the pipeline - no new row added.');
});

test('page actions: TABLE (Columns · People search) · SHEET (Export · Update, full old text as name + title) · + Add; a Viewer gets no SHEET and no + Add', async () => {
  setup();
  await screen.findByText('Solidcore');
  const bar = document.querySelector('#sales-frame-tools [data-page-actions]');
  expect([...bar.querySelectorAll('[data-action-group]')].map(g => g.dataset.actionGroup)).toEqual(['table', 'sheet', 'add']);
  const table = within(screen.getByRole('group', { name: 'Table' }));
  expect(table.getAllByRole('button').map(b => b.textContent)).toEqual(['Columns', 'People search']);
  const sheet = within(screen.getByRole('group', { name: 'Sheet' }));
  expect(sheet.getAllByRole('button').map(b => b.textContent)).toEqual(['Export', 'Update']);
  expect(sheet.getByRole('button', { name: 'Export joint sheet' }).title).toMatch(/^Export joint sheet/);
  expect(sheet.getByRole('button', { name: 'Update from sheet' }).title).toMatch(/^Update from sheet/);
  expect(bar.querySelectorAll('.ui-actions__word').length).toBe(2);
  expect(within(bar).getByRole('button', { name: '+ Add ▾' })).toBeTruthy();
  cleanup();
  document.body.innerHTML = '';
  setup({ canEdit: false });
  await screen.findByText('Solidcore');
  expect([...document.querySelectorAll('[data-action-group]')].map(g => g.dataset.actionGroup)).toEqual(['table']);
  expect(screen.queryByRole('button', { name: '+ Add ▾' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Update from sheet' })).toBeNull();
  expect(screen.queryByLabelText('Priority for Solidcore')).toBeNull();
});

test('priority cell: the same select drawn as an outline pill in the level\'s hue, with a caret', async () => {
  goalsApi.pipelineBoard.mockResolvedValue([row('Hot Co', 'employer', 'green', { priority: 1 }), row('Blank Co', 'employer', 'light')]);
  setup();
  const hot = await screen.findByLabelText('Priority for Hot Co');
  expect(hot).toHaveClass('ui-pill-select');
  expect(hot.style.getPropertyValue('--pill-color')).toBe('var(--sa-prio-p1)');
  expect(hot.nextElementSibling).toHaveClass('ui-pill-select__caret');
  expect(hot.selectedOptions[0].textContent).toBe('P1 · Act today');
  expect(screen.getByLabelText('Priority for Blank Co').style.getPropertyValue('--pill-color')).toBe('');
});

test('Viewer: stars are read-only; employer and partner open the read-only panel (no action bar, no ★ / note / Next)', async () => {
  const props = setup({ canEdit: false });
  await screen.findByText('Solidcore');
  expect(screen.queryByRole('button', { name: /^(Un)?[Ss]tar / })).toBeNull();
  expect(screen.getByLabelText('Top')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '+ Add ▾' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Export joint sheet' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Update from sheet' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Solidcore' }));
  const opp = within(await screen.findByRole('dialog', { name: 'Solidcore' }));
  expect(opp.queryByRole('region', { name: 'Actions' })).toBeNull();
  expect(opp.queryByRole('textbox')).toBeNull();
  expect(opp.getByText('You have view access, so this is read-only.')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Gallagher' }));
  const panel = within(screen.getByRole('dialog', { name: 'Gallagher' }));
  expect(await panel.findByText('Send the one-pager')).toBeTruthy();
  expect(panel.queryByRole('textbox')).toBeNull();
  expect(panel.queryByRole('button', { name: /Top|Add note|^Next:|Research|Check Apollo/ })).toBeNull();
  expect(panel.getByRole('button', { name: 'Open full card →' })).toBeTruthy();
  expect(props.onOpenPartner).not.toHaveBeenCalled();
});

// company-panel-v3 - a fact's shown value; the ⋯ menu.
const factText = (name, label) => screen.getByRole('dialog', { name }).querySelector(`[data-fact="${label}"] b`)?.textContent ?? null;
const openMore = (panel, item) => { fireEvent.click(panel.getByRole('button', { name: 'More' })); fireEvent.click(panel.getByRole('menuitem', { name: item })); };

test('panel: header chips; body from GET goals/company; Add note goes through the company note route; ★ through the hot signal; Add to-do links the record with owner + due and offers Undo', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Gallagher' }));
  const panel = within(screen.getByRole('dialog', { name: 'Gallagher' }));
  expect(panel.getByText('Brokers & PEOs')).toHaveAttribute('data-type-chip', 'brokers');
  expect(factText('Gallagher', 'Stage')).toBe('Replied');
  expect(factText('Gallagher', 'Owner')).toBe('Jack');
  expect(await panel.findByText('Send the deck')).toBeTruthy();
  expect(panel.getByText('Note: Newest note')).toBeTruthy();
  expect(panel.getByText('Send the one-pager')).toBeTruthy();
  fireEvent.click(panel.getByRole('button', { name: 'Note' }));
  fireEvent.change(panel.getByLabelText('Note'), { target: { value: 'Called, left voicemail' } });
  fireEvent.click(panel.getByRole('button', { name: 'Save note' }));
  await waitFor(() => expect(goalsApi.addCompanyNote).toHaveBeenCalledWith('b1', 'partner', 'Gallagher', 'Called, left voicemail'));
  await waitFor(() => expect(panel.queryByLabelText('Note')).toBeNull());
  expect(goalsApi.companyDetail).toHaveBeenCalledTimes(2);
  expect(panel.getByRole('button', { name: 'Top' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(panel.getByRole('button', { name: 'Top' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'Gallagher', { type: 'hot', hot: false }));
  await waitFor(() => expect(panel.getByRole('button', { name: 'Top' })).toHaveAttribute('aria-pressed', 'false'));
  fireEvent.click(panel.getByRole('button', { name: 'To-do' }));
  fireEvent.change(panel.getByLabelText('To-do'), { target: { value: 'Call Pat about the pilot' } });
  fireEvent.change(panel.getByLabelText('To-do owner'), { target: { value: 'u2' } });
  fireEvent.change(panel.getByLabelText('To-do due date'), { target: { value: '2026-10-23' } });
  fireEvent.click(panel.getByRole('button', { name: 'Save to-do' }));
  await waitFor(() => expect(goalsApi.createWeekGoal).toHaveBeenCalledWith('b1', { week_start: '2026-10-19', kind: 'todo', text: 'Call Pat about the pilot', owner_user_id: 'u2', due_date: '2026-10-23', link_type: 'partner', link_id: 'Gallagher' }));
  const status = (await screen.findAllByRole('status')).find(el => el.textContent.includes('To-do added for Cyrus'));
  fireEvent.click(within(status).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.deleteWeekGoal).toHaveBeenCalledWith('b1', 'wg1'));
});

test('visitor row: Research first asks to add the company as a target, adds it, then researches the new target; a No writes nothing', async () => {
  goalsApi.pipelineBoard.mockImplementation(() => Promise.resolve([...ROWS, APOLLO, VISITOR]));
  setup();
  await screen.findByText('Solidcore');
  fireEvent.click(channelBtn('Website visitors'));
  fireEvent.click(await screen.findByRole('button', { name: 'Acme Visit' }));
  const panel = within(screen.getByRole('dialog', { name: 'Acme Visit' }));
  expect(panel.getByRole('button', { name: 'Add to pipeline ▾' })).toBeTruthy();
  window.confirm.mockReturnValueOnce(false);
  fireEvent.click(panel.getByRole('button', { name: 'Research' }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('Add Acme Visit to Pipeline as a target?'));
  expect(goalsApi.addToPipeline).not.toHaveBeenCalled();
  fireEvent.click(panel.getByRole('button', { name: 'Research' }));
  await waitFor(() => expect(goalsApi.addToPipeline).toHaveBeenCalledWith('b1', { type: 'visitor', id: 'Acme Visit', to: 'target' }));
  await waitFor(() => expect(goalsApi.runCompanyResearch).toHaveBeenCalledWith('b1', 'target', 't9'));
  expect(goalsApi.pipelineBoard.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test('stage: Next sends the status signal with expect and moves the row (Undo = partner undo); Jump back confirms and sends allow_backward; Esc / backdrop close and flash the row', async () => {
  // The first load is the fixture; every reload after the move returns the moved row, as the server would.
  goalsApi.pipelineBoard.mockResolvedValueOnce([...ROWS, APOLLO]).mockResolvedValue([...ROWS.map(r => (r.id === 'OneDigital' ? { ...r, stage: 'researching', stage_label: 'Researching' } : r)), APOLLO]);
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'OneDigital' }));
  const panel = within(screen.getByRole('dialog', { name: 'OneDigital' }));
  fireEvent.click(panel.getByRole('button', { name: 'Next: Start research' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'OneDigital', { type: 'status', to: 'researching', expect: 'not_started' }));
  await waitFor(() => expect(panel.getByRole('button', { name: 'Next: Mark drafted' })).toBeTruthy());
  const tr = screen.getByText('OneDigital', { selector: 'td button' }).closest('tr');
  expect([...tr.querySelectorAll('td')].map(td => td.textContent)).toContain('Researching');
  const status = (await screen.findAllByRole('status')).find(el => el.textContent.includes('OneDigital: Researching'));
  fireEvent.click(within(status).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.partnerUndo).toHaveBeenCalledWith('b1', 'OneDigital', 'ev1'));
  openMore(panel, 'Jump to stage…');
  const jump = within(panel.getByRole('group', { name: 'Jump to stage' }));
  expect(jump.getByRole('button', { name: 'Researching · now' })).toBeDisabled();
  window.confirm.mockReturnValueOnce(false);
  fireEvent.click(jump.getByRole('button', { name: '↩ Not started' }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('Move OneDigital back from Researching to Not started?'));
  expect(goalsApi.partnerSignal).toHaveBeenCalledTimes(1);
  fireEvent.click(jump.getByRole('button', { name: '↩ Not started' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'OneDigital', { type: 'status', to: 'not_started', expect: 'researching', allow_backward: true }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(tr.style.getPropertyValue('--ui-row-tint')).toContain('--sa-accent');
  fireEvent.click(screen.getByRole('button', { name: 'OneDigital' }));
  fireEvent.click(screen.getByTestId('side-panel-backdrop'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('employer: Next moves the stage through PATCH; Jump back confirms and sends allow_backward; Priority ▾ Not a fit writes P4 + a note and Undo restores', async () => {
  goalsApi.pipelineBoard.mockResolvedValueOnce([...ROWS, APOLLO]).mockResolvedValue([...ROWS.map(r => (r.id === 'Solidcore' ? { ...r, stage: 'contacted', stage_label: 'Contacted' } : r)), APOLLO]);
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Solidcore' }));
  const panel = within(screen.getByRole('dialog', { name: 'Solidcore' }));
  fireEvent.click(panel.getByRole('button', { name: 'Next: Contacted' }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'Solidcore', { stage: 'contacted' }));
  openMore(panel, 'Jump to stage…');
  fireEvent.click(within(panel.getByRole('group', { name: 'Jump to stage' })).getByRole('button', { name: '↩ Target' }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'Solidcore', { stage: 'target', allow_backward: true }));
  fireEvent.click(panel.getByRole('button', { name: /^Priority/ }));
  fireEvent.change(panel.getByRole('combobox', { name: 'Priority' }), { target: { value: 'not_a_fit' } });
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'Solidcore', expect.objectContaining({ priority: 4, notes: expect.stringMatching(/Not a fit \(set to P4 from Pipeline\)/) })));
  const status = (await screen.findAllByRole('status')).find(el => el.textContent.includes('Solidcore: Not a fit'));
  fireEvent.click(within(status).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'Solidcore', { priority: null }));
});

test('Export joint sheet fetches the .xlsx for the current filters and saves it; a refusal shows', async () => {
  const blob = new Blob(['x']);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob), headers: { get: () => 'attachment; filename="joint-pipeline-2026-10-15.xlsx"' } });
  URL.createObjectURL = jest.fn(() => 'blob:x');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  setup();
  await screen.findByText('Solidcore');
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'upside' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'partner' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export joint sheet' }));
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(global.fetch).toHaveBeenCalledWith('/api/sales/b1/goals/pipeline-board/export?type=partner&owner_team=upside');
  expect(click.mock.instances[0].download).toBe('joint-pipeline-2026-10-15.xlsx');
  global.fetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Export is for members only' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Export joint sheet' }));
  expect(await screen.findByText('Export is for members only')).toBeTruthy();
  click.mockRestore();
});

// pipeline-quick-panel-v1 Stage 2 - Next step and Due typed straight into the table.
const td = (name, col) => screen.getByText(name, { selector: 'td button' }).closest('tr').querySelectorAll('td')[col];
const NEXT = 9, DUE = 10;

test('Next step cell on a partner row: click -> input prefilled; Enter saves through updatePartner once and updates the row; the click never opens the panel', async () => {
  setup();
  await screen.findByText('Solidcore');
  fireEvent.click(within(td('Gallagher', NEXT)).getByRole('button'));
  expect(screen.queryByRole('dialog')).toBeNull();
  const input = screen.getByRole('textbox', { name: 'Next step for Gallagher' });
  expect(input.value).toBe('Send the one-pager');
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: '  Book the pilot call ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.blur(input);
  await waitFor(() => expect(goalsApi.updatePartner).toHaveBeenCalledWith('b1', 'Gallagher', { next_step: 'Book the pilot call' }));
  expect(goalsApi.updatePartner).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(td('Gallagher', NEXT).textContent).toBe('Book the pilot call'));
  expect(screen.queryByRole('textbox', { name: 'Next step for Gallagher' })).toBeNull();
  expect(goalsApi.pipelineBoard).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('status')).toBeNull();
});

test('Esc cancels with no call and the old text; unchanged blur writes nothing; an employer Next step goes through next_action', async () => {
  setup();
  await screen.findByText('Solidcore');
  fireEvent.click(within(td('Gallagher', NEXT)).getByRole('button'));
  const input = screen.getByRole('textbox', { name: 'Next step for Gallagher' });
  fireEvent.change(input, { target: { value: 'Something else' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Next step for Gallagher' })).toBeNull();
  expect(td('Gallagher', NEXT).textContent).toBe('Send the one-pager');
  expect(goalsApi.updatePartner).not.toHaveBeenCalled();
  fireEvent.click(within(td('Gallagher', NEXT)).getByRole('button'));
  fireEvent.blur(screen.getByRole('textbox', { name: 'Next step for Gallagher' }));
  expect(goalsApi.updatePartner).not.toHaveBeenCalled();
  fireEvent.click(within(td('Solidcore', NEXT)).getByRole('button'));
  expect(fetchOpportunities).not.toHaveBeenCalled();
  const emp = screen.getByRole('textbox', { name: 'Next step for Solidcore' });
  fireEvent.change(emp, { target: { value: 'Send the deck' } });
  fireEvent.blur(emp);
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'Solidcore', { next_action: 'Send the deck' }));
  await waitFor(() => expect(td('Solidcore', NEXT).textContent).toBe('Send the deck'));
});

test('employer Due: a date input; a change saves next_action_date; clearing saves null; Tab from Next step opens Due', async () => {
  setup();
  await screen.findByText('Solidcore');
  expect(td('Solidcore', DUE).textContent).toBe('Oct 20');
  fireEvent.click(within(td('Solidcore', DUE)).getByRole('button'));
  const date = screen.getByLabelText('Due for Solidcore');
  expect(date.type).toBe('date');
  expect(date.value).toBe('2026-10-20');
  fireEvent.change(date, { target: { value: '2026-10-27' } });
  fireEvent.keyDown(date, { key: 'Enter' });
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'Solidcore', { next_action_date: '2026-10-27' }));
  await waitFor(() => expect(td('Solidcore', DUE).textContent).toBe('Oct 27'));
  fireEvent.click(within(td('Solidcore', DUE)).getByRole('button'));
  const again = screen.getByLabelText('Due for Solidcore');
  fireEvent.change(again, { target: { value: '' } });
  fireEvent.blur(again);
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'Solidcore', { next_action_date: null }));
  await waitFor(() => expect(td('Solidcore', DUE).textContent).toBe('—'));
  fireEvent.click(within(td('Solidcore', NEXT)).getByRole('button'));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Next step for Solidcore' }), { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByLabelText('Due for Solidcore'));
  expect(updateOpportunity).toHaveBeenCalledTimes(2);
});

test('partner Due is read-only (a dash until a next meeting is set); target and Apollo cells are text; a Viewer gets no editors', async () => {
  setup();
  await screen.findByText('Solidcore');
  const due = td('Gallagher', DUE);
  expect(due.textContent).toBe('—');
  expect(due.title).toBe('No next meeting set');
  expect(due.querySelector('button')).toBeNull();
  expect(td('Solidcore', DUE).title).toBe('2026-10-20');
  expect(td('New Target', NEXT).querySelector('button')).toBeNull();
  expect(td('New Target', DUE).querySelector('button')).toBeNull();
  fireEvent.click(channelBtn('Apollo outbound'));
  await screen.findByText('Fresh Co');
  expect(td('Fresh Co', NEXT).querySelector('button')).toBeNull();
  expect(td('Fresh Co', DUE).querySelector('button')).toBeNull();
  fireEvent.click(channelBtn('All'));
  document.body.innerHTML = '';
  setup({ canEdit: false });
  await screen.findByText('Solidcore');
  expect(td('Gallagher', NEXT).textContent).toBe('Send the one-pager');
  expect(td('Gallagher', NEXT).querySelector('button')).toBeNull();
  expect(td('Solidcore', DUE).querySelector('button')).toBeNull();
  expect(document.querySelectorAll('.ui-cell').length).toBe(0);
});

test('a failed save reverts the cell and shows the message; sorting is not re-applied while a cell is edited or saving', async () => {
  goalsApi.pipelineBoard.mockResolvedValue([
    row('Alpha Co', 'employer', 'yellow', { next_step: 'Aaa' }),
    row('Beta Co', 'employer', 'yellow', { next_step: 'Bbb' }),
  ]);
  setup();
  await screen.findByText('Alpha Co');
  updateOpportunity.mockRejectedValueOnce(new Error('Opportunity not found'));
  fireEvent.click(within(td('Alpha Co', NEXT)).getByRole('button'));
  const bad = screen.getByRole('textbox', { name: 'Next step for Alpha Co' });
  fireEvent.change(bad, { target: { value: 'Nope' } });
  fireEvent.keyDown(bad, { key: 'Enter' });
  expect((await screen.findByRole('status')).textContent).toBe('Opportunity not found');
  expect(td('Alpha Co', NEXT).textContent).toBe('Aaa');
  expect(td('Alpha Co', NEXT).querySelector('[aria-busy]')).toBeNull();

  const order = () => [...document.querySelectorAll('tr[data-row] td.ui-table__sticky')].map(x => x.textContent);
  fireEvent.click(screen.getByRole('button', { name: /^Next step/ }));
  expect(order()).toEqual(['Alpha Co', 'Beta Co']);
  let finish;
  updateOpportunity.mockReturnValueOnce(new Promise(r => { finish = r; }));
  fireEvent.click(within(td('Alpha Co', NEXT)).getByRole('button'));
  const input = screen.getByRole('textbox', { name: 'Next step for Alpha Co' });
  fireEvent.change(input, { target: { value: 'Zzz' } });
  expect(order()).toEqual(['Alpha Co', 'Beta Co']);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(td('Alpha Co', NEXT).querySelector('[aria-busy="true"]')).toBeTruthy());
  expect(td('Alpha Co', NEXT).textContent).toBe('Zzz');
  expect(order()).toEqual(['Alpha Co', 'Beta Co']);
  finish({});
  await waitFor(() => expect(order()).toEqual(['Beta Co', 'Alpha Co']));
  expect(td('Alpha Co', NEXT).querySelector('[aria-busy]')).toBeNull();
});

test('Type column: pills with the partner type; sorting Type groups partners by type, then employers and targets', async () => {
  goalsApi.pipelineBoard.mockResolvedValue([
    row('Tgt', 'target', 'yellow'),
    row('Emp', 'employer', 'yellow'),
    row('NoCat', 'partner', 'yellow'),
    row('Broker', 'partner', 'yellow', { category: '4. Mid-Market Benefits Brokers' }),
    row('Platform', 'partner', 'yellow', { category: '2. Marketplaces' }),
  ]);
  setup();
  await screen.findByText('Platform');
  const chip = name => screen.getByText(name).closest('tr').querySelector('[data-type-chip]');
  expect(chip('Broker').textContent).toBe('Brokers & PEOs'); expect(chip('Broker').dataset.typeChip).toBe('brokers'); expect(chip('Broker').title).toBe('Brokers, consultants & PEOs · partner');
  expect(chip('Platform').textContent).toBe('Platforms');
  expect(chip('NoCat').textContent).toBe('Partner'); expect(chip('NoCat').dataset.typeChip).toBe('partner');
  expect(chip('Emp').textContent).toBe('Employer'); expect(chip('Tgt').textContent).toBe('Target');
  expect(chip('Emp').style.getPropertyValue('--type-chip-hue')).toBe('var(--ui-accent, var(--sa-accent))'); expect(chip('Broker').style.getPropertyValue('--type-chip-hue')).toBe('#00A19D');
  const order = () => [...document.querySelectorAll('tr[data-row] td.ui-table__sticky')].map(td => td.textContent);
  fireEvent.click(screen.getByRole('button', { name: /^Type/ }));
  expect(order()).toEqual(['Platform', 'Broker', 'NoCat', 'Emp', 'Tgt']);
  expect(screen.getByRole('columnheader', { name: /^Type/ })).toHaveAttribute('aria-sort', 'ascending');
});

// sales-ia-v2 P3 - one Priority dropdown (P1-P4 + Not a fit) with a 10 s Undo.
test('priority: partner and employer write their record; who set it shows; Undo puts the old value back', async () => {
  goalsApi.pipelineBoard.mockResolvedValue([
    row('Gallagher', 'partner', 'yellow', { priority: 2, priority_set_by: 'Jack Carlson', priority_set_at: '2026-10-20T17:00:00Z' }),
    row('Solidcore', 'employer', 'yellow'),
  ]);
  setup();
  const g = await screen.findByLabelText('Priority for Gallagher');
  expect(g.value).toBe('2');
  expect(g.closest('span').title).toBe('P2 · set by Jack Oct 20');
  expect(g.closest('span').textContent).toContain('Jack Oct 20');
  fireEvent.change(screen.getByLabelText('Priority for Solidcore'), { target: { value: '1' } });
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'Solidcore', { priority: 1 }));
  expect((await screen.findByRole('status')).textContent).toContain('Solidcore: P1');
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenLastCalledWith('b1', 'Solidcore', { priority: null }));
  fireEvent.change(g, { target: { value: 'not_a_fit' } });
  await waitFor(() => expect(goalsApi.updatePartner).toHaveBeenCalledWith('b1', 'Gallagher', { priority: 4 }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'Gallagher', { type: 'note', note: 'Not a fit (set to P4 from Pipeline)' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.updatePartner).toHaveBeenLastCalledWith('b1', 'Gallagher', { priority: 2 }));
});

test('priority on a visitor: P2 overrides the pull; Undo goes back to the pull score; Not a fit; targets have none', async () => {
  goalsApi.setVisitPriority.mockResolvedValue({});
  goalsApi.pipelineBoard.mockResolvedValue([row('Acme Widgets', 'visitor', 'light', { id: 'acme widgets', priority: 1, priority_rule: 'US 500+' }), row('New Target', 'target', 'light')]);
  setup();
  fireEvent.click(await screen.findByRole('button', { name: /^Website visitors/ }));
  const sel = await screen.findByLabelText('Priority for Acme Widgets');
  expect(sel.closest('span').title).toBe('P1 · scored by the visitor pull');
  fireEvent.change(sel, { target: { value: '2' } });
  await waitFor(() => expect(goalsApi.setVisitPriority).toHaveBeenCalledWith('b1', { company_key: 'acme widgets', priority: 2 }));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.setVisitPriority).toHaveBeenLastCalledWith('b1', { company_key: 'acme widgets', priority: null }));
  fireEvent.change(screen.getByLabelText('Priority for Acme Widgets'), { target: { value: 'not_a_fit' } });
  await waitFor(() => expect(goalsApi.setVisitPriority).toHaveBeenLastCalledWith('b1', { company_key: 'acme widgets', not_a_fit: true }));
  fireEvent.click(channelBtn('Targets'));
  expect(await screen.findByText('New Target')).toBeTruthy();
  expect(screen.queryByLabelText('Priority for New Target')).toBeNull();
});

test('Viewer: priority is text, no dropdown', async () => {
  goalsApi.pipelineBoard.mockResolvedValue([row('Gallagher', 'partner', 'yellow', { priority: 3 })]);
  setup({ canEdit: false });
  await screen.findByText('Gallagher');
  expect(screen.queryByLabelText('Priority for Gallagher')).toBeNull();
  expect(screen.getByText('P3', { selector: 'td span' })).toBeTruthy();
});

test('columns: the chooser hides a column and the choice and the last sort are remembered', async () => {
  setup();
  await screen.findByText('Solidcore');
  expect(screen.queryByRole('columnheader', { name: /^Record ID/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Columns' })).getByLabelText('Channel'));
  expect(screen.queryByRole('columnheader', { name: /^Channel/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Last touch/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Last touch/ }));
  expect(screen.getByRole('columnheader', { name: /^Last touch/ })).toHaveAttribute('aria-sort', 'descending');
  expect(JSON.parse(localStorage.getItem('prospector_pipeline_columns'))).toEqual(['record', 'channel']);
  expect(JSON.parse(localStorage.getItem('prospector_pipeline_sort'))).toEqual({ id: 'touch', dir: 'desc' });
  cleanup();
  setup();
  await screen.findByText('Solidcore');
  expect(screen.queryByRole('columnheader', { name: /^Channel/ })).toBeNull();
  expect(screen.getByRole('columnheader', { name: /^Last touch/ })).toHaveAttribute('aria-sort', 'descending');
});

test('Has open to-do and Overdue filter on the row counts; the cells show them, red when overdue', async () => {
  goalsApi.pipelineBoard.mockResolvedValue([
    row('Busy Co', 'employer', 'yellow', { work: { todos: 2, todos_overdue: 1, waiting: 1, waiting_overdue: 0 } }),
    row('Calm Co', 'employer', 'yellow', { work: { todos: 1, todos_overdue: 0, waiting: 0, waiting_overdue: 0 } }),
    row('Idle Co', 'employer', 'yellow'),
  ]);
  setup();
  await screen.findByText('Idle Co');
  expect(td('Busy Co', 13).textContent).toBe('2 !');
  fireEvent.click(screen.getByRole('button', { name: 'Has open to-do' }));
  expect(screen.queryByText('Idle Co')).toBeNull();
  expect(screen.getByText('Calm Co')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Overdue' }));
  expect(screen.queryByText('Calm Co')).toBeNull();
  expect(screen.getByText('Busy Co')).toBeTruthy();
});

// company-panel-v2 Stage 3 - the Interest band and its buttons; Viewers see the text alone; Not now is hidden on a visitor.
test('interest band: the strongest signal in bold with its date; Mark contacted names the person and offers Undo; Not now snoozes the person; Book meeting sets the next step; the People row carries the pill', async () => {
  goalsApi.companyDetail.mockImplementation((b, type, id) => Promise.resolve({ ...INTEREST_DETAIL, record: { type, id, name: id, stage: 'replied', next_step: 'Send the one-pager', last_touch: null, site: { domain: 'gallagher.example', confirmed: true } } }));
  goalsApi.markContacted.mockResolvedValue({ event: { id: 'ev9', touch_type: 'email', to_status: null }, person: { contact_id: 'c-pat', before: { status: 'new' } } });
  goalsApi.notNow.mockResolvedValue({ person: { contact_id: 'c-pat', status: 'not_now', snooze_until: '2026-10-27', before: { status: 'new', snooze_until: null } } });
  goalsApi.bookMeeting.mockResolvedValue({ todo: { id: 'wg7' }, next_step: 'Book meeting with Pat Lee', before: { next_step: 'Send the one-pager' } });
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Gallagher' }));
  const panel = within(screen.getByRole('dialog', { name: 'Gallagher' }));
  const band = within(await panel.findByRole('region', { name: 'Interest' }));
  expect(band.getByText('Pat Lee clicked Step 1')).toBeTruthy();
  expect(band.getByText('Oct 19')).toBeTruthy();
  expect(panel.getAllByRole('link', { name: /^gallagher\.example/ }).map(a => a.getAttribute('href'))).toEqual(['https://gallagher.example', 'https://gallagher.example']);
  expect(panel.getByText('✓ confirmed')).toBeTruthy();
  expect(within(panel.getByRole('region', { name: 'People' })).getByText('clicked Step 1')).toBeTruthy();
  expect(within(panel.getByRole('region', { name: 'Signals & visits' })).getByText('Pat Lee clicked Step 1')).toBeTruthy();
  fireEvent.click(band.getByRole('button', { name: 'Mark contacted' }));
  await waitFor(() => expect(goalsApi.markContacted).toHaveBeenCalledWith('b1', 'partner', 'Gallagher', { contact_id: 'c-pat', person: 'Pat Lee', touch_type: 'email' }));
  const status = (await screen.findByText(/Pat Lee marked contacted/)).closest('[role="status"]');
  fireEvent.click(within(status).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.partnerUndo).toHaveBeenCalledWith('b1', 'Gallagher', 'ev9'));
  fireEvent.click(band.getByRole('button', { name: 'Not now' }));
  await waitFor(() => expect(goalsApi.notNow).toHaveBeenCalledWith('b1', 'partner', 'Gallagher', { contact_id: 'c-pat' }));
  fireEvent.click(band.getByRole('button', { name: 'Book meeting' }));
  await waitFor(() => expect(goalsApi.bookMeeting).toHaveBeenCalledWith('b1', 'partner', 'Gallagher', { person: 'Pat Lee' }));
  expect(panel.getByRole('button', { name: /^Stage/ })).toHaveAttribute('title', 'Stage only moves forward · saves at once · Undo 10 s');
  expect(panel.getByRole('region', { name: 'Actions' })).toBeTruthy();
});

test('Viewer: the band shows the signal but no buttons; the facts row and the cards still render; no edit row', async () => {
  goalsApi.companyDetail.mockImplementation((b, type, id) => Promise.resolve({ ...INTEREST_DETAIL, record: { type, id, name: id, stage: 'replied', next_step: null } }));
  setup({ canEdit: false });
  fireEvent.click(await screen.findByRole('button', { name: 'Gallagher' }));
  const panel = within(screen.getByRole('dialog', { name: 'Gallagher' }));
  const band = within(await panel.findByRole('region', { name: 'Interest' }));
  expect(band.getByText('Pat Lee clicked Step 1')).toBeTruthy();
  expect(band.queryByRole('button')).toBeNull();
  expect(panel.queryByRole('group', { name: 'Edit' })).toBeNull();
  expect(factText('Gallagher', 'Stage')).toBe('Replied');
  expect(factText('Gallagher', 'Last touch')).toBe('No touch yet');
  expect(panel.queryByRole('button', { name: /^(Stage|Owner|Team|Priority|Source|Next step)/ })).toBeNull(); // company-panel-v3: viewers get plain facts
  expect(panel.queryByRole('button', { name: 'More' })).toBeNull(); // spec Z: no ⋯ for Viewers
  expect(panel.queryByRole('button', { name: /Not this company|\+ Add|\+ Note|Follow up|Find who/ })).toBeNull();
});

test('visitor: facts are Priority · Source · Last visit; no Edit row but Priority; the band shows the signal only - the one Add to pipeline is the Actions row\'s (company-workflow-v1 W2)', async () => {
  goalsApi.pipelineBoard.mockImplementation(() => Promise.resolve([...ROWS, APOLLO, VISITOR]));
  const VISIT = { id: 'v1', kind: 'visit', count: 6, step: null, at: '2026-10-20', person: null, text: '6 site visits this week · /pricing' };
  goalsApi.companyDetail.mockImplementation((b, type, id) => Promise.resolve({ ...DETAIL, interest: { items: [VISIT], strongest: VISIT, newest_id: 'v1', dismissed: false, show: true }, record: { type, id, name: id, stage: 'visited', channel: 'website_visit' } }));
  setup();
  fireEvent.click(await screen.findByRole('button', { name: /^Website visitors/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Acme Visit' }));
  const panel = within(screen.getByRole('dialog', { name: 'Acme Visit' }));
  const band = within(await panel.findByRole('region', { name: 'Interest' }));
  expect(band.getByText('6 site visits this week · /pricing')).toBeTruthy();
  expect(band.queryByRole('button', { name: 'Not now' })).toBeNull();
  expect(band.queryAllByRole('button')).toEqual([]);
  expect(panel.getAllByRole('button', { name: 'Add to pipeline ▾' })).toHaveLength(1);
  expect(factText('Acme Visit', 'Source')).toBe('Website');
  expect(factText('Acme Visit', 'Last visit')).toBe('Oct 20');
  expect(factText('Acme Visit', 'Owner')).toBeNull();
  fireEvent.click(panel.getByRole('button', { name: /^Priority/ })); // company-panel-v3: the one editable fact on a visitor
  expect(panel.getByRole('combobox', { name: 'Priority' })).toBeTruthy();
  expect(panel.queryByRole('button', { name: /^Stage/ })).toBeNull();
});

// FIX pipeline-quick-fixes-v1 A - the menu's four items by role, keyboard, and the Person / Target / Partner forms.
test('+ Add ▾: four menu items (Employer · Partner · Target · Person), the only primary on the row; Esc closes; Arrow keys move', async () => {
  setup();
  await screen.findByText('Solidcore');
  const btn = screen.getByRole('button', { name: '+ Add ▾' });
  expect(btn.className).toMatch(/ui-btn--primary/);
  expect(document.querySelectorAll('#sales-frame-tools .ui-btn--primary')).toHaveLength(1);
  fireEvent.click(btn);
  const menu = screen.getByRole('menu', { name: 'Add' });
  expect(within(menu).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Employer', 'Partner', 'Target', 'Person']);
  expect(btn.getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  await waitFor(() => expect(document.activeElement.textContent).toBe('Partner'));
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu', { name: 'Add' })).toBeNull();
  expect(btn.getAttribute('aria-expanded')).toBe('false');
});

test('Person: name, title, company typeahead (board records + parked names), LinkedIn - no email or phone field; a picked record posts { type, id }; the window opens on its People card; a new company posts the name and toasts People search', async () => {
  setup();
  await screen.findByText('Solidcore');
  goalsApi.people.mockResolvedValue({ people: [{ person_id: 'x', name: 'Pat Parked', company: { type: 'parked', id: null, name: 'Solid Parked Co' }, no_record: true, ties: [] }], n: 1, total: 1 });
  goalsApi.addPerson.mockResolvedValueOnce({ person: { id: 'sp1', name: 'Jean Horton' }, company: { type: 'employer', id: 'Solidcore', name: 'Solidcore' } });
  openAdd('Person');
  const form = document.querySelector('[data-add-person]');
  expect(form).toBeTruthy();
  expect(form.querySelectorAll('input[type="email"], input[type="tel"]')).toHaveLength(0);
  expect(within(form).queryByLabelText(/email|phone/i)).toBeNull();
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Jean Horton' } });
  fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'VP People' } });
  fireEvent.change(within(form).getByLabelText('Company'), { target: { value: 'solid' } });
  const list = await within(form).findByRole('listbox', { name: 'Company suggestions' });
  await waitFor(() => expect(within(list).getAllByRole('option').map(o => o.textContent)).toEqual(['SolidcoreEmployer', 'Solid Parked CoNo record yet']));
  fireEvent.click(within(list).getByRole('button', { name: /^Solidcore/ }));
  expect(form.querySelector('[data-company-choice]')).toHaveTextContent('Employer: Solidcore');
  fireEvent.click(within(form).getByRole('button', { name: 'Add person' }));
  await waitFor(() => expect(goalsApi.addPerson).toHaveBeenCalledWith('b1', { name: 'Jean Horton', title: 'VP People', company: { type: 'employer', id: 'Solidcore' } }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Jean Horton added to Solidcore'));
  await waitFor(() => expect(document.querySelector('[data-section="people"]')).toBeTruthy());
  expect(document.querySelector('[data-row][data-key="employer-Solidcore"]')).toBeTruthy();

  goalsApi.addPerson.mockResolvedValueOnce({ person: { id: 'sp2', name: 'New Person' }, company: { type: 'parked', id: null, name: 'Brand New Co' } });
  fireEvent.keyDown(document, { key: 'Escape' });
  openAdd('Person');
  const f2 = document.querySelector('[data-add-person]');
  fireEvent.change(within(f2).getByLabelText('Name'), { target: { value: 'New Person' } });
  fireEvent.change(within(f2).getByLabelText('Company'), { target: { value: 'Brand New Co' } });
  expect(f2.querySelector('[data-company-choice]')).toHaveTextContent('New company "Brand New Co"');
  fireEvent.click(within(f2).getByRole('button', { name: 'Add person' }));
  await waitFor(() => expect(goalsApi.addPerson).toHaveBeenLastCalledWith('b1', { name: 'New Person', company: { name: 'Brand New Co' } }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('New Person filed under "Brand New Co" with no record yet - find them in People search'));
});

test('Target: name + kind picker + website posts createTarget; the new row is highlighted and its window opens; Partner: the existing Add partner form (dupe check) from the menu', async () => {
  setup();
  await screen.findByText('Solidcore');
  goalsApi.pipelineBoard.mockImplementation(() => Promise.resolve([...ROWS, APOLLO, row('Zeta Target', 'target', 'light')]));
  goalsApi.createTarget.mockResolvedValueOnce({ created: { type: 'target', id: 'Zeta Target', name: 'Zeta Target' } });
  openAdd('Target');
  const form = document.querySelector('[data-add-target]');
  fireEvent.change(within(form).getByLabelText('Company name'), { target: { value: 'Zeta Target' } });
  fireEvent.change(within(form).getByLabelText('Kind'), { target: { value: 'partner' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Add target' }));
  await waitFor(() => expect(goalsApi.createTarget).toHaveBeenCalledWith('b1', { name: 'Zeta Target', kind: 'partner' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Zeta Target added as a target'));
  await waitFor(() => expect(document.querySelector('[data-row][data-key="target-Zeta Target"]').style.getPropertyValue('--ui-row-tint')).toMatch(/--sa-accent/));
  fireEvent.keyDown(document, { key: 'Escape' });
  goalsApi.partnerDupeCheck.mockResolvedValue({ exact: [], partial: [] });
  goalsApi.createPartner.mockResolvedValueOnce({ id: 'g9', name: 'Zeta Partner' });
  openAdd('Partner');
  const name = await screen.findByLabelText('Partner name');
  fireEvent.change(name, { target: { value: 'Zeta Partner' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(goalsApi.createPartner).toHaveBeenCalledWith('b1', expect.objectContaining({ name: 'Zeta Partner' })));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Zeta Partner added as a partner'));
});

// FIX pipeline-quick-fixes-v1 B - the search is the first control in the filter row; "/" focuses it when nothing else is being typed into.
test('search first: the first control after the Filter label is the search box (width 220, "Search companies"); "/" focuses it, but not while typing in another field', async () => {
  setup();
  await screen.findByText('Solidcore');
  const group = screen.getByRole('group', { name: 'Filters' });
  const first = group.querySelector('input, select, button');
  expect(first.getAttribute('aria-label')).toBe('Search companies');
  expect(first.getAttribute('placeholder')).toBe('Search companies');
  expect(first.style.width).toBe('220px');
  fireEvent.keyDown(document.body, { key: '/' });
  expect(document.activeElement).toBe(first);
  first.blur();
  const owner = within(group).getByLabelText('Owner');
  owner.focus();
  fireEvent.keyDown(owner, { key: '/' });
  expect(document.activeElement).toBe(owner);
});
