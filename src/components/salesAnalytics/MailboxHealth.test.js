import { render, screen, fireEvent } from '@testing-library/react';
import MailboxHealth, { tileLine } from './MailboxHealth';
import { exportWidgetCsv } from './exportCsv';

jest.mock('./exportCsv', () => ({ exportWidgetCsv: jest.fn() }));

// dashboard-v3 Stage 4 - mailbox tiles from the pulse route: names never addresses, the health pill, sent + delivered %
// (spam % once any spam block), the cap bar, the warn border at ≥ 95 % of the cap, idle at 0 sends.
const tile = (key, label, over = {}) => ({ key, label, sent: 152, delivered: 150, delivered_rate: 0.987, spam_rate: 0, hard_bounce_rate: 0.013, spam_blocked: 0, per_weekday: 30.4, cap: 50, weekdays: 5, status: 'healthy', why: null, ...over });
const TILES = [
  tile('mailbox:jack', 'Jack'),
  tile('mailbox:cyrus', 'Cyrus', { sent: 249, delivered: 246, spam_blocked: 3, spam_rate: 0.012, per_weekday: 49.8, status: 'at_capacity' }),
  tile('mailbox:mailbox-1', 'Mailbox 1', { sent: 0, delivered: 0, delivered_rate: null, spam_rate: null, hard_bounce_rate: null, per_weekday: 0, status: 'idle' }),
  tile('mailbox:seif', 'Seif', { sent: 0, delivered: 0, per_weekday: 0, status: 'reconnect', why: 'Needs re-auth' }),
];

test('tileLine: sent · delivered %, or spam % once a spam block happened; nothing sent', () => {
  expect(tileLine(TILES[0])).toBe('152 sent · 98.7% delivered');
  expect(tileLine(TILES[1])).toBe('249 sent · 1.2% spam');
  expect(tileLine(TILES[2])).toBe('nothing sent');
});

test('tiles: one per mailbox by name, pills, cap bars (49.8 / 50 = 100 %), the warn border at capacity, idle, reconnect with its reason; no address anywhere; CSV through the shared exporter', () => {
  const { container } = render(<MailboxHealth tiles={TILES} periodLabel="this week" />);
  expect(screen.getByRole('heading', { name: 'Mailboxes' })).toBeInTheDocument();
  expect(screen.getByText(/this week · cap 50 \/ day each/)).toBeInTheDocument();
  const tiles = container.querySelectorAll('[data-mailbox-tile]');
  expect([...tiles].map(t => t.dataset.mailboxTile)).toEqual(['mailbox:jack', 'mailbox:cyrus', 'mailbox:mailbox-1', 'mailbox:seif']);
  expect([...container.querySelectorAll('[data-pill]')].map(p => p.textContent)).toEqual(['✓ healthy', '! at capacity', 'idle', '! reconnect']);
  expect(tiles[0]).toHaveTextContent('152 sent · 98.7% delivered');
  expect(tiles[0]).toHaveTextContent('30.4 / 50 per day');
  expect(tiles[0].querySelector('[data-cap-bar]').style.width).toBe('61%');
  expect(tiles[1].querySelector('[data-cap-bar]').style.width).toBe('100%');
  expect(tiles[1]).toHaveTextContent('49.8 / 50 per day');
  expect(tiles[1].dataset.status).toBe('at_capacity'); // the warn border follows data-status (jsdom drops a var() border color)
  expect(tiles[2]).toHaveTextContent('nothing sent');
  expect(tiles[3]).toHaveAttribute('title', 'Needs re-auth');
  expect(container.textContent).not.toMatch(/@/);
  expect(screen.getByText('Addresses are never shown.', { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  expect(exportWidgetCsv).toHaveBeenCalledWith('mailbox_health', TILES, expect.any(Array));
  expect(exportWidgetCsv.mock.calls[0][2].map(c => c.label)).toEqual(['Mailbox', 'Status', 'Sent', 'Delivered %', 'Hard bounce %', 'Spam %', 'Sends per weekday', 'Cap per day']);
});

test('loading and empty states', () => {
  const { rerender } = render(<MailboxHealth tiles={null} periodLabel="this week" />);
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  rerender(<MailboxHealth tiles={[]} periodLabel="this week" />);
  expect(screen.getByText('No mailbox data yet.')).toBeInTheDocument();
});
