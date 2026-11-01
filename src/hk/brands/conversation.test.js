import { render, screen, within } from '@testing-library/react';
import ConversationChips, { convOfThreads } from './ConversationChips';
import BrandTimeline from './BrandTimeline';

// grow-mailbox-link-v1 Stage 3 - the conversation chips and the Timeline's linked-thread entries: your own thread shows
// the facts + Open in Gmail; a teammate who shares shows the facts without Open in Gmail; one who doesn't share shows
// existence only. Invented names; no addresses anywhere.
const NOW = Date.now(), daysAgo = n => new Date(NOW - n * 864e5).toISOString();
const threads = [
  { id: 'a', brand_id: 'b', member_user_id: 'u-jack', who: 'Jack', own: true, shared: true, last_at: daysAgo(1), message_count: 3, waiting_on: 'us', waiting_days: 1, deal_stage: 'discussing', deal_month: '2026-12', deal_amount_usd: 150, our_question_open: false, summary: 'Wants December', gmail_thread_id: 'aa11bb22' },
  { id: 'b', brand_id: 'b', member_user_id: 'u-pete', who: 'Pete', own: false, shared: true, last_at: daysAgo(4), message_count: 2, waiting_on: 'them', waiting_days: 4, deal_stage: 'confirmed', deal_month: '2027-01', deal_amount_usd: null, summary: 'Confirmed January' },
  { id: 'c', brand_id: 'b', member_user_id: 'u-sam', who: 'Sam', own: false, shared: false, last_at: daysAgo(9) },
];
const member = id => ({ 'u-jack': { first_name: 'Jack', palette_index: 0 }, 'u-pete': { first_name: 'Pete', palette_index: 1 } }[id]);

test('chips: last contact + who, waiting on us / them with days; nothing without a thread', () => {
  const { container, rerender } = render(<ConversationChips conv={convOfThreads(threads)} />);
  expect(container.querySelector('[data-hk-last-contact]').textContent).toBe(' Last contact yesterday · You');
  expect(container.querySelector('[data-hk-waiting="us"]').textContent).toBe('Waiting on us · 1 d');
  rerender(<ConversationChips conv={{ last_at: daysAgo(5), who: 'Pete', waiting_on: 'them', waiting_days: 5 }} />);
  expect(container.querySelector('[data-hk-waiting="them"]').textContent).toBe('Waiting on them · 5 d');
  rerender(<ConversationChips conv={convOfThreads([{ ...threads[0], waiting_on: 'none', waiting_days: null }, threads[1]])} />);
  expect(container.querySelector('[data-hk-waiting]')).toBeNull();
  rerender(<ConversationChips conv={convOfThreads([])} />);
  expect(container.querySelector('[data-hk-conversation]')).toBeNull();
});

test('Timeline: one entry per thread - own = facts + Open in Gmail on your mailbox; shared teammate = facts, no link; private teammate = existence only', () => {
  const { container } = render(<BrandTimeline businessId="hk" brand={{ id: 'b', notes: '' }} events={[]} touches={[]} replies={[]} threads={threads} member={member} mailbox={{ linked: true, email: 'jack@team.invalid' }} me={{ user_id: 'u-jack' }} canEdit={false} onChanged={() => {}} />);
  const items = [...container.querySelectorAll('[data-hk-thread]')];
  expect(items).toHaveLength(3);
  expect(items[0].textContent).toContain('You ↔ them · 3 messages');
  expect(within(items[0]).getByText(/Discussing · December 2026 · \$150/)).toBeInTheDocument();
  expect(within(items[0]).getByRole('link', { name: 'Open in Gmail' }).getAttribute('href')).toContain('#all/aa11bb22');
  expect(items[1].textContent).toContain('Pete ↔ them · 2 messages');
  expect(within(items[1]).getByText(/Confirmed · January 2027/)).toBeInTheDocument();
  expect(within(items[1]).queryByRole('link')).toBeNull();
  expect(items[2].textContent).toContain('Sam has a conversation with them');
  expect(items[2].textContent).toContain('details are private to their mailbox');
  expect(items[2].querySelector('[data-hk-thread-facts]')).toBeNull();
  expect(screen.getByRole('tab', { name: /Emails 3/ })).toBeInTheDocument();
});
