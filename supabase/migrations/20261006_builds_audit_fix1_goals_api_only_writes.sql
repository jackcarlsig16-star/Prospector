-- builds-audit-2026-10-06 FIX-1 (H1) - Goals tables: API-only writes.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- These 10 tables kept the REV3/REV4 member write policy (s5_write), so any
-- Member could change them straight from the browser and skip what the API
-- enforces: partner history rows, the finalized-week freeze, who flagged
-- what. The app never writes them from the browser - every write goes through
-- /api/sales/* with the service key, which RLS doesn't apply to. Members keep
-- reading them (s5_read is unchanged).

DROP POLICY IF EXISTS s5_write ON public.sales_goals;
DROP POLICY IF EXISTS s5_write ON public.sales_week_goals;
DROP POLICY IF EXISTS s5_write ON public.sales_week_goal_steps;
DROP POLICY IF EXISTS s5_write ON public.sales_metric_targets;
DROP POLICY IF EXISTS s5_write ON public.sales_week_report;
DROP POLICY IF EXISTS s5_write ON public.sales_week_report_sections;
DROP POLICY IF EXISTS s5_write ON public.sales_infra_items;
DROP POLICY IF EXISTS s5_write ON public.sales_cadence_plan;
DROP POLICY IF EXISTS s5_write ON public.sales_month_goals;
DROP POLICY IF EXISTS s5_write ON public.sales_week_notes;

-- Check: each of the 10 tables shows only s5_read / SELECT
SELECT tablename, policyname, cmd FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('sales_goals', 'sales_week_goals', 'sales_week_goal_steps',
    'sales_metric_targets', 'sales_week_report', 'sales_week_report_sections', 'sales_infra_items',
    'sales_cadence_plan', 'sales_month_goals', 'sales_week_notes')
  ORDER BY tablename, policyname;
