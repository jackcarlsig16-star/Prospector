import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CallNotesPanel from './CallNotesPanel';
import { goalsApi } from '../goals/goalsApi';
import { laWeekStart } from '../periods';

import { fathomApi } from '../goals/fathomApi';

jest.mock('../goals/goalsApi', () => ({ goalsApi: { extractCallNotes: jest.fn(), createFromCallNotes: jest.fn(), appendToSection: jest.fn(), reviewCallNote: jest.fn(), acceptCallNote: jest.fn(), setCallRecord: jest.fn() } }));
jest.mock('../goals/fathomApi', () => ({ fathomApi: { extractNote: jest.fn() } }));

const JACK = 'u-jack', CY = 'u-cy';
const members = [{ user_id: JACK }, { user_id: CY }];
const lookup = id => ({ [JACK]: { first: 'Jack', color: '#6F8CF0' }, [CY]: { first: 'Cyrus', color: '#C97626' } }[id] || { first: 'Unassigned', color: '#888' });
const links = { options: {}, load: jest.fn(), labelFor: (t, id) => `${t}: ${id}` };
const proposal = (text, extra) => ({ text, owner_user_id: null, due_date: null, link_type: null, link_id: null, company_name: null, steps: [], evidence: '', similar_to: null, ...extra });

const setup = props => render(<CallNotesPanel businessId="b1" members={members} lookup={lookup} links={links} onClose={jest.fn()} onCreated={jest.fn()} onShowCalls={jest.fn()} {...props} />);
const paste = text => fireEvent.change(screen.getByLabelText('Call notes'), { target: { value: text } });

afterEach(() => jest.clearAllMocks());

test('nothing is written until Create; only ticked, edited proposals are sent', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({
    call_date: '2026-10-07', summary: ['Decided A', 'Decided B', 'Decided C'],
    tasks: [
      proposal('Send BenefitHub deck', { owner_user_id: JACK, steps: ['Draft', 'Send'], link_type: 'partner', link_id: 'p1' }),
      proposal('Call Brad', { owner_user_id: CY, due_date: '2026-10-09' }),
      proposal('Exhibit C on attribution'),
      proposal('Follow up with Christina', { similar_to: { id: 'old', text: 'Follow up with Christina at Norton' } }),
      proposal('Re-review decks'),
    ],
  });
  goalsApi.createFromCallNotes.mockResolvedValue({ goals: [{}, {}, {}], note: { id: 'n1', title: 'Weekly sync' } });
  const onCreated = jest.fn();
  setup({ onCreated });
  fireEvent.change(screen.getByLabelText('Call title'), { target: { value: 'Weekly sync' } });
  paste('Jack will send the BenefitHub deck. Cyrus to call Brad by Friday.');
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  await screen.findByText('Decided A');
  expect(goalsApi.extractCallNotes).toHaveBeenCalledWith('b1', expect.objectContaining({ title: 'Weekly sync' }));
  expect(goalsApi.createFromCallNotes).not.toHaveBeenCalled();

  // The one that matches an earlier call starts unticked.
  expect(screen.getByRole('button', { name: 'Create: Follow up with Christina' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText(/Already a task from an earlier call/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Accept 4' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Create: Re-review decks' }));
  fireEvent.change(screen.getByLabelText('Owner of Exhibit C on attribution'), { target: { value: CY } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove step: Draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept 3' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(3, { id: 'n1', title: 'Weekly sync' }, expect.anything()));

  const body = goalsApi.createFromCallNotes.mock.calls[0][1];
  expect(body.call_date).toBe('2026-10-07');
  expect(body.source_type).toBe('call');
  expect(body.companies).toEqual([]);
  expect(body.tasks).toEqual([
    { text: 'Send BenefitHub deck', owner_user_id: JACK, due_date: null, link_type: 'partner', link_id: 'p1', steps: ['Send'] },
    { text: 'Call Brad', owner_user_id: CY, due_date: '2026-10-09', link_type: null, link_id: null, steps: [] },
    { text: 'Exhibit C on attribution', owner_user_id: CY, due_date: null, link_type: null, link_id: null, steps: [] },
  ]);
});

test('notes pasted before: says so, offers the earlier tasks, no Find', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({ duplicate: { id: 'n1', title: 'Weekly sync', call_date: '2026-10-06', task_count: 3 } });
  const onShowCalls = jest.fn();
  setup({ onShowCalls });
  paste('same notes');
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  expect(await screen.findByText(/already pasted as “Weekly sync” for the call on Oct 6 - 3 tasks came from them/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Read notes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Show tasks from calls' }));
  expect(onShowCalls).toHaveBeenCalled();
  expect(goalsApi.createFromCallNotes).not.toHaveBeenCalled();
});

test('a server error shows and keeps the review', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({ call_date: '2026-10-07', summary: [], tasks: [proposal('Call Brad')] });
  goalsApi.createFromCallNotes.mockRejectedValue(new Error('This week is finalized - reopen it to edit'));
  setup();
  paste('notes');
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accept 1' }));
  expect(await screen.findByText('This week is finalized - reopen it to edit')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Accept 1' })).toBeEnabled();
});

test('summary reaches report §1 only on click, as one draft line for this week', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({ call_date: '2026-10-06', summary: ['Decided A.', 'Decided B.', 'Decided C.'], tasks: [proposal('Call Brad')] });
  goalsApi.appendToSection.mockResolvedValue({ section: {} });
  setup();
  fireEvent.change(screen.getByLabelText('Call title'), { target: { value: 'Weekly sync' } });
  paste('notes');
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  await screen.findByText('Decided A.');
  expect(goalsApi.appendToSection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add to report §1' }));
  expect(await screen.findByText('Added to this week’s report §1 as a draft line')).toBeInTheDocument();
  expect(goalsApi.appendToSection).toHaveBeenCalledTimes(1);
  expect(goalsApi.appendToSection).toHaveBeenCalledWith('b1', laWeekStart(), 's1', 'From call · Oct 6 · Weekly sync: Decided A. Decided B. Decided C.');
  expect(screen.queryByRole('button', { name: 'Add to report §1' })).not.toBeInTheDocument();
  expect(goalsApi.createFromCallNotes).not.toHaveBeenCalled();
});

test('a finalized week says so and the button stays', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({ call_date: '2026-10-07', summary: ['Decided A.'], tasks: [] });
  goalsApi.appendToSection.mockRejectedValue(new Error('This week is finalized - reopen it to edit'));
  setup();
  paste('notes');
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to report §1' }));
  expect(await screen.findByText('This week is finalized - reopen it to edit')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add to report §1' })).toBeEnabled();
});

const company = (key, name, extra) => ({ key, name, kind: 'partner', category: null, evidence: `${name} came up`, match: null, action: 'target_partner', on: true, ...extra });
const GAL = { type: 'partner', id: 'p-gal', name: 'Gallagher', partial: false, pipeline_status: 'replied' };
const SC = { type: 'account', id: 'a-sc', name: '[solidcore]', partial: false };

test('Intake: five sections in order; only ticked rows are sent; rows on a skipped new company go nowhere', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({
    call_date: '2026-10-13', summary: [], tasks: [proposal('Book Solidcore December call', { link_type: 'company', link_id: 'a-sc' })],
    categories: ['4. Mid-Market Benefits Brokers'], rejected: ['ZeroBounce'],
    companies: [
      company('c0', 'Gallagher', { match: GAL, action: 'note' }),
      company('c1', 'Lockton', { category: '4. Mid-Market Benefits Brokers' }),
      company('c2', 'Fundrise'),
      company('c3', 'Solidcore', { kind: 'employer', match: SC, action: 'none', on: false }),
      company('c4', 'Plaid', { kind: 'not_target', action: 'skip', on: false }),
    ],
    people: [
      { key: 'p0', name: 'Ana Zz', company: 'Fundrise', company_key: 'c2', match: null, title: 'VP', role: 'champion', moved_from: null, moved_from_match: null, evidence: '', dest: 'research_notes', existing: null, on: true },
      { key: 'p1', name: 'Pat Nobody', company: 'Unknown', company_key: null, match: null, title: null, role: 'other', moved_from: null, moved_from_match: null, evidence: '', dest: null, existing: null, on: false },
    ],
    touches: [
      { key: 't0', company: 'Gallagher', company_key: 'c0', match: GAL, touch_type: 'meeting', people: ['Kim Zz'], date: '2026-10-12', direction: 'out', stage: 'meeting_set', stage_on: true, evidence: 'met Kim', kept_with_note: false, duplicate: null, warning: "Upside owns this (Brad) - don't double-touch", on: true },
      { key: 't1', company: '[solidcore]', company_key: 'c3', match: SC, touch_type: 'email', people: ['Crystal Pringle'], date: '2026-10-13', direction: 'in', stage: null, stage_on: false, evidence: 'circle back', kept_with_note: true, duplicate: null, warning: null, on: false },
      { key: 't2', company: 'Gallagher', company_key: 'c0', match: GAL, touch_type: 'email', people: ['Pat Example'], date: '2026-10-13', direction: 'out', stage: null, stage_on: false, evidence: '', kept_with_note: false, duplicate: { source: 'outlook', date: '2026-10-12' }, warning: null, on: false },
    ],
    ownership: [{ key: 'o0', company: 'Gallagher', company_key: 'c0', match: GAL, owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true, owner_name: 'Brad', evidence: 'Upside owns Gallagher', old: { owner_team: null, co_owner_name: null, no_double_touch: false }, creates_opportunity: false, dest: 'partner', on: true }],
    facts: [
      { key: 'f0', company: 'Gallagher', company_key: 'c0', match: GAL, field: 'next_step', column: 'next_step', text: 'Send deck', single: true, old: 'Old step', due_date: null, evidence: '', creates_opportunity: false, on: true },
      { key: 'f1', company: 'Fundrise', company_key: 'c2', match: null, field: 'angle', column: 'research_notes', text: 'Renters', single: false, old: null, due_date: null, evidence: '', creates_opportunity: false, on: true },
    ],
  });
  goalsApi.createFromCallNotes.mockResolvedValue({ goals: [{}], note: { id: 'n2', title: null }, targets: [] });
  setup();
  fireEvent.change(screen.getByLabelText('What these notes are'), { target: { value: 'partner_update' } });
  fireEvent.change(screen.getByLabelText('Source label'), { target: { value: 'Brad weekly 10/13' } });
  paste('notes');
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  await screen.findByRole('region', { name: 'Companies mentioned' });
  expect(goalsApi.extractCallNotes).toHaveBeenCalledWith('b1', expect.objectContaining({ source_type: 'partner_update', source_label: 'Brad weekly 10/13' }));
  expect(screen.getAllByRole('region').map(r => r.getAttribute('aria-label')).slice(1)).toEqual(['Companies mentioned', 'People', 'Touches', 'Tasks', 'Ownership & intel']);
  expect(screen.getByText(/Already recorded Oct 12 via Outlook - left unticked/)).toBeInTheDocument();
  expect(screen.getByText(/Kept with the note - employer timelines/)).toBeInTheDocument();
  expect(screen.getByText(/Upside owns this \(Brad\) - don't double-touch/)).toBeInTheDocument();
  expect(screen.getByText('Old step → Send deck')).toBeInTheDocument();
  expect(screen.getByText(/Not proposed again \(you said never\): ZeroBounce/)).toBeInTheDocument();
  // 3 companies + 1 person + 1 touch + 1 task + 1 ownership + 2 facts
  expect(screen.getByRole('button', { name: 'Accept 9' })).toBeEnabled();

  // Skipping Fundrise takes its person and fact with it; dropping the stage chip keeps the touch.
  fireEvent.change(screen.getByLabelText('What to do with Fundrise'), { target: { value: 'skip' } });
  expect(screen.getAllByText('Tick Fundrise as a target to keep this')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Move Gallagher to Meeting' }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept 6' }));
  await waitFor(() => expect(goalsApi.createFromCallNotes).toHaveBeenCalled());
  const body = goalsApi.createFromCallNotes.mock.calls[0][1];
  expect(body.source_type).toBe('partner_update');
  expect(body.companies.map(c => [c.name, c.action])).toEqual([['Gallagher', 'note'], ['Lockton', 'target_partner']]);
  expect(body.companies[1].category).toBe('4. Mid-Market Benefits Brokers');
  expect(body.people).toEqual([]);
  expect(body.facts.map(f => f.text)).toEqual(['Send deck']);
  expect(body.touches).toEqual([{ key: 't0', match: GAL, touch_type: 'meeting', people: ['Kim Zz'], date: '2026-10-12', evidence: 'met Kim', stage: 'meeting_set', stage_on: false, expect: 'replied' }]);
  expect(body.ownership).toEqual([{ company_key: 'c0', match: GAL, owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true, owner_name: 'Brad' }]);
  expect(JSON.stringify(body)).not.toMatch(/Pat Nobody|Crystal Pringle|Pat Example/);
});

// call-notes-targets-v1 REV5 - the deal sections, the 24 h warning, and the stored extract riding back with Accept.
test('review: Decisions · Waiting on them · Terms · Next meeting after Touches; non-partner rows greyed; 24 h warning; extract + sig sent back', async () => {
  const eq = { type: 'partner', id: 'g1', name: 'Equifax', pipeline_status: 'meeting_set' };
  goalsApi.extractCallNotes.mockResolvedValue({
    call_date: '2026-10-16', summary: ['Pilot agreed'], tasks: [],
    touches: [{ key: 't0', company: 'Equifax', match: eq, touch_type: 'meeting', people: ['Dana'], date: '2026-10-16', direction: 'out', stage: null, stage_on: false, evidence: 'sync', kept_with_note: false, duplicate: null, warning: null, on: true }],
    decisions: [{ key: 'd0', company: 'Equifax', match: eq, text: 'Pilot with 3 employers', evidence: 'pilot runs', on: true }, { key: 'd1', company: 'Acme', match: null, text: 'Acme goes first', evidence: 'x', on: false }],
    waiting_on: [{ key: 'w0', company: 'Equifax', match: eq, who: 'Dana', text: 'Send the employer list', due_date: '2026-10-23', evidence: 'Dana to send', on: true }],
    terms: [{ key: 'm0', company: 'Equifax', match: eq, text: 'Equifax keeps 20%', line: '(10/16) Terms: Equifax keeps 20%', evidence: '20%', on: true }],
    next_meeting: [{ key: 'n0', company: 'Equifax', match: eq, date: '2026-10-26', text: 'Pick employers', old: null, evidence: 'week of Oct 27', on: true }],
    recent_accepts: [{ partner: 'Equifax', partner_id: 'g1', note_id: 'n0', minutes_ago: 42, todos: 5, events: 3 }],
    extract: { tasks: [] }, extract_sig: 'sig-1',
  });
  goalsApi.createFromCallNotes.mockResolvedValue({ goals: [], note: { id: 'n1' } });
  setup();
  paste('Equifax sync notes');
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  await screen.findByText('Pilot agreed');
  expect(screen.getByRole('note')).toHaveTextContent('⚠ Another note on Equifax was accepted 42 min ago (5 to-dos, 3 events)');
  const order = [...document.querySelectorAll('section[aria-label]')].map(s => s.getAttribute('aria-label'));
  expect(order.slice(order.indexOf('Touches'), order.indexOf('Touches') + 5)).toEqual(['Touches', 'Decisions', 'Waiting on them', 'Terms', 'Next meeting']);
  expect(screen.getByText('Not stored - only a partner keeps it')).toBeInTheDocument();
  expect(screen.getByText('+ (10/16) Terms: Equifax keeps 20%')).toBeInTheDocument();
  expect(screen.getByText('— → Oct 26 · Pick employers')).toBeInTheDocument();
  expect(screen.getByText(/Dana/, { selector: 'strong' }).parentElement).toHaveTextContent('Dana · Equifax · due Oct 23');
  fireEvent.click(screen.getByRole('button', { name: 'Accept 5' }));
  await waitFor(() => expect(goalsApi.createFromCallNotes).toHaveBeenCalled());
  const body = goalsApi.createFromCallNotes.mock.calls[0][1];
  expect(body.decisions).toEqual([{ match: eq, text: 'Pilot with 3 employers' }]);
  expect(body.waiting_on).toEqual([{ match: eq, who: 'Dana', text: 'Send the employer list', due_date: '2026-10-23' }]);
  expect(body.terms).toEqual([{ match: eq, text: 'Equifax keeps 20%' }]);
  expect(body.next_meeting).toEqual([{ match: eq, date: '2026-10-26' }]);
  expect(body.extract).toEqual({ tasks: [] });
  expect(body.extract_sig).toBe('sig-1');
});

// lead-source-v1 - the extract's referred_by is an editable proposal on a company Accept creates; cleared = not sent.
test('Intake: referred_by shows as editable fields on a new target, edits ride with Accept, clear sends null', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({
    call_date: '2026-10-13', summary: [], tasks: [], categories: [],
    companies: [
      company('c0', 'Lockton', { referred_by: { partner: 'Upside', partner_id: 'g-up', person: 'Brad', office: null } }),
      company('c1', 'Fundrise', { referred_by: { partner: 'Hub', partner_id: null, person: null, office: null } }),
      company('c2', 'Gallagher', { match: GAL, action: 'note' }),
    ],
    people: [], touches: [], ownership: [], facts: [],
  });
  goalsApi.createFromCallNotes.mockResolvedValue({ goals: [], note: { id: 'n3', title: null }, targets: [] });
  setup();
  paste('notes');
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  await screen.findByRole('region', { name: 'Companies mentioned' });
  expect(screen.getByLabelText('Person who referred Lockton')).toHaveValue('Brad');
  expect(screen.getByText('✓ in Pipeline')).toBeInTheDocument();
  expect(screen.getByText('not in Pipeline yet')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Referred by for Gallagher' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Office who referred Lockton'), { target: { value: 'Chicago' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clear referred by for Fundrise' }));
  fireEvent.click(screen.getByRole('button', { name: /^Accept/ }));
  await waitFor(() => expect(goalsApi.createFromCallNotes).toHaveBeenCalled());
  const body = goalsApi.createFromCallNotes.mock.calls[0][1];
  expect(body.companies.map(c => [c.name, c.referred_by])).toEqual([
    ['Lockton', { partner: 'Upside', partner_id: 'g-up', person: 'Brad', office: 'Chicago' }], ['Fundrise', null], ['Gallagher', null],
  ]);
});

// ---- fathom-notes-v1 Stage 2: a stored note (noteId), the paste warning, ideas ----
const NOTE = { id: 'n9', title: 'Northwind weekly', call_date: '2026-11-20', source_type: 'call', source_label: 'Fathom · Northwind weekly', accepted_at: null, fathom_url: 'https://fathom.video/share/abc', attendees: [] };
const REVIEW = { note: NOTE, call_date: '2026-11-20', summary: ['Pilot agreed'], tasks: [proposal('Send Northwind the one-pager', { owner_user_id: JACK }), proposal('Book the kickoff')],
  ideas: [{ text: 'A pilot dashboard the employer can open', kind: 'product', company: 'Northwind', evidence: 'could we see it live' }] };

test('noteId: the panel opens AT the review of the stored note - no paste box, no model call - and Accept goes to the accept-existing route', async () => {
  goalsApi.reviewCallNote.mockResolvedValue(REVIEW);
  goalsApi.acceptCallNote.mockResolvedValue({ goals: [{}], note: { ...NOTE, accepted_at: '2026-11-20T19:00:00Z' } });
  const onCreated = jest.fn();
  setup({ noteId: 'n9', onCreated });
  await screen.findByText('Pilot agreed');
  expect(goalsApi.reviewCallNote).toHaveBeenCalledWith('b1', 'n9');
  expect(screen.queryByLabelText('Call notes')).toBeNull();
  expect(screen.queryByRole('radiogroup', { name: 'What to read' })).toBeNull();
  expect(screen.queryByRole('button', { name: '← Back to notes' })).toBeNull();
  expect(screen.getByText(/Call summary · Northwind weekly · Oct|Call summary · Northwind weekly · Nov 20/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open in Fathom ↗' })).toHaveAttribute('href', NOTE.fathom_url);
  // ideas are shown, never sent
  expect(screen.getByRole('region', { name: /^Ideas/ })).toHaveTextContent('product · Northwind · A pilot dashboard the employer can open');
  fireEvent.click(screen.getByRole('button', { name: 'Create: Book the kickoff' }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept 1' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(1, expect.objectContaining({ id: 'n9' }), expect.anything()));
  const [, id, body] = goalsApi.acceptCallNote.mock.calls[0];
  expect(id).toBe('n9');
  expect(body.tasks).toEqual([{ text: 'Send Northwind the one-pager', owner_user_id: JACK, due_date: null, link_type: null, link_id: null, steps: [] }]);
  expect(body).not.toHaveProperty('text'); expect(body).not.toHaveProperty('ideas'); expect(body).not.toHaveProperty('extract');
  expect(goalsApi.createFromCallNotes).not.toHaveBeenCalled();
  expect(goalsApi.extractCallNotes).not.toHaveBeenCalled();
  expect(fathomApi.extractNote).not.toHaveBeenCalled();
});

test('noteId with no extract yet: one button, Extract; past the cap the reason shows and the button stays; an accepted note says so', async () => {
  goalsApi.reviewCallNote.mockResolvedValue({ note: NOTE, needs_extract: true });
  const { unmount } = setup({ noteId: 'n9' });
  await screen.findByText(/have not been read yet\. Extract makes the proposal - one AI call/);
  expect(fathomApi.extractNote).not.toHaveBeenCalled();
  fathomApi.extractNote.mockRejectedValueOnce(new Error('Today’s extractions for this workspace are used - an Owner can raise the daily cap'));
  fireEvent.click(screen.getByRole('button', { name: 'Extract' }));
  await screen.findByText(/an Owner can raise the daily cap/);
  fathomApi.extractNote.mockResolvedValue(REVIEW);
  fireEvent.click(screen.getByRole('button', { name: 'Extract' }));
  await screen.findByText('Pilot agreed');
  expect(fathomApi.extractNote).toHaveBeenLastCalledWith('b1', 'n9');
  unmount();
  // the Today row said Extract: the click is the go-ahead
  fathomApi.extractNote.mockClear();
  const now = setup({ noteId: 'n9', extractNow: true });
  await screen.findByText('Pilot agreed');
  expect(fathomApi.extractNote).toHaveBeenCalledTimes(1);
  now.unmount();
  goalsApi.reviewCallNote.mockResolvedValue({ ...REVIEW, note: { ...NOTE, accepted_at: '2026-11-20T19:00:00Z' } });
  setup({ noteId: 'n9' });
  await screen.findByText('These notes were already reviewed and accepted.');
  expect(screen.queryByRole('button', { name: /Accept|Extract/ })).toBeNull();
});

test('paste: the same text as a Fathom note warns with the note to open instead; insisting reads the paste', async () => {
  goalsApi.extractCallNotes.mockResolvedValueOnce({ fathom_match: { id: 'n9', title: 'Northwind weekly', call_date: '2026-11-20', accepted: false, fathom_url: null } });
  setup();
  paste('## Decisions - Northwind will pilot in January');
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  const warn = await screen.findByText('Same text as the Fathom note ‘Northwind weekly’ (Nov 20) — open it instead.');
  expect(warn.closest('[data-fathom-twin]')).toHaveAttribute('role', 'status');
  expect(screen.getByRole('button', { name: 'Read notes' })).toBeDisabled();
  goalsApi.extractCallNotes.mockResolvedValueOnce({ call_date: '2026-11-20', summary: ['From the paste'], tasks: [proposal('Typed task')] });
  fireEvent.click(screen.getByRole('button', { name: 'Read these notes anyway' }));
  await screen.findByText('From the paste');
  expect(goalsApi.extractCallNotes).toHaveBeenLastCalledWith('b1', expect.objectContaining({ insist: true }));
  expect(goalsApi.extractCallNotes.mock.calls[0][1]).not.toHaveProperty('insist');
});

test('paste warning → Open the Fathom note: the panel turns into that note’s review', async () => {
  goalsApi.extractCallNotes.mockResolvedValueOnce({ fathom_match: { id: 'n9', title: 'Northwind weekly', call_date: '2026-11-20', accepted: false, fathom_url: null } });
  goalsApi.reviewCallNote.mockResolvedValue(REVIEW);
  setup();
  paste('same words');
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open the Fathom note' }));
  await screen.findByText('Pilot agreed');
  expect(goalsApi.reviewCallNote).toHaveBeenCalledWith('b1', 'n9');
  expect(screen.queryByLabelText('Call notes')).toBeNull();
});

// fathom-notes-v1 REV 2 F12 (1) - "This call is about".
const PICK_LINKS = { load: jest.fn(), options: { partner: [{ id: 'p1', label: 'Northwind' }, { id: 'p2', label: 'Northwind Re' }], employer: [{ id: 'e1', label: 'Harbor Hotels' }], target: [], commitment: [{ id: 'c1', label: 'Ship the deck' }] }, labelFor: (t, id) => `${t}: ${id}` };

test('review: the picker opens on the server’s record, searches partners / employers / targets only, and the pick rides with Accept', async () => {
  goalsApi.reviewCallNote.mockResolvedValue({ ...REVIEW, about: { record: { type: 'partner', id: 'p1', name: 'Northwind' }, by: 'linked', candidates: [{ type: 'partner', id: 'p2', name: 'Northwind Re' }] } });
  goalsApi.acceptCallNote.mockResolvedValue({ goals: [{}], note: NOTE });
  setup({ noteId: 'n9', links: PICK_LINKS });
  await screen.findByText('Pilot agreed');
  const box = document.querySelector('[data-call-about]');
  expect(box).toHaveTextContent('This call is about');
  expect(screen.getByRole('button', { name: 'Change link for this call' })).toHaveTextContent('Partner: Northwind');
  expect(box).toHaveTextContent('Also matches');
  fireEvent.click(screen.getByRole('button', { name: 'Change link for this call' }));
  const search = screen.getByRole('combobox', { name: 'Search what to link for this call' });
  expect(search).toHaveAttribute('placeholder', 'Partner, employer or target');
  expect(screen.queryByRole('option', { name: 'Ship the deck' })).toBeNull();
  fireEvent.change(search, { target: { value: 'harbor' } });
  fireEvent.click(screen.getByRole('option', { name: 'Harbor Hotels' }));
  fireEvent.click(screen.getByRole('button', { name: /^Accept / }));
  await waitFor(() => expect(goalsApi.acceptCallNote).toHaveBeenCalled());
  expect(goalsApi.acceptCallNote.mock.calls[0][2].about).toEqual({ type: 'employer', id: 'e1' });
  expect(goalsApi.setCallRecord).not.toHaveBeenCalled();
});

test('review: no record proposed shows the candidates; one click picks it; × sends "none"', async () => {
  goalsApi.reviewCallNote.mockResolvedValue({ ...REVIEW, about: { record: null, by: null, candidates: [{ type: 'partner', id: 'p1', name: 'Northwind' }, { type: 'partner', id: 'p2', name: 'Northwind Re' }] } });
  goalsApi.acceptCallNote.mockResolvedValue({ goals: [{}], note: NOTE });
  setup({ noteId: 'n9', links: PICK_LINKS });
  await screen.findByText('Pilot agreed');
  expect(screen.getByRole('button', { name: 'Link for this call' })).toHaveTextContent('None · pick a company');
  expect(document.querySelector('[data-call-about]')).toHaveTextContent('Could be');
  fireEvent.click(screen.getByRole('button', { name: 'Partner: Northwind Re' }));
  expect(screen.getByRole('button', { name: 'Change link for this call' })).toHaveTextContent('Partner: Northwind Re');
  fireEvent.click(screen.getByRole('button', { name: 'Remove link for this call' }));
  fireEvent.click(screen.getByRole('button', { name: /^Accept / }));
  await waitFor(() => expect(goalsApi.acceptCallNote).toHaveBeenCalled());
  expect(goalsApi.acceptCallNote.mock.calls[0][2].about).toBeNull();
});

test('a note already accepted: the pick is saved at once through the record route; a refusal shows', async () => {
  goalsApi.reviewCallNote.mockResolvedValue({ note: { ...NOTE, accepted_at: '2026-11-20T19:00:00Z' }, about: { record: null, by: null, candidates: [{ type: 'partner', id: 'p1', name: 'Northwind' }] } });
  goalsApi.setCallRecord.mockResolvedValueOnce({ changed: true });
  setup({ noteId: 'n9', links: PICK_LINKS });
  await screen.findByText('These notes were already reviewed and accepted.');
  expect(document.querySelector('[data-call-about]')).toHaveTextContent('Saved as soon as you pick.');
  fireEvent.click(screen.getByRole('button', { name: 'Partner: Northwind' }));
  await waitFor(() => expect(goalsApi.setCallRecord).toHaveBeenCalledWith('b1', 'n9', { type: 'partner', id: 'p1', name: 'Northwind' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Change link for this call' })).toHaveTextContent('Partner: Northwind'));
  goalsApi.setCallRecord.mockRejectedValueOnce(new Error('record not found'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove link for this call' }));
  expect(await screen.findByText('record not found')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Change link for this call' })).toHaveTextContent('Partner: Northwind');
});
