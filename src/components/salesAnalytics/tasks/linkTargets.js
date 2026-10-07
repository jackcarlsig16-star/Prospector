import { useState, useCallback, useRef } from 'react';
import { goalsApi } from '../goals/goalsApi';

// Names for every metric key a to-do can link to - must match
// LINKABLE_METRICS in api/sales/goalsRoutes.js. Hero-card goals first.
export const METRIC_NAMES = {
  outbound_audience: 'Outbound audience',
  total_in_sequence: 'People in sequence',
  partners_first_touched: 'Partners first-touched',
  meetings_set: 'Meetings set',
  real_replies_clicks: 'Real replies + clicks',
  sequences_running: 'Sequences running',
  open_rate: 'Open rate',
  tier1_touched_pct: 'Tier 1 touched',
  partner_meetings: 'Partner meetings',
  partners_pilot_live: 'Partners in pilot / live',
  target_orgs: 'Target organizations',
  dm_contacted: 'Decision-makers contacted',
  positive_responses: 'Positive responses',
  meetings_held: 'Meetings held',
  qualified_opps: 'Qualified opportunities',
  covered_lives_pipeline: 'Covered lives in pipeline',
  proposals_outstanding: 'Proposals / pilots outstanding',
  verbal_commitments: 'Verbal commitments',
  contracts_signed: 'Contracts signed',
  launches_90d: 'Expected 90-day launches',
};

export const LINK_GROUPS = [
  { type: 'commitment', label: 'Commitments this week', chip: 'Commitment' },
  { type: 'metric', label: 'Goals', chip: 'Goal' },
  { type: 'partner', label: 'Partners', chip: 'Partner' },
  { type: 'company', label: 'Companies', chip: 'Company' },
];

const ALL_WEEKS_FROM = '2020-01-06'; // same as GoalsTab's all-companies list
const metricOptions = Object.entries(METRIC_NAMES).map(([id, label]) => ({ id, label }));

// Matches anywhere in the name; groups keep LINK_GROUPS order, `per` each.
export function filterLinkOptions(options, query, per = 5) {
  const q = query.trim().toLowerCase();
  return LINK_GROUPS.map(g => ({ ...g, items: (options[g.type] || []).filter(o => !q || o.label.toLowerCase().includes(q)).slice(0, per) }))
    .filter(g => g.items.length);
}

// The four lists the Link picker searches, loaded on first need and again
// when the picker opens a minute later (a partner added since shows up). A
// list that fails to load stays empty rather than blocking the others.
const FRESH_MS = 60e3;
export function useLinkOptions(businessId, week) {
  const [options, setOptions] = useState({ metric: metricOptions });
  const [loaded, setLoaded] = useState(false);
  const loadedAt = useRef(0);
  const load = useCallback(() => {
    if (Date.now() - loadedAt.current < FRESH_MS) return;
    loadedAt.current = Date.now();
    Promise.allSettled([
      goalsApi.weekGoals(businessId, week, week, 'commitment'),
      goalsApi.partners(businessId),
      goalsApi.companies(businessId, ALL_WEEKS_FROM, week),
    ]).then(([cs, ps, co]) => {
      const ok = r => (r.status === 'fulfilled' ? r.value : null);
      setOptions({
        commitment: (ok(cs) || []).map(c => ({ id: c.id, label: c.text })),
        metric: metricOptions,
        partner: (ok(ps) || []).map(p => ({ id: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label)),
        company: (ok(co)?.companies || []).map(c => ({ id: c.account_id, label: c.name || c.account_id })).sort((a, b) => a.label.localeCompare(b.label)),
      });
      setLoaded(true);
    });
  }, [businessId, week]);
  const labelFor = useCallback((type, id) => {
    const chip = LINK_GROUPS.find(g => g.type === type)?.chip || type;
    const name = (options[type] || []).find(o => o.id === id)?.label;
    return `${chip}: ${name || (!loaded ? '…' : type === 'commitment' ? 'an earlier week' : id)}`;
  }, [options, loaded]);
  return { options, load, labelFor };
}
