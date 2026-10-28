import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CompanyStepsStrip from './CompanyStepsStrip';
import { goalsApi } from './goalsApi';

// company-workflow-v1 W1 - the guided steps strip. Made-up names; no emails or phones.
jest.mock('./goalsApi', () => ({ goalsApi: { addToPipeline: jest.fn(), runCompanyResearch: jest.fn(), editCompanyFields: jest.fn(), partnerSignal: jest.fn(), markContacted: jest.fn(), addPartnerDomain: jest.fn() } }));

const JACK = 'u-jack', CY = 'u-cy';
const members = [{ user_id: JACK, name: 'Jack Zz', role: 'owner' }, { user_id: CY, name: 'Cyrus Yy', role: 'member' }, { user_id: 'u-v', name: 'Vic Viewer', role: 'viewer' }];
const step = (id, label, status, value = null, extra = {}) => ({ id, label, status, value, ...extra });
const visitorSteps = { next: 'research', ready: false, steps: [step('research', 'Research', 'next', null, { needs_record: true }), step('site', 'Confirm site', 'skip'), step('size', 'Size & type', 'todo', null, { reach: false }), step('owner', 'Owner', 'todo'), step('add', 'Add to pipeline', 'todo'), step('touch', 'First touch', 'skip')] };
const setup = (row, detail, props = {}) => {
  const p = { onChanged: jest.fn(), onConvert: jest.fn(), onToast: jest.fn(), setForm: jest.fn() };
  render(<CompanyStepsStrip businessId="b1" row={row} detail={detail} canEdit members={members} {...p} {...props} />);
  return p;
};
afterEach(() => jest.clearAllMocks());

test('a visitor: exactly one glowing step, "Research — adds it as a target"; it adds a target, researches it and switches the window', async () => {
  goalsApi.addToPipeline.mockResolvedValue({ created: { type: 'target', id: 't1', name: 'ZZ Acme' } });
  goalsApi.runCompanyResearch.mockResolvedValue({});
  const p = setup({ type: 'visitor', id: 'zz acme', name: 'ZZ Acme' }, { record: {}, steps: visitorSteps });
  const glowing = document.querySelectorAll('[data-steps] .ui-btn--primary');
  expect(glowing).toHaveLength(1);
  expect(glowing[0]).toHaveTextContent('1 Research — adds it as a target');
  expect(screen.queryByText(/Confirm site/)).toBeNull();
  fireEvent.click(glowing[0]);
  await waitFor(() => expect(goalsApi.runCompanyResearch).toHaveBeenCalledWith('b1', 'target', 't1'));
  expect(goalsApi.addToPipeline).toHaveBeenCalledWith('b1', { type: 'visitor', id: 'zz acme', to: 'target' });
  expect(p.onConvert).toHaveBeenCalledWith({ type: 'target', id: 't1', name: 'ZZ Acme' }, false);
});

test('done steps show ✓ + value; Size & type offers the research number with Use and saves it typed (Undo puts it back)', async () => {
  goalsApi.editCompanyFields.mockResolvedValue({});
  const steps = { next: 'size', ready: false, steps: [step('research', 'Research', 'done', 'Researched 2026-10-22'), step('site', 'Confirm site', 'skip'), step('size', 'Size & type', 'next', null, { reach: true }), step('owner', 'Owner', 'todo'), step('add', 'Add to pipeline', 'skip'), step('touch', 'First touch', 'todo')] };
  const detail = { record: { employees: null, reach_employees: null, reach_clients: null }, research: { runs: [{ status: 'done', result: { employees_count: 300, reach_employees: 45000, reach_clients: 410 } }] }, steps };
  const p = setup({ type: 'partner', id: 'g1', name: 'ZZ Payroll Co' }, detail);
  // company-panel-v3 S: SETUP done/shown (the skip step is not counted); a done chip carries no number.
  expect(document.querySelector('[data-setup-count]').textContent).toBe('Setup 1/4');
  expect(screen.getByRole('region', { name: 'Setup' })).toBeInTheDocument();
  expect(screen.getByText('✓ Research · Researched 2026-10-22')).toBeInTheDocument();
  expect(document.querySelectorAll('.ui-btn--primary')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '2 Size & type' }));
  const group = screen.getByRole('group', { name: 'Size & type' });
  fireEvent.click(within(group).getByRole('button', { name: 'Use 300' }));
  fireEvent.click(within(group).getByRole('button', { name: 'Use 410' }));
  fireEvent.change(within(group).getByLabelText('Covers (employees)'), { target: { value: '44,000' } });
  fireEvent.click(within(group).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(goalsApi.editCompanyFields).toHaveBeenCalledWith('b1', 'partner', 'g1', { employees: 300, reach_employees: 44000, reach_clients: 410 }));
  const toast = p.onToast.mock.calls[0][0];
  await toast.undo();
  expect(goalsApi.editCompanyFields).toHaveBeenLastCalledWith('b1', 'partner', 'g1', { employees: null, reach_employees: null, reach_clients: null });
});

test('Owner: a partner goes through Assign, an employer through the fields route; Viewers aren\'t offered', async () => {
  goalsApi.partnerSignal.mockResolvedValue({});
  goalsApi.editCompanyFields.mockResolvedValue({});
  const steps = { next: 'owner', ready: false, steps: [step('research', 'Research', 'done'), step('site', 'Confirm site', 'skip'), step('size', 'Size & type', 'done'), step('owner', 'Owner', 'next'), step('add', 'Add to pipeline', 'skip'), step('touch', 'First touch', 'todo')] };
  setup({ type: 'partner', id: 'g1', name: 'ZZ Co' }, { record: {}, steps });
  fireEvent.click(screen.getByRole('button', { name: '3 Owner' }));
  expect(within(screen.getByRole('group', { name: 'Owner' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Jack', 'Cyrus']);
  fireEvent.click(screen.getByRole('button', { name: 'Cyrus' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'g1', { type: 'assign', owner_user_id: CY }));
});

test('Add to pipeline / Promote open the Actions row\'s one control; Ready collapses; Viewers read only', () => {
  const p = setup({ type: 'target', id: 't1', name: 'ZZ Oak' }, { record: {}, steps: { next: 'add', ready: false, steps: [step('research', 'Research', 'done'), step('site', 'Confirm site', 'skip'), step('size', 'Size & type', 'done'), step('owner', 'Owner', 'done', 'Cyrus Yy'), step('add', 'Add to pipeline', 'next', 'Promote to partner or employer'), step('touch', 'First touch', 'skip')] } });
  fireEvent.click(screen.getByRole('button', { name: '4 Add to pipeline' }));
  expect(p.setForm).toHaveBeenCalledWith('promote');
  document.body.innerHTML = '';
  setup({ type: 'employer', id: 'o1', name: 'ZZ Elm' }, { record: {}, steps: { next: null, ready: true, last_touch_at: '2026-10-20T10:00:00Z', steps: [] } });
  expect(document.querySelector('[data-steps-ready]')).toHaveTextContent('✓ Ready · last touch Oct 20');
  document.body.innerHTML = '';
  setup({ type: 'visitor', id: 'v', name: 'ZZ V' }, { record: {}, steps: visitorSteps }, { canEdit: false });
  expect(document.querySelectorAll('[data-steps] button')).toHaveLength(0);
});
