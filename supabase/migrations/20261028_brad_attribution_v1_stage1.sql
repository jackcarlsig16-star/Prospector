-- brad-attribution-v1 Stage 1 (F3, Oct 28 2026) - Supabase SQL editor: paste -> Run. Idempotent. No existing row changes.
--
-- sales_stage_marks  NEW. A hand-set date for a funnel stage Prospector never saw (Stage 0: one partner sits at
--                    meeting_set with no dated row; a Meeting that happened before the events existed). One mark per
--                    (record, stage); the funnel reads it as one more dated source, never edits the record's band.
--                    reason manual (a person marked it) | backfill. Members write through the API (service key);
--                    the browser reads only (s5_read, anon revoked). Never an address or a phone: note <= 200 chars.
-- The employer stage-change event needs no change: trigger sales_opportunities_log_event_trigger
-- (20261001_sales_pipeline_v1.sql) already logs created / stage_change / archived on every insert or update, and the
-- app is barred from writing that table. Prod's 'archived' row proves the UPDATE branch fires.
CREATE TABLE IF NOT EXISTS public.sales_stage_marks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type IN ('partner', 'employer', 'target')),
  record_id   uuid NOT NULL,
  stage       text NOT NULL CHECK (stage IN ('referred', 'visited', 'replied', 'meeting', 'pilot', 'lost')),
  at          date NOT NULL,
  by_user     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note        text CHECK (note IS NULL OR length(note) <= 200),
  reason      text NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual', 'backfill')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_stage_marks_one_idx ON public.sales_stage_marks (business_id, record_type, record_id, stage);
CREATE INDEX IF NOT EXISTS sales_stage_marks_record_idx ON public.sales_stage_marks (business_id, record_type, record_id);
ALTER TABLE public.sales_stage_marks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_stage_marks;
CREATE POLICY s5_read ON public.sales_stage_marks FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_stage_marks FROM anon;

-- Proof (expect):
--   1 table        sales_stage_marks present · rls=t
--   2 unique       sales_stage_marks_one_idx (business_id, record_type, record_id, stage)
--   3 policy       s5_read
--   4 rows         0
--   5 trigger      sales_opportunities_log_event_trigger on sales_opportunities = t (the stage-change writer already in place)
SELECT 1 AS n, 'table' AS what, 'sales_stage_marks present=' || EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_stage_marks') || ' · rls=' || coalesce((SELECT relrowsecurity FROM pg_class WHERE relname = 'sales_stage_marks'), false) AS detail
UNION ALL
SELECT 2, 'unique', coalesce((SELECT regexp_replace(indexdef, '^.*USING btree ', '') FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'sales_stage_marks_one_idx'), 'MISSING')
UNION ALL
SELECT 3, 'policy', coalesce((SELECT string_agg(policyname, ',') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_stage_marks'), 'MISSING')
UNION ALL
SELECT 4, 'rows', (SELECT count(*) FROM public.sales_stage_marks)::text
UNION ALL
SELECT 5, 'trigger', 'sales_opportunities_log_event_trigger=' || EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sales_opportunities_log_event_trigger' AND tgrelid = 'public.sales_opportunities'::regclass)
ORDER BY n;
