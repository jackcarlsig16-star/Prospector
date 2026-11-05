import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { ownerChip, fitChip, dueChip, primaryAction, nextStepText, overviewFacts, liveSince, kindStageWord } from './flowModel';
import { OwnerChip, FitChip, DueChip, LiveChip, KindStageChip } from './FlowChips';
import FitCard, { Radar, AxisRows } from './FitRadar';
import { NextStepCard, ReachedCard, OverviewCard, CameFromCard } from './FlowCards';
import { DeprioritizeForm, TheyRepliedForm, FitMenu, OwnerMenu } from './FlowSheets';
import { goalsApi } from './goalsApi';
import { MEMBER_COLORS, UNASSIGNED_COLOR } from '../../../constants/memberColors';

jest.mock('./goalsApi', () => ({ goalsApi: { deprioritize: jest.fn(), theyReplied: jest.fn(), undoFlow: jest.fn() } }));

// homelover-flow-v1 Stage 2 - the account card pieces (mockups A + C) over invented companies: chips (owner color /
// Me / Other / Unassigned, Fit, Due, Live since), the primary per state, the Next step text, the radar ("—" axes at the
// centre on a dotted spoke, the clients overlay only with clients), the Reached card, the Overview facts, the two sheets.
const MEMBERS = [{ user_id: 'u-jack', name: 'Jack Zz', role: 'owner', color: '#3DBA8C' }, { user_id: 'u-cyrus', name: 'Cyrus Test', role: 'member', color: null }, { user_id: 'u-view', name: 'Vic Viewer', role: 'viewer' }];
const EMPLOYER = { type: 'employer', id: 'o1', name: 'Zz Acme', stage: 'contacted', owner_user_id: 'u-cyrus', owner_team: 'homelover', due: 'week', due_date: '2026-11-07' };
const FIT = { level: 'strong', source: 'computed', score: 78, used: 6, of: 6, hand_level: null, us_footprint: 'mostly_us', us_footprint_source: 'research', overlay: { n: 1, axes: { intent: 50, industry: 90, size: 80, us_footprint: 100, buyers: 40, warm_path: 70 } },
  axes: [{ id: 'intent', value: 62, why: '6 visits · 3 people' }, { id: 'industry', value: 85, why: 'research: why HomeLover fits' }, { id: 'size', value: 80, why: '1,250 employees' }, { id: 'us_footprint', value: 90, why: 'Mostly US' }, { id: 'buyers', value: 55, why: '2 buyer titles' }, { id: 'warm_path', value: 88, why: 'partner referral' }] };
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

test('F2 chips: "Strong fit · 78", Deprioritized with its reason, "Fit —" before a score; Due reads the Due level; Live since reads the history', () => {
  expect(fitChip(FIT).word).toBe('Strong fit · 78');
  expect(fitChip({ level: 'deprioritized', reason: 'mostly_outside_us' })).toMatchObject({ word: 'Deprioritized · Mostly outside US', tone: 'bad' });
  expect(fitChip(null).word).toBe('Fit —');
  expect(fitChip({ level: 'low', source: 'hand', score: 20 }).title).toBe('Set by hand');
  expect(dueChip(EMPLOYER)).toEqual({ word: 'Due this week', date: '2026-11-07' });
  expect(dueChip({ ...EMPLOYER, due: null })).toBeNull();
  expect(liveSince([{ stage: 'replied', at: '2026-10-20T00:00:00Z' }, { stage: 'live', at: '2026-11-03T20:00:00Z' }])).toBe('Nov 3');
  expect(kindStageWord(EMPLOYER)).toBe('Employer · Contacted');
  expect(kindStageWord({ type: 'partner', stage: 'live', category: '4. Brokers & PEOs' })).toBe('Partner · Brokers & PEOs');
  render(<><KindStageChip row={EMPLOYER} /><FitChip fit={FIT} /><DueChip row={EMPLOYER} /><LiveChip since="Nov 3" /></>);
  expect(screen.getByText('Strong fit · 78')).toBeInTheDocument();
  expect(screen.getByText('Due this week')).toBeInTheDocument();
  expect(screen.getByText('Live since Nov 3')).toBeInTheDocument();
});

test('F5 / F8 primary follows the state; Next step text = suggestion > next step > first to-do, with the last touch + visits sub-line', () => {
  expect(primaryAction({ row: { type: 'target', stage: 'researching' } })).toEqual({ id: 'draft', label: 'Draft first email' });
  expect(primaryAction({ row: EMPLOYER })).toEqual({ id: 'follow_up', label: 'Draft follow-up' });
  expect(primaryAction({ row: EMPLOYER, suggestion: { action: 'book_meeting' } }).id).toBe('book');
  expect(primaryAction({ row: EMPLOYER, suggestion: { action: 'they_replied' } }).label).toBe('They replied…');
  expect(primaryAction({ row: { ...EMPLOYER, stage: 'responded' }, suggestion: { action: 'mark_lost' } }).label).toBe('Mark lost?');
  expect(primaryAction({ row: { ...EMPLOYER, stage: 'verbal' } }).id).toBe('make_client');
  expect(primaryAction({ row: { ...EMPLOYER, stage: 'meeting' } }).label).toBe('Next: Proposal/Pilot');
  expect(primaryAction({ row: EMPLOYER, fit: { level: 'deprioritized' } }).id).toBe('bring_back');
  expect(primaryAction({ row: { type: 'partner', stage: 'live' } }).id).toBe('add_client');
  expect(primaryAction({ row: { type: 'partner', stage: 'replied' } })).toBeNull();
  const detail = { record: { next_step: 'Send the deck', next_step_due: '2026-11-07', last_touch: { at: '2026-10-29T18:00:00Z', by: 'Cyrus Test', what: 'Contacted Ana' } }, todos: [{ text: 'Call them', due_date: '2026-11-05' }], visits: [{ visits_7d: 2, top_paths: [{ path: '/employers' }] }] };
  expect(nextStepText({ row: EMPLOYER, detail })).toEqual({ text: 'Send the deck', sub: 'Last touch Oct 29 · Cyrus · Contacted Ana · 2 visits / 7 d · /employers · due Nov 5', empty: false });
  expect(nextStepText({ row: EMPLOYER, detail: { record: {}, todos: [{ text: 'Call them' }], visits: [] } }).text).toBe('Call them');
  expect(nextStepText({ row: EMPLOYER, detail, suggestion: { text: 'Book the meeting' } }).text).toBe('Book the meeting');
  expect(nextStepText({ row: { type: 'target' }, detail: { record: {}, todos: [], visits: [] } })).toMatchObject({ text: 'Research, then draft the first email', empty: true });
});

test('F3 radar: six labelled axes; a "—" axis sits at the centre on a dotted spoke with a hollow marker; the clients overlay only with clients; rows show why + value', () => {
  const axes = Object.fromEntries(FIT.axes.map(a => [a.id, a]));
  const { container, rerender } = render(<Radar axes={{ ...axes, industry: { value: null, why: 'not researched yet' } }} overlay={FIT.overlay} />);
  const svg = container.querySelector('[data-fit-radar]');
  expect(svg.getAttribute('aria-label')).toMatch(/Intent 62, Industry no data, Size 80/);
  expect(svg.querySelectorAll('[data-axis]')).toHaveLength(6);
  expect(svg.querySelector('[data-axis="industry"]').getAttribute('data-missing')).toBe('true');
  expect(svg.querySelector('[data-axis="industry"] line').getAttribute('stroke-dasharray')).toBe('2 4');
  const p = svg.querySelector('[data-point="industry"]');
  expect([p.getAttribute('cx'), p.getAttribute('cy')]).toEqual(['220', '152']);
  expect(svg.querySelector('[data-series="clients"]')).toBeInTheDocument();
  expect(svg.textContent).toMatch(/Your clients \(avg of 1 client\)/);
  rerender(<Radar axes={axes} overlay={{ n: 0, axes: {} }} />);
  expect(container.querySelector('[data-series="clients"]')).toBeNull();
  render(<AxisRows axes={{ ...axes, size: { value: null, why: 'headcount unknown' } }} />);
  expect(document.querySelector('[data-axis-row="size"]').textContent).toMatch(/Size.*headcount unknown.*—/);
  expect(document.querySelector('[data-axis-row="intent"]').textContent).toMatch(/Intent.*6 visits · 3 people.*62/);
  render(<FitCard fit={null} />);
  expect(screen.getByText(/No score yet/)).toBeInTheDocument();
});

test('F6 Reached card: "3 of 11 people" + buyers / replies; nobody known = Check Apollo; F8 Overview facts incl. "—" and "filled at Verbal"', () => {
  const { rerender } = render(<ReachedCard reach={{ known: 11, reached: 3, buyers: 6, buyers_reached: 2, buyers_not_yet: 4, replies: 0 }} canEdit onCheckApollo={jest.fn()} />);
  expect(document.querySelector('[data-reached]').textContent).toBe('3of 11 people');
  expect(document.querySelector('[data-reached-sub]').textContent).toBe('2 buyers reached · 4 buyers not yet · 0 replies');
  rerender(<ReachedCard reach={{ known: 0, reached: 0 }} canEdit onCheckApollo={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Check Apollo' })).toBeInTheDocument();
  const facts = overviewFacts({ row: EMPLOYER, record: { employees: 1250, employees_source: 'apollo', employees_at: '2026-10-28' }, research: { sells_to: 'Healthcare services', hq_city: 'Phoenix, AZ', housing_perk: 'no housing perk found' }, fit: FIT, source: { source_kind: 'partner_referral', partner_name: 'HUB' }, visits: [{ visits_7d: 6, top_paths: [{ path: '/employers' }, { path: '/pricing' }] }], client: null });
  expect(facts.map(f => [f[0], f[1]])).toEqual([['Employees', '1,250'], ['US footprint', 'Mostly US'], ['Industry', 'Healthcare services'], ['HQ', 'Phoenix, AZ'], ['Came from', 'Partner referral · HUB'], ['Website', '6 visits'], ['Deal', '— lives · — launch']]);
  expect(facts.find(f => f[0] === 'Deal')[2]).toBe('filled at Verbal');
  const bare = overviewFacts({ row: EMPLOYER, record: {}, research: null, fit: null, source: null, visits: [] });
  expect(bare.map(f => f[1])).toEqual(['—', '—', '—', '—', 'Not set', 'No visits yet', '— lives · — launch']);
  render(<OverviewCard row={EMPLOYER} record={{}} research={null} fit={null} source={null} visits={[]} client={null} canEdit onSetSource={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Not set — Set it' })).toBeInTheDocument();
  render(<CameFromCard network={{ came_from: { kind: 'partner_referral', label: 'Partner referral', partner_not_set: true }, ownership: { team: 'HomeLover', owner: null, co_owner_name: 'Brad' } }} canEdit onSetSource={jest.fn()} />);
  expect(screen.getByText('partner not set')).toBeInTheDocument();
  expect(screen.getByText(/Ownership: HomeLover · co-owner set/)).toBeInTheDocument();
});

test('Next step card: the primary is the flow\'s first item and hands back its id', () => {
  const onPrimary = jest.fn();
  render(<NextStepCard row={EMPLOYER} detail={{ record: { next_step: 'Follow up with the 2 buyers' }, todos: [], visits: [] }} suggestion={null} reach={null} primary={{ id: 'follow_up', label: 'Draft follow-up' }} busy="" canEdit onPrimary={onPrimary} />);
  expect(screen.getByText('Follow up with the 2 buyers')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));
  expect(onPrimary).toHaveBeenCalledWith({ id: 'follow_up', label: 'Draft follow-up' });
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

test('Fit menu: Strong · Good · Low by hand (+ clear when set), Deprioritize…; Bring back when deprioritized. Owner menu: Me first, members in color, the current owner just closes', () => {
  const onSet = jest.fn(), onDep = jest.fn(), onBack = jest.fn(), onClose = jest.fn(), onPick = jest.fn();
  const { rerender } = render(<FitMenu fit={{ ...FIT, hand_level: 'good' }} busy={false} onSet={onSet} onDeprioritize={onDep} onBringBack={onBack} onClose={onClose} />);
  expect(within(screen.getByRole('menu', { name: 'Fit' })).getAllByRole('menuitemradio').map(b => b.textContent)).toEqual(['Strong', 'Good · set by hand', 'Low']);
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Good · set by hand' }));
  expect(onSet).toHaveBeenCalledWith(null);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Deprioritize…' }));
  expect(onDep).toHaveBeenCalled();
  rerender(<FitMenu fit={{ level: 'deprioritized', reason: 'too_small' }} busy={false} onSet={onSet} onDeprioritize={onDep} onBringBack={onBack} onClose={onClose} />);
  expect(screen.queryByRole('menuitem', { name: 'Deprioritize…' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Bring back' }));
  expect(onBack).toHaveBeenCalled();
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
