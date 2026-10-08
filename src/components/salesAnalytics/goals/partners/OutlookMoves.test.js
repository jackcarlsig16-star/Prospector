import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import OutlookMoves, { moveLine } from './OutlookMoves';

// microsoft-connect-v1 Stage 3 Step 1 - the read-only Outlook half of the moves panel.
const data = {
  counts: { messages: 78, events: 11, touches: 1, proposed: 1, held: 2, people: 1, skipped_auto: 3, unmatched: 60 },
  touches: { would_record: [{ key: 'touch:<m1@x>', partner: 'Acme', reason: 'emailed Amy Adams <amy@acme.com> on 2026-10-06', direction: 'sent' }], skipped_manual: [{ key: 'touch:<m5@x>', partner: 'Delta', reason: 'logged by hand: Dee Delta on 2026-10-07' }], already: 0, duplicates: 0 },
  proposed: [{ key: 'outlook:<m1@x>', goal_id: 'g1', partner: 'Acme', from: 'researching', to: 'first_email_sent', person: 'Amy Adams <amy@acme.com>', date: '2026-10-06', auto: true }],
  held: [
    { key: 'outlook:<m2@x>', goal_id: 'g2', partner: 'Beta', from: 'first_email_sent', to: 'replied', person: 'bob@beta.io', date: '2026-10-07', auto: false, hold_reason: 'reply outside a thread we started - needs Jack' },
    { key: 'event:ical-1', goal_id: 'g3', partner: 'Gamma', from: 'replied', to: 'meeting_set', person: 'gail@gamma.co', date: '2026-10-08', meeting_date: '2026-10-20', auto: false, hold_reason: 'meeting from the calendar - needs Jack' },
  ],
  people: [{ key: 'person:g1:amy@acme.com', goal_id: 'g1', partner: 'Acme', email: 'amy@acme.com', name: 'Amy Adams', first_seen: '2026-10-06' }],
  skipped: [],
};

test('moveLine: stages, person, date, and the meeting day when it differs', () => {
  expect(moveLine(data.proposed[0])).toBe('Researching → Sent · Amy Adams <amy@acme.com> · Oct 6');
  expect(moveLine(data.held[1])).toBe('Replied → Meeting · gail@gamma.co · Oct 8 (meeting Oct 20)');
});

test('renders counts, ready and needs-OK lists with keys and pills, and the people a Sent mail would add', async () => {
  render(<OutlookMoves load={() => Promise.resolve(data)} />);
  await screen.findByText(/78 messages · 11 meetings read · 1 touches to record · 1 ready · 2 need OK · 1 people to add · 3 auto-replies skipped · 60 unmatched/);
  expect(within(screen.getByRole('list', { name: 'Outlook touches to record' })).getAllByRole('listitem')[0].textContent).toContain('emailed Amy Adams');
  expect(within(screen.getByRole('list', { name: 'Outlook touches already logged' })).getAllByRole('listitem')[0].textContent).toContain('logged by hand: Dee Delta');
  const ready = within(screen.getByRole('list', { name: 'Outlook ready moves' })).getAllByRole('listitem');
  expect(ready).toHaveLength(1);
  expect(ready[0].textContent).toContain('Acme');
  expect(ready[0].textContent).toContain('outlook:<m1@x>');
  expect(ready[0].textContent).toContain('from Outlook');
  const held = within(screen.getByRole('list', { name: 'Outlook held moves' })).getAllByRole('listitem').map(li => li.textContent);
  expect(held[0]).toContain('cold reply');
  expect(held[0]).toContain('reply outside a thread we started');
  expect(held[1]).toContain('meeting');
  expect(held[1]).toContain('event:ical-1');
  const people = within(screen.getByRole('list', { name: 'Outlook people' })).getAllByRole('listitem').map(li => li.textContent);
  expect(people[0]).toContain('Amy Adams <amy@acme.com>');
  expect(screen.queryByRole('button')).toBeNull();
});

test('with actions: Record touches, Apply on ready, OK / Dismiss on held - each calls its prop, reloads and reports', async () => {
  const load = jest.fn().mockResolvedValue(data);
  const onRecord = jest.fn().mockResolvedValue({ recorded: [{ key: 'touch:<m1@x>' }], people: [{ email: 'amy@acme.com' }], skipped_manual: 1, refused: [] });
  const onApply = jest.fn().mockResolvedValue({ applied: [{ key: 'outlook:<m2@x>' }], refused: [] });
  const onDismiss = jest.fn().mockResolvedValue({ dismissed: { key: 'event:ical-1' } });
  const onChanged = jest.fn();
  render(<OutlookMoves load={load} onApply={onApply} onDismiss={onDismiss} onRecord={onRecord} onChanged={onChanged} />);
  await screen.findByRole('button', { name: 'Record touches' });
  fireEvent.click(screen.getByRole('button', { name: 'Record touches' }));
  await screen.findByText('1 touch recorded · 1 people added · 1 already logged by hand');
  expect(onRecord).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Apply Acme' }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith(['outlook:<m1@x>'], false));
  fireEvent.click(screen.getByRole('button', { name: 'OK Beta' }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith(['outlook:<m2@x>'], true));
  await screen.findByText('Beta → Replied · from Outlook');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss Gamma' }));
  await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('event:ical-1'));
  await screen.findByText("Gamma: dismissed - it won't come back");
  expect(onChanged).toHaveBeenCalledTimes(4);
  expect(load.mock.calls.length).toBeGreaterThanOrEqual(5);
});

test('load failure shows the error', async () => {
  render(<OutlookMoves load={() => Promise.reject(new Error('You need member access to this workspace'))} />);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe('You need member access to this workspace');
});
