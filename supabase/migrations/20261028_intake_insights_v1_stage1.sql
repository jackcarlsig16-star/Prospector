-- intake-insights-v1 Stage 1 (I4, Oct 28 2026) - Supabase SQL editor: paste -> Run. Idempotent. No existing row changes.
--
-- sales_insights       NEW. A kept "track" (a data point the notes show matters) or "optimize" (a process / channel
--                      improvement) item from a notes upload. The same idea from a second note raises seen_count /
--                      last_seen_at on the live row instead of adding one: unique (business_id, kind, lower(text)) is
--                      partial on status open | planned, so a done or dismissed item never blocks the idea coming back.
--                      Dismissed = the archive; rows are never deleted.
-- sales_channel_links  NEW. A relationship the notes state between partners, offices, people and companies ("Upside
--                      Chicago office -> referred -> Acme"). Each end keeps the name as written and, when matched, the
--                      record (Pipeline partner / employer / target, or a person row). A repeat raises seen_count on the
--                      live row: unique (business_id, from_kind, lower(from_name), relation, to_kind, lower(to_name)) is
--                      partial on archived_at IS NULL, so an archived link never blocks a fresh one. Archive, never delete.
-- Both: RLS on, s5_read for members (same as sales_suggestions), anon revoked; writes go through the API with the
-- service key only. Names, offices, companies and short phrases only - no email or phone columns (the server strips
-- both from every text before it lands).
CREATE TABLE IF NOT EXISTS public.sales_insights (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('track', 'optimize')),
  text          text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 200),
  why           text CHECK (why IS NULL OR length(why) <= 200),
  where_text    text CHECK (where_text IS NULL OR where_text IN ('company', 'partner', 'person', 'referral', 'deal', 'activity')),
  example       text CHECK (example IS NULL OR length(example) <= 200),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'done', 'dismissed')),
  already_field text CHECK (already_field IS NULL OR length(already_field) <= 60),
  note_id       uuid REFERENCES public.sales_call_notes(id) ON DELETE SET NULL,
  seen_count    int NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_insights_live_key_idx
  ON public.sales_insights (business_id, kind, lower(text))
  WHERE status IN ('open', 'planned');
CREATE INDEX IF NOT EXISTS sales_insights_status_idx ON public.sales_insights (business_id, status, last_seen_at DESC);
ALTER TABLE public.sales_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_insights;
CREATE POLICY s5_read ON public.sales_insights FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_insights FROM anon;

CREATE TABLE IF NOT EXISTS public.sales_channel_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  from_kind        text NOT NULL CHECK (from_kind IN ('partner', 'office', 'person', 'company')),
  from_name        text NOT NULL CHECK (length(btrim(from_name)) BETWEEN 1 AND 120),
  from_record_type text CHECK (from_record_type IS NULL OR from_record_type IN ('partner', 'employer', 'target', 'partner_contact', 'sales_person')),
  from_record_id   uuid,
  to_kind          text NOT NULL CHECK (to_kind IN ('partner', 'office', 'person', 'company')),
  to_name          text NOT NULL CHECK (length(btrim(to_name)) BETWEEN 1 AND 120),
  to_record_type   text CHECK (to_record_type IS NULL OR to_record_type IN ('partner', 'employer', 'target', 'partner_contact', 'sales_person')),
  to_record_id     uuid,
  relation         text NOT NULL CHECK (relation IN ('referred', 'introduced', 'owns', 'co_sells', 'reports_to', 'works_with', 'other')),
  link_date        date,
  evidence         text CHECK (evidence IS NULL OR length(evidence) <= 200),
  note_id          uuid REFERENCES public.sales_call_notes(id) ON DELETE SET NULL,
  seen_count       int NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  CHECK ((from_record_type IS NULL) = (from_record_id IS NULL)),
  CHECK ((to_record_type IS NULL) = (to_record_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_channel_links_live_key_idx
  ON public.sales_channel_links (business_id, from_kind, lower(from_name), relation, to_kind, lower(to_name))
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_channel_links_from_idx ON public.sales_channel_links (business_id, from_record_type, from_record_id) WHERE from_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_channel_links_to_idx ON public.sales_channel_links (business_id, to_record_type, to_record_id) WHERE to_record_id IS NOT NULL;
ALTER TABLE public.sales_channel_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_channel_links;
CREATE POLICY s5_read ON public.sales_channel_links FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_channel_links FROM anon;

-- Proof (expect):
--   1 tables     sales_insights present · rls=t | sales_channel_links present · rls=t
--   2 unique     sales_insights_live_key_idx (business_id, kind, lower(text)) WHERE status open|planned
--   3 unique     sales_channel_links_live_key_idx (… lower(from_name), relation, to_kind, lower(to_name)) WHERE archived_at IS NULL
--   4 policies   s5_read | s5_read
--   5 anon       no table privileges on either (0)
--   6 columns    seen_count + last_seen_at on both; 0 columns named like email / phone
--   7 rows       0 | 0
SELECT 1 AS n, 'tables' AS what, 'sales_insights present=' || EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_insights') || ' · rls=' || coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_insights'::regclass), false)
  || ' | sales_channel_links present=' || EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_channel_links') || ' · rls=' || coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_channel_links'::regclass), false) AS detail
UNION ALL
SELECT 2, 'unique', coalesce((SELECT regexp_replace(indexdef, '^.*USING btree ', '') FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'sales_insights_live_key_idx'), 'MISSING')
UNION ALL
SELECT 3, 'unique', coalesce((SELECT regexp_replace(indexdef, '^.*USING btree ', '') FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'sales_channel_links_live_key_idx'), 'MISSING')
UNION ALL
SELECT 4, 'policies', coalesce((SELECT string_agg(policyname, ',') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_insights'), 'MISSING') || ' | ' || coalesce((SELECT string_agg(policyname, ',') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_channel_links'), 'MISSING')
UNION ALL
SELECT 5, 'anon', (SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_schema = 'public' AND table_name IN ('sales_insights', 'sales_channel_links'))::text
UNION ALL
SELECT 6, 'columns', (SELECT string_agg(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('sales_insights', 'sales_channel_links') AND column_name IN ('seen_count', 'last_seen_at'))
  || ' · email/phone columns=' || (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('sales_insights', 'sales_channel_links') AND (column_name ILIKE '%email%' OR column_name ILIKE '%phone%'))
UNION ALL
SELECT 7, 'rows', (SELECT count(*) FROM public.sales_insights)::text || ' | ' || (SELECT count(*) FROM public.sales_channel_links)::text
ORDER BY n;
