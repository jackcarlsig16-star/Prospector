// sales-analytics-core-v1 Stage 3 - single source of truth for which
// metrics exist and how to read them. Later SPECs add entries here instead
// of touching widget code.
//
// aggregate:
//   'snapshot_delta' - this period's real activity = last day's cumulative
//     value minus the first day's (Apollo's own counters are lifetime-
//     cumulative, not daily deltas - audit A6b/A6c, no date-range API).
//   'last'            - a point-in-time gauge (how many right now), not a
//     period total - e.g. companies_in_cadence, sequences_active.
//   'ratio'           - computed from two already-aggregated counts for the
//     SAME period, never an average of each day's own rate (design
//     decision - a day with 2 deliveries and 1 open would otherwise skew a
//     100%-single-day average into a weekly rate that isn't real).
export const METRICS = [
  { key: 'companies_in_cadence', label: 'Companies in Cadence', source: 'apollo', format: 'number', aggregate: 'last', goodDirection: 'up', enabled: true },
  { key: 'prospects_in_cadence', label: 'Prospects in Cadence', source: 'apollo', format: 'number', aggregate: 'last', goodDirection: 'up', enabled: true },
  { key: 'sequences_active',     label: 'Active Sequences',     source: 'apollo', format: 'number', aggregate: 'last', goodDirection: 'up', enabled: true },
  { key: 'unique_delivered',     label: 'Delivered',            source: 'apollo', format: 'number', aggregate: 'snapshot_delta', goodDirection: 'up',   enabled: true },
  { key: 'unique_opened',        label: 'Opened',                source: 'apollo', format: 'number', aggregate: 'snapshot_delta', goodDirection: 'up',   enabled: true },
  { key: 'unique_clicked',       label: 'Clicked',               source: 'apollo', format: 'number', aggregate: 'snapshot_delta', goodDirection: 'up',   enabled: true },
  { key: 'unique_replied',       label: 'Replied',               source: 'apollo', format: 'number', aggregate: 'snapshot_delta', goodDirection: 'up',   enabled: true },
  { key: 'unique_bounced',       label: 'Bounced',                source: 'apollo', format: 'number', aggregate: 'snapshot_delta', goodDirection: 'down', enabled: true },
  { key: 'open_rate',  label: 'Open Rate',  source: 'derived', format: 'percent', aggregate: 'ratio', ratioOf: ['unique_opened', 'unique_delivered'],  goodDirection: 'up', enabled: true },
  { key: 'click_rate', label: 'Click Rate', source: 'derived', format: 'percent', aggregate: 'ratio', ratioOf: ['unique_clicked', 'unique_delivered'], goodDirection: 'up', enabled: true },
  { key: 'reply_rate', label: 'Reply Rate', source: 'derived', format: 'percent', aggregate: 'ratio', ratioOf: ['unique_replied', 'unique_delivered'], goodDirection: 'up', enabled: true },
  { key: 'bounce_rate', label: 'Bounce Rate', source: 'derived', format: 'percent', aggregate: 'ratio', ratioOf: ['unique_bounced', 'unique_delivered'], goodDirection: 'down', enabled: true },
  // overview-home-v1 - week strip tiles with no Apollo lifetime counter:
  // range sums of the stored daily counts / partner events (weekStrip.js).
  { key: 'sent',           label: 'Sent',           source: 'email_counts', format: 'number',  aggregate: 'sum', goodDirection: 'up',   enabled: true },
  { key: 'delivered_rate', label: 'Delivered Rate', source: 'email_counts', format: 'percent', aggregate: 'sum', goodDirection: 'up',   enabled: true },
  { key: 'spam_blocked',   label: 'Spam Blocks',    source: 'email_counts', format: 'number',  aggregate: 'sum', goodDirection: 'down', enabled: true },
  { key: 'meetings_set',   label: 'Meetings Set',   source: 'partners',     format: 'number',  aggregate: 'sum', goodDirection: 'up',   enabled: true },
];

export function getMetric(key) {
  return METRICS.find(m => m.key === key && m.enabled);
}

// Cohort keyword map (A6j design decision). This is a DUPLICATE of
// api/sales/cohort.js's list, not an import - CRA's build refuses any
// import reaching outside src/ ("falls outside of the project src/
// directory"), confirmed while wiring this file, so the server-side
// adapter and this client registry can't literally share one module. Keep
// the two keyword lists in sync by hand if they ever change; the
// dashboard doesn't actually need to re-derive cohort from sequence names
// itself for computation (Stage 2 already labels every stored metric row
// with dim_value='<cohort>' server-side) - this copy exists only so a
// future widget can validate/label a cohort name consistently with the
// server's own classification.
export const COHORTS = ['Retail', 'Hospitality', 'SaaS', 'Car Rental', 'Fitness', 'Wireless', 'Other'];

export function cohortForSequenceName(name) {
  const n = name || '';
  if (/retail/i.test(n)) return 'Retail';
  if (/hospitality|hotel|motel/i.test(n)) return 'Hospitality';
  if (/saas/i.test(n)) return 'SaaS';
  if (/car rental/i.test(n)) return 'Car Rental';
  if (/fitness|gym/i.test(n)) return 'Fitness';
  if (/wireless|cell phone/i.test(n)) return 'Wireless';
  return 'Other';
}

// sales-email-trend-v1 REV2 - Email Performance Over Time thresholds
// (REVISABLE). Health colours apply to hard bounce, spam block and their
// Apollo-style total only. Rates use SENT as the denominator, which is how
// Apollo's own weekly numbers reconcile exactly (bounce/spam/reply).
export const EMAIL_HEALTH_THRESHOLDS = { good: 0.02, concerning: 0.05 };
export const EMAIL_LOW_VOLUME_SENT = 50;
