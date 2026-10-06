-- sales-goals-v1 REVISION 4 Stage 4 - manual values and KPI targets.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- sales_metric_targets now also holds:
--   * targets for Seif's 11-row KPI table (carried forward until changed), and
--   * the typed-in actual for manual metrics (meetings), with who/when.
-- Computed actuals are still never stored here.

ALTER TABLE public.sales_metric_targets
  ADD COLUMN IF NOT EXISTS actual    numeric CHECK (actual IS NULL OR actual >= 0),
  ADD COLUMN IF NOT EXISTS actual_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actual_at timestamptz;

ALTER TABLE public.sales_metric_targets DROP CONSTRAINT IF EXISTS sales_metric_targets_metric_key_check;
ALTER TABLE public.sales_metric_targets ADD CONSTRAINT sales_metric_targets_metric_key_check CHECK (metric_key IN (
  -- scorecard (This week view)
  'outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set', 'open_rate',
  -- Seif's KPI table ('New meetings booked' reuses meetings_set)
  'target_orgs', 'dm_contacted', 'positive_responses', 'meetings_held', 'qualified_opps',
  'covered_lives_pipeline', 'proposals_outstanding', 'verbal_commitments', 'contracts_signed', 'launches_90d'
));
