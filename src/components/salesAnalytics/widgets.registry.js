import KpiTiles from './KpiTiles';
import EmailTrendChart from './EmailTrendChart';
import SequenceLeaderboard from './SequenceLeaderboard';
import MailboxHealth from './MailboxHealth';
import CompaniesByCohort from './CompaniesByCohort';
import DeliveryMix from './DeliveryMix';

// Entry fields: { id, title, component, metrics[], defaultOrder, enabled }.
// Later SPECs add entries here instead of rewriting SalesAnalyticsTab.js.
//
// design-v1 Stage 3 - the three donut widgets (delivered_by_cohort_donut,
// delivered_by_sender_donut, direct_vs_partner_donut) are removed, not
// just disabled - DECIDED: "REMOVE the three donut charts", replaced by
// delivery_mix. Their component files are deleted too (DonutChart.js
// included - nothing else referenced it).
//
// PAIRED_ROWS in SalesAnalyticsTab.js renders [email_trend, mailbox_health]
// and [companies_by_cohort, delivery_mix] as side-by-side 2-column rows
// (DECIDED layout items 4 and 7) instead of each getting its own full-
// width card - defaultOrder keeps them adjacent here for that reason.
export const WIDGETS = [
  {
    id: 'kpi_tiles', title: 'Overview', component: KpiTiles,
    metrics: ['companies_in_cadence', 'prospects_in_cadence', 'unique_delivered', 'unique_opened', 'unique_replied', 'unique_bounced'],
    defaultOrder: 1, enabled: true,
  },
  {
    id: 'email_trend', title: 'Email Performance Over Time', component: EmailTrendChart,
    metrics: ['unique_delivered', 'open_rate', 'reply_rate'],
    defaultOrder: 2, enabled: true,
  },
  {
    id: 'mailbox_health', title: 'Mailbox Health', component: MailboxHealth,
    metrics: ['mailbox_sent', 'mailbox_delivered', 'mailbox_opened', 'mailbox_replied'],
    defaultOrder: 3, enabled: true,
  },
  {
    id: 'sequence_leaderboard', title: 'Sequence Leaderboard', component: SequenceLeaderboard,
    metrics: ['unique_delivered', 'unique_opened', 'unique_replied', 'unique_bounced'],
    defaultOrder: 4, enabled: true,
  },
  {
    id: 'companies_by_cohort', title: 'Companies in Cadence by Cohort', component: CompaniesByCohort,
    metrics: ['companies_in_cadence'],
    defaultOrder: 5, enabled: true,
  },
  {
    id: 'delivery_mix', title: 'Delivery Mix', component: DeliveryMix,
    metrics: ['unique_delivered'],
    defaultOrder: 6, enabled: true,
  },
];

export function getWidget(id) {
  return WIDGETS.find(w => w.id === id && w.enabled);
}
