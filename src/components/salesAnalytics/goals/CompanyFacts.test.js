import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CompanyFacts, { editableFacts, MoreMenu } from './CompanyFacts';
import { factsFor } from './companyPanelFacts';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';

jest.mock('./goalsApi', () => ({ goalsApi: { partnerSignal: jest.fn(), partnerUndo: jest.fn(), editCompanyFields: jest.fn(), updateTarget: jest.fn(), updatePartner: jest.fn(), partners: jest.fn(), editSource: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));

// company-panel-v3 Stage 1 - the facts are the edit row (invented companies; names only).
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson', role: 'owner' }, { user_id: 'u2', name: 'Cyrus Test', role: 'member' }, { user_id: 'u3', name: 'Vera Viewer', role: 'viewer' }];
const PARTNER = { type: 'partner', id: 'p1', name: 'Zz Harbor', stage: 'replied', category: '2. Brokers & PEOs', owner: 'Jack', owner_user_id: 'u1', owner_team: 'homelover', priority: null, next_step: 'Send the deck', channel: 'manual' };
const EMPLOYER = { type: 'employer', id: 'e1', name: 'Zz Elm', stage: 'contacted', owner: null, owner_user_id: null, owner_team: null, priority: 2, next_step: null, channel: 'import' };
const TARGET = { type: 'target', id: 't1', name: 'Zz Quarry', stage: 'proposed', owner_team: null };
const VISITOR = { type: 'visitor', id: 'v1', name: 'Zz Visit', priority: null, visited: { last_visit: '2026-10-20' } };
const setup = (row, props = {}) => {
  const onToast = jest.fn(), onChanged = jest.fn(), onPatch = jest.fn(), setPanel = jest.fn();
  const record = { next_step: row.next_step ?? null };
  render(<CompanyFacts businessId="b1" row={row} record={record} facts={factsFor(row, record, undefined)} canEdit members={MEMBERS} source={null} panel={null} setPanel={setPanel} onPatch={onPatch} onChanged={onChanged} onToast={onToast} {...props} />);
  return { onToast, onChanged, onPatch, setPanel };
};
const fact = label => document.querySelector(`[data-fact="${label}"]`);
afterEach(() => jest.clearAllMocks());

test('factsFor is unchanged; editable facts follow editControls (+ Next step on partners / employers); Employees / Last touch never edit', () => {
  expect(factsFor(PARTNER, {}, undefined).map(f => f[0])).toEqual(['Stage', 'Priority', 'Owner', 'Team', 'Source', 'Last touch', 'Next step', 'Employees', 'Reach']);
  expect(editableFacts(PARTNER)).toEqual(['Stage', 'Owner', 'Team', 'Priority', 'Source', 'Next step']);
  expect(editableFacts(EMPLOYER)).toEqual(['Stage', 'Owner', 'Team', 'Priority', 'Source', 'Next step']);
  expect(editableFacts(TARGET)).toEqual(['Stage', 'Owner', 'Team', 'Source']);
  expect(editableFacts(VISITOR)).toEqual(['Priority']);
  expect(editableFacts({ type: 'apollo' })).toEqual([]);
  setup(PARTNER);
  for (const l of ['Stage', 'Owner', 'Team', 'Priority', 'Source', 'Next step']) expect(fact(l).tagName).toBe('BUTTON');
  expect(fact('Last touch').tagName).toBe('DIV');
  expect(fact('Stage')).toHaveAttribute('title', 'Stage only moves forward · saves at once · Undo 10 s');
});

test('viewers get plain facts - no buttons, no carets', () => {
  setup(PARTNER, { canEdit: false });
  expect(screen.queryAllByRole('button')).toEqual([]);
  expect(fact('Stage').tagName).toBe('DIV');
});

test('Stage: the popover lists forward stages only; a pick sends the status signal with expect and offers Undo (partner undo)', async () => {
  goalsApi.partnerSignal.mockResolvedValue({ event: { id: 'ev1' } });
  const { onToast } = setup(PARTNER);
  fireEvent.click(fact('Stage'));
  const pop = screen.getByRole('dialog', { name: 'Stage' });
  const opts = within(pop).getAllByRole('option').map(o => o.textContent);
  expect(opts[0]).toBe('Replied · now');
  expect(opts).not.toContain('Not started');
  fireEvent.click(within(pop).getAllByRole('option')[1]);
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'p1', expect.objectContaining({ type: 'status', expect: 'replied' })));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stage' })).toBeNull());
  await onToast.mock.calls[0][0].undo();
  expect(goalsApi.partnerUndo).toHaveBeenCalledWith('b1', 'p1', 'ev1');
});

test('Owner / Team / Priority: the same controls in a popover, saved at once with Undo', async () => {
  goalsApi.partnerSignal.mockResolvedValue({});
  updateOpportunity.mockResolvedValue({});
  const { onToast } = setup(EMPLOYER);
  fireEvent.click(fact('Owner'));
  const owner = screen.getByRole('combobox', { name: 'Owner' });
  expect(within(owner).getAllByRole('option').map(o => o.textContent)).toEqual(['Unassigned', 'Jack Carlson', 'Cyrus Test']);
  goalsApi.editCompanyFields.mockResolvedValue({});
  fireEvent.change(owner, { target: { value: 'u2' } });
  await waitFor(() => expect(goalsApi.editCompanyFields).toHaveBeenCalledWith('b1', 'employer', 'e1', { owner_user_id: 'u2' }));
  expect(onToast.mock.calls[0][0].text).toBe('Zz Elm: owner Cyrus');
  fireEvent.click(fact('Team'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Team' }), { target: { value: 'upside' } });
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'e1', { owner_team: 'upside' }));
  await onToast.mock.calls[1][0].undo();
  expect(updateOpportunity).toHaveBeenLastCalledWith('b1', 'e1', { owner_team: null });
  fireEvent.click(fact('Priority'));
  expect(screen.getByRole('combobox', { name: 'Priority' }).value).toBe('2');
});

test('Next step (D1): partners save next_step through PATCH /land, employers next_action; Undo restores the old text; targets show it read-only', async () => {
  goalsApi.updatePartner.mockResolvedValue({});
  updateOpportunity.mockResolvedValue({});
  const p = setup(PARTNER);
  fireEvent.click(fact('Next step'));
  const input = screen.getByRole('textbox', { name: 'Next step' });
  expect(input.value).toBe('Send the deck');
  fireEvent.change(input, { target: { value: 'Book the pilot call' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(goalsApi.updatePartner).toHaveBeenCalledWith('b1', 'p1', { next_step: 'Book the pilot call' }));
  expect(p.onPatch).toHaveBeenCalledWith({ next_step: 'Book the pilot call' });
  await p.onToast.mock.calls[0][0].undo();
  expect(goalsApi.updatePartner).toHaveBeenLastCalledWith('b1', 'p1', { next_step: 'Send the deck' });
  document.body.innerHTML = '';
  const e = setup(EMPLOYER);
  fireEvent.click(fact('Next step'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Next step' }), { target: { value: 'Send the one-pager' } });
  fireEvent.submit(screen.getByRole('textbox', { name: 'Next step' }).closest('form'));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'e1', { next_action: 'Send the one-pager' }));
  expect(e.onToast).toHaveBeenCalled();
  document.body.innerHTML = '';
  setup(TARGET);
  expect(fact('Next step')).toBeNull(); // a target's facts carry no Next step (no column)
});

test('Source opens the existing form under the facts (the same one the ⋯ menu opens); a press outside a popover closes it', () => {
  const { setPanel } = setup(PARTNER);
  fireEvent.click(fact('Source'));
  expect(setPanel).toHaveBeenCalledWith('source');
  fireEvent.click(fact('Owner'));
  expect(screen.getByRole('dialog', { name: 'Owner' })).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog', { name: 'Owner' })).toBeNull();
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
