-- goals-surface-v1 Stage 3 - one more goal key for the goal hero.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- real_replies_clicks: the "Real replies + clicks" card's weekly goal
-- (actual = real clicks + replies that week, computed, never typed).
-- Same list as 20261006_sales_partners_pipeline_v1_stage4 plus the new key.
ALTER TABLE public.sales_metric_targets DROP CONSTRAINT IF EXISTS sales_metric_targets_metric_key_check;
ALTER TABLE public.sales_metric_targets ADD CONSTRAINT sales_metric_targets_metric_key_check CHECK (metric_key IN (
  'outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set', 'open_rate',
  'target_orgs', 'dm_contacted', 'positive_responses', 'meetings_held', 'qualified_opps',
  'covered_lives_pipeline', 'proposals_outstanding', 'verbal_commitments', 'contracts_signed', 'launches_90d',
  'partners_first_touched', 'tier1_touched_pct', 'partner_meetings', 'partners_pilot_live',
  'real_replies_clicks'
));

-- Check: the constraint text now ends with 'real_replies_clicks'
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'sales_metric_targets_metric_key_check';
