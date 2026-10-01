import KpiTiles from './KpiTiles';
import PipelineTable from './PipelineTable';
import PipelineMovement from './PipelineMovement';
import PipelineForecast from './PipelineForecast';
import TopOpportunities from './TopOpportunities';
import EmailTrendChart from './EmailTrendChart';
import SequenceLeaderboard from './SequenceLeaderboard';
import MailboxHealth from './MailboxHealth';
import CompaniesByCohort from './CompaniesByCohort';
import DeliveryMix from './DeliveryMix';
import InsightsPanel from './InsightsPanel';

// Entry fields: { id, title, component, metrics[], defaultOrder, printOrder,
// enabled }. Later SPECs add entries here instead of rewriting
// SalesAnalyticsTab.js.
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
//
// sales-pipeline-v1 Stage 3 - the 4 pipeline widgets go "after the KPI
// tiles" on SCREEN (SPEC's own placement instruction), ahead of every
// Apollo-data widget - that's defaultOrder.
//
// sales-pipeline-v1 Stage 4 - the PDF wants Pipeline as its own page
// "after the existing widgets" instead (SPEC's own words - a flagged
// interim, "the final ordering is handled by sales-weekly-report-v1").
// printOrder is a SEPARATE sequence used only under @media print
// (SalesAnalyticsTab.js applies it via CSS `order` on a flex container
// scoped to print - the DOM itself stays in defaultOrder, screen is
// unaffected since `order` only does anything inside a flex/grid parent).
export const WIDGETS = [
  {
    id: 'kpi_tiles', title: 'Overview', component: KpiTiles,
    metrics: ['companies_in_cadence', 'prospects_in_cadence', 'unique_delivered', 'unique_opened', 'unique_replied', 'unique_bounced'],
    defaultOrder: 1, printOrder: 1, enabled: true,
  },
  {
    id: 'pipeline_table', title: 'Pipeline', component: PipelineTable,
    metrics: [], defaultOrder: 2, printOrder: 8, enabled: true,
  },
  {
    id: 'pipeline_movement', title: 'Pipeline Movement', component: PipelineMovement,
    metrics: [], defaultOrder: 3, printOrder: 9, enabled: true,
  },
  {
    id: 'pipeline_forecast', title: 'Forecast', component: PipelineForecast,
    metrics: [], defaultOrder: 4, printOrder: 10, enabled: true,
  },
  {
    id: 'top_opportunities', title: 'Top Opportunities', component: TopOpportunities,
    metrics: [], defaultOrder: 5, printOrder: 11, enabled: true,
  },
  {
    id: 'email_trend', title: 'Email Performance Over Time', component: EmailTrendChart,
    metrics: ['unique_delivered', 'open_rate', 'reply_rate'],
    defaultOrder: 6, printOrder: 2, enabled: true,
  },
  {
    id: 'mailbox_health', title: 'Mailbox Health', component: MailboxHealth,
    metrics: ['mailbox_sent', 'mailbox_delivered', 'mailbox_opened', 'mailbox_replied'],
    defaultOrder: 7, printOrder: 3, enabled: true,
  },
  // sales-email-trend-v1 REV2 Stage 4 - full width, directly under the
  // Email Trend | Mailbox Health row. Final PDF placement is Stage 5.
  {
    id: 'email_insights', title: 'Why performance looks like this', component: InsightsPanel,
    metrics: [], defaultOrder: 8, printOrder: 4, enabled: true,
  },
  {
    id: 'sequence_leaderboard', title: 'Sequence Leaderboard', component: SequenceLeaderboard,
    metrics: ['unique_delivered', 'unique_opened', 'unique_replied', 'unique_bounced'],
    defaultOrder: 9, printOrder: 5, enabled: true,
  },
  {
    id: 'companies_by_cohort', title: 'Companies in Cadence by Cohort', component: CompaniesByCohort,
    metrics: ['companies_in_cadence'],
    defaultOrder: 10, printOrder: 6, enabled: true,
  },
  {
    id: 'delivery_mix', title: 'Delivery Mix', component: DeliveryMix,
    metrics: ['unique_delivered'],
    defaultOrder: 11, printOrder: 7, enabled: true,
  },
];

export function getWidget(id) {
  return WIDGETS.find(w => w.id === id && w.enabled);
}
