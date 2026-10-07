import { render, screen, fireEvent, within } from '@testing-library/react';
import WorkflowView from './WorkflowView';
import { comparePartners, stepOf, isTouched } from '../../../../constants/partnerPipeline';
import { familyOf } from './partnerTypes';
import { memberLookup } from '../goalsUi';

// sales-partners-workflow-v1 Stage 2: grouping, top-5 order, touched counts,
// stage bar filter.
const lookup = memberLookup([{ user_id: 'u-jack', name: 'Jack Carlson' }]);
const p = (id, extra) => ({ id, name: id, category: '5. Rental Rewards & Renter Platforms', pipeline_status: 'not_started', owner_user_id: 'u-jack', ...extra });

test('order: hand rank first, then P1 > P2 > P3 > none, hot, tier, name', () => {
  const list = [p('Zed'), p('Bee', { priority: 2 }), p('Ann', { priority: 1, tier: '2' }), p('Cat', { priority: 1, tier: '1' }), p('Dan', { priority: 1, hot: true, tier: '3' }), p('Eve', { sort_rank: '5' }), p('Fay', { sort_rank: 2 })];
  expect(list.sort(comparePartners).map(x => x.name)).toEqual(['Fay', 'Eve', 'Dan', 'Cat', 'Ann', 'Bee', 'Zed']);
});

test('steps, touched, families', () => {
  expect([stepOf('in_sequence'), stepOf('first_email_sent'), stepOf('live'), stepOf('paused'), stepOf(null)]).toEqual([3, 3, 7, null, 0]);
  expect(isTouched({ pipeline_status: 'first_email_drafted' })).toBe(false);
  expect(isTouched({ pipeline_status: 'replied' })).toBe(true);
  expect(isTouched({ pipeline_status: 'paused', last_touch_at: '2026-09-01T00:00:00Z' })).toBe(true);
  expect(['1. A', '7. B', '4. C', '9. D', '13. E', '14. F', null].map(c => familyOf(c).id)).toEqual(['current', 'platforms', 'brokers', 'renters', 'influence', 'professional', 'none']);
});

test('groups by category number, top 5 then "Show N more", every partner once', () => {
  const rent = Array.from({ length: 7 }, (_, i) => p(`R${i}`, { priority: i === 6 ? 1 : null, pipeline_status: i < 2 ? 'replied' : 'not_started' }));
  const cur = [p('C1', { category: '1. Current Partners (active)', pipeline_status: 'live', last_touch_at: '2026-10-01T00:00:00Z' })];
  const all = [...rent, ...cur];
  render(<WorkflowView partners={all} shown={all} lookup={lookup} compact={false} stage={null} onStage={jest.fn()} />);
  const groups = screen.getAllByRole('region').filter(r => r.getAttribute('aria-label') !== 'Top priorities');
  expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['Current Partners (active)', 'Rental Rewards & Renter Platforms']);
  const rentGroup = groups[1];
  expect(within(rentGroup).getByText('2 of 7 touched')).toBeTruthy();
  const names = () => [...rentGroup.querySelectorAll('[data-partner-id]')].map(e => e.getAttribute('data-partner-id'));
  expect(names()).toEqual(['R6', 'R0', 'R1', 'R2', 'R3']);
  fireEvent.click(within(rentGroup).getByRole('button', { name: 'Show 2 more ▾' }));
  expect(names()).toEqual(['R6', 'R0', 'R1', 'R2', 'R3', 'R4', 'R5']);
  expect(within(screen.getByRole('region', { name: 'Top priorities' })).getByText('R6')).toBeTruthy();
});

test('stage bar segments are buttons that filter', () => {
  const all = [p('A', { pipeline_status: 'replied' }), p('B'), p('C', { pipeline_status: 'in_sequence' }), p('D', { pipeline_status: 'first_email_sent' })];
  const onStage = jest.fn();
  const { rerender } = render(<WorkflowView partners={all} shown={all} lookup={lookup} compact={false} stage={null} onStage={onStage} />);
  const bar = screen.getByRole('group', { name: 'Partners by stage' });
  fireEvent.click(within(bar).getByRole('button', { name: 'Sent 2' }));
  expect(onStage).toHaveBeenCalledWith('first_email_sent');
  rerender(<WorkflowView partners={all} shown={all} lookup={lookup} compact={false} stage="first_email_sent" onStage={onStage} />);
  expect([...document.querySelectorAll('section[aria-label="Rental Rewards & Renter Platforms"] [data-partner-id]')].map(e => e.getAttribute('data-partner-id')).sort()).toEqual(['C', 'D']);
  expect(screen.getByRole('button', { name: 'Showing Sent (2). Clear filter' })).toBeTruthy();
});

// Stage 3: row actions.
const members = [{ user_id: 'u-jack', name: 'Jack Carlson' }, { user_id: 'u-cy', name: 'Cyrus Lee' }];
const actions = extra => ({ members, onNext: jest.fn().mockResolvedValue(), onSignal: jest.fn(), ...extra });

test('Next names the one-step move; Live has none; Paused says Resume', () => {
  const rows = [p('A'), p('B', { pipeline_status: 'first_email_drafted' }), p('C', { pipeline_status: 'in_sequence' }), p('D', { pipeline_status: 'live' }), p('E', { pipeline_status: 'paused' })];
  render(<WorkflowView partners={rows} shown={rows} lookup={lookup} compact={false} stage={null} onStage={jest.fn()} rowActions={() => actions()} onRank={null} movedNotes={{}} />);
  const grp = document.querySelector('section[aria-label="Rental Rewards & Renter Platforms"]');
  const btn = id => grp.querySelector(`[data-partner-id="${id}"]`);
  expect(within(btn('A')).getByRole('button', { name: 'Next: Start research' })).toBeTruthy();
  expect(within(btn('B')).getByRole('button', { name: 'Next: Mark sent' })).toBeTruthy();
  expect(within(btn('C')).getByRole('button', { name: 'Next: Got a reply' })).toBeTruthy();
  expect(within(btn('D')).queryByRole('button', { name: /^Next/ })).toBeNull();
  expect(within(btn('D')).getByText('✓ Live')).toBeTruthy();
  expect(within(btn('E')).getByRole('button', { name: 'Resume' })).toBeTruthy();
});

test('More menu: every action in words; jump-to-stage sends the stage the screen showed', () => {
  const a = actions();
  const rows = [p('A', { pipeline_status: 'replied' })];
  render(<WorkflowView partners={rows} shown={rows} lookup={lookup} compact={false} stage={null} onStage={jest.fn()} rowActions={() => a} onRank={null} movedNotes={{}} />);
  const row = document.querySelector('section[aria-label="Rental Rewards & Renter Platforms"] [data-partner-id="A"]');
  fireEvent.click(within(row).getByRole('button', { name: 'More actions for A' }));
  const menu = screen.getByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Jump to stage… ›', 'Assign… ›', '🔥 Hot on', 'Snooze 7 days', 'Deprioritize (pause)', 'Add note… ›']);
  fireEvent.click(within(menu).getByText('Jump to stage… ›'));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: /Sent/ }));
  expect(a.onSignal).toHaveBeenCalledWith({ type: 'status', to: 'first_email_sent', expect: 'replied' });
});

test('viewers get no Next, More or up/down', () => {
  const rows = [p('A'), p('B')];
  render(<WorkflowView partners={rows} shown={rows} lookup={lookup} compact={false} stage={null} onStage={jest.fn()} rowActions={() => null} onRank={null} movedNotes={{}} />);
  expect(screen.queryByRole('button', { name: /^Next|More actions|Move .* (up|down)/ })).toBeNull();
});

test('▲▼ send the group order with the row moved one place; ends are disabled', () => {
  const onRank = jest.fn();
  const rows = [p('A', { priority: 1 }), p('B', { priority: 2 }), p('C', { priority: 3 })];
  render(<WorkflowView partners={rows} shown={rows} lookup={lookup} compact={false} stage={null} onStage={jest.fn()} rowActions={() => actions()} onRank={onRank} movedNotes={{ B: 'Moved to Sent · today' }} />);
  const grp = document.querySelector('section[aria-label="Rental Rewards & Renter Platforms"]');
  expect(within(grp).getByRole('button', { name: 'Move A up' }).disabled).toBe(true);
  expect(within(grp).getByRole('button', { name: 'Move C down' }).disabled).toBe(true);
  fireEvent.click(within(grp).getByRole('button', { name: 'Move C up' }));
  expect(onRank).toHaveBeenCalledWith('C', ['A', 'C', 'B']);
  fireEvent.click(within(grp).getByRole('button', { name: 'Move A down' }));
  expect(onRank).toHaveBeenLastCalledWith('A', ['B', 'A', 'C']);
  expect(within(grp).getByText('Moved to Sent · today')).toBeTruthy();
});
