import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import ApolloMoves from './ApolloMoves';

// partner-360-v1 Stage 4 step 3 - last run with 2 applied (one undoable, one
// already undone) + 2 held; OK / Dismiss / Undo each call their prop and reload.
const first = {
  proposed: [], skipped: [],
  held: [
    { key: 'sent:c1:2026-09-30T00:28:50Z', goal_id: 'g-bilt', partner: 'Bilt', from: 'not_started', to: 'first_email_sent', date: '2026-09-29', reason: 'enrolled, paused — needs Jack (5 paused)' },
    { key: 'sent:c2:2026-09-30T00:47:13Z', goal_id: 'g-stake', partner: 'Stake', from: 'not_started', to: 'first_email_sent', date: '2026-09-29', reason: 'enrolled, paused — needs Jack (6 paused)' },
  ],
  last_run: {
    at: '2026-10-08T13:00:00Z', status: 'success', calls: 0, refused: [],
    applied: [
      { key: 'sent:c3:2026-08-28T00:28:26Z', goal_id: 'g-dom', partner: 'Domuso', from: 'not_started', to: 'first_email_sent', date: '2026-08-27', reason: 'Becki in sequence since 2026-08-27', event_id: 'e1', undone: false, undoable: true, held_ok: false },
      { key: 'reply:m9', goal_id: 'g-acme', partner: 'Acme', from: 'in_sequence', to: 'replied', date: '2026-10-03', reason: 'reply from Pat (seen at sync 2026-10-03)', event_id: 'e2', undone: true, undoable: false, held_ok: false },
    ],
  },
};
const after = { ...first, held: [first.held[1]], last_run: { ...first.last_run, applied: [{ ...first.last_run.applied[0], undone: true, undoable: false }, first.last_run.applied[1]] } };
const rows = name => within(screen.getByRole('list', { name })).getAllByRole('listitem').map(li => li.textContent);

test('shows the last run (applied with Undo / undone) and the held list with reasons; OK applies with include_held and reloads', async () => {
  const load = jest.fn().mockResolvedValueOnce(first).mockResolvedValue(after);
  const onApply = jest.fn().mockResolvedValue({ applied: [{ key: first.held[0].key }], refused: [] });
  const onChanged = jest.fn();
  render(<ApolloMoves load={load} onApply={onApply} onDismiss={jest.fn()} onUndo={jest.fn()} onChanged={onChanged} onClose={jest.fn()} />);
  await screen.findByRole('list', { name: 'Applied moves' });
  expect(screen.getByText(/2 applied · 0 Apollo calls/)).toBeTruthy();
  expect(rows('Applied moves')).toEqual([
    expect.stringMatching(/^DomusoNot started → SentBecki in sequence since 2026-08-27from ApolloUndo$/),
    expect.stringMatching(/^AcmeSent → Repliedreply from Pat \(seen at sync 2026-10-03\)from Apolloundone$/),
  ]);
  expect(rows('Held moves')).toEqual([
    expect.stringMatching(/^BiltNot started → Sentenrolled, paused — needs Jack \(5 paused\) · Sep 29OKDismiss$/),
    expect.stringMatching(/^StakeNot started → Sentenrolled, paused — needs Jack \(6 paused\) · Sep 29OKDismiss$/),
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'OK Bilt' }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith([first.held[0].key], true));
  await screen.findByText('Bilt → Sent · from Apollo');
  expect(onChanged).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(rows('Held moves')).toHaveLength(1));
  expect(load).toHaveBeenCalledTimes(2);
});

test('Dismiss calls onDismiss with the key; Undo calls onUndo with goal + event and the row turns to "undone"', async () => {
  const load = jest.fn().mockResolvedValueOnce(first).mockResolvedValue(after);
  const onDismiss = jest.fn().mockResolvedValue({ dismissed: {} });
  const onUndo = jest.fn().mockResolvedValue({ goal: {} });
  render(<ApolloMoves load={load} onApply={jest.fn()} onDismiss={onDismiss} onUndo={onUndo} onChanged={jest.fn()} onClose={jest.fn()} />);
  await screen.findByRole('list', { name: 'Held moves' });
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss Stake' }));
  await waitFor(() => expect(onDismiss).toHaveBeenCalledWith(first.held[1].key));
  await screen.findByText("Stake: dismissed - it won't come back");
  fireEvent.click(screen.getByRole('button', { name: 'Undo Domuso' }));
  await waitFor(() => expect(onUndo).toHaveBeenCalledWith('g-dom', 'e1'));
  await screen.findByText('Domuso: back to Not started');
  expect(rows('Applied moves')[0]).toMatch(/undone$/);
  expect(screen.queryByRole('button', { name: 'Undo Domuso' })).toBeNull();
});

test('no run yet and nothing held reads plainly; a failed action shows the error', async () => {
  const load = jest.fn().mockResolvedValue({ proposed: [{ key: 'k' }], held: [{ key: 'h1', goal_id: 'g', partner: 'Bilt', from: 'not_started', to: 'first_email_sent', date: '2026-09-29', reason: 'enrolled, paused — needs Jack (5 paused)' }], skipped: [], last_run: null });
  const onApply = jest.fn().mockRejectedValue(new Error('You need member access to this workspace'));
  render(<ApolloMoves load={load} onApply={onApply} onDismiss={jest.fn()} onUndo={jest.fn()} onChanged={jest.fn()} onClose={jest.fn()} />);
  await screen.findByText(/The daily step has not run yet · 1 proposed now, applies on the next sync/);
  fireEvent.click(screen.getByRole('button', { name: 'OK Bilt' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe('You need member access to this workspace');
});
