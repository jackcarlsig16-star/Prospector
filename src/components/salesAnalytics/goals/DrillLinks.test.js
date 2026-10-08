import { render, screen, fireEvent, within } from '@testing-library/react';
import ReportView from './ReportView';
import KpiTable from './KpiTable';
import ScorecardTable from './ScorecardTable';
import { memberLookup } from './goalsUi';
import { filterFeed } from '../huddleView';

// goals-surface-v1 Stage 4: counts open the list they count.
const members = [{ user_id: 'u-jack', name: 'Jack Carlson' }];
const lookup = memberLookup(members);

test('report auto-numbers and the partner status table link; typed-in meetings do not', () => {
  const onOpen = jest.fn();
  const autoChips = {
    s4: [{ k: 'real clicks', v: '4', src: 'Apollo', to: 'huddle:click' }, { k: 'partner meetings', v: '2', src: 'App', to: { partners: { stage: 'meeting_set' } } }],
    s5: [{ k: 'meetings set this week', v: '3', src: 'Manual' }],
  };
  const partnerBlock = { by_owner: { 'u-jack': { in_sequence: 2, replied: 1 } } };
  render(<ReportView weekStart="2026-10-05" report={{ status: 'draft' }} sections={[]} infra={[]} commitments={[]} kpiRows={[]} autoChips={autoChips} partnerBlock={partnerBlock}
    canEdit={false} lookup={lookup} members={members} onOpen={onOpen} />);
  fireEvent.click(screen.getByTitle('Open the real clicks'));
  expect(onOpen).toHaveBeenLastCalledWith('huddle:click');
  fireEvent.click(screen.getByTitle('Open the partner meetings'));
  expect(onOpen).toHaveBeenLastCalledWith({ partners: { stage: 'meeting_set' } });
  expect(screen.queryByTitle('Open the meetings set this week')).toBeNull();
  fireEvent.click(screen.getByTitle("Open Jack's partners at In sequence"));
  expect(onOpen).toHaveBeenLastCalledWith({ partners: { owner: 'u-jack', stage: 'first_email_sent' } });
  fireEvent.click(screen.getByTitle("Open Jack's partners"));
  expect(onOpen).toHaveBeenLastCalledWith({ partners: { owner: 'u-jack' } });
});

test('KPI rows link to Overview / Huddle; manual rows stay plain', () => {
  const onOpen = jest.fn();
  const rows = [
    { key: 'target_orgs', label: 'Target organizations', source: 'Apollo', this_week: 112, last_week: 100 },
    { key: 'qualified_opps', label: 'Qualified opportunities', source: 'Pipeline', this_week: 3, last_week: 2 },
    { key: 'meetings_held', label: 'Meetings held', source: 'Manual', this_week: 1, last_week: 0 },
  ];
  render(<KpiTable rows={rows} weekStart="2026-10-05" editable={false} onOpen={onOpen} onSaveTarget={jest.fn()} />);
  fireEvent.click(screen.getByTitle('Open the list behind Target organizations'));
  expect(onOpen).toHaveBeenLastCalledWith('overview:companies_by_cohort');
  fireEvent.click(screen.getByTitle('Open the list behind Qualified opportunities'));
  expect(onOpen).toHaveBeenLastCalledWith('overview:pipeline_table');
  expect(screen.queryByTitle('Open the list behind Meetings held')).toBeNull();
});

test('scorecard: row names link; a week\'s audience opens that week\'s companies', () => {
  const onOpen = jest.fn();
  const metric = { value: 1200, goal: null, companies: 3, companies_with_employees: 3, unit: 'partners' };
  const data = { month: '2026-09-01', weeks: [{ week_start: '2026-09-28', metrics: new Proxy({}, { get: () => metric }) }], month_total: new Proxy({}, { get: () => metric }), sources: {} };
  render(<ScorecardTable data={data} weekStart="2026-09-28" canEdit={false} onOpen={onOpen} />);
  fireEvent.click(screen.getByTitle('Open the list behind Partners first-touched'));
  expect(onOpen).toHaveBeenLastCalledWith({ partners: { stage: 'first_email_sent' } });
  fireEvent.click(screen.getByTitle('Open the list behind Partners in pilot / live'));
  expect(onOpen).toHaveBeenLastCalledWith({ partners: { stage: ['proposal_pilot', 'live'] } });
  fireEvent.click(screen.getByTitle(/^Open companies sequenced/));
  expect(onOpen).toHaveBeenLastCalledWith({ companies: '2026-09-28' });
  expect(screen.queryByTitle('Open the list behind Meetings set')).toBeNull();
  expect(within(screen.getByRole('table')).getAllByTitle(/^Open the list behind/)).toHaveLength(8);
});

test('the feed filters to one kind of event', () => {
  const items = [{ kind: 'open', owner: 'jack', contact_id: 'a' }, { kind: 'click', owner: 'jack', contact_id: 'b' }, { kind: 'reply', owner: 'cyrus', contact_id: 'c' }];
  const f = { owner: 'team', heat: 'all', stale: false, hideBots: true };
  expect(filterFeed(items, { ...f, kind: 'click' }, new Map(), new Map()).map(i => i.contact_id)).toEqual(['b']);
  expect(filterFeed(items, f, new Map(), new Map())).toHaveLength(3);
});
