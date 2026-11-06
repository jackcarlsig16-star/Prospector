import KpiTiles from './KpiTiles';
import PipelineTable from './PipelineTable';
import PipelineMovement from './PipelineMovement';
import PipelineForecast from './PipelineForecast';
import TopOpportunities from './TopOpportunities';
import CompaniesByCohort from './CompaniesByCohort';
import DeliveryMix from './DeliveryMix';

// Entry fields: { id, title, component, metrics[], defaultOrder, printOrder,
// enabled, goalsSalesHidden?, printPage? }. Later SPECs add entries here
// instead of rewriting SalesAnalyticsTab.js.
//
// dashboard-v3 Stage 4: the Email page draws its own sections (Pulse, Explorer, WHY, Mailboxes, Sequences) - the
// registry keeps only the pipeline widgets (hidden wherever features.goals_sales is on: goalsSalesHidden) and the two
// disabled leftovers, until Stage 5 drops what has no nav path. printOrder is a
// separate sequence used only under @media print (CSS `order` on a flex
// column scoped to print); printPage starts a new page in the PDF, so each
// band prints on its own page.
export const WIDGETS = [
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
