-- signals-v1 REV4 Stage 3 - Prospector's own daily website-visitor pull.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- web_visits: one row per visiting company per LA pull day (Apollo's visitor
-- search, both HomeLover domains). us_500 = the company is in the US/500+
-- filtered copy of the search. Only the fields listed here are kept; Apollo's
-- phone fields are dropped before anything is stored - there is no phone
-- column on any of these tables.
-- apollo_credit_spend: the measured balance delta of every credit-spending
-- call (even 0); the server refuses a pull once this LA month reaches 500.
-- sales_visit_skip: the Members-edited skip list (own domains, vendors) -> P4.
-- visit_pull_runs: the ran-today guard - one row per business per LA day.
-- RLS: web_visits + sales_visit_skip get s5_read like every Goals table;
-- apollo_credit_spend + visit_pull_runs are server-only (RLS on, no policy).
-- The API writes with the service key. Re-runnable: IF NOT EXISTS everywhere.

CREATE TABLE IF NOT EXISTS public.web_visits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  company_key        text NOT NULL,
  company_name       text NOT NULL CHECK (length(btrim(company_name)) BETWEEN 1 AND 160),
  domain             text,
  apollo_org_id      text,
  linkedin_url       text,
  naics_codes        text[],
  sic_codes          text[],
  revenue            numeric,
  headcount_growth   jsonb,
  us_500             boolean NOT NULL DEFAULT false,
  first_visit        date,
  last_visit         date,
  visits_1d          int,
  visits_7d          int,
  unique_visitors_7d int,
  weekly             jsonb,
  top_paths          jsonb,
  apollo_intent      text,
  intent_score       numeric,
  priority           text NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  priority_rule      text,
  noise_reason       text,
  maybe_user         boolean NOT NULL DEFAULT false,
  matched_type       text CHECK (matched_type IS NULL OR matched_type IN ('partner', 'opportunity', 'target')),
  matched_id         uuid,
  pulled_on          date NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS web_visits_day_idx
  ON public.web_visits (business_id, company_key, pulled_on);

CREATE TABLE IF NOT EXISTS public.apollo_credit_spend (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  la_month       text NOT NULL CHECK (la_month ~ '^\d{4}-\d{2}$'),
  endpoint       text NOT NULL,
  ref            text,
  credits        int NOT NULL,
  balance_before int,
  balance_after  int
);
CREATE INDEX IF NOT EXISTS apollo_credit_spend_month_idx ON public.apollo_credit_spend (la_month);

CREATE TABLE IF NOT EXISTS public.sales_visit_skip (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  company_key text NOT NULL,
  reason      text CHECK (reason IS NULL OR length(reason) <= 160),
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_visit_skip_key_idx
  ON public.sales_visit_skip (business_id, company_key);

CREATE TABLE IF NOT EXISTS public.visit_pull_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  la_date     date NOT NULL,
  status      text NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  calls       int NOT NULL DEFAULT 0,
  credits     int NOT NULL DEFAULT 0,
  error       text CHECK (error IS NULL OR length(error) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS visit_pull_runs_day_idx
  ON public.visit_pull_runs (business_id, la_date);

ALTER TABLE public.web_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.web_visits;
CREATE POLICY s5_read ON public.web_visits FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.web_visits FROM anon;

ALTER TABLE public.sales_visit_skip ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_visit_skip;
CREATE POLICY s5_read ON public.sales_visit_skip FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_visit_skip FROM anon;

ALTER TABLE public.apollo_credit_spend ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apollo_credit_spend FROM anon;
ALTER TABLE public.visit_pull_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.visit_pull_runs FROM anon;

-- Check: 11 rows -
--    1 web_visits           (30 columns)
--    2 web_visits           (3 checks)                    company_name/priority/matched_type
--    3 web_visits           index web_visits_day_idx      ...(business_id, company_key, pulled_on)
--    4 apollo_credit_spend  (9 columns)
--    5 sales_visit_skip     (6 columns)
--    6 sales_visit_skip     index sales_visit_skip_key_idx ...(business_id, company_key)
--    7 visit_pull_runs      (9 columns)
--    8 visit_pull_runs      index visit_pull_runs_day_idx ...(business_id, la_date)
--    9 (4 tables)           rls enabled                   apollo_credit_spend,sales_visit_skip,visit_pull_runs,web_visits
--   10 (4 tables)           policies                      sales_visit_skip:s5_read:SELECT,web_visits:s5_read:SELECT
--   11 (4 tables)           anon can select / phone cols  anon 0 of 4 · phone columns 0
SELECT 1 AS n, 'web_visits' AS tbl, '(' || count(*) || ' columns)' AS item, '' AS detail
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'web_visits'
UNION ALL
SELECT 2, 'web_visits', '(' || count(*) || ' checks)', '' FROM pg_constraint
  WHERE conrelid = 'public.web_visits'::regclass AND contype = 'c'
UNION ALL
SELECT 3, tablename, 'index ' || indexname, indexdef FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'web_visits_day_idx'
UNION ALL
SELECT 4, 'apollo_credit_spend', '(' || count(*) || ' columns)', ''
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'apollo_credit_spend'
UNION ALL
SELECT 5, 'sales_visit_skip', '(' || count(*) || ' columns)', ''
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_visit_skip'
UNION ALL
SELECT 6, tablename, 'index ' || indexname, indexdef FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'sales_visit_skip_key_idx'
UNION ALL
SELECT 7, 'visit_pull_runs', '(' || count(*) || ' columns)', ''
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'visit_pull_runs'
UNION ALL
SELECT 8, tablename, 'index ' || indexname, indexdef FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'visit_pull_runs_day_idx'
UNION ALL
SELECT 9, '(4 tables)', 'rls enabled', string_agg(relname, ',' ORDER BY relname) FROM pg_class
  WHERE relnamespace = 'public'::regnamespace AND relrowsecurity
    AND relname IN ('web_visits', 'apollo_credit_spend', 'sales_visit_skip', 'visit_pull_runs')
UNION ALL
SELECT 10, '(4 tables)', 'policies', string_agg(tablename || ':' || policyname || ':' || cmd, ',' ORDER BY tablename)
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('web_visits', 'apollo_credit_spend', 'sales_visit_skip', 'visit_pull_runs')
UNION ALL
SELECT 11, '(4 tables)', 'anon can select / phone cols',
  'anon ' || (SELECT count(*) FROM unnest(ARRAY['web_visits', 'apollo_credit_spend', 'sales_visit_skip', 'visit_pull_runs']) t
              WHERE has_table_privilege('anon', 'public.' || t, 'SELECT')) || ' of 4 · phone columns '
  || (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name IN ('web_visits', 'apollo_credit_spend', 'sales_visit_skip', 'visit_pull_runs')
        AND column_name ILIKE '%phone%')
ORDER BY 1;
