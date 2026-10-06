-- sales-partners-pipeline-v1 Stage 4 - partner scorecard goals.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- Adds the 4 partner metric keys to the targets constraint (goals only;
-- actuals are computed from sales_partner_events).
ALTER TABLE public.sales_metric_targets DROP CONSTRAINT IF EXISTS sales_metric_targets_metric_key_check;
ALTER TABLE public.sales_metric_targets ADD CONSTRAINT sales_metric_targets_metric_key_check CHECK (metric_key IN (
  'outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set', 'open_rate',
  'target_orgs', 'dm_contacted', 'positive_responses', 'meetings_held', 'qualified_opps',
  'covered_lives_pipeline', 'proposals_outstanding', 'verbal_commitments', 'contracts_signed', 'launches_90d',
  'partners_first_touched', 'tier1_touched_pct', 'partner_meetings', 'partners_pilot_live'
));
