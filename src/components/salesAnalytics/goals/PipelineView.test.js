import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PipelineView from './PipelineView';
import { goalsApi } from './goalsApi';
import { fetchOpportunities, createOpportunity, updateOpportunity } from '../pipelineApi';
import { OPEN_TASKS } from './goalsApi';

// pipeline-board-v1 Stage 2 - Goals > Pipeline; pipeline-wide-table-v1 Stage 2 - the board is a DataTable.
// jsdom has no matchMedia; PipelineView reads it for its phone list.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
jest.mock('./goalsApi', () => ({ ...jest.requireActual('./goalsApi'), goalsApi: { ...jest.requireActual('./goalsApi').goalsApi, pipelineBoard: jest.fn(), partnerSignal: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ fetchOpportunities: jest.fn(), createOpportunity: jest.fn(), updateOpportunity: jest.fn(), archiveOpportunity: jest.fn() }));

const row = (id, type, color, extra = {}) => ({
  type, id, name: id, stage: 's', stage_label: 'Stage', color, owner_team: null, owner: null, tier: null,
  next_step: null, next_step_due: null, last_touch_at: null, top: false, record_id: null, ...extra,
});
const ROWS = [
  row('Gallagher', 'partner', 'yellow', { top: true, owner_team: 'homelover', owner: 'Jack', tier: '1' }),
  row('Solidcore', 'employer', 'yellow', { owner_team: 'upside', next_step: 'Call', next_step_due: '2026-10-20' }),
  row('OneDigital', 'partner', 'blue', { owner_team: 'upside', tier: '2' }),
  row('New Target', 'target', 'light'),
  row('Old Union', 'employer', 'faded'),
];
const APOLLO = row('Fresh Co', 'apollo', 'gray', { last_touch_at: '2026-10-07T15:00:00Z' });

beforeEach(() => {
  goalsApi.pipelineBoard.mockImplementation((id, includeApollo) => Promise.resolve(includeApollo ? [...ROWS, APOLLO] : ROWS));
  goalsApi.partnerSignal.mockResolvedValue({});
  updateOpportunity.mockResolvedValue({});
  fetchOpportunities.mockResolvedValue([{ id: 'Solidcore', organization: 'Solidcore', org_type: 'employer', stage: 'meeting' }]);
});
const setup = (extra = {}) => {
  const props = { businessId: 'b1', canEdit: true, onOpenPartner: jest.fn(), onOpenCompanies: jest.fn(), ...extra };
  render(<PipelineView {...props} />);
  return props;
};
// The rows of one group: everything after its header row up to the next header row.
const section = name => {
  let tr = screen.getByRole('heading', { name: new RegExp(`^${name}`) }).closest('tr').nextElementSibling;
  const box = document.createElement('div');
  while (tr && !tr.classList.contains('ui-table__group')) { box.appendChild(tr.cloneNode(true)); tr = tr.nextElementSibling; }
  return box;
};

test('Top pinned first, then color sections in order; Parked collapsed; counts per color', async () => {
  setup();
  expect(await screen.findByRole('heading', { name: /^Top 1 of 25/ })).toBeTruthy();
  expect(within(section('Top 1 of 25')).getByText('Gallagher')).toBeTruthy();
  const heads = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent.trim());
  expect(heads).toEqual(['Top 1 of 25', 'Meeting 1', 'Talking 1', 'Not started 1', 'Parked 1']);
  expect(screen.queryByText('Old Union')).toBeNull();
  const table = within(screen.getByRole('table'));
  const parked = table.getByRole('button', { name: /^Parked 1/ });
  expect(parked).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(parked);
  expect(screen.getByText('Old Union')).toBeTruthy();
  fireEvent.click(table.getByRole('button', { name: /^Meeting 1/ }));
  expect(screen.queryByText('Solidcore')).toBeNull();
  fireEvent.click(table.getByRole('button', { name: /^Meeting 1/ }));
  expect(screen.getByText('Solidcore')).toBeTruthy();
  const counts = screen.getByRole('group', { name: 'Counts by color' });
  expect(within(counts).getByRole('button', { name: /Meeting 2/ })).toBeTruthy();
  expect(within(counts).getByRole('button', { name: /Talking 1/ })).toBeTruthy();
});

test('type chips, owner team, owner and search filter the board; a count chip filters to its color', async () => {
  setup();
  await screen.findByText('Solidcore');
  fireEvent.click(screen.getByRole('button', { name: 'Partners' }));
  expect(screen.queryByText('Solidcore')).toBeNull();
  expect(screen.getByText('OneDigital')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  fireEvent.change(screen.getByLabelText('Owner team'), { target: { value: 'upside' } });
  expect(screen.queryByText('Gallagher')).toBeNull();
  expect(screen.getByText('Solidcore')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Owner team'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Jack' } });
  expect(screen.queryByText('Solidcore')).toBeNull();
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Search companies'), { target: { value: 'one' } });
  expect(screen.getByText('OneDigital')).toBeTruthy();
  expect(screen.queryByText('Solidcore')).toBeNull();
  fireEvent.change(screen.getByLabelText('Search companies'), { target: { value: '' } });
  fireEvent.click(within(screen.getByRole('group', { name: 'Counts by color' })).getByRole('button', { name: /Talking 1/ }));
  expect(screen.getByText('OneDigital')).toBeTruthy();
  expect(screen.queryByText('Solidcore')).toBeNull();
});

test('"In Apollo" refetches with the flag and shows the company', async () => {
  setup();
  await screen.findByText('Solidcore');
  expect(screen.queryByText('Fresh Co')).toBeNull();
  const chip = screen.getByRole('button', { name: 'In Apollo' });
  expect(chip).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(chip);
  expect(await screen.findByText('Fresh Co')).toBeTruthy();
  expect(goalsApi.pipelineBoard).toHaveBeenLastCalledWith('b1', true);
  expect(screen.getByRole('button', { name: 'In Apollo' })).toHaveAttribute('aria-pressed', 'true');
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
  expect(cells(beta)).toEqual(['☆', 'Beta Co', 'Employer', 'Stage', '—', '—', '—', 'Send deck', 'Oct 22', '—']);
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
  expect(beta.style.getPropertyValue('--ui-row-bar')).toBe('var(--sa-warn)');
});

test('★ a partner goes through the hot signal, an employer through is_top; it moves into Top', async () => {
  setup();
  await screen.findByText('Solidcore');
  fireEvent.click(screen.getByRole('button', { name: 'Star OneDigital' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'OneDigital', { type: 'hot', hot: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Star Solidcore' }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'Solidcore', { is_top: true }));
  await waitFor(() => expect(within(section('Top 3 of 25')).getByText('Solidcore')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Unstar Gallagher' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'Gallagher', { type: 'hot', hot: false }));
});

test('soft cap: starring a 26th asks to unstar one first and writes nothing', async () => {
  const full = Array.from({ length: 25 }, (_, i) => row(`P${i}`, 'partner', 'gray', { top: true }));
  goalsApi.pipelineBoard.mockResolvedValue([...full, row('Extra', 'partner', 'gray')]);
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Star Extra' }));
  expect(screen.getByRole('status').textContent).toMatch(/Top is full \(25\): unstar one first/);
  expect(goalsApi.partnerSignal).not.toHaveBeenCalled();
});

test('click-through: partner -> Partners focus, target -> Tasks, Apollo -> Companies week, employer -> panel', async () => {
  const props = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'OneDigital' }));
  expect(props.onOpenPartner).toHaveBeenCalledWith('OneDigital', 'OneDigital');
  const seen = [];
  const listen = e => seen.push(e.detail);
  window.addEventListener(OPEN_TASKS, listen);
  fireEvent.click(screen.getByRole('button', { name: 'New Target' }));
  window.removeEventListener(OPEN_TASKS, listen);
  expect(seen).toEqual([{ link: { type: 'target', id: 'New Target' }, filter: 'team' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Solidcore' }));
  expect(await screen.findByText('Edit opportunity')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'In Apollo' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Fresh Co' }));
  expect(props.onOpenCompanies).toHaveBeenCalledWith('2026-10-05');
});

test('+ Add employer opens a blank panel; save creates through the route and reloads; a reuse says so', async () => {
  setup();
  await screen.findByText('Solidcore');
  createOpportunity.mockResolvedValueOnce({ opportunity: { id: 'n1', organization: 'Zeta Labs' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add employer' }));
  expect(screen.getByText('Add opportunity')).toBeTruthy();
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Zeta Labs' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(createOpportunity).toHaveBeenCalledWith('b1', expect.objectContaining({ organization: 'Zeta Labs' })));
  await waitFor(() => expect(screen.queryByText('Add opportunity')).toBeNull());
  expect(goalsApi.pipelineBoard).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('status')).toBeNull();

  createOpportunity.mockResolvedValueOnce({ opportunity: { id: 'Solidcore', organization: 'Solidcore' }, reused: true });
  fireEvent.click(screen.getByRole('button', { name: '+ Add employer' }));
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'solidcore inc' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('status')).textContent).toBe('Solidcore is already in the pipeline - no new row added.');
});

test('Viewer: stars are read-only, no employer panel, partners still open', async () => {
  const props = setup({ canEdit: false });
  await screen.findByText('Solidcore');
  expect(screen.queryByRole('button', { name: /^(Un)?[Ss]tar / })).toBeNull();
  expect(screen.getByLabelText('Top')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Solidcore' })).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Add employer' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Export joint sheet' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Update from sheet' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Gallagher' }));
  expect(props.onOpenPartner).toHaveBeenCalled();
});

test('Export joint sheet fetches the .xlsx for the current filters and saves it; a refusal shows', async () => {
  const blob = new Blob(['x']);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob), headers: { get: () => 'attachment; filename="joint-pipeline-2026-10-15.xlsx"' } });
  URL.createObjectURL = jest.fn(() => 'blob:x');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  setup();
  await screen.findByText('Solidcore');
  fireEvent.change(screen.getByLabelText('Owner team'), { target: { value: 'upside' } });
  fireEvent.click(screen.getByRole('button', { name: 'Partners' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export joint sheet' }));
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(global.fetch).toHaveBeenCalledWith('/api/sales/b1/goals/pipeline-board/export?type=partner&owner_team=upside');
  expect(click.mock.instances[0].download).toBe('joint-pipeline-2026-10-15.xlsx');
  global.fetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Export is for members only' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Export joint sheet' }));
  expect(await screen.findByText('Export is for members only')).toBeTruthy();
  click.mockRestore();
});
