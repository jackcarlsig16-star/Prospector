import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import PartnerDetails from './PartnerDetails';
import { memberLookup } from '../goalsUi';

// partner-360-v1 Stage 1 - the drop-down's five sections against a partner
// shaped like Justworks: 7 try-out clicks (noise) and one real reply.
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
  await screen.findByRole('list', { name: 'People at this partner' });
  for (const name of ['Status and next step', 'People', 'Activity', 'Tasks', 'Intel']) expect(screen.getByRole('region', { name })).toBeTruthy();
  expect(screen.getByText('Replied')).toBeTruthy();
  expect(screen.getByText(/Next: Meeting booked/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Log touch' })).toBeTruthy();
  const people = within(screen.getByRole('list', { name: 'People at this partner' })).getAllByRole('listitem');
  expect(people.map(li => li.textContent)).toEqual([expect.stringContaining('Dana Kim'), expect.stringContaining('Pat Lee')]);
  expect(within(people[0]).getByText('Added')).toBeTruthy();
  expect(within(people[1]).getByText('Sheet')).toBeTruthy();
  expect(within(people[0]).getByRole('link', { name: 'Email Dana Kim' })).toBeTruthy();
  expect(props.onCount).toHaveBeenCalledWith('p1', 2);
  const timeline = screen.getByRole('list', { name: 'Activity timeline' });
  expect(within(timeline).getAllByRole('listitem').map(li => li.textContent)).toEqual([expect.stringContaining('Task: Send deck'), expect.stringContaining('Sent → Replied')]);
  fireEvent.click(screen.getByRole('button', { name: 'Show all activity (8)' }));
  expect(within(screen.getByRole('list', { name: 'Activity timeline' })).getAllByRole('listitem')).toHaveLength(10);
  const intel = screen.getByRole('button', { name: /^Intel/ });
  expect(intel.getAttribute('aria-expanded')).toBe('false');
  expect(intel.textContent).toContain('Payroll partner for renters');
  expect(screen.queryByText('Angle')).toBeNull();
  fireEvent.click(intel);
  expect(screen.getByText('Angle')).toBeTruthy();
});

test('Log touch form sends a touch signal with the stage the screen showed; Add person posts', async () => {
  const props = setup();
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
});

test('viewer: everything shown, no buttons', async () => {
  setup({ canEdit: false, actions: null });
  await screen.findByRole('list', { name: 'People at this partner' });
  expect(screen.queryByRole('button', { name: 'Log touch' })).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Add person' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Next:/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  expect(screen.queryByLabelText(/New task for/)).toBeNull();
  expect(screen.getByRole('list', { name: 'Activity timeline' })).toBeTruthy();
});
