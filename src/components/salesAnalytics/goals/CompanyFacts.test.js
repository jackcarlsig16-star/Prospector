import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CompanyFacts, { editableFacts, MoreMenu } from './CompanyFacts';
import { factsFor } from './companyPanelFacts';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';

jest.mock('./goalsApi', () => ({ goalsApi: { partnerSignal: jest.fn(), partnerUndo: jest.fn(), editCompanyFields: jest.fn(), updateTarget: jest.fn(), updatePartner: jest.fn(), partners: jest.fn(), editSource: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));

// company-window-v4 Stage 1 - a fact's popover IS the list (invented companies; names only): no <select> anywhere,
// one click = the listbox, a pick saves at once with Undo, readiness draws on the fact, Employees offers the research number.
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson', role: 'owner', color: '#6F8CF0' }, { user_id: 'u2', name: 'Cyrus Test', role: 'member', color: '#C97626' }, { user_id: 'u3', name: 'Vera Viewer', role: 'viewer' }];
const PARTNER = { type: 'partner', id: 'p1', name: 'Zz Harbor', stage: 'replied', category: '3. Brokers & PEOs', owner: 'Jack', owner_user_id: 'u1', owner_team: 'homelover', priority: null, next_step: 'Send the deck', channel: 'manual' };
const EMPLOYER = { type: 'employer', id: 'e1', name: 'Zz Elm', stage: 'contacted', owner: null, owner_user_id: null, owner_team: null, priority: 2, next_step: null, channel: 'import', org_type: 'employer' };
const TARGET = { type: 'target', id: 't1', name: 'Zz Quarry', stage: 'proposed', owner_team: null, kind: 'employer' };
const VISITOR = { type: 'visitor', id: 'v1', name: 'Zz Visit', priority: null, visited: { last_visit: '2026-10-20' } };
const step = (id, label, status, extra = {}) => ({ id, label, status, ...extra });
const OPEN_STEPS = { next: 'size', ready: false, steps: [step('research', 'Research', 'done'), step('site', 'Confirm site', 'skip'), step('size', 'Size & type', 'next', { reach: false }), step('owner', 'Owner', 'todo'), step('add', 'Add to pipeline', 'todo'), step('touch', 'First touch', 'skip')] };
const setup = (row, props = {}) => {
  const onToast = jest.fn(), onChanged = jest.fn(), onPatch = jest.fn(), setPanel = jest.fn();
  const record = { next_step: row.next_step ?? null, org_type: row.org_type, kind: row.kind, employees: row.employees ?? null, ...props.record };
  render(<CompanyFacts businessId="b1" row={row} record={record} detail={props.detail || null} steps={props.steps || null} facts={factsFor(row, record, undefined)} canEdit members={MEMBERS} source={null} panel={null} setPanel={setPanel} onPatch={onPatch} onChanged={onChanged} onToast={onToast} {...props} />);
  return { onToast, onChanged, onPatch, setPanel };
};
const fact = label => document.querySelector(`[data-fact="${label}"]`);
afterEach(() => jest.clearAllMocks());

test('editable facts follow editControls (+ Next step on partners / employers); Stage is no fact; Last touch never edits; a Viewer gets plain facts', () => {
  expect(factsFor(PARTNER, {}, undefined).map(f => f[0])).toEqual(['Owner', 'Team', 'Priority', 'Employees', 'Reach', 'Type', 'Source', 'Last touch', 'Next step']);
  expect(editableFacts(PARTNER)).toEqual(['Owner', 'Team', 'Priority', 'Employees', 'Reach', 'Source', 'Next step']);
  expect(editableFacts(EMPLOYER)).toEqual(['Owner', 'Team', 'Priority', 'Employees', 'Type', 'Source', 'Next step']);
  expect(editableFacts(TARGET)).toEqual(['Owner', 'Team', 'Employees', 'Source']);
  expect(editableFacts(VISITOR)).toEqual(['Priority']);
  expect(editableFacts({ type: 'apollo' })).toEqual([]);
  setup(PARTNER);
  for (const l of ['Owner', 'Team', 'Priority', 'Employees', 'Reach', 'Source', 'Next step']) expect(fact(l).tagName).toBe('BUTTON');
  expect(fact('Stage')).toBeNull();
  expect(fact('Last touch').tagName).toBe('DIV');
  expect(fact('Type').tagName).toBe('DIV'); // a partner's category has no PATCH
  expect(fact('Owner').querySelector('i').style.background).toBe('rgb(111, 140, 240)'); // Jack's member color beside the value
  document.body.innerHTML = '';
  setup(PARTNER, { canEdit: false });
  expect(screen.queryAllByRole('button')).toEqual([]);
  expect(fact('Owner').tagName).toBe('DIV');
});

test('F1 Owner: one click = the listbox (members with color dots + Unassigned, the current one selected); a pick saves at once, closes, offers Undo; no <select> in the window', async () => {
  goalsApi.editCompanyFields.mockResolvedValue({});
  const { onToast } = setup(EMPLOYER);
  expect(fact('Owner')).toHaveAttribute('aria-haspopup', 'listbox');
  fireEvent.click(fact('Owner'));
  const list = screen.getByRole('listbox', { name: 'Owner' });
  const opts = within(list).getAllByRole('option');
  expect(opts.map(o => o.textContent)).toEqual(['Jack Carlson', 'Cyrus Test', 'Unassigned']);
  expect(opts[0].querySelector('i').style.background).toBe('rgb(111, 140, 240)');
  expect(opts[1].querySelector('i').style.background).toBe('rgb(201, 118, 38)');
  expect(opts[2]).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('select')).toBeNull();
  fireEvent.click(opts[1]);
  await waitFor(() => expect(goalsApi.editCompanyFields).toHaveBeenCalledWith('b1', 'employer', 'e1', { owner_user_id: 'u2' }));
  await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Owner' })).toBeNull());
  expect(onToast.mock.calls[0][0].text).toBe('Zz Elm: owner Cyrus');
  await onToast.mock.calls[0][0].undo();
  expect(goalsApi.editCompanyFields).toHaveBeenLastCalledWith('b1', 'employer', 'e1', { owner_user_id: null });
});

test('F1 Team · Priority · Type: listboxes with the same writes and Undo (team through updateOpportunity, priority with its dot, type = org_type)', async () => {
  updateOpportunity.mockResolvedValue({});
  const { onToast, onPatch } = setup(EMPLOYER);
  fireEvent.click(fact('Team'));
  expect(within(screen.getByRole('listbox', { name: 'Team' })).getAllByRole('option').map(o => o.textContent)).toEqual(['HomeLover', 'Upside', 'Both', 'None']);
  fireEvent.click(within(screen.getByRole('listbox', { name: 'Team' })).getByRole('option', { name: 'Upside' }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'e1', { owner_team: 'upside' }));
  await onToast.mock.calls[0][0].undo();
  expect(updateOpportunity).toHaveBeenLastCalledWith('b1', 'e1', { owner_team: null });
  fireEvent.click(fact('Priority'));
  const pri = screen.getByRole('listbox', { name: 'Priority' });
  expect(within(pri).getAllByRole('option').map(o => o.textContent)).toEqual(['P1 · Strong', 'P2 · Good', 'P3 · Low', 'P4 · Low', 'Not a fit', '—']);
  expect(within(pri).getByRole('option', { name: 'P2 · Good' })).toHaveAttribute('aria-selected', 'true');
  expect(within(pri).getByRole('option', { name: 'P1 · Strong' }).querySelector('i')).toBeTruthy();
  fireEvent.click(fact('Type'));
  const type = screen.getByRole('listbox', { name: 'Type' });
  expect(within(type).getAllByRole('option').map(o => o.textContent)).toEqual(['Employer', 'Membership org', 'Channel partner']);
  fireEvent.click(within(type).getByRole('option', { name: 'Membership org' }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenLastCalledWith('b1', 'e1', { org_type: 'membership' }));
  expect(onPatch).toHaveBeenCalledWith({ org_type: 'membership' });
  await onToast.mock.calls[onToast.mock.calls.length - 1][0].undo();
  expect(updateOpportunity).toHaveBeenLastCalledWith('b1', 'e1', { org_type: 'employer' });
  expect(document.querySelector('select')).toBeNull();
});

test('F2 readiness: with the size and owner steps open the Owner fact reads "unassigned" and Employees "unknown", red dashed with the step\'s title; Employees opens a number input with "from research: 22 · Use"; Save writes the fields route with Undo', async () => {
  goalsApi.editCompanyFields.mockResolvedValue({});
  const { onToast } = setup(TARGET, { steps: OPEN_STEPS, detail: { research: { runs: [{ status: 'done', result: { employees_count: 22 } }] } } });
  expect(fact('Owner')).toHaveAttribute('data-need', 'true');
  expect(fact('Owner')).toHaveAttribute('title', 'Needed before Add to pipeline');
  expect(fact('Owner').querySelector('b').textContent).toBe('unassigned');
  expect(fact('Employees')).toHaveAttribute('data-need', 'true');
  expect(fact('Employees')).toHaveAttribute('title', 'Needed before Add to pipeline · Research fills it');
  expect(fact('Employees').querySelector('b').textContent).toBe('unknown');
  expect(fact('Team')).not.toHaveAttribute('data-need');
  fireEvent.click(fact('Employees'));
  const dlg = screen.getByRole('dialog', { name: 'Employees' });
  expect(within(dlg).getByText(/from research: 22/)).toBeInTheDocument();
  fireEvent.click(within(dlg).getByRole('button', { name: 'Use' }));
  expect(within(dlg).getByRole('textbox', { name: 'Employees' }).value).toBe('22');
  fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(goalsApi.editCompanyFields).toHaveBeenCalledWith('b1', 'target', 't1', { employees: 22 }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Employees' })).toBeNull());
  expect(onToast.mock.calls[0][0].text).toBe('Zz Quarry: size saved');
  await onToast.mock.calls[0][0].undo();
  expect(goalsApi.editCompanyFields).toHaveBeenLastCalledWith('b1', 'target', 't1', { employees: null });
  // Once the size is typed the fact no longer glows.
  document.body.innerHTML = '';
  setup({ ...TARGET, employees: 22 }, { steps: { ...OPEN_STEPS, steps: OPEN_STEPS.steps.map(s => (s.id === 'size' ? { ...s, status: 'done' } : s)) }, record: { employees: 22, employees_source: 'manual' } });
  expect(fact('Employees')).not.toHaveAttribute('data-need');
  expect(fact('Employees').querySelector('b').textContent).toBe('22');
  expect(fact('Owner')).toHaveAttribute('data-need', 'true');
});

test('Reach (a PEO / platform partner): its own two-number form with the research values; Next step (D1) saves through PATCH /land with Undo; Source opens the existing form; a press outside closes a popover', async () => {
  goalsApi.editCompanyFields.mockResolvedValue({});
  goalsApi.updatePartner.mockResolvedValue({});
  const p = setup(PARTNER, { detail: { research: { runs: [{ status: 'done', result: { reach_employees: 5000, reach_clients: 40 } }] } } });
  fireEvent.click(fact('Reach'));
  const reach = screen.getByRole('dialog', { name: 'Reach' });
  expect(within(reach).getAllByRole('textbox').map(t => t.getAttribute('aria-label'))).toEqual(['Covers (employees)', 'Clients']);
  fireEvent.click(within(reach).getAllByRole('button', { name: 'Use' })[1]);
  fireEvent.click(within(reach).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(goalsApi.editCompanyFields).toHaveBeenCalledWith('b1', 'partner', 'p1', { reach_clients: 40 }));
  fireEvent.click(fact('Next step'));
  const input = screen.getByRole('textbox', { name: 'Next step' });
  expect(input.value).toBe('Send the deck');
  fireEvent.change(input, { target: { value: 'Book the pilot call' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(goalsApi.updatePartner).toHaveBeenCalledWith('b1', 'p1', { next_step: 'Book the pilot call' }));
  expect(p.onPatch).toHaveBeenCalledWith({ next_step: 'Book the pilot call' });
  await p.onToast.mock.calls[p.onToast.mock.calls.length - 1][0].undo();
  expect(goalsApi.updatePartner).toHaveBeenLastCalledWith('b1', 'p1', { next_step: 'Send the deck' });
  fireEvent.click(fact('Source'));
  expect(p.setPanel).toHaveBeenCalledWith('source');
  fireEvent.click(fact('Owner'));
  expect(screen.getByRole('listbox', { name: 'Owner' })).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('listbox', { name: 'Owner' })).toBeNull();
  document.body.innerHTML = '';
  setup(TARGET);
  expect(fact('Next step')).toBeNull(); // a target's facts carry no Next step (no column)
});

test('⋯ menu (D2): Jump to stage · Source · Website · Copy link; no Check Apollo (the window hides ⋯ from Viewers)', () => {
  const onPick = jest.fn();
  const { unmount } = render(<MoreMenu row={{ ...EMPLOYER, domain: 'elm.example' }} canEdit onPick={onPick} />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Jump to stage…', 'Source…', 'Website · elm.example', 'Copy link']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Jump to stage…' }));
  expect(onPick).toHaveBeenCalledWith('jump');
  expect(screen.queryByRole('menu')).toBeNull();
  unmount();
});
