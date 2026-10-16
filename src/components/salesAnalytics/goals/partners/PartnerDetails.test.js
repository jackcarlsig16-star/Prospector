import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import PartnerDetails, { peopleSummary, activitySummary, tasksSummary, intelSummary, domainsSummary } from './PartnerDetails';
import { memberLookup } from '../goalsUi';

// partner-360-v1 Stage 1 - the drop-down's five sections against a partner
// shaped like Justworks: 7 try-out clicks (noise) and one real reply.
// partner-details-drawers-v1 - the five are drawers now: closed on first
// open, summaries from the fetched data, remembered per drawer kind.
const lookup = memberLookup([{ user_id: 'u-jack', name: 'Jack Carlson' }]);
const at = i => `2026-10-01T10:0${i}:00Z`;
const tryouts = [
  { id: 'h1', event: 'hot', meta: { hot: true }, at: at(0), by_user: 'u-jack' },
  { id: 'h2', event: 'hot', meta: { hot: false }, at: at(1), by_user: 'u-jack' },
  { id: 's1', event: 'snooze', meta: { until: '2026-10-08' }, at: at(2), by_user: 'u-jack' },
  { id: 'u1', event: 'undo', meta: { undid: 's1', undid_event: 'snooze' }, at: at(3), by_user: 'u-jack' },
  { id: 'h3', event: 'hot', meta: { hot: true }, at: at(4), by_user: 'u-jack' },
  { id: 'h4', event: 'hot', meta: { hot: false }, at: at(5), by_user: 'u-jack' },
  { id: 'n1', event: 'note', note: 'test note', at: at(6), by_user: 'u-jack' },
  { id: 'u2', event: 'undo', meta: { undid: 'n1', undid_event: 'note' }, at: at(7), by_user: 'u-jack' },
];
const real = { id: 'r1', event: 'status', from_status: 'first_email_sent', to_status: 'replied', at: '2026-10-03T16:00:00Z', by_user: 'u-jack' };
const partner = { id: 'p1', name: 'Justworks', pipeline_status: 'replied', known_contacts: 'Pat Lee (intro)', angle: 'Payroll partner for renters', updated_at: 'v1', people_count: 0 };
const DRAWERS = ['People', 'Activity', 'Tasks', 'Intel', 'Domains'];
const head = name => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const open = name => fireEvent.click(head(name));

beforeEach(() => localStorage.clear());

function setup(over = {}) {
  const props = {
    partner, lookup, canEdit: true, onUpdate: jest.fn(), bump: 0,
    onEvents: jest.fn(() => Promise.resolve([...tryouts, real])),
    people: { load: jest.fn(() => Promise.resolve([{ id: 'c1', name: 'Dana Kim', title: 'VP Partnerships', email: 'dana@example.com', source: 'manual' }])), add: jest.fn(() => Promise.resolve({})), remove: jest.fn(() => Promise.resolve({})) },
    domains: { load: jest.fn(() => Promise.resolve({ domains: [{ id: 'd1', domain: 'justworks.com', confirmed: true, is_primary: true, source: 'sources' }], suggestions: [], apollo_account: null })), add: jest.fn(), update: jest.fn(), remove: jest.fn() },
    actions: { members: [], onNext: jest.fn(), onSignal: jest.fn(() => Promise.resolve({ id: 'p1' })) },
    tasksFor: () => [{ id: 'k1', text: 'Send deck', created_at: '2026-10-04T12:00:00Z', owner_user_id: 'u-jack', status: 'open', steps: [], link_type: 'partner', link_id: 'p1' }],
    onCreateTask: jest.fn(() => Promise.resolve({})), onCount: jest.fn(),
    ...over,
  };
  render(<PartnerDetails {...props} />);
  return props;
}

test('five sections, noise hidden behind Show all activity (8), people merged, count reported', async () => {
  const props = setup();
  await waitFor(() => expect(props.onCount).toHaveBeenCalledWith('p1', 2));
  for (const name of ['Status and next step', ...DRAWERS]) expect(screen.getByRole('region', { name })).toBeTruthy();
  expect(screen.getByText('Replied')).toBeTruthy();
  expect(screen.getByText(/Next: Meeting booked/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Log touch' })).toBeTruthy();
  open('People');
  const people = within(screen.getByRole('list', { name: 'People at this partner' })).getAllByRole('listitem');
  expect(people.map(li => li.textContent)).toEqual([expect.stringContaining('Dana Kim'), expect.stringContaining('Pat Lee')]);
  expect(within(people[0]).getByText('Added')).toBeTruthy();
  expect(within(people[1]).getByText('Sheet')).toBeTruthy();
  expect(within(people[0]).getByRole('link', { name: 'Email Dana Kim' })).toBeTruthy();
  open('Activity');
  const timeline = screen.getByRole('list', { name: 'Activity timeline' });
  expect(within(timeline).getAllByRole('listitem').map(li => li.textContent)).toEqual([expect.stringContaining('Task: Send deck'), expect.stringContaining('Sent → Replied')]);
  fireEvent.click(screen.getByRole('button', { name: 'Show all activity (8)' }));
  expect(within(screen.getByRole('list', { name: 'Activity timeline' })).getAllByRole('listitem')).toHaveLength(10);
  const intel = head('Intel');
  expect(intel.getAttribute('aria-expanded')).toBe('false');
  expect(intel.textContent).toContain('Payroll partner for renters');
  expect(screen.queryByText('Angle')).toBeNull();
  fireEvent.click(intel);
  expect(screen.getByText('Angle')).toBeTruthy();
});

test('drawers: all five closed on first open with summaries from the fetched data; opening one leaves the others; the choice is remembered per drawer kind on the next partner', async () => {
  const props = setup();
  await waitFor(() => expect(props.onCount).toHaveBeenCalledWith('p1', 2));
  for (const name of DRAWERS) expect(head(name)).toHaveAttribute('aria-expanded', 'false');
  expect(head('People').textContent).toBe('People2 people · Dana Kim (VP Partnerships) +1Show ▸');
  expect(head('Activity').textContent).toBe('ActivityTask: Send deck · Oct 4Show ▸');
  expect(head('Tasks').textContent).toBe('Tasks1 this weekShow ▸');
  expect(head('Intel').textContent).toBe('IntelPayroll partner for rentersShow ▸');
  expect(head('Domains').textContent).toBe('Domains1 confirmedShow ▸');
  expect(screen.queryByRole('list', { name: 'People at this partner' })).toBeNull();
  expect(screen.queryByRole('list', { name: 'Activity timeline' })).toBeNull();
  expect(screen.queryByText('justworks.com')).toBeNull();
  expect(props.domains.load).toHaveBeenCalledTimes(1);
  open('Activity');
  expect(head('Activity')).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['People', 'Tasks', 'Intel', 'Domains']) expect(head(name)).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('list', { name: 'Activity timeline' })).toBeTruthy();
  expect(localStorage.getItem('prospector_partner_drawer_activity')).toBe('open');
  open('Domains');
  expect(screen.getByText('justworks.com')).toBeTruthy();
  expect(props.domains.load).toHaveBeenCalledTimes(1);
  open('Domains');
  expect(screen.queryByText('justworks.com')).toBeNull();
  expect(localStorage.getItem('prospector_partner_drawer_domains')).toBe('closed');
});

test('a second partner opens with Activity still open (remembered) and the rest closed; empty partner summaries', async () => {
  localStorage.setItem('prospector_partner_drawer_activity', 'open');
  const props = setup({ partner: { id: 'p2', name: 'Blank Co', pipeline_status: 'not_started', updated_at: 'v1', people_count: 0 }, onEvents: jest.fn(() => Promise.resolve([])), people: { load: jest.fn(() => Promise.resolve([])), add: jest.fn(), remove: jest.fn() }, domains: { load: jest.fn(() => Promise.resolve({ domains: [], suggestions: [], apollo_account: null })), add: jest.fn(), update: jest.fn(), remove: jest.fn() }, tasksFor: () => [] });
  await waitFor(() => expect(head('People').textContent).toBe('Peoplenobody yetShow ▸'));
  expect(head('Activity')).toHaveAttribute('aria-expanded', 'true');
  expect(head('Activity').textContent).toBe('ActivityHide ▾');
  expect(screen.getByText('Nothing yet. Log a touch or move the stage and it shows here.')).toBeTruthy();
  for (const name of ['People', 'Tasks', 'Intel', 'Domains']) expect(head(name)).toHaveAttribute('aria-expanded', 'false');
  expect(head('Tasks').textContent).toBe('Tasksnone this weekShow ▸');
  expect(head('Intel').textContent).toBe('Intelnothing yetShow ▸');
  expect(head('Domains').textContent).toBe('Domainsnone confirmedShow ▸');
  expect(props.onCount).not.toHaveBeenCalled();
});

test('summaries (pure)', () => {
  expect(peopleSummary(null)).toBe('loading…');
  expect(peopleSummary([{ name: 'Brad', note: 'counterpart' }, { name: 'B' }, { name: 'C' }])).toBe('3 people · Brad (counterpart) +2');
  expect(peopleSummary([{ name: 'Solo' }])).toBe('1 person · Solo');
  expect(activitySummary([{ text: 'Marked hot', at: '2026-10-01T00:00:00Z', noise: true }, { text: 'Called Pat', at: '2026-10-02T18:00:00Z', noise: false }])).toBe('Called Pat · Oct 2');
  expect(activitySummary([])).toBe('nothing yet');
  const t = (id, extra) => ({ id, text: id, status: 'open', steps: [], ...extra });
  expect(tasksSummary([], null, '2026-10-15')).toBe('shown for the current week');
  expect(tasksSummary([], () => [], '2026-10-15')).toBe('none this week');
  expect(tasksSummary([t('a', { due_date: '2026-10-10' }), t('b'), t('c', { status: 'done' })], () => [], '2026-10-15')).toBe('2 this week · 1 overdue');
  expect(tasksSummary([t('c', { status: 'done' })], () => [], '2026-10-15')).toBe('1 done');
  expect(intelSummary({ angle: 'x'.repeat(100) })).toHaveLength(80);
  expect(intelSummary({ partner_role: 'Payroll' })).toBe('Payroll');
  expect(intelSummary({})).toBe('nothing yet');
  expect(domainsSummary(null)).toBe('loading…');
  expect(domainsSummary({ domains: [{ confirmed: true }, { confirmed: false }, { confirmed: true }] })).toBe('2 confirmed');
  expect(domainsSummary({ domains: [{ confirmed: false }] })).toBe('none confirmed');
});

test('Log touch form sends a touch signal with the stage the screen showed; Add person posts', async () => {
  const props = setup();
  open('People');
  await screen.findByRole('list', { name: 'People at this partner' });
  fireEvent.click(screen.getByRole('button', { name: 'Log touch' }));
  const form = screen.getByRole('form', { name: 'Log a touch on Justworks' });
  fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'call' } });
  fireEvent.change(within(form).getByLabelText('When'), { target: { value: '2026-10-02' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Dana Kim' }));
  fireEvent.change(within(form).getByLabelText('Add a name'), { target: { value: 'Jane Doe' } });
  fireEvent.keyDown(within(form).getByLabelText('Add a name'), { key: 'Enter' });
  fireEvent.click(within(form).getByRole('button', { name: 'Log touch' }));
  await waitFor(() => expect(props.actions.onSignal).toHaveBeenCalledWith({ type: 'touch', touch_type: 'call', date: '2026-10-02', contacts: ['Dana Kim', 'Jane Doe'], move_to: 'auto', expect: 'replied' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Log a touch on Justworks' })).toBeNull());

  fireEvent.click(screen.getByRole('button', { name: '+ Add person' }));
  const add = screen.getByRole('form', { name: 'Add person' });
  fireEvent.change(within(add).getByLabelText('Name'), { target: { value: 'Sam Roe' } });
  fireEvent.change(within(add).getByLabelText('Email'), { target: { value: 'sam@example.com' } });
  fireEvent.click(within(add).getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(props.people.add).toHaveBeenCalledWith('p1', { name: 'Sam Roe', title: null, email: 'sam@example.com', linkedin_url: null }));
  expect(props.people.add).toHaveBeenCalledTimes(1);
});

test('inside the drawers every write still calls the same handler once: Add task, Intel priority, Add domain; the header quick note sends a note signal and clears', async () => {
  const props = setup({ domains: { load: jest.fn(() => Promise.resolve({ domains: [], suggestions: [], apollo_account: null })), add: jest.fn(() => Promise.resolve({ domains: [{ id: 'd2', domain: 'justworks.io', confirmed: true, is_primary: true, source: 'manual' }], suggestions: [], apollo_account: null })), update: jest.fn(), remove: jest.fn() } });
  await waitFor(() => expect(props.onCount).toHaveBeenCalledWith('p1', 2));
  open('Tasks');
  fireEvent.change(screen.getByLabelText('New task for Justworks'), { target: { value: 'Send the deck' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
  await waitFor(() => expect(props.onCreateTask).toHaveBeenCalledWith({ text: 'Send the deck', link_type: 'partner', link_id: 'p1' }));
  expect(props.onCreateTask).toHaveBeenCalledTimes(1);
  open('Intel');
  fireEvent.change(screen.getByLabelText('Priority'), { target: { value: '1' } });
  await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith('p1', { priority: 1 }));
  expect(props.onUpdate).toHaveBeenCalledTimes(1);
  open('Domains');
  fireEvent.click(screen.getByRole('button', { name: '+ Add domain' }));
  fireEvent.change(screen.getByLabelText('New domain'), { target: { value: 'justworks.io' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(props.domains.add).toHaveBeenCalledWith('p1', { domain: 'justworks.io' }));
  expect(props.domains.add).toHaveBeenCalledTimes(1);
  await screen.findByText('justworks.io');
  open('Domains');
  expect(head('Domains').textContent).toBe('Domains1 confirmedShow ▸');
  expect(props.domains.load).toHaveBeenCalledTimes(1);
  const note = screen.getByLabelText('Quick note');
  fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
  expect(props.actions.onSignal).not.toHaveBeenCalled();
  fireEvent.change(note, { target: { value: '  Called, left voicemail ' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Quick note on Justworks' }));
  await waitFor(() => expect(props.actions.onSignal).toHaveBeenCalledWith({ type: 'note', note: 'Called, left voicemail' }));
  expect(props.actions.onSignal).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(note.value).toBe(''));
});

test('viewer: everything shown, no buttons', async () => {
  setup({ canEdit: false, actions: null });
  for (const name of DRAWERS) open(name);
  await screen.findByRole('list', { name: 'People at this partner' });
  await screen.findByText('justworks.com');
  expect(screen.queryByRole('button', { name: 'Log touch' })).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Add person' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Next:/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  expect(screen.queryByLabelText(/New task for/)).toBeNull();
  expect(screen.queryByLabelText('Quick note')).toBeNull();
  expect(screen.queryByRole('form')).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Add domain' })).toBeNull();
  expect(screen.queryByLabelText('Priority')).toBeNull();
  expect(screen.getByRole('list', { name: 'Activity timeline' })).toBeTruthy();
  expect(screen.getByText('Angle')).toBeTruthy();
});

test('an Apollo person in a sequence shows "In sequence · active since Aug 27"', async () => {
  setup({ people: { load: jest.fn(() => Promise.resolve([{ id: 'c9', name: 'Sam Ortiz', title: 'Director', email: 'sam@example.com', source: 'apollo', apollo_contact_id: 'ap1', sequence_status: 'active', sequence_added_at: '2026-08-28T00:28:26Z', sequence_finished_at: null }])), add: jest.fn(), remove: jest.fn() } });
  open('People');
  const list = await screen.findByRole('list', { name: 'People at this partner' });
  const sam = within(list).getAllByRole('listitem').find(li => /Sam Ortiz/.test(li.textContent));
  expect(sam.textContent).toMatch(/Apollo/);
  expect(sam.textContent).toMatch(/In sequence · active since Aug 2[78]/);
  expect(within(sam).queryByRole('button', { name: /Remove/ })).toBeNull();
});
