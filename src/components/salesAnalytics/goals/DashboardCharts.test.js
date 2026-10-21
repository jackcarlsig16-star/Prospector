import { render, screen, waitFor, within } from '@testing-library/react';
import DashboardCharts from './DashboardCharts';
import GoalsSection from './GoalsSection';
import { goalsApi } from './goalsApi';
import { fetchMovement } from '../pipelineApi';
import { memberLookup } from './goalsUi';

// CRA's Jest resets mock implementations before every test, so they are set inside each test.
jest.mock('./goalsApi', () => ({ TODOS_CHANGED: 'todos', goalsApi: { dashboard: jest.fn(), report: jest.fn(), partnerEvents: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ fetchMovement: jest.fn() }));

// sales-ia-v2 Stage 6 - the 13 chart cards over one read; the Goals section's
// per-person commitments, report card and moves.
const members = [{ user_id: 'u-jack', name: 'Jack Zz' }, { user_id: 'u-cy', name: 'Cyrus Yy' }];
const lookup = memberLookup(members);
const days = ['2026-10-19', '2026-10-20', '2026-10-21'];
const payload = {
  today: '2026-10-21', days: 30, from: '2026-09-22', week_start: '2026-10-19', month: '2026-10', history_start: '2026-10-20', history_days: 2, history_full: false,
  pipeline_by_stage: [{ id: 'target', label: 'Target', count: 0 }, { id: 'meeting', label: 'Meeting', count: 1 }],
  partners_by_status_owner: [{ owner_user_id: 'u-jack', name: 'Jack Zz', counts: { replied: 2 } }],
  partners_by_category: [{ category: '3. Brokers', count: 2 }],
  visitors_per_day: days.map((day, i) => ({ day, companies: i ? i + 1 : null })),
  visitors_by_priority_day: days.map((day, i) => ({ day, P1: i ? 1 : null, P2: i ? i : null, P3: i ? 0 : null, P4: i ? 0 : null })),
  outreach_per_week: [{ week_start: '2026-10-12', sent: 100, opened: 40, clicked: 5, replied: 4 }, { week_start: '2026-10-19', sent: 60, opened: 21, clicked: 2, replied: 4 }],
  replies_meetings_per_week: [{ week_start: '2026-10-12', replies: 4, meetings: 1 }, { week_start: '2026-10-19', replies: 4, meetings: 1 }],
  signals_by_channel: [{ source: 'scout', label: 'Scout', new: 1, accepted: 1, dismissed: 0 }, { source: 'web_visit', label: 'Website', new: 0, accepted: 0, dismissed: 1 }],
  companies_by_channel_stage: [{ channel: 'scout', label: 'Scout signal', bands: { green: 0, yellow: 0, blue: 0, gray: 2, light: 0, faded: 0 } }],
  todos_per_owner: [{ owner_user_id: 'u-jack', name: 'Jack Zz', done: 2, open: 1 }],
  waiting: { open: 3, overdue: 1 },
  covered_lives_by_stage: [{ id: 'meeting', label: 'Meeting', lives: 1200 }],
  credits: { used: 134, cap: 500, month: '2026-10', all_businesses: true },
};

beforeEach(() => { jest.clearAllMocks(); goalsApi.dashboard.mockResolvedValue(payload); });

test('13 chart cards, the history note on the visitor charts, team-wide captions while an owner is picked, one read per filter change', async () => {
  const { rerender } = render(<DashboardCharts businessId="b1" days={30} owner={null} team={null} lookup={lookup} />);
  await screen.findByRole('region', { name: 'Pipeline by stage' });
  expect(document.querySelectorAll('[data-chart]').length).toBe(13);
  expect(screen.getAllByRole('note').map(n => n.textContent)).toEqual(['History starts Oct 20', 'History starts Oct 20']);
  expect(within(screen.getByRole('region', { name: 'Website visitors per day' })).getByRole('img').getAttribute('aria-label')).toBe('Website visitors per day: Oct 19: no data; Oct 20: Companies 2; Oct 21: Companies 3');
  expect(within(screen.getByRole('region', { name: 'Apollo credits used by visitor pulls' })).getByRole('meter').getAttribute('aria-valuenow')).toBe('134');
  expect(within(screen.getByRole('region', { name: 'Waiting on them' })).getByText('3')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Partners by category' })).getByText('Brokers')).toBeTruthy();
  expect(goalsApi.dashboard).toHaveBeenCalledWith('b1', { days: 30, owner: null, team: null });
  rerender(<DashboardCharts businessId="b1" days={7} owner="u-jack" team="upside" lookup={lookup} />);
  await waitFor(() => expect(goalsApi.dashboard).toHaveBeenCalledWith('b1', { days: 7, owner: 'u-jack', team: 'upside' }));
  expect(goalsApi.dashboard).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Outreach per week' })).getByText('Apollo emails · Last 30 days · team-wide')).toBeTruthy());
  expect(within(screen.getByRole('region', { name: 'Pipeline by stage' })).getByText('Employers · As of today · Jack · Upside')).toBeTruthy();
});

test('Goals section: commitments per person with Focus 5 progress, the latest final report, this week\'s moves, week nav', async () => {
  goalsApi.report.mockImplementation((id, w) => Promise.resolve(w === '2026-10-12' ? { report: { status: 'final', finalized_at: '2026-10-16T20:00:00Z', finalized_by: 'u-jack', snapshot: { commitments: [{}, {}], kpi: [] } } } : { report: { status: 'draft' } }));
  goalsApi.partnerEvents.mockResolvedValue([{ id: 'e1', goal_id: 'p1', event: 'status', from_status: 'replied', to_status: 'meeting_set', at: '2026-10-20T16:00:00Z' }]);
  fetchMovement.mockResolvedValue({ moved_forward: [{ id: 'o1', organization: 'Old Mill Union', stage: 'meeting', updated_at: '2026-10-20T15:00:00Z' }], moved_back: [], lost: [] });
  const commitments = [
    { id: 'c1', text: 'Book two meetings', status: 'open', owner_user_id: 'u-jack', plan_id: 'pl', plan_rank: 1 },
    { id: 'c2', text: 'Ship the deck', status: 'done', owner_user_id: 'u-jack', plan_id: 'pl', plan_rank: 2 },
    { id: 'c3', text: 'Call the broker', status: 'open', owner_user_id: 'u-cy', plan_id: null },
  ];
  const onWeek = jest.fn();
  render(<GoalsSection businessId="b1" weekStart="2026-10-19" thisWeek="2026-10-19" onWeek={onWeek} members={members} lookup={lookup} commitments={commitments} report={{ status: 'draft' }} partners={[{ id: 'p1', name: 'Lakeshore Mutual' }]} hero={<div>HERO</div>}>
    <div>CHILD</div>
  </GoalsSection>);
  expect(screen.getByText('HERO')).toBeTruthy();
  expect(screen.getByText('CHILD')).toBeTruthy();
  const jack = within(document.querySelector('[data-person-goals="u-jack"]'));
  expect(jack.getByText('Focus 5 · 1 of 2 done')).toBeTruthy();
  expect(jack.getAllByLabelText('Planned')).toHaveLength(2);
  expect(within(document.querySelector('[data-person-goals="u-cy"]')).getByText('No Focus 5 planned')).toBeTruthy();
  await screen.findByText('Week of Oct 12');
  expect(screen.getByText(/2 commitments · 0 KPI rows frozen/)).toBeTruthy();
  await screen.findByText('2 moves');
  expect(screen.getByText('Lakeshore Mutual')).toBeTruthy();
  expect(screen.getByText('Old Mill Union')).toBeTruthy();
  screen.getByRole('button', { name: 'Previous week' }).click();
  expect(onWeek).toHaveBeenCalledWith('2026-10-12');
  expect(screen.queryByRole('button', { name: 'This week' })).toBeNull();
});
