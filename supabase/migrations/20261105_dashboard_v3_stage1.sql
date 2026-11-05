-- dashboard-v3 Stage 1 - the Scorecard's "Human open rate" row can carry a goal: add its metric_key to the CHECK.
-- Same list as 20261006_goals_surface_v1_stage3 plus the new key. No column, no data change.
ALTER TABLE public.sales_metric_targets DROP CONSTRAINT IF EXISTS sales_metric_targets_metric_key_check;
ALTER TABLE public.sales_metric_targets ADD CONSTRAINT sales_metric_targets_metric_key_check CHECK (metric_key IN (
  'outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set', 'open_rate', 'human_open_rate',
  'target_orgs', 'dm_contacted', 'positive_responses', 'meetings_held', 'qualified_opps',
  'covered_lives_pipeline', 'proposals_outstanding', 'verbal_commitments', 'contracts_signed', 'launches_90d',
  'partners_first_touched', 'tier1_touched_pct', 'partner_meetings', 'partners_pilot_live',
  'real_replies_clicks'
));

-- Check: the constraint text now contains 'human_open_rate'
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'sales_metric_targets_metric_key_check';
