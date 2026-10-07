import { filterLinkOptions, METRIC_NAMES } from './linkTargets';

const options = {
  commitment: [{ id: 'c1', label: 'Send 40 partner emails' }],
  metric: Object.entries(METRIC_NAMES).map(([id, label]) => ({ id, label })),
  partner: [{ id: 'p1', label: 'Acme Health' }, { id: 'p2', label: 'Beacon Partners' }],
  company: [{ id: 'a1', label: 'Acme Corp' }],
};

test('search matches any part of the name, grouped in order', () => {
  const g = filterLinkOptions(options, 'acme');
  expect(g.map(x => x.type)).toEqual(['partner', 'company']);
  expect(g[0].items.map(o => o.id)).toEqual(['p1']);
  const partners = filterLinkOptions(options, 'PARTNER');
  expect(partners.map(x => x.type)).toEqual(['commitment', 'metric', 'partner']);
});

test('empty search shows each group, capped', () => {
  const g = filterLinkOptions(options, '  ', 3);
  expect(g.map(x => x.type)).toEqual(['commitment', 'metric', 'partner', 'company']);
  expect(g[1].items).toHaveLength(3);
  expect(filterLinkOptions(options, 'zzz')).toEqual([]);
});

test('metric names cover every linkable metric on the server', () => {
  expect(Object.keys(METRIC_NAMES).sort()).toEqual([
    'outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set', 'open_rate',
    'target_orgs', 'dm_contacted', 'positive_responses', 'meetings_held', 'qualified_opps',
    'covered_lives_pipeline', 'proposals_outstanding', 'verbal_commitments', 'contracts_signed', 'launches_90d',
    'partners_first_touched', 'tier1_touched_pct', 'partner_meetings', 'partners_pilot_live', 'real_replies_clicks',
  ].sort());
});
