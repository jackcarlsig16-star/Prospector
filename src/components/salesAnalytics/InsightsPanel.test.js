import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import InsightsPanel, { actionFor, RULE_IDS, APOLLO_MAILBOXES_URL } from './InsightsPanel';
import { dismissInsight } from './salesApi';

jest.mock('./salesApi', () => ({ dismissInsight: jest.fn() }));

// dashboard-v3 Stage 4 - WHY rows: every live rule as a compact row (good rows too), one action each, Dismissed n ▾,
// the Dismiss round trip (POST, hidden at once, the list reloads), a Viewer without Dismiss.
const ins = (id, scope_key, severity, affected = []) => ({ id, scope_key, severity, title: `${id} title`, evidence: `${id} evidence`, cause: `${id} cause`, action: `${id} suggestion`, affected });
const seq = { type: 'sequence', id: 'seq-1', label: 'HomeLover 5-Step Retail' };
const all = [
  ins('R1', 'seq-1', 'bad', [seq]), ins('R2', 'mb', 'bad', [{ type: 'mailbox', id: 'mb', label: 'Mailbox A' }]), ins('R3', 'week:2026-10-26', 'warn'),
  ins('R4', '', 'warn', [{ type: 'sequence', id: 'seq-9', label: 'Best: X' }]), ins('R5', 'mb', 'bad'), ins('R6', 'mb', 'warn'), ins('R7', 'seq-1:2', 'warn', [seq]), ins('R8', 'seq-1', 'warn', [seq]),
  ins('R9', '', 'warn'), ins('R10', 'hard_bounce', 'info'),
];
const insights = { insights: all, not_enough_data: ['R2 x', 'R6 y'], dismissed: [{ id: 'R3', scope_key: 'week:2026-10-19', title: 'Old spam week' }], computed_at: 'now' };
beforeEach(() => { dismissInsight.mockResolvedValue({}); });
afterEach(() => jest.clearAllMocks());

test('actionFor: ONE action per rule - sequence rules open the sequence in Apollo (Pause / Review copy), mailbox rules open Apollo mailboxes, the rest open here; R10 none', () => {
  const onEmail = jest.fn();
  const by = Object.fromEntries(all.map(i => [i.id, actionFor(i, { onEmail, hereLabel: 'Open Explorer' })]));
  expect(by.R1.props.children[0]).toBe('Pause sequence'); expect(by.R1.props.href).toBe('https://app.apollo.io/#/sequences/seq-1');
  for (const id of ['R2', 'R5', 'R6']) { expect(by[id].props.children[0]).toBe('Open mailboxes'); expect(by[id].props.href).toBe(APOLLO_MAILBOXES_URL); }
  for (const id of ['R7', 'R8']) { expect(by[id].props.children[0]).toBe('Review copy'); expect(by[id].props.href).toBe('https://app.apollo.io/#/sequences/seq-1'); }
  expect(by.R4.props.children).toBe('Open Explorer'); // its only sequence is "Best: X"
  expect(by.R3.props.children).toBe('Open Explorer'); expect(by.R9.props.children).toBe('Open Explorer');
  by.R3.props.onClick(); expect(onEmail).toHaveBeenCalledTimes(1);
  expect(by.R10).toBeNull();
  expect(actionFor(all[2], {})).toBeNull(); // nowhere to go without ctx.onEmail
  expect(RULE_IDS).toHaveLength(10);
});

test('panel (Member): header counts rules + short of data, every live row incl. the good one, severity words, one action each, Dismissed 1 ▾ lists it; Dismiss posts and hides the row and reloads', async () => {
  const onInsightsChanged = jest.fn().mockResolvedValue();
  render(<InsightsPanel businessId="b1" insights={insights} canEdit onInsightsChanged={onInsightsChanged} onOpenExplorer={jest.fn()} />);
  const panel = screen.getByRole('region', { name: /Why performance looks like this/ });
  expect(panel).toHaveTextContent('✦ generated · 10 rules live · 2 short of data');
  expect(document.querySelectorAll('[data-insight]')).toHaveLength(10);
  expect(within(panel).getAllByRole('img').map(e => e.getAttribute('aria-label')).filter(w => w === 'Good news')).toHaveLength(1);
  expect(document.querySelector('[data-insight="R1"]')).toHaveTextContent('HomeLover 5-Step Retail');
  expect(document.querySelector('[data-insight="R1"]')).toHaveTextContent('Rule R1 · Cause: R1 cause · Suggested: R1 suggestion');
  expect(document.querySelectorAll('[data-action]')).toHaveLength(9);
  expect(within(panel).getAllByRole('button', { name: 'Dismiss 7 d' })).toHaveLength(10);
  fireEvent.click(within(panel).getByRole('button', { name: /Dismissed 1/ }));
  expect(document.querySelector('[data-dismissed-list]')).toHaveTextContent('Old spam week · R3 · hidden 7 days');
  fireEvent.click(within(document.querySelector('[data-insight="R5"]')).getByRole('button', { name: 'Dismiss 7 d' }));
  await waitFor(() => expect(dismissInsight).toHaveBeenCalledWith('b1', { insight_id: 'R5', scope_key: 'mb' }));
  await waitFor(() => expect(onInsightsChanged).toHaveBeenCalled());
  expect(document.querySelector('[data-insight="R5"]')).toBeNull();
  expect(document.querySelectorAll('[data-insight]')).toHaveLength(9);
});

test('a Viewer reads every row and its action but has no Dismiss; nothing fired = the quiet line', () => {
  const { unmount } = render(<InsightsPanel businessId="b1" insights={insights} canEdit={false} onInsightsChanged={jest.fn()} onOpenExplorer={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Dismiss 7 d' })).toBeNull();
  expect(document.querySelectorAll('[data-action]')).toHaveLength(9);
  unmount();
  render(<InsightsPanel businessId="b1" insights={{ insights: [], not_enough_data: ['R1 x'], dismissed: [], computed_at: 'now' }} canEdit onInsightsChanged={jest.fn()} />);
  expect(document.querySelector('[data-insights-empty]')).toHaveTextContent('Nothing stands out right now · 10 rules ran on the synced data · 1 short of data.');
});
