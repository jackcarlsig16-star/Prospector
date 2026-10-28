import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PeopleSearch from './PeopleSearch';
import { goalsApi } from './goalsApi';

// visitor-to-record-v1 Stage 3 - the People search: one list, ties as chips, has_email as a word, the reveal flag,
// filters go to the route. Made-up names; no address anywhere.
jest.mock('./goalsApi', () => ({ goalsApi: { people: jest.fn(), addPersonRecord: jest.fn() } }));

const person = (id, name, extra = {}) => ({ person_id: id, source_table: 'sales_people', name, title: 'VP People', company: { type: 'target', id: 't1', name: 'Nimbus Freight' }, ties: [{ kind: 'company', label: 'Nimbus Freight' }, { kind: 'visit', label: 'Visited 2026-10-18' }], last_activity: '2026-10-27T10:00:00Z', has_email: false, name_partial: false, ...extra });
beforeEach(() => { jest.clearAllMocks(); goalsApi.people.mockResolvedValue({ people: [person('p1', 'Larry F.', { name_partial: true }), person('p2', 'Pat Broker', { source_table: 'partner_contacts', company: { type: 'partner', id: 'g1', name: 'Harbor Lane' }, ties: [{ kind: 'company', label: 'Harbor Lane' }, { kind: 'sequence', label: 'Apollo sequence' }, { kind: 'upside', label: 'Upside (Rob Example)' }], has_email: true })], n: 2, total: 9 }); });

test('lists people with company chip, tie chips, has email as a word, the reveal flag; Open company hands the company up; filters reach the route', async () => {
  const onOpen = jest.fn();
  render(<PeopleSearch businessId="b1" onOpenCompany={onOpen} />);
  const rows = await screen.findAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText('Larry F.')).toBeInTheDocument();
  expect(within(rows[0]).getByText('reveal to see full name')).toBeInTheDocument();
  expect(within(rows[0]).getByText('Visited 2026-10-18')).toBeInTheDocument();
  expect(within(rows[0]).queryByText('has email')).not.toBeInTheDocument();
  expect(within(rows[1]).getByText('has email')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Upside (Rob Example)')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('2 of 9 people');
  expect(document.body.textContent).not.toMatch(/@/);
  fireEvent.click(within(rows[1]).getByRole('button', { name: 'Open company' }));
  expect(onOpen).toHaveBeenCalledWith({ type: 'partner', id: 'g1', name: 'Harbor Lane' });
  fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'adp' } });
  fireEvent.change(screen.getByLabelText('Tie'), { target: { value: 'visit' } });
  await waitFor(() => expect(goalsApi.people).toHaveBeenLastCalledWith('b1', { q: 'adp', company: '', tie: 'visit', title: '' }));
});

test('nobody matches + an error note', async () => {
  goalsApi.people.mockResolvedValueOnce({ people: [], n: 0, total: 9 });
  render(<PeopleSearch businessId="b1" />);
  expect(await screen.findByText('Nobody matches.')).toBeInTheDocument();
  goalsApi.people.mockRejectedValueOnce(new Error('boom'));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'CHRO' } });
  expect(await screen.findByText('boom')).toBeInTheDocument();
});

// V2a follow-up - a parked visitor shows "no record yet"; Members Add the company (POST add-record), Viewers only read.
test('parked: "no record yet" chip, Add files the company and re-runs the search; no Add for a Viewer', async () => {
  const parked = person('p3', 'Pat Parked', { company: { type: 'parked', id: null, name: 'Zz Small Shop' }, ties: [{ kind: 'visit', label: 'Identified visitor' }], no_record: true });
  goalsApi.people.mockResolvedValue({ people: [parked], n: 1, total: 9 });
  goalsApi.addPersonRecord.mockResolvedValue({ record: { type: 'target', id: 't9', name: 'Zz Small Shop' }, people_moved: 2, already: false });
  const { unmount } = render(<PeopleSearch businessId="b1" canEdit onOpenCompany={jest.fn()} />);
  const row = (await screen.findAllByRole('listitem'))[0];
  expect(within(row).getByText('no record yet')).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Open company' })).toBeNull();
  fireEvent.click(within(row).getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(goalsApi.addPersonRecord).toHaveBeenCalledWith('b1', 'p3'));
  expect(await screen.findByText('Zz Small Shop: employer target created · 2 people filed')).toBeInTheDocument();
  expect(goalsApi.people.mock.calls.length).toBeGreaterThanOrEqual(2);
  unmount();
  render(<PeopleSearch businessId="b1" canEdit={false} />);
  const vrow = (await screen.findAllByRole('listitem'))[0];
  expect(within(vrow).getByText('no record yet')).toBeInTheDocument();
  expect(within(vrow).queryByRole('button', { name: 'Add' })).toBeNull();
});
