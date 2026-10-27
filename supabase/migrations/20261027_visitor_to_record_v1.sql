-- visitor-to-record-v1 REV2 Stage 1 - a visit can build the company and file its people, and every person stays tied
-- to the visit that found them. Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Idempotent.
--
-- sales_signals    + auto boolean (V1: accepted by the pull itself, decided_by NULL -> "Auto-created" + Undo).
-- sales_people     + apollo_person_id (V2b search id, never a reveal), visit_id -> web_visits (V6 undo), archived_at
--                    (V6: archive, never delete), source_kind gains 'web_visit'.
-- sales_targets    + visit_id -> web_visits (V1 evidence + V6 undo). sales_targets.source already allows 'web_visit'.
-- sales_settings   NEW, one row per business (V4 buyer_titles seed; FIX visit-window W4 hook: visitor_domains /
--                    visitor_filters; the V2 daily caps). Members read (s5_read), writes through the API only.
-- employees_source  gains 'apollo' on sales_goals, sales_opportunities, sales_targets (V1 employees from a visit row).

ALTER TABLE public.sales_signals ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;

ALTER TABLE public.sales_people ADD COLUMN IF NOT EXISTS apollo_person_id text CHECK (apollo_person_id IS NULL OR length(apollo_person_id) <= 80);
ALTER TABLE public.sales_people ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.web_visits(id) ON DELETE SET NULL;
ALTER TABLE public.sales_people ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.sales_people DROP CONSTRAINT IF EXISTS sales_people_source_kind_check;
ALTER TABLE public.sales_people ADD CONSTRAINT sales_people_source_kind_check
  CHECK (source_kind IS NULL OR source_kind IN ('homelover_outreach', 'partner_referral', 'person_referral', 'campaign', 'website', 'scout', 'event', 'inbound', 'unknown', 'apollo', 'web_visit'));
CREATE INDEX IF NOT EXISTS sales_people_visit_idx ON public.sales_people (business_id, visit_id) WHERE visit_id IS NOT NULL;

ALTER TABLE public.sales_targets ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.web_visits(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.sales_settings (
  business_id             uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  buyer_titles            text[] NOT NULL DEFAULT '{}',
  visitor_domains         text[],
  visitor_filters         jsonb,
  auto_create_daily_cap   int NOT NULL DEFAULT 25 CHECK (auto_create_daily_cap BETWEEN 0 AND 500),
  people_search_daily_cap int NOT NULL DEFAULT 25 CHECK (people_search_daily_cap BETWEEN 0 AND 500),
  people_per_company      int NOT NULL DEFAULT 3 CHECK (people_per_company BETWEEN 0 AND 10),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_settings;
CREATE POLICY s5_read ON public.sales_settings FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_settings FROM anon;
-- HomeLover's seed (V4 PROPOSED titles, REVISABLE; the visitor domains + US/500+ filters the pull uses today).
INSERT INTO public.sales_settings (business_id, buyer_titles, visitor_domains, visitor_filters)
SELECT id,
       ARRAY['Chief People Officer', 'CHRO', 'VP People', 'VP Human Resources', 'Head of People', 'Director of Benefits', 'Benefits Manager', 'Total Rewards', 'Compensation and Benefits', 'HR Director', 'Head of Total Rewards', 'People Operations'],
       ARRAY['homelover.ai', 'homelover.com'],
       '{"organization_num_employees_ranges": ["501,1000", "1001,2000", "2001,5000", "5001,10000", "10001,"], "organization_locations": ["United States"]}'::jsonb
  FROM public.businesses WHERE id = 'bc69beab-effd-452d-9e81-fd652333bb95'
ON CONFLICT (business_id) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_goals', 'sales_opportunities', 'sales_targets'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_employees_source_check');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (employees_source IS NULL OR employees_source IN (''research'', ''manual'', ''apollo''))', t, t || '_employees_source_check');
  END LOOP;
END $$;

-- Proof - expect 6 rows:
--   1 sales_signals.auto            present=true · default=false
--   2 sales_people                  columns apollo_person_id,archived_at,visit_id · source_kind check has web_visit=true
--   3 sales_targets.visit_id        present=true
--   4 sales_settings                rls=true · policies=1 · anon_select=false · rows=1 · homelover titles=12 · domains=2
--   5 employees_source checks       3 tables allow apollo
--   6 addresses in sales_settings   0 (no email/phone ever lands in settings)
SELECT 1 AS n, 'sales_signals.auto' AS what,
       'present=' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_signals' AND column_name = 'auto') ||
       ' · default=' || COALESCE((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_signals' AND column_name = 'auto'), 'none') AS detail
UNION ALL
SELECT 2, 'sales_people',
       'columns ' || (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_people' AND column_name IN ('apollo_person_id', 'visit_id', 'archived_at')) ||
       ' · source_kind check has web_visit=' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_people_source_kind_check' AND pg_get_constraintdef(oid) LIKE '%web_visit%')
UNION ALL
SELECT 3, 'sales_targets.visit_id', 'present=' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_targets' AND column_name = 'visit_id')
UNION ALL
SELECT 4, 'sales_settings',
       'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_settings'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_settings') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_settings', 'SELECT') ||
       ' · rows=' || (SELECT count(*) FROM public.sales_settings) ||
       ' · homelover titles=' || COALESCE((SELECT array_length(buyer_titles, 1) FROM public.sales_settings WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95'), 0) ||
       ' · domains=' || COALESCE((SELECT array_length(visitor_domains, 1) FROM public.sales_settings WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95'), 0)
UNION ALL
SELECT 5, 'employees_source checks', (SELECT count(*) FROM pg_constraint WHERE conname IN ('sales_goals_employees_source_check', 'sales_opportunities_employees_source_check', 'sales_targets_employees_source_check') AND pg_get_constraintdef(oid) LIKE '%apollo%') || ' tables allow apollo'
UNION ALL
SELECT 6, 'addresses in sales_settings', (SELECT count(*) FROM public.sales_settings WHERE array_to_string(buyer_titles, ' ') ~ '@' OR array_to_string(visitor_domains, ' ') ~ '@' OR visitor_filters::text ~ '@')::text
ORDER BY 1;
