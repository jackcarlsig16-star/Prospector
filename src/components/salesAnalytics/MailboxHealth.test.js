import { render } from '@testing-library/react';
import MailboxHealth, { mailboxStatus } from './MailboxHealth';

// overview-home-v1 Stage 2: one row per sender over the period; status ok / stale / reconnect.
const row = (day, mailbox, delivered, hard_bounced, spam_blocked, opened, replied) => ({ day, mailbox, delivered, hard_bounced, spam_blocked, opened, clicked: 0, replied });
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

test('mailboxStatus: reconnect beats stale beats ok; nothing sent in 7 days is stale', () => {
  expect(mailboxStatus({ last_send_day: today }, { active: false }, today).word).toBe('Reconnect');
  expect(mailboxStatus({ last_send_day: today }, { needs_reauth_at: '2026-10-01T00:00:00Z' }, today).word).toBe('Reconnect');
  expect(mailboxStatus({ last_send_day: today }, { last_synced_at: '2026-10-01T00:00:00Z', snapshot_at: '2026-10-08T00:00:00Z' }, today).word).toBe('Stale');
  expect(mailboxStatus({ last_send_day: '2026-01-05' }, {}, today)).toEqual(expect.objectContaining({ word: 'Stale', tone: 'warn' }));
  expect(mailboxStatus({ last_send_day: null }, undefined, today).why).toBe('Nothing sent yet');
  expect(mailboxStatus({ last_send_day: today }, {}, today).word).toBe('OK');
});

test('table: jack and cyrus side by side with Apollo open %, the human estimate from tracked opens, and status', () => {
  const emailData = {
    emailRows: [row(today, 'jack@x', 200, 4, 1, 30, 2), row(today, 'cyrus@x', 200, 0, 0, 2, 0)],
    days: [], manualMeetings: [],
    senders: [{ day: today, sender: 'jack@x', tracked_opens: 10, tracked_bot_opens: 4, tracked_replies: 2, tracked_real_replies: 2 }],
  };
  const entities = { mailboxes: [{ id: '1', email: 'jack@x', active: true, last_synced_at: '2026-10-08T15:00:00Z' }, { id: '2', email: 'cyrus@x', active: false }] };
  const { container } = render(<MailboxHealth emailData={emailData} period={{ from: today, to: today }} entities={entities} />);
  const rows = [...container.querySelectorAll('[data-mailbox-row]')].map(tr => [tr.dataset.mailboxRow, tr.querySelector('[data-cell="open_rate"]').textContent, tr.querySelector('[data-cell="human_open_rate"]').textContent, tr.querySelector('[data-cell="status"]').textContent.trim()]);
  expect(rows).toEqual([
    ['jack@x', '15.0%', '~9.0%', '● OK'],
    ['cyrus@x', '1.0%', '—', '■ Reconnect'],
  ]);
});
