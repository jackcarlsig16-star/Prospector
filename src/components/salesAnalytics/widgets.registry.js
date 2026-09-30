import KpiTiles from './KpiTiles';
import EmailTrendChart from './EmailTrendChart';
import SequenceLeaderboard from './SequenceLeaderboard';
import MailboxHealth from './MailboxHealth';
import CompaniesByCohort from './CompaniesByCohort';

// Entry fields: { id, title, component, metrics[], defaultOrder, enabled }.
// Later SPECs add entries here instead of rewriting SalesAnalyticsTab.js.
export const WIDGETS = [
  {
    id: 'kpi_tiles', title: 'Overview', component: KpiTiles,
    metrics: ['companies_in_cadence', 'prospects_in_cadence', 'sequences_active', 'unique_delivered', 'unique_opened', 'unique_replied'],
    defaultOrder: 1, enabled: true,
  },
  {
    id: 'email_trend', title: 'Email Trend', component: EmailTrendChart,
    metrics: ['unique_delivered', 'open_rate', 'reply_rate'],
    defaultOrder: 2, enabled: true,
  },
  {
    id: 'sequence_leaderboard', title: 'Sequence Leaderboard', component: SequenceLeaderboard,
    metrics: ['unique_delivered', 'unique_opened', 'unique_replied', 'unique_bounced'],
    defaultOrder: 3, enabled: true,
  },
  {
    id: 'mailbox_health', title: 'Mailbox Health', component: MailboxHealth,
    metrics: ['mailbox_sent', 'mailbox_delivered', 'mailbox_opened', 'mailbox_replied'],
    defaultOrder: 4, enabled: true,
  },
  {
    id: 'companies_by_cohort', title: 'Companies in Cadence by Cohort', component: CompaniesByCohort,
    metrics: ['companies_in_cadence'],
    defaultOrder: 5, enabled: true,
  },
];

export function getWidget(id) {
  return WIDGETS.find(w => w.id === id && w.enabled);
}
