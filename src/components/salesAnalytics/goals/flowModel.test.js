import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { ownerChip, primaryAction, nextStepText, liveSince, kindStageWord } from './flowModel';
import { OwnerChip, LiveChip, KindStageChip } from './FlowChips';
import { NextStepCard, CameFromCard } from './FlowCards';
import { DeprioritizeForm, TheyRepliedForm, OwnerMenu } from './FlowSheets';
import { goalsApi } from './goalsApi';
import { MEMBER_COLORS, UNASSIGNED_COLOR } from '../../../constants/memberColors';

jest.mock('./goalsApi', () => ({ goalsApi: { deprioritize: jest.fn(), theyReplied: jest.fn(), undoFlow: jest.fn() } }));

// homelover-flow-v1 Stage 2 - the live partner's card pieces (mockup C) over invented companies: chips (owner color /
// Me / Other / Unassigned, kind, Live since), the primary, the Next step text, Came from, the two sheets, the Owner
// menu, the Map's flow menu.
const MEMBERS = [{ user_id: 'u-jack', name: 'Jack Zz', role: 'owner', color: '#3DBA8C' }, { user_id: 'u-cyrus', name: 'Cyrus Test', role: 'member', color: null }, { user_id: 'u-view', name: 'Vic Viewer', role: 'viewer' }];
const EMPLOYER = { type: 'employer', id: 'o1', name: 'Zz Acme', stage: 'contacted', owner_user_id: 'u-cyrus', owner_team: 'homelover', due: 'week', due_date: '2026-11-07' };
afterEach(() => jest.clearAllMocks());

test('F1 owner chip: a member in their stored color (Me for the viewer), the next free palette color when none is stored, Other for Upside, dashed Unassigned', () => {
  expect(ownerChip({ ownerUserId: 'u-jack', members: MEMBERS, meId: 'u-jack' })).toMatchObject({ word: 'Me', color: '#3DBA8C', dashed: false });
  expect(ownerChip({ ownerUserId: 'u-jack', members: MEMBERS, meId: 'u-cyrus' }).word).toBe('Jack');
  expect(ownerChip({ ownerUserId: 'u-cyrus', members: MEMBERS }).color).toBe(MEMBER_COLORS[1]);
  expect(ownerChip({ ownerUserId: null, ownerTeam: 'upside', members: MEMBERS })).toMatchObject({ word: 'Other', kind: 'other' });
  expect(ownerChip({ ownerUserId: null, members: MEMBERS })).toMatchObject({ word: 'Unassigned', dashed: true, color: UNASSIGNED_COLOR });
  render(<><OwnerChip row={EMPLOYER} members={MEMBERS} meId="u-jack" /><OwnerChip row={{ ...EMPLOYER, owner_user_id: null }} members={MEMBERS} meId="u-jack" /></>);
  expect(screen.getByText('Cyrus')).toBeInTheDocument();
  expect(document.querySelector('[data-chip="owner"]').style.getPropertyValue('--owner-color')).toBe(MEMBER_COLORS[1]);
  expect(screen.getByText('Unassigned').closest('[data-chip]').style.borderStyle).toBe('dashed');
});

test('F1 / F9 chips: kind + category word; Live since reads the history', () => {
  expect(liveSince([{ stage: 'replied', at: '2026-10-20T00:00:00Z' }, { stage: 'live', at: '2026-11-03T20:00:00Z' }])).toBe('Nov 3');
  expect(kindStageWord(EMPLOYER)).toBe('Employer · Contacted');
  expect(kindStageWord({ type: 'partner', stage: 'live', category: '4. Brokers & PEOs' })).toBe('Partner · Brokers & PEOs');
  render(<><KindStageChip row={{ type: 'partner', stage: 'live', category: '4. Brokers & PEOs' }} /><LiveChip since="Nov 3" /></>);
  expect(screen.getByText('Partner · Brokers & PEOs')).toBeInTheDocument();
  expect(screen.getByText('Live since Nov 3')).toBeInTheDocument();
});

test('F9 primary: a live partner adds a referred client, Bring back while deprioritized, nothing for other rows; Next step text = next step > first to-do, with the last touch + visits sub-line', () => {
  expect(primaryAction({ row: { type: 'partner', stage: 'live' } }).id).toBe('add_client');
  expect(primaryAction({ row: { type: 'partner', stage: 'live' }, fit: { level: 'deprioritized' } }).id).toBe('bring_back');
  expect(primaryAction({ row: { type: 'partner', stage: 'replied' } })).toBeNull();
  expect(primaryAction({ row: EMPLOYER })).toBeNull();
  const detail = { record: { next_step: 'Send the deck', next_step_due: '2026-11-07', last_touch: { at: '2026-10-29T18:00:00Z', by: 'Cyrus Test', what: 'Contacted Ana' } }, todos: [{ text: 'Call them', due_date: '2026-11-05' }], visits: [{ visits_7d: 2, top_paths: [{ path: '/employers' }] }] };
  expect(nextStepText({ row: EMPLOYER, detail })).toEqual({ text: 'Send the deck', sub: 'Last touch Oct 29 · Cyrus · Contacted Ana · 2 visits / 7 d · /employers · due Nov 5', empty: false });
  expect(nextStepText({ row: EMPLOYER, detail: { record: {}, todos: [{ text: 'Call them' }], visits: [] } }).text).toBe('Call them');
  expect(nextStepText({ row: { type: 'target' }, detail: { record: {}, todos: [], visits: [] } })).toMatchObject({ text: 'Research, then draft the first email', empty: true });
});

test('F9 Came from: partner not set — Set it; ownership line', () => {
  render(<CameFromCard network={{ came_from: { kind: 'partner_referral', label: 'Partner referral', partner_not_set: true }, ownership: { team: 'HomeLover', owner: null, co_owner_name: 'Brad' } }} canEdit onSetSource={jest.fn()} />);
  expect(screen.getByText('partner not set')).toBeInTheDocument();
  expect(screen.getByText(/Ownership: HomeLover · co-owner set/)).toBeInTheDocument();
});

test('Next step card: the primary hands back its id', () => {
  const onPrimary = jest.fn();
  render(<NextStepCard row={EMPLOYER} detail={{ record: { next_step: 'Follow up with the 2 buyers' }, todos: [], visits: [] }} primary={{ id: 'add_client', label: '+ Add a client they referred' }} busy="" canEdit onPrimary={onPrimary} />);
  expect(screen.getByText('Follow up with the 2 buyers')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '+ Add a client they referred' }));
  expect(onPrimary).toHaveBeenCalledWith({ id: 'add_client', label: '+ Add a client they referred' });
});

test('F4 Deprioritize sheet: six reason chips; Other needs a note; saves with expect, toasts with Undo (the flow undo)', async () => {
  goalsApi.deprioritize.mockResolvedValue({ fit: { word: 'Too small' }, event: { id: 'ev1' } });
  const onToast = jest.fn(), onChanged = jest.fn(), onDone = jest.fn();
  render(<DeprioritizeForm businessId="b1" row={EMPLOYER} expect="contacted" onDone={onDone} onCancel={jest.fn()} onToast={onToast} onChanged={onChanged} />);
  expect(within(screen.getByRole('radiogroup', { name: 'Reason' })).getAllByRole('radio').map(r => r.textContent)).toEqual(['Mostly outside US', 'Too small', 'Wrong industry', 'Has housing perk', 'Upside owns', 'Other…']);
  fireEvent.click(screen.getByRole('radio', { name: 'Other…' }));
  expect(screen.getByRole('button', { name: 'Deprioritize' })).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: 'Too small' }));
  fireEvent.click(screen.getByRole('button', { name: 'Deprioritize' }));
  await waitFor(() => expect(goalsApi.deprioritize).toHaveBeenCalledWith('b1', 'employer', 'o1', { reason: 'too_small', expect: 'contacted' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(onToast.mock.calls[0][0].text).toBe('Zz Acme: deprioritized · Too small');
  await onToast.mock.calls[0][0].undo();
  expect(goalsApi.undoFlow).toHaveBeenCalledWith('b1', 'ev1');
});

test('F7 They replied… sheet: six outcomes; a pick sends outcome + expect, patches the stage and toasts with Undo; a 409 reads "changed elsewhere"', async () => {
  goalsApi.theyReplied.mockResolvedValue({ stage: { before: 'contacted', after: 'meeting' }, suggestion: null, event: { id: 'ev2' } });
  const onToast = jest.fn(), onPatch = jest.fn();
  render(<TheyRepliedForm businessId="b1" row={EMPLOYER} expect="contacted" onDone={jest.fn()} onCancel={jest.fn()} onToast={onToast} onChanged={jest.fn()} onPatch={onPatch} />);
  expect(screen.getByRole('group', { name: 'They replied' }).querySelectorAll('button')).toHaveLength(7);
  fireEvent.click(screen.getByRole('button', { name: 'Meeting set' }));
  await waitFor(() => expect(goalsApi.theyReplied).toHaveBeenCalledWith('b1', 'o1', { outcome: 'meeting_set', expect: 'contacted' }));
  await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ stage: 'meeting' }));
  expect(onToast.mock.calls[0][0].text).toBe('Zz Acme: Meeting set · moved to meeting');
  goalsApi.theyReplied.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 409 }));
  fireEvent.click(screen.getByRole('button', { name: 'No' }));
  await screen.findByText('This changed elsewhere - refresh');
});

test('Owner menu: Me first, members in color, the current owner just closes', () => {
  const onClose = jest.fn(), onPick = jest.fn();
  render(<OwnerMenu row={EMPLOYER} members={MEMBERS} meId="u-jack" busy={false} onPick={onPick} onClose={onClose} />);
  const items = within(screen.getByRole('menu', { name: 'Owner' })).getAllByRole('menuitemradio');
  expect(items.map(b => b.textContent)).toEqual(['Me (Jack)', 'Cyrus · now', 'Unassigned']);
  fireEvent.click(items[1]);
  expect(onPick).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(items[0]);
  expect(onPick).toHaveBeenCalledWith('u-jack');
});

test('F5 flow menu per state: unowned target = Claim + Research / Promote / Draft / To-do / Open; owned = Draft first; contacted = They replied… first; responded = Book meeting; verbal+ = Make client; live partner = Add referred client; deprioritized = reason + Bring back', () => {
  const { flowMenu } = require('./flowModel');
  const ids = p => p.items.map(i => i.id);
  const unowned = flowMenu({ type: 'target', stage: 'researching', owner_user_id: null });
  expect([unowned.claim, ids(unowned), unowned.deprioritize]).toEqual([true, ['research', 'promote', 'draft', 'todo', 'open'], true]);
  expect(ids(flowMenu({ type: 'target', stage: 'researching', owner_user_id: 'u1' }))).toEqual(['draft', 'contacted', 'research', 'todo', 'open']);
  expect(ids(flowMenu({ type: 'employer', stage: 'target', owner_user_id: null }))).toEqual(['research', 'draft', 'todo', 'open']);
  expect(ids(flowMenu({ type: 'employer', stage: 'contacted', owner_user_id: 'u1' }))).toEqual(['they_replied', 'book', 'call', 'draft', 'open']);
  expect(ids(flowMenu({ type: 'employer', stage: 'responded', owner_user_id: 'u1' }))).toEqual(['book', 'next', 'open']);
  expect(flowMenu({ type: 'employer', stage: 'meeting' }).items[0].label).toBe('Next: Proposal/Pilot');
  expect(ids(flowMenu({ type: 'employer', stage: 'verbal' }))).toEqual(['make_client', 'open']);
  expect(ids(flowMenu({ type: 'partner', stage: 'live', owner_user_id: 'u2' }))).toEqual(['add_client', 'log_referral', 'book', 'open']);
  expect(ids(flowMenu({ type: 'partner', stage: 'replied', owner_user_id: 'u2' }))).toEqual(['draft', 'research', 'todo', 'open']);
  const dep = flowMenu({ type: 'employer', stage: 'contacted', fit_level: 'deprioritized', deprioritized_reason: 'mostly_outside_us' });
  expect([dep.bring_back, dep.reason, ids(dep), dep.deprioritize, dep.claim]).toEqual([true, 'mostly_outside_us', ['open'], false, false]);
});
