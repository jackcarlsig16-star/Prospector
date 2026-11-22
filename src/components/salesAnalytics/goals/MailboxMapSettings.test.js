import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MailboxMapSettings, { mailboxLabel } from './MailboxMapSettings';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { mailboxMap: jest.fn(), saveMailbox: jest.fn() } }));

// email-by-member-v1 M1 - Sales › Settings › Team mailboxes over an invented GET goals/mailbox-map: a mailbox is its
// domain · first seen · delivered count behind an opaque key, the owner picks the member, everyone else reads, and a
// member's own connected account asks before it is mapped and then stays.
const MAP = {
  members: [{ id: 'u1', name: 'Jack', role: 'owner' }, { id: 'u2', name: 'Cyrus', role: 'member' }],
  mailboxes: [
    { key: 'a'.repeat(16), domain: 'one.test', first_seen: '2026-09-21', delivered: 1840, user_id: 'u1', connected_account_of: 'u1', suggested_user_id: null },
    { key: 'b'.repeat(16), domain: 'one.test', first_seen: '2026-09-22', delivered: 610, user_id: 'u2', connected_account_of: null, suggested_user_id: null },
    { key: 'c'.repeat(16), domain: 'two.test', first_seen: '2026-11-19', delivered: 5, user_id: null, connected_account_of: null, suggested_user_id: 'u1' },
    { key: 'd'.repeat(16), domain: 'two.test', first_seen: null, delivered: 0, user_id: null, connected_account_of: 'u2', suggested_user_id: 'u2' },
  ],
};
beforeEach(() => { goalsApi.mailboxMap.mockResolvedValue(MAP); goalsApi.saveMailbox.mockResolvedValue({}); });
afterEach(() => jest.clearAllMocks());
const rowOf = n => document.querySelector(`[data-mailbox="${n}"]`);

test('the owner: each mailbox as domain · first seen · delivered, a member select, the suggestion, a connected account locked once mapped; a pick saves through the route by key', async () => {
  render(<MailboxMapSettings businessId="b1" isOwner />);
  await screen.findByRole('heading', { name: 'Team mailboxes' });
  expect(mailboxLabel(MAP.mailboxes[0])).toBe('one.test · first seen Sep 21, 2026 · 1,840 delivered');
  expect([...document.querySelectorAll('[data-mailbox-label]')].map(n => n.textContent)).toEqual(MAP.mailboxes.map(mailboxLabel));
  expect(rowOf(4)).toHaveTextContent('two.test · not seen sending · 0 delivered');
  expect(rowOf(1)).toHaveTextContent("Jack's own connected Microsoft account");
  expect(rowOf(1).querySelector('select')).toBeNull();
  expect(rowOf(1)).toHaveTextContent('stays with Jack');
  expect(rowOf(2).querySelector('select')).toHaveValue('u2');
  expect(rowOf(3).querySelector('[data-mailbox-suggested]')).toHaveTextContent("looks like Jack's");
  expect(document.querySelector('[data-mailbox-map]').textContent).not.toMatch(/@/);
  fireEvent.change(rowOf(3).querySelector('select'), { target: { value: 'u1' } });
  await waitFor(() => expect(goalsApi.saveMailbox).toHaveBeenCalledWith('b1', { key: 'c'.repeat(16), user_id: 'u1' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Mapped to Jack');
  expect(goalsApi.mailboxMap).toHaveBeenCalledTimes(2);
  fireEvent.change(rowOf(2).querySelector('select'), { target: { value: '' } });
  await waitFor(() => expect(goalsApi.saveMailbox).toHaveBeenLastCalledWith('b1', { key: 'b'.repeat(16), user_id: null }));
});

test("a member's own connected account: only that member is offered, and mapping it asks first (it starts their Outlook sync)", async () => {
  render(<MailboxMapSettings businessId="b1" isOwner />);
  await screen.findByRole('heading', { name: 'Team mailboxes' });
  const select = rowOf(4).querySelector('select');
  expect([...select.options].map(o => o.textContent)).toEqual(['Unassigned mailbox', 'Cyrus']);
  fireEvent.change(select, { target: { value: 'u2' } });
  expect(goalsApi.saveMailbox).not.toHaveBeenCalled();
  expect(rowOf(4).querySelector('[data-mailbox-confirm]')).toHaveTextContent("starts Cyrus's Outlook sync");
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(rowOf(4).querySelector('[data-mailbox-confirm]')).toBeNull();
  fireEvent.change(rowOf(4).querySelector('select'), { target: { value: 'u2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Map to Cyrus' }));
  await waitFor(() => expect(goalsApi.saveMailbox).toHaveBeenCalledWith('b1', { key: 'd'.repeat(16), user_id: 'u2' }));
});

test("everyone else reads names, no control; the route's refusal is shown in its own words", async () => {
  const { unmount } = render(<MailboxMapSettings businessId="b1" isOwner={false} />);
  await screen.findByRole('heading', { name: 'Team mailboxes' });
  expect(document.querySelectorAll('select, [data-mailbox-map] button')).toHaveLength(0);
  expect([...document.querySelectorAll('[data-mailbox-member]')].map(n => n.textContent)).toEqual(['Jack', 'Cyrus', 'Unassigned mailbox', 'Unassigned mailbox']);
  expect(screen.getByText(/The workspace owner sets this/)).toBeInTheDocument();
  unmount();
  goalsApi.saveMailbox.mockRejectedValue(new Error("That mailbox is a member's own connected account - it stays with that member"));
  render(<MailboxMapSettings businessId="b1" isOwner />);
  await screen.findByRole('heading', { name: 'Team mailboxes' });
  fireEvent.change(rowOf(3).querySelector('select'), { target: { value: 'u2' } });
  expect(await screen.findByText(/it stays with that member/)).toBeInTheDocument();
});
