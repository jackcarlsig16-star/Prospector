import { render, screen, fireEvent, within } from '@testing-library/react';
import HomeCards, { splitSlices, donutGradient } from './HomeCards';
import { goalsApi } from './goalsApi';
import { memberLookup } from './goalsUi';
import { EMPLOYER_STAGE_COLORS, PARTNER_STATUS_GROUPS } from '../../../constants/homeCards';

jest.mock('./goalsApi', () => ({ goalsApi: { homeCards: jest.fn() } }));
jest.mock('../../../utils/useMediaQuery', () => () => false);

// dashboard-v3 Stage 5 - the three small cards over an invented GET goals/dashboard: every legend count and total is the
// route's digit, a zero slice is not drawn (its stage goes to the footnote), the owner legend wears member colors, We owe
// rows sort by open with the overdue note, waiting-on and lives read the route, the two links navigate; nothing writes.
const JACK = 'u-jack', CY = 'u-cyrus', SEIF = 'u-seif';
const members = [{ user_id: JACK, name: 'Jack Zz' }, { user_id: CY, name: 'Cyrus Yy' }, { user_id: SEIF, name: 'Seif Ss' }];
const stage = (id, label, count) => ({ id, label, count });
const DATA = {
  today: '2026-11-05', owner: null, members,
  employers: { total: 238, by_stage: [stage('target', 'Target', 88), stage('contacted', 'Contacted', 74), stage('responded', 'Responded', 1), stage('meeting', 'Meeting', 0), stage('proposal_pilot', 'Proposal/Pilot', 0), stage('verbal', 'Verbal', 1), stage('contract', 'Contract', 0), stage('launched', 'Launched', 0), stage('nurture', 'Nurture', 38), stage('on_hold', 'On hold', 36)] },
  partners: { total: 78, by_status: [stage('not_started', 'Not started', 52), stage('working', 'Working', 12), stage('replied', 'Replied', 6), stage('meeting', 'Meeting', 3), stage('pilot_live', 'Pilot · Live', 4), stage('paused', 'Paused', 1)],
    by_owner: [{ owner_user_id: JACK, name: 'Jack Zz', count: 38 }, { owner_user_id: CY, name: 'Cyrus Yy', count: 37 }, { owner_user_id: SEIF, name: 'Seif Ss', count: 1 }, { owner_user_id: null, name: 'Unassigned', count: 2 }] },
  todos: { per_owner: [{ owner_user_id: JACK, name: 'Jack Zz', open: 140, overdue: 36 }, { owner_user_id: CY, name: 'Cyrus Yy', open: 9, overdue: 0 }, { owner_user_id: SEIF, name: 'Seif Ss', open: 37, overdue: 0 }, { owner_user_id: null, name: 'Unassigned', open: 110, overdue: 0 }], open: 296, overdue: 36 },
  waiting: { open: 12, overdue: 0, scope: 'team' },
  lives: { value: 390, goal: 1000, metric: 'covered_lives_pipeline' },
};
const lookup = memberLookup(members);
beforeEach(() => { goalsApi.homeCards.mockResolvedValue(DATA); });
afterEach(() => jest.clearAllMocks());

test('splitSlices / donutGradient: drawn slices biggest first in their colors, the empty ones apart; the gradient covers 0–100 % in that order', () => {
  const { drawn, empty } = splitSlices(DATA.employers.by_stage, id => EMPLOYER_STAGE_COLORS[id]);
  expect(drawn.map(s => s.id)).toEqual(['target', 'contacted', 'nurture', 'on_hold', 'responded', 'verbal']);
  expect(empty.map(s => s.id)).toEqual(['meeting', 'proposal_pilot', 'contract', 'launched']);
  expect(drawn[0].color).toBe('#94A3B8');
  const g = donutGradient(drawn);
  expect(g.startsWith('conic-gradient(#94A3B8 0.00% 36.97%, #4FD1C5 36.97% 68.07%')).toBe(true);
  expect(g.endsWith('#3DD68C 99.58% 100.00%)')).toBe(true);
  expect(donutGradient([])).toBeNull();
  expect(splitSlices(DATA.partners.by_status, () => '#000', { byCount: false }).drawn.map(s => s.id)).toEqual(['not_started', 'working', 'replied', 'meeting', 'pilot_live', 'paused']);
  expect(new Set(PARTNER_STATUS_GROUPS.map(g => g.color)).size).toBe(PARTNER_STATUS_GROUPS.length);
});

test('the three cards: totals and legend counts = the route, zero stages in the footnote, owner legend in member colors, We owe rows by open with the overdue note, waiting / overdue / lives, Map → and Actions →; no write control', async () => {
  const onOpenMap = jest.fn(), onOpenActions = jest.fn();
  render(<HomeCards businessId="b1" owner={null} lookup={lookup} onOpenMap={onOpenMap} onOpenActions={onOpenActions} />);
  await screen.findByRole('img', { name: /238 employers/ });
  expect(goalsApi.homeCards).toHaveBeenCalledWith('b1', { owner: null });
  const employers = screen.getByRole('region', { name: 'Employers by stage' });
  expect(within(employers).getByRole('img').getAttribute('aria-label')).toBe('238 employers: Target 88, Contacted 74, Nurture 38, On hold 36, Responded 1, Verbal 1');
  expect([...employers.querySelectorAll('[data-legend-row]')].map(e => `${e.dataset.legendRow}:${e.dataset.count}`)).toEqual(['target:88', 'contacted:74', 'nurture:38', 'on_hold:36', 'responded:1', 'verbal:1']);
  expect(employers.querySelector('[data-donut="employers"]')).toHaveAttribute('data-gradient', '6'); // six slices drawn (jsdom drops the conic-gradient value itself)
  expect(employers.querySelector('[data-zero-stages]')).toHaveTextContent('Meeting · Proposal/Pilot · Contract · Launched: 0 — not drawn until one lands.');
  const partners = screen.getByRole('region', { name: 'Partners by status' });
  expect(within(partners).getByRole('img').getAttribute('aria-label')).toBe('78 partners: Not started 52, Working 12, Replied 6, Meeting 3, Pilot · Live 4, Paused 1');
  expect(partners.querySelector('[data-zero-statuses]')).toBeNull();
  const owners = [...partners.querySelectorAll('[data-owner-legend] [data-owner]')];
  expect(owners.map(o => `${o.dataset.owner}:${o.dataset.count}:${o.textContent.trim()}`)).toEqual([`${JACK}:38:Jack 38`, `${CY}:37:Cyrus 37`, `${SEIF}:1:Seif 1`, 'unassigned:2:Unassigned 2']);
  expect(owners[0].querySelector('i').style.background).toBe('rgb(111, 140, 240)'); // Jack's member color, by join order
  expect(owners[1].querySelector('i').style.background).toBe('rgb(201, 118, 38)');
  const owe = screen.getByRole('region', { name: 'We owe, they owe' });
  expect([...owe.querySelectorAll('[data-owe-row]')].map(e => `${e.dataset.oweRow}:${e.dataset.open}:${e.dataset.overdue}`)).toEqual([`${JACK}:140:36`, 'unassigned:110:0', `${SEIF}:37:0`, `${CY}:9:0`]);
  expect(owe.querySelector(`[data-owe-row="${JACK}"]`)).toHaveTextContent('Jack140 36 overdue');
  expect(owe.querySelector(`[data-owe-row="${CY}"]`)).toHaveTextContent('Cyrus9');
  expect(owe.querySelector(`[data-owe-row="${CY}"]`).textContent).not.toMatch(/overdue/);
  expect(owe.querySelector('[data-waiting="12"]')).toHaveTextContent('12 waiting on them');
  expect(owe.querySelector('[data-waiting-overdue="0"]')).toHaveTextContent('0 overdue');
  expect(owe.querySelector('[data-lives="390"]')).toHaveTextContent('390 lives · 39% of 1,000');
  fireEvent.click(within(employers).getByRole('button', { name: 'Map →' }));
  fireEvent.click(within(owe).getByRole('button', { name: 'Actions →' }));
  expect(onOpenMap).toHaveBeenCalledTimes(1); expect(onOpenActions).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(document.body.textContent).not.toMatch(/@/);
});

test('a person filter re-reads with that owner; no lives goal reads "no goal set"; an empty pipeline shows the empty states and a paused-only footnote', async () => {
  goalsApi.homeCards.mockResolvedValue({ ...DATA, owner: JACK, employers: { total: 0, by_stage: DATA.employers.by_stage.map(s => ({ ...s, count: 0 })) }, partners: { total: 1, by_status: DATA.partners.by_status.map(s => ({ ...s, count: s.id === 'paused' ? 1 : 0 })), by_owner: [{ owner_user_id: JACK, name: 'Jack Zz', count: 1 }] }, todos: { per_owner: [], open: 0, overdue: 0 }, waiting: { open: 0, overdue: 0, scope: 'team' }, lives: { value: 0, goal: null, metric: 'covered_lives_pipeline' } });
  render(<HomeCards businessId="b1" owner={JACK} lookup={lookup} onOpenMap={jest.fn()} onOpenActions={jest.fn()} />);
  await screen.findByText('No employers in the pipeline yet.');
  expect(goalsApi.homeCards).toHaveBeenCalledWith('b1', { owner: JACK });
  expect(screen.getByRole('region', { name: 'Employers by stage' }).querySelector('[data-zero-stages]')).toHaveTextContent('Target · Contacted · Responded · Meeting · Proposal/Pilot · Verbal · Contract · Launched: 0');
  const partners = screen.getByRole('region', { name: 'Partners by status' });
  expect(within(partners).getByRole('img').getAttribute('aria-label')).toBe('1 partners: Paused 1');
  expect(partners.querySelector('[data-zero-statuses]')).toHaveTextContent('Not started · Working · Replied · Meeting · Pilot · Live: 0');
  expect(screen.getByText('No open to-dos.')).toBeInTheDocument();
  expect(document.querySelector('[data-lives="0"]')).toHaveTextContent('0 lives · no goal set');
});
