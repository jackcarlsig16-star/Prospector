-- heat-v2 Stage 1 (H4) - sales_person_heat_days: one row per person per LA day with the heat the writer computed that
-- day (api/sales/personActivity.js writePersonActivity, after the Apollo activity sync, the partner-contacts sync and
-- the explicit recompute - never a cron, never page load; the last write of the day wins). The series starts the day
-- this runs: there is no history to backfill (the popover's "History since <date>" reads the earliest row, R7).
-- Rows are never deleted. Sibling-table RLS (sales_person_activity): members read (s5_read), anon nothing; every write
-- goes through the server's service key. Nothing here stores an address.

CREATE TABLE IF NOT EXISTS public.sales_person_heat_days (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  person_key  text NOT NULL CHECK (person_key ~ '^(prospect|contact|person):.+$' AND length(person_key) <= 140),
  day         date NOT NULL,
  heat        int  NOT NULL CHECK (heat >= 0),
  band        text NOT NULL CHECK (band IN ('hot', 'warm', 'cold')),
  reply_pts   int  NOT NULL DEFAULT 0 CHECK (reply_pts >= 0),
  click_pts   int  NOT NULL DEFAULT 0 CHECK (click_pts >= 0),
  open_pts    int  NOT NULL DEFAULT 0 CHECK (open_pts >= 0),
  visit_pts   int  NOT NULL DEFAULT 0 CHECK (visit_pts >= 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, person_key, day)
);
CREATE INDEX IF NOT EXISTS sales_person_heat_days_day_idx ON public.sales_person_heat_days (business_id, day);

ALTER TABLE public.sales_person_heat_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_person_heat_days;
CREATE POLICY s5_read ON public.sales_person_heat_days FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_person_heat_days FROM anon;

-- Proof (expected right after this runs: 1 columns=10 · 2 rls=true · policies=1 · anon_select=false · 3 rows=0 ·
-- days=0 · since=none (the first sync or recompute writes today's rows) · 4 addresses=0).
SELECT 1 AS n, 'columns' AS what, (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_person_heat_days') AS value
UNION ALL
SELECT 2, 'rls',
       'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_person_heat_days'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_person_heat_days') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_person_heat_days', 'SELECT')
UNION ALL
SELECT 3, 'history',
       'rows=' || (SELECT count(*) FROM public.sales_person_heat_days) ||
       ' · days=' || (SELECT count(DISTINCT day) FROM public.sales_person_heat_days) ||
       ' · since=' || COALESCE((SELECT min(day)::text FROM public.sales_person_heat_days), 'none')
UNION ALL
SELECT 4, 'addresses', (SELECT count(*)::text FROM public.sales_person_heat_days WHERE person_key ~ '@')
ORDER BY n;
