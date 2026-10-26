-- lead-upload-v1 Stage 1 - the 'apollo' lead source, people at employers / targets, and the upload history.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- 1. 'apollo' joins the source_kind list on the three company tables. Each <table>_source_check is re-created
--    exactly as 20261022_lead_source_v1.sql:37-43 wrote it (same length caps) plus 'apollo'.
-- 2. sales_lead_uploads - one row per filed lead list: who, when, the source picked, the hash of the pasted text
--    (the text itself is never stored), and counts. Re-pasting the same list is allowed (people show "Already in").
-- 3. sales_people - people at an employer or a target (partners keep partner_contacts; Apollo's
--    sales_prospect_state is never written by hand). No email or phone column, ever.
-- Both new tables: RLS on, no policies, anon/authenticated revoked - every read and write goes through
-- /api/sales/:businessId/* with the service key.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_goals', 'sales_opportunities', 'sales_targets'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_source_check');
    EXECUTE format($c$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      (source_kind IS NULL OR source_kind IN ('homelover_outreach', 'partner_referral', 'person_referral', 'campaign', 'website', 'scout', 'event', 'inbound', 'unknown', 'apollo'))
      AND (source_person IS NULL OR length(source_person) <= 120)
      AND (source_office IS NULL OR length(source_office) <= 120)
      AND (route_in IS NULL OR length(route_in) <= 300)
      AND (source_note IS NULL OR length(source_note) <= 500))$c$, t, t || '_source_check');
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.sales_lead_uploads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  source_kind       text NOT NULL CHECK (source_kind IN ('homelover_outreach', 'partner_referral', 'person_referral', 'campaign', 'website', 'scout', 'event', 'inbound', 'unknown', 'apollo')),
  source_partner_id uuid REFERENCES public.sales_goals(id) ON DELETE SET NULL,
  source_person     text CHECK (source_person IS NULL OR length(source_person) <= 120),
  source_note       text CHECK (source_note IS NULL OR length(source_note) <= 500),
  text_hash         text NOT NULL,
  counts            jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sales_lead_uploads_business_idx ON public.sales_lead_uploads (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_lead_uploads_hash_idx ON public.sales_lead_uploads (business_id, text_hash);

CREATE TABLE IF NOT EXISTS public.sales_people (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  company_type      text NOT NULL CHECK (company_type IN ('employer', 'target')),
  opportunity_id    uuid REFERENCES public.sales_opportunities(id) ON DELETE CASCADE,
  target_id         uuid REFERENCES public.sales_targets(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  title             text CHECK (title IS NULL OR length(title) <= 160),
  location          text CHECK (location IS NULL OR length(location) <= 120),
  linkedin_url      text CHECK (linkedin_url IS NULL OR (length(linkedin_url) <= 300 AND linkedin_url ~ '^https://(www\.)?linkedin\.com/')),
  note              text CHECK (note IS NULL OR length(note) <= 500),
  source_kind       text CHECK (source_kind IS NULL OR source_kind IN ('homelover_outreach', 'partner_referral', 'person_referral', 'campaign', 'website', 'scout', 'event', 'inbound', 'unknown', 'apollo')),
  source_partner_id uuid REFERENCES public.sales_goals(id) ON DELETE SET NULL,
  source_note       text CHECK (source_note IS NULL OR length(source_note) <= 300),
  upload_id         uuid REFERENCES public.sales_lead_uploads(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_people_one_company CHECK (
    (company_type = 'employer' AND opportunity_id IS NOT NULL AND target_id IS NULL)
    OR (company_type = 'target' AND target_id IS NOT NULL AND opportunity_id IS NULL))
);
-- "Already in": one person per name per company.
CREATE UNIQUE INDEX IF NOT EXISTS sales_people_company_name_uniq
  ON public.sales_people (business_id, company_type, coalesce(opportunity_id, target_id), lower(name));
CREATE INDEX IF NOT EXISTS sales_people_opportunity_idx ON public.sales_people (business_id, opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_people_target_idx ON public.sales_people (business_id, target_id) WHERE target_id IS NOT NULL;

ALTER TABLE public.sales_lead_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_people       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_lead_uploads FROM anon, authenticated;
REVOKE ALL ON public.sales_people       FROM anon, authenticated;

-- Proof - expect 7 rows:
--   3 x "<table>_source_check"  apollo=true · caps=true
--   1 x "sales_targets.source check"  (the signals-v1 CHECK on sales_targets.source: a name, or MISSING - see report)
--   1 x "sales_people_one_company"  present
--   2 x table rows: rls=true · policies=0 · rows=0 · anon_select=false · auth_select=false
--       (sales_lead_uploads columns=10 uniq=0; sales_people columns=17 uniq=1)
SELECT 'constraint' AS kind, c.conname AS name,
       'apollo=' || (pg_get_constraintdef(c.oid) LIKE '%''apollo''%') ||
       ' · caps=' || (pg_get_constraintdef(c.oid) LIKE '%source_note%500%') AS detail
  FROM pg_constraint c
 WHERE c.conname IN ('sales_goals_source_check', 'sales_opportunities_source_check', 'sales_targets_source_check')
UNION ALL
SELECT 'constraint', 'sales_targets.source check',
       coalesce((SELECT string_agg(conname, ', ') FROM pg_constraint
                  WHERE conrelid = 'public.sales_targets'::regclass AND contype = 'c'
                    AND pg_get_constraintdef(oid) ~ '\(source = ANY'), 'MISSING')
UNION ALL
SELECT 'table', t.relname,
       'rls=' || t.relrowsecurity ||
       ' · policies=' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname) ||
       ' · rows=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t.relname), false, true, '')))[1]::text ||
       ' · anon_select=' || has_table_privilege('anon', t.oid, 'SELECT') ||
       ' · auth_select=' || has_table_privilege('authenticated', t.oid, 'SELECT') ||
       ' · columns=' || (SELECT count(*) FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = t.relname) ||
       ' · uniq=' || (SELECT count(*) FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = t.relname AND i.indexdef LIKE 'CREATE UNIQUE INDEX%' AND i.indexname <> t.relname || '_pkey')
  FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public' AND t.relname IN ('sales_people', 'sales_lead_uploads')
UNION ALL
SELECT 'constraint', 'sales_people_one_company', CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_people_one_company') THEN 'present' ELSE 'MISSING' END
ORDER BY 1, 2;
