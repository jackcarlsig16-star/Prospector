import { render, screen, fireEvent } from '@testing-library/react';
import { ByMemberTable, MemberStrip, memberItems, memberRow, memberMetricRows, TABLE_COLS } from './EmailByMember';
import { BY_MEMBER } from './byMemberFixture';

const mq = { phone: false };
jest.mock('../../../utils/useMediaQuery', () => () => mq.phone);
beforeEach(() => { mq.phone = false; });

// email-by-member-v1 M3 - the By member table and a member's strip over an invented goals/weekly?member=all: every cell
// is the route's digit, a count carries the route's pace and a rate never does, a member is a name, and no address
// shape is drawn.
const cell = k => document.querySelector(`[data-cell="${k}"]`);

test('the model: the control is Team + the members with a mailbox; the rows under a metric are everyone but the team', () => {
  expect(memberItems(BY_MEMBER)).toEqual([{ id: 'team', label: 'Team' }, { id: 'u1', label: 'Jack' }, { id: 'u2', label: 'Cyrus' }]);
  expect(memberItems(null)).toEqual([{ id: 'team', label: 'Team' }]);
  expect(memberRow(BY_MEMBER, 'u2').name).toBe('Cyrus');
  expect(memberRow(BY_MEMBER, 'gone')).toBeNull();
  expect(memberMetricRows(BY_MEMBER, 'delivered').map(r => [r.name, r.metric.this_week.to_date])).toEqual([['Jack', 161], ['Cyrus', null], ['Unassigned mailbox', 5]]);
  expect(memberMetricRows(BY_MEMBER, 'companies_visited')).toEqual([]);
  expect(memberMetricRows({ metrics: [] }, 'delivered')).toEqual([]);
});

test('1440: one row per member + Unassigned mailbox + Team, to the digit; this week against the same point last week; pace on counts, never on a rate; a line per row', () => {
  const onSelect = jest.fn();
  render(<ByMemberTable all={BY_MEMBER} selected="team" onSelect={onSelect} />);
  expect(screen.getByRole('heading', { name: 'By member' })).toBeInTheDocument();
  expect([...document.querySelectorAll('[data-member-row]')].map(r => r.getAttribute('data-member-row'))).toEqual(['u1', 'u2', 'unassigned', 'team']);
  expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Member', ...TABLE_COLS.map(c => c[1]), 'Delivered · 12 wks']);
  expect(cell('u1|delivered').querySelector('[data-value]')).toHaveTextContent('161');
  expect(cell('u1|delivered')).toHaveTextContent('▼ −19');
  expect(cell('u1|delivered')).toHaveTextContent('vs 180');
  expect(cell('u1|delivered').querySelector('[data-pace]')).toHaveTextContent('on pace for ~282');
  expect(cell('u1|human_open_rate').querySelector('[data-value]')).toHaveTextContent('14.1%');
  expect(cell('u1|human_open_rate')).toHaveTextContent('▼ −2.1 pts');
  expect(document.querySelectorAll('[data-cell$="|human_open_rate"] [data-pace]')).toHaveLength(0);
  expect(cell('u2|delivered').querySelector('[data-value]')).toHaveTextContent('—');
  expect(cell('u2|delivered').querySelector('[data-pace]')).toBeNull();
  expect(cell('team|meetings_set').querySelector('[data-value]')).toHaveTextContent('3');
  expect(cell('team|delivered').querySelector('[data-value]')).toHaveTextContent('166');
  expect(screen.getByRole('img', { name: /^Cyrus: Delivered, last 12 weeks/ })).toBeInTheDocument();
  expect(document.querySelectorAll('[data-cell$="|spark"] svg')).toHaveLength(4);
  expect(document.querySelector('[data-member-rule]')).toHaveTextContent("A member's email numbers");
  expect(document.querySelector('[data-by-member]').textContent).not.toMatch(/@/);
  fireEvent.click(screen.getByRole('button', { name: 'Jack' }));
  expect(onSelect).toHaveBeenCalledWith('u1');
  expect(screen.getByRole('button', { name: 'Team' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: 'Unassigned mailbox' })).toBeNull();
});

test('390: the same rows as cards, no table; loading and an error read as words', () => {
  mq.phone = true;
  const { rerender } = render(<ByMemberTable all={BY_MEMBER} selected="u1" onSelect={() => {}} />);
  expect(screen.queryByRole('table')).toBeNull();
  expect(document.querySelectorAll('[data-member-row]')).toHaveLength(4);
  expect(cell('u1|replies').querySelector('[data-value]')).toHaveTextContent('1');
  rerender(<ByMemberTable all={null} selected="team" onSelect={() => {}} />);
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  rerender(<ByMemberTable all={null} error="The read failed" selected="team" onSelect={() => {}} />);
  expect(screen.getByText(/The read failed/)).toBeInTheDocument();
});

test("a member's strip: the member's six rows as tiles, a rate as a percent with no pace", () => {
  render(<MemberStrip row={memberRow(BY_MEMBER, 'u1')} />);
  const tile = k => document.querySelector(`[data-member-tile="${k}"]`);
  expect(document.querySelectorAll('[data-member-tile]')).toHaveLength(6);
  expect(tile('delivered').querySelector('[data-value]')).toHaveTextContent('161');
  expect(tile('delivered')).toHaveTextContent('vs 180 same point last wk');
  expect(tile('delivered').querySelector('[data-pace]')).toHaveTextContent('on pace for ~282');
  expect(tile('human_open_rate').querySelector('[data-value]')).toHaveTextContent('14.1%');
  expect(tile('human_open_rate').querySelector('[data-pace]')).toBeNull();
  expect(tile('deliverability').querySelector('[data-pace]')).toBeNull();
});
