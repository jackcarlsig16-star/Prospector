import WeekStrip from './WeekStrip';
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
// enabled, goalsSalesHidden?, printPage? }. Later SPECs add entries here
// instead of rewriting SalesAnalyticsTab.js.
//
// overview-home-v1 Stage 1 (DECIDED): Overview = bands. Band 0 is the
// week strip (replaces kpi_tiles + delivery_mix, which stay registered but
// disabled); Band 1 is insights · mailbox health · trend · leaderboard, each
// full width in that order. The pipeline widgets and companies_by_cohort
// need territory deals, so they are hidden wherever features.goals_sales
// is on (goalsSalesHidden) and still render elsewhere. printOrder is a
// separate sequence used only under @media print (CSS `order` on a flex
// column scoped to print); printPage starts a new page in the PDF, so each
// band prints on its own page.
export const WIDGETS = [
  {
    id: 'week_strip', title: 'Week strip', component: WeekStrip,
    metrics: ['sent', 'delivered_rate', 'bounce_rate', 'spam_blocked', 'open_rate', 'reply_rate', 'meetings_set'],
    defaultOrder: 1, printOrder: 1, enabled: true,
  },
  {
    id: 'email_insights', title: 'Why performance looks like this', component: InsightsPanel,
    metrics: [], defaultOrder: 2, printOrder: 2, enabled: true, printPage: true,
  },
  {
    id: 'mailbox_health', title: 'Mailbox Health', component: MailboxHealth,
    metrics: ['mailbox_sent', 'mailbox_delivered', 'mailbox_opened', 'mailbox_replied'],
    defaultOrder: 3, printOrder: 3, enabled: true,
  },
  {
    id: 'email_trend', title: 'Email Performance Over Time', component: EmailTrendChart,
    metrics: ['unique_delivered', 'open_rate', 'reply_rate'],
    defaultOrder: 4, printOrder: 4, enabled: true,
  },
  {
    id: 'sequence_leaderboard', title: 'Sequence Leaderboard', component: SequenceLeaderboard,
    metrics: ['unique_delivered', 'unique_opened', 'unique_replied', 'unique_bounced'],
    defaultOrder: 5, printOrder: 5, enabled: true,
  },
  {
    id: 'pipeline_table', title: 'Pipeline', component: PipelineTable,
    metrics: [], defaultOrder: 6, printOrder: 6, enabled: true, goalsSalesHidden: true, printPage: true,
  },
  {
    id: 'pipeline_movement', title: 'Pipeline Movement', component: PipelineMovement,
    metrics: [], defaultOrder: 7, printOrder: 7, enabled: true, goalsSalesHidden: true,
  },
  {
    id: 'pipeline_forecast', title: 'Forecast', component: PipelineForecast,
    metrics: [], defaultOrder: 8, printOrder: 8, enabled: true, goalsSalesHidden: true,
  },
  {
    id: 'top_opportunities', title: 'Top Opportunities', component: TopOpportunities,
    metrics: [], defaultOrder: 9, printOrder: 9, enabled: true, goalsSalesHidden: true,
  },
  {
    id: 'companies_by_cohort', title: 'Companies in Cadence by Cohort', component: CompaniesByCohort,
    metrics: ['companies_in_cadence'],
    defaultOrder: 10, printOrder: 10, enabled: true, goalsSalesHidden: true,
  },
  {
    id: 'kpi_tiles', title: 'Overview', component: KpiTiles,
    metrics: ['companies_in_cadence', 'prospects_in_cadence', 'unique_delivered', 'unique_opened', 'unique_replied', 'unique_bounced'],
    defaultOrder: 11, printOrder: 11, enabled: false,
  },
  {
    id: 'delivery_mix', title: 'Delivery Mix', component: DeliveryMix,
    metrics: ['unique_delivered'],
    defaultOrder: 12, printOrder: 12, enabled: false,
  },
];

export function visibleWidgets(features) {
  return WIDGETS.filter(w => w.enabled && !(w.goalsSalesHidden && features?.goals_sales)).sort((a, b) => a.defaultOrder - b.defaultOrder);
}

export function getWidget(id) {
  return WIDGETS.find(w => w.id === id && w.enabled);
}
