-- call-notes-targets-v1 REV4 Stage 3 - Tidy: daily propose-only suggestions.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- sales_suggestions: one row per thing Tidy noticed - the rule (kind) and
-- the record it points at; ref_id2 is the second record of a duplicate pair.
-- The unique index is partial on status = 'proposed' so a dismissed row
-- (dismissed_until in the future) is never re-created while it sleeps and an
-- accepted row doesn't block a fresh proposal later. coalesce(ref_id2, ref_id)
-- puts single-record keys and pair keys in the same index.
-- sales_tidy_runs: one row per Tidy run, written once with its final status;
-- the page-load / Tidy-now guard reads today's non-error row (LA day, mirrors
-- partnerContactsSync ranToday). A failed run keeps its message in counts.
-- RLS: sales_suggestions gets s5_read like every Goals table; sales_tidy_runs
-- is server-only (RLS on, no policies) like sales_sync_runs - the API reads
-- it with the service key.

CREATE TABLE IF NOT EXISTS public.sales_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 40),
  ref_type        text NOT NULL CHECK (ref_type IN ('partner', 'opportunity', 'target', 'todo', 'flag', 'pair')),
  ref_id          uuid NOT NULL,
  ref_id2         uuid,
  text            text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 400),
  reason          text CHECK (reason IS NULL OR length(reason) <= 400),
  status          text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'dismissed')),
  dismissed_until timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  decided_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_suggestions_open_key_idx
  ON public.sales_suggestions (business_id, kind, ref_type, ref_id, coalesce(ref_id2, ref_id))
  WHERE status = 'proposed';

ALTER TABLE public.sales_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_suggestions;
CREATE POLICY s5_read ON public.sales_suggestions FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_suggestions FROM anon;

CREATE TABLE IF NOT EXISTS public.sales_tidy_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL CHECK (status IN ('ok', 'error')),
  counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  trigger     text NOT NULL CHECK (trigger IN ('pageload', 'manual', 'test'))
);
CREATE INDEX IF NOT EXISTS sales_tidy_runs_business_started_idx
  ON public.sales_tidy_runs (business_id, started_at DESC);

ALTER TABLE public.sales_tidy_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_tidy_runs FROM anon;

-- Check: 8 rows -
--   sales_suggestions  (13 columns)
--   sales_suggestions  index sales_suggestions_open_key_idx         WHERE (status = 'proposed'::text)
--   sales_suggestions  policies                                     1 (s5_read SELECT)
--   sales_suggestions  rls                                          true
--   sales_tidy_runs    (7 columns)
--   sales_tidy_runs    index sales_tidy_runs_business_started_idx   (blank)
--   sales_tidy_runs    policies                                     0
--   sales_tidy_runs    rls                                          true
SELECT t.tbl, '(' || count(c.column_name) || ' columns)' AS item, '' AS detail
  FROM (VALUES ('sales_suggestions'), ('sales_tidy_runs')) t(tbl)
  JOIN information_schema.columns c ON c.table_schema = 'public' AND c.table_name = t.tbl
  GROUP BY t.tbl
UNION ALL
SELECT tablename, 'index ' || indexname, coalesce(substring(indexdef FROM 'WHERE .*$'), '') FROM pg_indexes
  WHERE schemaname = 'public' AND indexname IN ('sales_suggestions_open_key_idx', 'sales_tidy_runs_business_started_idx')
UNION ALL
SELECT t.tbl, 'policies', count(p.policyname) || coalesce(' (' || string_agg(p.policyname || ' ' || p.cmd, ', ') || ')', '')
  FROM (VALUES ('sales_suggestions'), ('sales_tidy_runs')) t(tbl)
  LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = t.tbl
  GROUP BY t.tbl
UNION ALL
SELECT relname, 'rls', relrowsecurity::text FROM pg_class
  WHERE relnamespace = 'public'::regnamespace AND relname IN ('sales_suggestions', 'sales_tidy_runs')
ORDER BY 1, 2;
