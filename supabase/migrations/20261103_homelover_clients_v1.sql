-- homelover-clients-v1 REV2 Stage 1 - an employer becomes a Client; agreements + financials get a private file store;
-- lookalike becomes a source kind. Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Idempotent.
-- No existing row value changes (every new column is NULL until a person makes a client).
--
-- sales_opportunities  + client_status (verbal_yes | agreement_sent | signed | launched), client_since, signed_date,
--                        eligible_now, eligible_added, eligible_added_note (<= 200), expected_signing_date,
--                        apollo_deal_id, apollo_org_id (text ids). apollo_account_id already exists and is reused;
--                        launch date = expected_launch. Names / short text only - never an address or phone.
-- sales_client_events  NEW - the client Activity log (made client / status / signed / launched / undo / file added /
--                        file archived), with by_user + via (panel | connector). Kept apart from
--                        sales_opportunity_events because that table's to_stage is read as a pipeline stage everywhere
--                        (movementBuckets). Rows are never deleted - an Undo adds an 'undo' row.
-- sales_client_files   NEW - one row per uploaded file; archived_at, never deleted.
-- storage bucket client-files  PRIVATE, 20 MB, PDF / DOCX / XLSX / PNG / JPG. Object path = <business_id>/<opportunity_id>/<file id>.
--                        Members may read their own business's prefix; nobody writes from the browser (uploads use a
--                        server-issued signed upload URL, opens a short-lived signed URL).
-- source_kind          gains 'lookalike' on sales_goals / sales_opportunities / sales_targets (<t>_source_check, same
--                        shape as 20261026_lead_upload_v1.sql), sales_lead_uploads and sales_people.

ALTER TABLE public.sales_opportunities
  ADD COLUMN IF NOT EXISTS client_status         text,
  ADD COLUMN IF NOT EXISTS client_since          date,
  ADD COLUMN IF NOT EXISTS signed_date           date,
  ADD COLUMN IF NOT EXISTS eligible_now          integer,
  ADD COLUMN IF NOT EXISTS eligible_added        integer,
  ADD COLUMN IF NOT EXISTS eligible_added_note   text,
  ADD COLUMN IF NOT EXISTS expected_signing_date date,
  ADD COLUMN IF NOT EXISTS apollo_deal_id        text,
  ADD COLUMN IF NOT EXISTS apollo_org_id         text;
ALTER TABLE public.sales_opportunities DROP CONSTRAINT IF EXISTS sales_opportunities_client_check;
ALTER TABLE public.sales_opportunities ADD CONSTRAINT sales_opportunities_client_check CHECK (
  (client_status IS NULL OR client_status IN ('verbal_yes', 'agreement_sent', 'signed', 'launched'))
  AND (eligible_now IS NULL OR eligible_now >= 0)
  AND (eligible_added IS NULL OR eligible_added >= 0)
  AND (eligible_added_note IS NULL OR length(eligible_added_note) <= 200)
  AND (apollo_deal_id IS NULL OR length(apollo_deal_id) <= 80)
  AND (apollo_org_id IS NULL OR length(apollo_org_id) <= 80));
CREATE INDEX IF NOT EXISTS sales_opportunities_client_idx ON public.sales_opportunities (business_id, client_status) WHERE client_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sales_client_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.sales_opportunities(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('made_client', 'status', 'signed', 'launched', 'undo', 'file_added', 'file_archived')),
  from_status    text,
  to_status      text,
  by_user        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  via            text NOT NULL DEFAULT 'panel' CHECK (via IN ('panel', 'connector')),
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_client_events_opp_idx ON public.sales_client_events (business_id, opportunity_id, at DESC);
ALTER TABLE public.sales_client_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_client_events;
CREATE POLICY s5_read ON public.sales_client_events FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_client_events FROM anon;

CREATE TABLE IF NOT EXISTS public.sales_client_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.sales_opportunities(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('agreement', 'schedule', 'invoice', 'financial', 'other')),
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  storage_path   text NOT NULL UNIQUE CHECK (length(storage_path) <= 300),
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  mime           text NOT NULL CHECK (mime IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg')),
  uploaded_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz,
  archived_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS sales_client_files_opp_idx ON public.sales_client_files (business_id, opportunity_id, uploaded_at DESC);
ALTER TABLE public.sales_client_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_client_files;
CREATE POLICY s5_read ON public.sales_client_files FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_client_files FROM anon;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('client-files', 'client-files', false, 20971520, ARRAY['application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS client_files_member_read ON storage.objects;
CREATE POLICY client_files_member_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-files' AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' AND public.is_member(((storage.foldername(name))[1])::uuid));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_goals', 'sales_opportunities', 'sales_targets'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_source_check');
    EXECUTE format($c$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      (source_kind IS NULL OR source_kind IN ('homelover_outreach', 'partner_referral', 'person_referral', 'campaign', 'website', 'scout', 'event', 'inbound', 'unknown', 'apollo', 'lookalike'))
      AND (source_person IS NULL OR length(source_person) <= 120)
      AND (source_office IS NULL OR length(source_office) <= 120)
      AND (route_in IS NULL OR length(route_in) <= 300)
      AND (source_note IS NULL OR length(source_note) <= 500))$c$, t, t || '_source_check');
  END LOOP;
END $$;
ALTER TABLE public.sales_lead_uploads DROP CONSTRAINT IF EXISTS sales_lead_uploads_source_kind_check;
ALTER TABLE public.sales_lead_uploads ADD CONSTRAINT sales_lead_uploads_source_kind_check
  CHECK (source_kind IN ('homelover_outreach', 'partner_referral', 'person_referral', 'campaign', 'website', 'scout', 'event', 'inbound', 'unknown', 'apollo', 'lookalike'));
ALTER TABLE public.sales_people DROP CONSTRAINT IF EXISTS sales_people_source_kind_check;
ALTER TABLE public.sales_people ADD CONSTRAINT sales_people_source_kind_check
  CHECK (source_kind IS NULL OR source_kind IN ('homelover_outreach', 'partner_referral', 'person_referral', 'campaign', 'website', 'scout', 'event', 'inbound', 'unknown', 'apollo', 'web_visit', 'lookalike'));

-- Proof - expect 6 rows:
--   1 sales_opportunities client cols   9 of 9 · check=true · clients=0
--   2 sales_client_events                rls=true · policies=1 · anon_select=false · rows=0
--   3 sales_client_files                 rls=true · policies=1 · anon_select=false · rows=0
--   4 bucket client-files                public=false · limit=20971520 · mimes=5 · read policy=true
--   5 source checks allow lookalike      5 of 5
--   6 sales_lead_uploads / sales_people  lookalike=true · web_visit kept=true
SELECT 1 AS n, 'sales_opportunities client cols' AS what,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_opportunities'
          AND column_name IN ('client_status', 'client_since', 'signed_date', 'eligible_now', 'eligible_added', 'eligible_added_note', 'expected_signing_date', 'apollo_deal_id', 'apollo_org_id'))::text || ' of 9' ||
       ' · check=' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_opportunities_client_check') ||
       ' · clients=' || (SELECT count(*) FROM public.sales_opportunities WHERE client_status IS NOT NULL) AS detail
UNION ALL
SELECT 2, 'sales_client_events',
       'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_client_events'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_client_events') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_client_events', 'SELECT') ||
       ' · rows=' || (SELECT count(*) FROM public.sales_client_events)
UNION ALL
SELECT 3, 'sales_client_files',
       'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_client_files'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_client_files') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_client_files', 'SELECT') ||
       ' · rows=' || (SELECT count(*) FROM public.sales_client_files)
UNION ALL
SELECT 4, 'bucket client-files',
       'public=' || COALESCE((SELECT public::text FROM storage.buckets WHERE id = 'client-files'), 'missing') ||
       ' · limit=' || COALESCE((SELECT file_size_limit::text FROM storage.buckets WHERE id = 'client-files'), '-') ||
       ' · mimes=' || COALESCE((SELECT array_length(allowed_mime_types, 1)::text FROM storage.buckets WHERE id = 'client-files'), '0') ||
       ' · read policy=' || EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'client_files_member_read')
UNION ALL
SELECT 5, 'source checks allow lookalike',
       (SELECT count(*) FROM pg_constraint WHERE conname IN ('sales_goals_source_check', 'sales_opportunities_source_check', 'sales_targets_source_check', 'sales_lead_uploads_source_kind_check', 'sales_people_source_kind_check')
          AND pg_get_constraintdef(oid) LIKE '%lookalike%')::text || ' of 5'
UNION ALL
SELECT 6, 'sales_lead_uploads / sales_people',
       'lookalike=' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_lead_uploads_source_kind_check' AND pg_get_constraintdef(oid) LIKE '%lookalike%') ||
       ' · web_visit kept=' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_people_source_kind_check' AND pg_get_constraintdef(oid) LIKE '%web_visit%')
ORDER BY n;
