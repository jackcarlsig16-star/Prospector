-- weekly-funnel-v1 Stage 1 (W3 + W5) - one constraint widened, one small table.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- 1. sales_metric_targets.metric_key CHECK: the same list as 20261105_dashboard_v3_stage1 plus the weekly registry's new
--    keys (api/sales/weeklyMetrics.js), so the owner can type a week goal on every goalable row. A superset: no column,
--    no data change; the 27 live rows (one workspace) all carry keys from the old list (checked Nov 19).
--      new: delivered, deliverability, human_clicks, replies, companies_visited, people_identified,
--           email_site_company_rate, top_target_pins, linkedin_requests, linkedin_accepted, linkedin_replies,
--           linkedin_posts
--    People first-touched keeps its goal on 'partners_first_touched' with unit = people (first-touch-people-v1).
-- 2. sales_manual_metrics: a number a Member types for a week - LinkedIn today (Cyrus counts by hand; there is no
--    source). One row per workspace x metric x Monday; last write wins, entered_by / entered_at kept; value NULL = the
--    cell was cleared (it reads "—", never 0). Which keys are manual is the registry's list, checked by the one write
--    route - the table only checks the key's shape, so a new manual row needs no migration. note <= 140 characters.
--    Sibling-table RLS (sales_funnel_days, sales_metric_targets): members read (s5_read), anon nothing; every write goes
--    through /api/sales/:businessId with the service key.

ALTER TABLE public.sales_metric_targets DROP CONSTRAINT IF EXISTS sales_metric_targets_metric_key_check;
ALTER TABLE public.sales_metric_targets ADD CONSTRAINT sales_metric_targets_metric_key_check CHECK (metric_key IN (
  'outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set', 'open_rate', 'human_open_rate',
  'target_orgs', 'dm_contacted', 'positive_responses', 'meetings_held', 'qualified_opps',
  'covered_lives_pipeline', 'proposals_outstanding', 'verbal_commitments', 'contracts_signed', 'launches_90d',
  'partners_first_touched', 'tier1_touched_pct', 'partner_meetings', 'partners_pilot_live',
  'real_replies_clicks',
  'delivered', 'deliverability', 'human_clicks', 'replies',
  'companies_visited', 'people_identified', 'email_site_company_rate',
  'top_target_pins',
  'linkedin_requests', 'linkedin_accepted', 'linkedin_replies', 'linkedin_posts'
));

CREATE TABLE IF NOT EXISTS public.sales_manual_metrics (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  metric_key  text NOT NULL CHECK (metric_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  week_start  date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  value       numeric CHECK (value IS NULL OR value >= 0),
  entered_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  entered_at  timestamptz NOT NULL DEFAULT now(),
  note        text CHECK (note IS NULL OR length(note) <= 140),
  PRIMARY KEY (business_id, metric_key, week_start)
);

ALTER TABLE public.sales_manual_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_manual_metrics;
CREATE POLICY s5_read ON public.sales_manual_metrics FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_manual_metrics FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sales_manual_metrics FROM authenticated;

-- Proof (expected right after this runs: 1 new keys in the check=12 of 12 · 2 target rows=27 · rows the check
-- refuses=0 · 3 manual columns=7 · 4 rls=true · policies=1 · anon_select=false · authenticated_insert=false ·
-- 5 manual rows=0).
SELECT 1 AS n, 'new keys in the check' AS what,
       (SELECT count(*)::text FROM unnest(ARRAY['delivered', 'deliverability', 'human_clicks', 'replies', 'companies_visited',
          'people_identified', 'email_site_company_rate', 'top_target_pins', 'linkedin_requests', 'linkedin_accepted',
          'linkedin_replies', 'linkedin_posts']) k
         WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'sales_metric_targets_metric_key_check') LIKE '%''' || k || '''%') || ' of 12' AS value
UNION ALL
SELECT 2, 'target rows', (SELECT count(*)::text FROM public.sales_metric_targets)
UNION ALL
SELECT 3, 'manual columns', (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_manual_metrics')
UNION ALL
SELECT 4, 'rls',
       'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_manual_metrics'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_manual_metrics') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_manual_metrics', 'SELECT') ||
       ' · authenticated_insert=' || has_table_privilege('authenticated', 'public.sales_manual_metrics', 'INSERT')
UNION ALL
SELECT 5, 'manual rows', (SELECT count(*)::text FROM public.sales_manual_metrics)
ORDER BY n;
