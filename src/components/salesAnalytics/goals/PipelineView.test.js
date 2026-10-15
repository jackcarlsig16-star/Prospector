import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PipelineView from './PipelineView';
import { goalsApi } from './goalsApi';
import { fetchOpportunities, updateOpportunity } from '../pipelineApi';
import { OPEN_TASKS } from './goalsApi';

// pipeline-board-v1 Stage 2 - Goals > Pipeline.
jest.mock('./goalsApi', () => ({ ...jest.requireActual('./goalsApi'), goalsApi: { pipelineBoard: jest.fn(), partnerSignal: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ fetchOpportunities: jest.fn(), updateOpportunity: jest.fn(), archiveOpportunity: jest.fn() }));

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
const section = name => screen.getByRole('heading', { name: new RegExp(`^${name}`) }).parentElement;

test('Top pinned first, then color sections in order; Parked collapsed; counts per color', async () => {
  setup();
  expect(await screen.findByRole('heading', { name: /^Top 1 of 25/ })).toBeTruthy();
  expect(within(section('Top 1 of 25')).getByText('Gallagher')).toBeTruthy();
  const heads = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent.trim());
  expect(heads).toEqual(['Top 1 of 25', 'Meeting 1', 'Talking 1', 'Not started 1']);
  expect(screen.queryByText('Old Union')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Parked \(1\)/ }));
  expect(screen.getByText('Old Union')).toBeTruthy();
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
  fireEvent.click(screen.getByRole('button', { name: /Talking 1/ }));
  expect(screen.getByText('OneDigital')).toBeTruthy();
  expect(screen.queryByText('Solidcore')).toBeNull();
});

test('Include Apollo-only refetches with the flag and shows the company', async () => {
  setup();
  await screen.findByText('Solidcore');
  expect(screen.queryByText('Fresh Co')).toBeNull();
  fireEvent.click(screen.getByLabelText('Include Apollo-only companies'));
  expect(await screen.findByText('Fresh Co')).toBeTruthy();
  expect(goalsApi.pipelineBoard).toHaveBeenLastCalledWith('b1', true);
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
  fireEvent.click(screen.getByLabelText('Include Apollo-only companies'));
  fireEvent.click(await screen.findByRole('button', { name: 'Fresh Co' }));
  expect(props.onOpenCompanies).toHaveBeenCalledWith('2026-10-05');
});

test('Viewer: stars are read-only, no employer panel, partners still open', async () => {
  const props = setup({ canEdit: false });
  await screen.findByText('Solidcore');
  expect(screen.queryByRole('button', { name: /^(Un)?[Ss]tar / })).toBeNull();
  expect(screen.getByLabelText('Top')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Solidcore' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Gallagher' }));
  expect(props.onOpenPartner).toHaveBeenCalled();
});
