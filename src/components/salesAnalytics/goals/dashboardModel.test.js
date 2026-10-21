import { scopeLabel, captionFor, statusGroups, ownerSeries, categoryParts, channelPoints, historyNote, dayPoints, weekPoints, TEAM_OPTIONS, RANGE_OPTIONS } from './dashboardModel';
import { memberLookup } from './goalsUi';

// sales-ia-v2 Stage 6 - the Dashboard's pure pieces.
const members = [{ user_id: 'u-jack', name: 'Jack Zz' }, { user_id: 'u-cy', name: 'Cyrus Yy' }];
const lookup = memberLookup(members);

test('range and team options; scope + captions', () => {
  expect(RANGE_OPTIONS.map(([d]) => d)).toEqual([7, 30, 90]);
  expect(TEAM_OPTIONS.map(([id]) => id)).toEqual(['', 'homelover', 'upside', 'both']);
  expect(scopeLabel({ owner: null, team: null }, lookup)).toBe('');
  expect(scopeLabel({ owner: 'u-jack', team: 'upside' }, lookup)).toBe('Jack · Upside');
  expect(captionFor('As of today', '')).toBe('As of today');
  expect(captionFor('As of today', 'Jack')).toBe('As of today · Jack');
  expect(captionFor('Last 30 days', 'Jack', true)).toBe('Last 30 days · team-wide');
  expect(captionFor('Last 30 days', '', true)).toBe('Last 30 days');
});

test('partners by status per owner: a group per status in use, a bar per owner in member colors', () => {
  const rows = [
    { owner_user_id: 'u-jack', name: 'Jack Zz', counts: { not_started: 0, replied: 2, meeting_set: 1 } },
    { owner_user_id: null, name: 'Unassigned', counts: { not_started: 0, replied: 0, live: 1 } },
  ];
  expect(statusGroups(rows).map(g => `${g.label}:${JSON.stringify(g.values)}`)).toEqual(['Replied:{"u-jack":2,"unassigned":0}', 'Meeting set:{"u-jack":1,"unassigned":0}', 'Live:{"u-jack":0,"unassigned":1}']);
  expect(ownerSeries(rows, lookup)).toEqual([{ id: 'u-jack', label: 'Jack', color: '#6F8CF0' }, { id: 'unassigned', label: 'Unassigned', color: '#4A5462' }]);
});

test('pie: top five categories by family color, the rest fold into Other', () => {
  const rows = ['3. Brokers', '2. Platforms', '5. Rental Rewards', '10. Chambers', '11. Associations', '13. Cities', '14. Co-ops'].map((category, i) => ({ category, count: 10 - i }));
  const parts = categoryParts(rows);
  expect(parts.map(p => p.label)).toEqual(['Brokers', 'Platforms', 'Rental Rewards', 'Chambers', 'Associations', 'Other (2)']);
  expect(parts[0].color).toBe('#00A19D');
  expect(parts.at(-1).count).toBe(9);
  expect(categoryParts(rows.slice(0, 2)).length).toBe(2);
});

test('channel points use short labels; day / week points keep nulls as gaps; the history note', () => {
  expect(channelPoints([{ channel: 'partner_referral', label: 'Partner / referral', bands: { green: 1 } }])[0]).toEqual({ x: 'partner_referral', label: 'Partner', values: { green: 1 } });
  expect(dayPoints([{ day: '2026-10-19', companies: null }, { day: '2026-10-20', companies: 2 }], ['companies']).map(p => p.values.companies)).toEqual([null, 2]);
  expect(weekPoints([{ week_start: '2026-10-12', sent: 5, opened: 1 }], ['sent', 'opened'])[0]).toEqual({ x: '2026-10-12', label: 'Oct 12', values: { sent: 5, opened: 1 } });
  expect(historyNote({ history_start: null })).toBe('No visitor pulls yet');
  expect(historyNote({ history_start: '2026-10-20', history_full: false })).toBe('History starts Oct 20');
  expect(historyNote({ history_start: '2026-09-01', history_full: true })).toBeNull();
});
