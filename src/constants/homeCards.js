// dashboard-v3 Stage 5 (H) - the Home small cards' one leaf, shared by GET goals/dashboard (api/sales/dashboardRoutes.js
// groups the ten partner statuses into these six) and HomeCards.js (draws them). Colors ride the kit's priority ramp
// (tokens.js KIT_PRIORITY: gray · teal · yellow · orange) plus the status green; never a member color (memberColors.js).
// The mockup gave Replied and Meeting the same yellow - Meeting is orange here so adjacent slices stay apart.
export const PARTNER_STATUS_GROUPS = [
  { id: 'not_started', label: 'Not started', statuses: ['not_started'], color: '#94A3B8' },
  { id: 'working', label: 'Working', statuses: ['researching', 'first_email_drafted', 'first_email_sent', 'in_sequence'], color: '#4FD1C5' },
  { id: 'replied', label: 'Replied', statuses: ['replied'], color: '#F2C94C' },
  { id: 'meeting', label: 'Meeting', statuses: ['meeting_set'], color: '#FF9F57' },
  { id: 'pilot_live', label: 'Pilot · Live', statuses: ['proposal_pilot', 'live'], color: '#3DD68C' },
  { id: 'paused', label: 'Paused', statuses: ['paused'], color: '#4B5563' },
];
export const EMPLOYER_STAGE_COLORS = {
  target: '#94A3B8', contacted: '#4FD1C5', responded: '#F2C94C', meeting: '#FF9F57', proposal_pilot: '#B39DDB',
  verbal: '#3DD68C', contract: '#8FA8FF', launched: '#A8D04A', nurture: '#6B7480', on_hold: '#4B5563', lost: '#3A3F47',
};
// The We-owe card's lives = the KPI table's covered_lives_pipeline (goalsReportRoutes pipelineKpis: stage Meeting or
// later, side lanes out); its goal is that metric's latest sales_metric_targets row, when one is set.
export const LIVES_METRIC = 'covered_lives_pipeline';
