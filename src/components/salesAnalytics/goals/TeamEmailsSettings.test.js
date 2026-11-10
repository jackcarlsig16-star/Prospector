import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeamEmailsSettings from './TeamEmailsSettings';
import { goalsApi } from './goalsApi';
import { connectMicrosoft } from '../../ConnectionsPage';

jest.mock('./goalsApi', () => ({ goalsApi: { teamEmails: jest.fn(), clients: jest.fn(), updateTeamEmails: jest.fn(), addTeamRecipient: jest.fn(), editTeamRecipient: jest.fn(), removeTeamRecipient: jest.fn(), undoTeamEmailChange: jest.fn(), teamEmailTest: jest.fn(), teamEmailSendNow: jest.fn() } }));
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

// FIX visitor-email-top10-v1 follow-up: "Send to team now" (owner only) - one confirm; if today's went out, "Send again"
// then an explicit second confirm; a Member never sees the button.
test('Send to team now: owner only; confirm then send; already sent -> Send again -> second confirm -> again: true', async () => {
  goalsApi.teamEmails.mockResolvedValue(owner);
  goalsApi.teamEmailSendNow.mockImplementation(async (_id, body = {}) => (body.check ? { sent_today: false } : { status: 'sent', recipients: 2, rows: 3 }));
  const { unmount } = render(<TeamEmailsSettings businessId="b1" isOwner meId="u-owner" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send to team now' }));
  expect(await screen.findByRole('dialog', { name: 'Send to team now' })).toHaveTextContent("Send today's visitor email to 2 recipients?");
  fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
  await waitFor(() => expect(goalsApi.teamEmailSendNow).toHaveBeenCalledWith('b1', {}));
  expect(await screen.findByText(/Sent to the team \(2 recipients\)/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Send to team now' })).toBeNull();
  unmount();
  goalsApi.teamEmailSendNow.mockClear();
  goalsApi.teamEmailSendNow.mockImplementation(async (_id, body = {}) => (body.check ? { sent_today: true, sent_at: '2026-11-05T15:00:06Z', recipients: 4 } : { status: 'sent', recipients: 4, rows: 10, again: true }));
  render(<TeamEmailsSettings businessId="b1" isOwner meId="u-owner" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send to team now' }));
  const dlg = await screen.findByRole('dialog', { name: 'Send to team now' });
  expect(dlg).toHaveTextContent(/already went out at .* to 4 recipients\. Send again\?/);
  expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
  expect(screen.getByRole('dialog', { name: 'Send to team now' })).toHaveTextContent('This sends a second copy to 2 recipients. Are you sure?');
  expect(goalsApi.teamEmailSendNow).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Yes, send a second copy' }));
  await waitFor(() => expect(goalsApi.teamEmailSendNow).toHaveBeenCalledWith('b1', { again: true }));
  expect(await screen.findByText(/Sent to the team \(4 recipients\) - a second copy/)).toBeInTheDocument();
});

test('Send to team now: a Member never sees the button; Cancel closes the dialog without a send', async () => {
  goalsApi.teamEmails.mockResolvedValue(base);
  const { unmount } = render(<TeamEmailsSettings businessId="b1" isOwner={false} meId="u-m" />);
  await screen.findByText('Team emails');
  expect(screen.queryByRole('button', { name: 'Send to team now' })).toBeNull();
  unmount();
  goalsApi.teamEmails.mockResolvedValue(owner);
  goalsApi.teamEmailSendNow.mockResolvedValue({ sent_today: false });
  render(<TeamEmailsSettings businessId="b1" isOwner meId="u-owner" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send to team now' }));
  await screen.findByRole('dialog', { name: 'Send to team now' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Send to team now' })).toBeNull();
  expect(goalsApi.teamEmailSendNow).toHaveBeenCalledTimes(1);
  expect(goalsApi.teamEmailSendNow).toHaveBeenCalledWith('b1', { check: true });
});

// visitor-trend-v1 Stage 2 (T4 / R4): the weekend switch - its copy quotes the month's measured pull runs from the state
// (never a constant); ON takes two confirms and PATCHes weekend_on only (no test send, no send-now - the switch fires
// nothing); OFF is one click; a member only reads it; the visitor row's cadence word follows it.
const RUNS = { month: '2026-11', runs: 8, credits: 0, calls_min: 4, calls_max: 10 };
test('T4: weekend switch - measured copy, two confirms to turn on, PATCH weekend_on only, one click off, read-only for a member', async () => {
  goalsApi.teamEmails.mockResolvedValue({ ...owner, weekend_on: false, pull_runs_month: RUNS });
  goalsApi.updateTeamEmails.mockResolvedValue({});
  render(<TeamEmailsSettings businessId="b1" isOwner meId="u-owner" />);
  const box = await screen.findByLabelText('Weekend pulls and emails');
  expect(box).not.toBeChecked();
  expect(screen.getByText('Adds Saturday and Sunday pulls and emails · measured 0 Apollo credits per run this month (8 runs, 4–10 API calls each)')).toBeInTheDocument();
  expect(screen.getByText(/Weekdays at 7:00 AM PT/)).toBeInTheDocument();
  fireEvent.click(box);
  expect(goalsApi.updateTeamEmails).not.toHaveBeenCalled();
  const dlg = await screen.findByRole('dialog', { name: 'Weekend pulls and emails' });
  expect(dlg.textContent).toMatch(/Turn on weekend pulls and emails\? Adds 2 Apollo pull runs and 2 visitor emails a week \(Saturday and Sunday, 6:30 \/ 7:00 AM PT\) · measured 0 Apollo credits per run this month \(8 runs, 4–10 API calls each\)\./);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Weekend pulls and emails' })).toBeNull();
  expect(goalsApi.updateTeamEmails).not.toHaveBeenCalled();
  fireEvent.click(box);
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  expect(goalsApi.updateTeamEmails).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Weekend pulls and emails' }).textContent).toMatch(/This changes the schedule only - nothing is pulled or sent right now; the first Saturday run is the check\. Monday’s email then covers Sunday only\. Are you sure\?/);
  fireEvent.click(screen.getByRole('button', { name: 'Yes, turn on weekends' }));
  await waitFor(() => expect(goalsApi.updateTeamEmails).toHaveBeenCalledWith('b1', { weekend_on: true }));
  expect(goalsApi.updateTeamEmails).toHaveBeenCalledTimes(1);
  expect(goalsApi.teamEmailTest).not.toHaveBeenCalled();
  expect(goalsApi.teamEmailSendNow).not.toHaveBeenCalled();
  expect(await screen.findByText(/Weekend pulls and emails on - the schedule changes from Saturday; nothing was pulled or sent now/)).toBeInTheDocument();

  document.body.innerHTML = '';
  goalsApi.updateTeamEmails.mockClear();
  goalsApi.teamEmails.mockResolvedValue({ ...owner, weekend_on: true, pull_runs_month: { ...RUNS, runs: 1, credits: 3, calls_min: 6, calls_max: 6 } });
  render(<TeamEmailsSettings businessId="b1" isOwner meId="u-owner" />);
  const on = await screen.findByLabelText('Weekend pulls and emails');
  expect(on).toBeChecked();
  expect(screen.getByText(/Every day at 7:00 AM PT/)).toBeInTheDocument();
  expect(screen.getByText('Adds Saturday and Sunday pulls and emails · measured 3 Apollo credits per run this month (1 run, 6 API calls each)')).toBeInTheDocument();
  fireEvent.click(on);
  expect(screen.queryByRole('dialog', { name: 'Weekend pulls and emails' })).toBeNull();
  await waitFor(() => expect(goalsApi.updateTeamEmails).toHaveBeenCalledWith('b1', { weekend_on: false }));

  document.body.innerHTML = '';
  goalsApi.teamEmails.mockResolvedValue({ ...base, weekend_on: false, pull_runs_month: { ...RUNS, runs: 0, credits: 0, calls_min: 0, calls_max: 0 } });
  render(<TeamEmailsSettings businessId="b1" isOwner={false} meId="u-m" />);
  expect(await screen.findByText('Weekend pulls and emails (Sat · Sun)')).toBeInTheDocument();
  expect(screen.getByText('Adds Saturday and Sunday pulls and emails · no pull runs measured this month yet')).toBeInTheDocument();
  expect(screen.queryByLabelText('Weekend pulls and emails')).toBeNull();
  expect(screen.getByText('Off')).toBeInTheDocument();
});
