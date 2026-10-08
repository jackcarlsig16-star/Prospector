import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InsightsPanel, { actionFor, RULE_IDS, APOLLO_MAILBOXES_URL } from './InsightsPanel';

// overview-home-v1 Stage 2: one action per rule, viewer read-only, checks passed.
const ins = (id, scope_key, affected = []) => ({ id, scope_key, severity: 'warn', title: `${id} title`, evidence: 'e', cause: 'c', action: 'a', affected });
const seq = { type: 'sequence', id: 'seq-1', label: 'HomeLover 5-Step Retail' };
const all = [
  ins('R1', 'seq-1', [seq]), ins('R2', 'cyrus@x', [{ type: 'mailbox', id: 'cyrus@x', label: 'cyrus@x' }]), ins('R3', 'week:2026-09-28', [{ type: 'week', id: '2026-09-28', label: 'week of Sep 28' }]),
  ins('R4', '', [{ type: 'sequence', id: 'seq-9', label: 'Best: X' }]), ins('R5', 'jack@x'), ins('R6', 'jack@x'), ins('R7', 'seq-1:2', [seq]), ins('R8', 'seq-1', [seq, { type: 'sequence', id: 'seq-2', label: 'Best: Y' }]),
  ins('R9', ''), ins('R10', 'hard_bounce'),
];
const insights = { insights: all, not_enough_data: [], dismissed: [], computed_at: 'now' };
const entities = { sequences: [{ id: 'seq-1', name: 'HomeLover 5-Step Retail' }], mailboxes: [] };

test('actionFor: the 10 rules map to the spec\'s buttons', () => {
  const ctx = { toggleBounces: jest.fn(), onOpenHuddle: jest.fn(), humanOpens: true, onToggleHumanOpens: jest.fn() };
  const by = Object.fromEntries(all.map(i => [i.id, actionFor(i, ctx)]));
  expect(by.R1.label).toBe('View bounces');
  for (const id of ['R2', 'R5', 'R6']) { expect(by[id].label).toBe('Open mailbox'); expect(by[id].href).toBe(APOLLO_MAILBOXES_URL); }
  expect(by.R3.label).toBe('View week');
  expect(by.R4.label).toBe('Open Huddle');
  by.R4.onClick(); expect(ctx.onOpenHuddle).toHaveBeenCalledWith({ feed: null });
  for (const id of ['R7', 'R8']) { expect(by[id].label).toBe('Open sequence in Apollo'); expect(by[id].href).toBe('https://app.apollo.io/#/sequences/seq-1'); }
  expect(by.R9.label).toBe('Hide human opens');
  expect(actionFor(all[8], { ...ctx, humanOpens: false }).label).toBe('Show human opens');
  expect(by.R10).toBeNull();
  expect(RULE_IDS).toHaveLength(10);
});

test('panel: a button or link per fired rule (none for R10), R1 loads the bounce list, viewer has no Dismiss, checks passed counts the quiet rules', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [{ day: '2026-09-29', mailbox: 'jack@x', sequence_id: 'seq-1', step: 2, hard_bounced: 3, delivered: 40, spam_blocked: 0 }], contacts: [] }) }));
  const onToggleHumanOpens = jest.fn();
  const { container, rerender } = render(<InsightsPanel businessId="b" insights={insights} entities={entities} canEdit={false} humanOpens onToggleHumanOpens={onToggleHumanOpens} onOpenHuddle={jest.fn()} onInsightsChanged={jest.fn()} />);
  expect(container.querySelectorAll('[data-action]')).toHaveLength(9);
  expect(container.querySelector('[data-insight="R10"] [data-action]')).toBeNull();
  expect(screen.queryByText('Dismiss for 7 days')).toBeNull();
  fireEvent.click(screen.getByText('Hide human opens'));
  expect(onToggleHumanOpens).toHaveBeenCalled();
  fireEvent.click(screen.getByText('View bounces'));
  await waitFor(() => expect(container.querySelector('[data-bounce-list]')).not.toBeNull());
  expect(global.fetch.mock.calls[0][0]).toBe('/api/sales/b/bounces?sequence_id=seq-1');
  expect(screen.getByText('3 hard bounces across 1 sequence-step-day (Apollo\'s daily counts). Apollo lists the bounced contacts on the sequence page.')).toBeTruthy();
  expect(container.querySelector('[data-checks-passed] summary').textContent).toBe('0 checks passed');
  rerender(<InsightsPanel businessId="b" insights={{ ...insights, insights: [all[0]], not_enough_data: ['R9 bot opens: 12 open events (needs 30)'], dismissed: [{ id: 'R4', scope_key: '', title: 'No replies' }] }} entities={entities} canEdit humanOpens onToggleHumanOpens={onToggleHumanOpens} onOpenHuddle={jest.fn()} onInsightsChanged={jest.fn()} />);
  expect(container.querySelector('[data-checks-passed] summary').textContent).toBe('7 checks passed · not enough data: 1 · dismissed: 1');
  expect(screen.getAllByText('Dismiss for 7 days')).toHaveLength(1);
});
