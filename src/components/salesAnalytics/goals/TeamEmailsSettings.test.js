import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeamEmailsSettings from './TeamEmailsSettings';
import { goalsApi } from './goalsApi';
import { connectMicrosoft } from '../../ConnectionsPage';

jest.mock('./goalsApi', () => ({ goalsApi: { teamEmails: jest.fn(), clients: jest.fn(), updateTeamEmails: jest.fn(), addTeamRecipient: jest.fn(), editTeamRecipient: jest.fn(), removeTeamRecipient: jest.fn(), undoTeamEmailChange: jest.fn(), teamEmailTest: jest.fn() } }));
jest.mock('../../ConnectionsPage', () => ({ connectMicrosoft: jest.fn() }));

// homelover-team-emails-v1 Stage 2 - the panel: owner edits, everyone else reads counts; Reconnect banner; Undo.
// Invented people at a reserved test domain.
const base = {
  sender: { user_id: 'u-owner', first_name: 'Alex' }, senders: [{ user_id: 'u-owner', first_name: 'Alex' }], visitor_on: true, client_on: true, ready: true, banner: null,
  domains: ['example.test'], max: 25, total: 2, counts: { visitor: { count: 2, dropped: 0, capped: 0 }, client: { count: 1, dropped: 0, capped: 0 } },
  sends: [{ id: 's1', at: '2026-11-04T15:00:00Z', kind: 'visitor', test: false, recipients: 2, status: 'sent', error: null }], changes: [],
};
const owner = { ...base, recipients: [{ id: 'r1', address: 'team-one@example.test', visitor_email: true, client_alert: true, allowed: true }, { id: 'r2', address: 'team-two@example.test', visitor_email: true, client_alert: false, allowed: true }], suggestions: [{ user_id: 'u-m', first_name: 'Robin' }] };
beforeEach(() => { goalsApi.clients.mockResolvedValue({ clients: [{ id: 'c1', name: 'Zz Elm' }] }); });
afterEach(() => jest.clearAllMocks());

test('a member reads: counts and status, no addresses, no controls', async () => {
  goalsApi.teamEmails.mockResolvedValue(base);
  render(<TeamEmailsSettings businessId="b1" isOwner={false} meId="u-m" />);
  expect(await screen.findByText('Team emails')).toBeInTheDocument();
  expect(screen.getByText(/2 addresses are on the list/)).toBeInTheDocument();
  expect(screen.getByText(/The owner manages team emails/)).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: /Send a test/ })).toBeNull();
  expect(document.body.textContent).not.toMatch(/[a-z0-9.-]+@example\.test/i);
  expect(screen.getByText('Last 10 sends')).toBeInTheDocument();
});

test('the owner adds by typing or by a member suggestion, ticks a per-email box, removes, and can Undo', async () => {
  goalsApi.teamEmails.mockResolvedValue(owner);
  goalsApi.addTeamRecipient.mockResolvedValue({ id: 'r3', change_id: 'ch1', count: 3 });
  goalsApi.editTeamRecipient.mockResolvedValue({ id: 'r2', change_id: 'ch2', count: 2 });
  goalsApi.removeTeamRecipient.mockResolvedValue({ change_id: 'ch3', count: 1 });
  goalsApi.undoTeamEmailChange.mockResolvedValue({ count: 2 });
  render(<TeamEmailsSettings businessId="b1" isOwner meId="u-owner" />);
  fireEvent.change(await screen.findByLabelText('Add an address'), { target: { value: 'new@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(goalsApi.addTeamRecipient).toHaveBeenCalledWith('b1', { address: 'new@example.test' }));
  expect(await screen.findByText(/Added · 3 addresses on the list/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add Robin' }));
  await waitFor(() => expect(goalsApi.addTeamRecipient).toHaveBeenCalledWith('b1', { member_user_id: 'u-m' }));
  fireEvent.click(screen.getByLabelText('New-client alert for team-two@example.test'));
  await waitFor(() => expect(goalsApi.editTeamRecipient).toHaveBeenCalledWith('b1', 'r2', { client_alert: true }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
  await waitFor(() => expect(goalsApi.removeTeamRecipient).toHaveBeenCalledWith('b1', 'r1'));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.undoTeamEmailChange).toHaveBeenCalledWith('b1', 'ch3'));
});

test('Send a test to me only: visitor straight away; client after picking one', async () => {
  goalsApi.teamEmails.mockResolvedValue(owner);
  goalsApi.teamEmailTest.mockResolvedValue({ status: 'sent', recipients: 1 });
  render(<TeamEmailsSettings businessId="b1" isOwner meId="u-owner" />);
  const [visitorTest, clientTest] = await screen.findAllByRole('button', { name: 'Send a test to me only' });
  expect(clientTest).toBeDisabled();
  fireEvent.click(visitorTest);
  await waitFor(() => expect(goalsApi.teamEmailTest).toHaveBeenCalledWith('b1', { kind: 'visitor' }));
  expect(await screen.findByText(/Test sent to your mailbox \(1 recipient\)/)).toBeInTheDocument();
  await screen.findByRole('option', { name: 'Zz Elm' });
  fireEvent.change(screen.getByLabelText('Client for the test alert'), { target: { value: 'c1' } });
  fireEvent.click(clientTest);
  await waitFor(() => expect(goalsApi.teamEmailTest).toHaveBeenCalledWith('b1', { kind: 'client', opportunity_id: 'c1' }));
});

test('Reconnect banner: the sender gets the button; anyone else is told who must reconnect; tests wait', async () => {
  goalsApi.teamEmails.mockResolvedValue({ ...owner, ready: false, banner: 'Reconnect to allow team emails' });
  const { unmount } = render(<TeamEmailsSettings businessId="b1" isOwner meId="u-owner" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect to allow team emails');
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect Microsoft →' }));
  expect(connectMicrosoft).toHaveBeenCalled();
  for (const b of screen.getAllByRole('button', { name: 'Send a test to me only' })) expect(b).toBeDisabled();
  unmount();
  goalsApi.teamEmails.mockResolvedValue({ ...base, ready: false, banner: 'Reconnect to allow team emails' });
  render(<TeamEmailsSettings businessId="b1" isOwner={false} meId="u-m" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Alex needs to reconnect Microsoft');
  expect(screen.queryByRole('button', { name: /Reconnect/ })).toBeNull();
});
