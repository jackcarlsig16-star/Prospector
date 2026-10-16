import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PipelineView from './PipelineView';
import { goalsApi } from './goalsApi';
import { fetchOpportunities, createOpportunity, updateOpportunity } from '../pipelineApi';
import { OPEN_TASKS } from './goalsApi';

// pipeline-board-v1 Stage 2 - Goals > Pipeline; pipeline-wide-table-v1 Stage 2 - the board is a DataTable.
// jsdom has no matchMedia; PipelineView reads it for its phone list.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || jest.fn();
jest.mock('./goalsApi', () => ({ ...jest.requireActual('./goalsApi'), goalsApi: { ...jest.requireActual('./goalsApi').goalsApi, pipelineBoard: jest.fn(), partnerSignal: jest.fn(), updatePartner: jest.fn(), partnerEvents: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ fetchOpportunities: jest.fn(), createOpportunity: jest.fn(), updateOpportunity: jest.fn(), archiveOpportunity: jest.fn() }));

const row = (id, type, color, extra = {}) => ({
  type, id, name: id, stage: 's', stage_label: 'Stage', color, owner_team: null, owner: null, tier: null,
  next_step: null, next_step_due: null, last_touch_at: null, top: false, record_id: null, ...extra,
});
const ROWS = [
  row('Gallagher', 'partner', 'yellow', { top: true, owner_team: 'homelover', owner: 'Jack', tier: '1', stage: 'replied', stage_label: 'Replied', category: '4. Mid-Market Benefits Brokers', next_step: 'Send the one-pager' }),
  row('Solidcore', 'employer', 'yellow', { owner_team: 'upside', next_step: 'Call', next_step_due: '2026-10-20' }),
  row('OneDigital', 'partner', 'blue', { owner_team: 'upside', tier: '2', stage: 'not_started', stage_label: 'Not started' }),
  row('New Target', 'target', 'light'),
  row('Old Union', 'employer', 'faded'),
];
const APOLLO = row('Fresh Co', 'apollo', 'gray', { last_touch_at: '2026-10-07T15:00:00Z' });

beforeEach(() => {
  goalsApi.pipelineBoard.mockImplementation((id, includeApollo) => Promise.resolve(includeApollo ? [...ROWS, APOLLO] : ROWS));
  goalsApi.partnerSignal.mockResolvedValue({});
  goalsApi.updatePartner.mockResolvedValue({});
  goalsApi.partnerEvents.mockResolvedValue([]);
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
  expect((await screen.findByRole('status')).textContent).toMatch(/Top is full \(25\): unstar one first/);
  expect(goalsApi.partnerSignal).not.toHaveBeenCalled();
});

test('click-through: partner -> quick panel (not Partners), target -> Tasks, Apollo -> Companies week, employer -> panel', async () => {
  const props = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'OneDigital' }));
  expect(screen.getByRole('complementary', { name: 'OneDigital' })).toBeTruthy();
  expect(props.onOpenPartner).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open full card →' }));
  expect(props.onOpenPartner).toHaveBeenCalledWith('OneDigital', 'OneDigital');
  expect(screen.queryByRole('complementary')).toBeNull();
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

test('Viewer: stars are read-only; employer and partner open read-only panels (text, no Save / ★ / note / Next)', async () => {
  const props = setup({ canEdit: false });
  await screen.findByText('Solidcore');
  expect(screen.queryByRole('button', { name: /^(Un)?[Ss]tar / })).toBeNull();
  expect(screen.getByLabelText('Top')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '+ Add employer' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Export joint sheet' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Update from sheet' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Solidcore' }));
  const opp = within(await screen.findByRole('complementary', { name: 'Opportunity' }));
  expect(opp.getByText('Solidcore')).toBeTruthy();
  expect(opp.queryByRole('textbox')).toBeNull();
  expect(opp.queryByRole('button', { name: /Save|Archive/ })).toBeNull();
  expect(opp.getByText('You have view access, so this is read-only.')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('complementary')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Gallagher' }));
  const panel = within(screen.getByRole('complementary', { name: 'Gallagher' }));
  expect(panel.getByText('Send the one-pager')).toBeTruthy();
  expect(panel.queryByRole('textbox')).toBeNull();
  expect(panel.queryByRole('button', { name: /Star|Save note|^Next:/ })).toBeNull();
  expect(panel.getByRole('button', { name: 'Open full card →' })).toBeTruthy();
  expect(props.onOpenPartner).not.toHaveBeenCalled();
});

test('quick panel: Next step saves once on Enter and updates the row; unchanged blur writes nothing; note + ★ go through signals', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Gallagher' }));
  const panel = within(screen.getByRole('complementary', { name: 'Gallagher' }));
  expect(panel.getByText('Mid-Market Benefits Brokers')).toBeTruthy();
  expect(panel.getAllByText('Replied').length).toBe(2);
  const field = panel.getByLabelText('Next step');
  expect(field.value).toBe('Send the one-pager');
  fireEvent.blur(field);
  expect(goalsApi.updatePartner).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: 'Book the pilot call' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  await waitFor(() => expect(goalsApi.updatePartner).toHaveBeenCalledWith('b1', 'Gallagher', { next_step: 'Book the pilot call' }));
  expect(goalsApi.updatePartner).toHaveBeenCalledTimes(1);
  const gallagher = screen.getByText('Gallagher', { selector: 'td button' }).closest('tr');
  await waitFor(() => expect([...gallagher.querySelectorAll('td')].map(td => td.textContent)).toContain('Book the pilot call'));
  expect(goalsApi.pipelineBoard).toHaveBeenCalledTimes(1);
  fireEvent.change(panel.getByLabelText('Add note'), { target: { value: 'Called, left voicemail' } });
  fireEvent.click(panel.getByRole('button', { name: 'Save note' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'Gallagher', { type: 'note', note: 'Called, left voicemail' }));
  await waitFor(() => expect(panel.getByLabelText('Add note').value).toBe(''));
  fireEvent.click(panel.getByRole('button', { name: 'Unstar Gallagher' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'Gallagher', { type: 'hot', hot: false }));
  await waitFor(() => expect(panel.getByRole('button', { name: 'Star Gallagher' })).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Export joint sheet' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Update from sheet' })).toBeTruthy();
});

test('quick panel: one forward step sends the status signal with expect and moves the row; Esc / backdrop close and flash the row', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'OneDigital' }));
  const panel = within(screen.getByRole('complementary', { name: 'OneDigital' }));
  fireEvent.click(panel.getByRole('button', { name: 'Next: Start research' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'OneDigital', { type: 'status', to: 'researching', expect: 'not_started' }));
  await waitFor(() => expect(panel.getByRole('button', { name: 'Next: Mark drafted' })).toBeTruthy());
  const tr = screen.getByText('OneDigital', { selector: 'td button' }).closest('tr');
  expect([...tr.querySelectorAll('td')].map(td => td.textContent)).toContain('Researching');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('complementary')).toBeNull();
  expect(tr.style.getPropertyValue('--ui-row-tint')).toContain('--sa-accent');
  fireEvent.click(screen.getByRole('button', { name: 'OneDigital' }));
  fireEvent.click(screen.getByTestId('side-panel-backdrop'));
  expect(screen.queryByRole('complementary')).toBeNull();
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

// pipeline-quick-panel-v1 Stage 2 - Next step and Due typed straight into the table.
const td = (name, col) => screen.getByText(name, { selector: 'td button' }).closest('tr').querySelectorAll('td')[col];
const NEXT = 7, DUE = 8;

test('Next step cell on a partner row: click -> input prefilled; Enter saves through updatePartner once and updates the row; the click never opens the panel', async () => {
  setup();
  await screen.findByText('Solidcore');
  fireEvent.click(within(td('Gallagher', NEXT)).getByRole('button'));
  expect(screen.queryByRole('complementary')).toBeNull();
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

test('partner Due stays a dash with a title; target and Apollo cells are text; a Viewer gets no editors', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'In Apollo' }));
  await screen.findByText('Fresh Co');
  const due = td('Gallagher', DUE);
  expect(due.textContent).toBe('—');
  expect(due.title).toBe('Partners have no due date yet');
  expect(due.querySelector('button')).toBeNull();
  expect(td('Solidcore', DUE).title).toBe('2026-10-20');
  for (const name of ['New Target', 'Fresh Co']) {
    expect(td(name, NEXT).querySelector('button')).toBeNull();
    expect(td(name, DUE).querySelector('button')).toBeNull();
  }
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
