-- visitor-to-record-v1 V2a follow-up (Oct 27 2026 ruling) - Supabase SQL editor: paste -> Run. Idempotent. No existing
-- row changes. Until it runs the code keeps working: parked people are COUNTED but not stored (the Needs attention line
-- says "migration pending"), and the people pull falls back to its settings-state day guard instead of a run row.
--
-- sales_people      company_type gains 'parked' (a visitor filed with the company name only - no record yet):
--                   + company_name text, company_domain text; the one-company CHECK allows parked rows with both ids null.
-- visit_pull_runs   kind gains 'people' (the visitor PEOPLE pull's own run row, one per LA day; the unique index
--                   (business_id, la_date, kind) already covers it).
ALTER TABLE public.sales_people ADD COLUMN IF NOT EXISTS company_name   text CHECK (company_name IS NULL OR length(company_name) <= 160);
ALTER TABLE public.sales_people ADD COLUMN IF NOT EXISTS company_domain text CHECK (company_domain IS NULL OR length(company_domain) <= 120);
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.sales_people'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%company_type%' LOOP
    EXECUTE format('ALTER TABLE public.sales_people DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.sales_people ADD CONSTRAINT sales_people_company_type_check CHECK (company_type IN ('employer', 'target', 'parked'));
ALTER TABLE public.sales_people ADD CONSTRAINT sales_people_one_company CHECK (
  (company_type = 'employer' AND opportunity_id IS NOT NULL AND target_id IS NULL)
  OR (company_type = 'target' AND target_id IS NOT NULL AND opportunity_id IS NULL)
  OR (company_type = 'parked' AND opportunity_id IS NULL AND target_id IS NULL AND company_name IS NOT NULL));
CREATE INDEX IF NOT EXISTS sales_people_parked_idx ON public.sales_people (business_id, company_name) WHERE company_type = 'parked' AND archived_at IS NULL;

ALTER TABLE public.visit_pull_runs DROP CONSTRAINT IF EXISTS visit_pull_runs_kind_check;
ALTER TABLE public.visit_pull_runs ADD CONSTRAINT visit_pull_runs_kind_check CHECK (kind IN ('daily', 'backfill', 'people'));

-- Proof (expect):
--   1 sales_people columns      company_domain,company_name
--   2 sales_people checks       company_type has parked=true · one_company has parked=true
--   3 visit_pull_runs kind      people=true
--   4 parked rows               0 (nothing changed)
--   5 addresses                 0
SELECT 1 AS n, 'sales_people columns' AS what, (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_people' AND column_name IN ('company_name', 'company_domain')) AS detail
UNION ALL
SELECT 2, 'sales_people checks', 'company_type has parked=' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_people_company_type_check' AND pg_get_constraintdef(oid) LIKE '%parked%') || ' · one_company has parked=' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_people_one_company' AND pg_get_constraintdef(oid) LIKE '%parked%')
UNION ALL
SELECT 3, 'visit_pull_runs kind', 'people=' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_pull_runs_kind_check' AND pg_get_constraintdef(oid) LIKE '%people%')
UNION ALL
SELECT 4, 'parked rows', (SELECT count(*) FROM public.sales_people WHERE company_type = 'parked')::text
UNION ALL
SELECT 5, 'addresses', (SELECT count(*) FROM public.sales_people WHERE company_name ~ '@' OR company_domain ~ '@')::text
ORDER BY n;
