-- signals-v1 REV2 Stage 1 - outside-signal review queue + target source tag.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- sales_signals: rows proposed by the Signal Scout import ('scout') and the
-- website-visitor upload ('web_visit'). Nothing becomes a target or a to-do
-- until a Member accepts the row. The unique index makes a re-upload of the
-- same file add 0 rows, and keeps a dismissed row dismissed.
-- sales_targets.source: where a target came from; existing rows are Intake
-- ('note'). signal_id points back at the accepted signal.
-- RLS: s5_read like every Goals table; the API writes with the service key.
-- Re-runnable: IF NOT EXISTS everywhere, drop-then-add for the named checks.

CREATE TABLE IF NOT EXISTS public.sales_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('scout', 'web_visit')),
  signal_week     date NOT NULL,
  company_name    text NOT NULL CHECK (length(btrim(company_name)) BETWEEN 1 AND 160),
  company_key     text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('partner', 'employer')),
  kind_guessed    boolean NOT NULL DEFAULT false,
  who             text CHECK (who IS NULL OR length(who) <= 160),
  who_key         text,
  signal          text CHECK (signal IS NULL OR length(signal) <= 400),
  why_now         text CHECK (why_now IS NULL OR length(why_now) <= 400),
  first_line      text CHECK (first_line IS NULL OR length(first_line) <= 400),
  score           int,
  upside_joint    boolean NOT NULL DEFAULT false,
  match           jsonb,
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'dismissed')),
  dismissed_until date,
  target_id       uuid REFERENCES public.sales_targets(id) ON DELETE SET NULL,
  todo_id         uuid REFERENCES public.sales_week_goals(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_signals_dedupe_idx
  ON public.sales_signals (business_id, source, signal_week, company_key, coalesce(who_key, ''));

ALTER TABLE public.sales_signals DROP CONSTRAINT IF EXISTS sales_signals_week_monday_check;
ALTER TABLE public.sales_signals ADD CONSTRAINT sales_signals_week_monday_check
  CHECK (extract(isodow FROM signal_week) = 1);

ALTER TABLE public.sales_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_signals;
CREATE POLICY s5_read ON public.sales_signals FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_signals FROM anon;

ALTER TABLE public.sales_targets
  ADD COLUMN IF NOT EXISTS source    text NOT NULL DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS signal_id uuid REFERENCES public.sales_signals(id) ON DELETE SET NULL;
ALTER TABLE public.sales_targets DROP CONSTRAINT IF EXISTS sales_targets_source_check;
ALTER TABLE public.sales_targets ADD CONSTRAINT sales_targets_source_check
  CHECK (source IN ('note', 'scout', 'web_visit', 'manual'));

-- Check: 11 rows -
--    1 sales_signals  (25 columns)
--    2 sales_signals  (9 checks)                       source/company_name/kind/who/signal/why_now/first_line/status/week_monday
--    3 sales_signals  (5 foreign keys)                 businesses/sales_targets/sales_week_goals/profiles x2
--    4 sales_signals  index sales_signals_dedupe_idx   ...(business_id, source, signal_week, company_key, COALESCE(who_key, ''::text))
--    5 sales_signals  rls enabled                      true
--    6 sales_signals  policy s5_read                   SELECT (the only policy)
--    7 sales_signals  anon can select sales_signals    false
--    8 sales_targets  column source                    text default 'note'::text not null
--    9 sales_targets  column signal_id                 uuid
--   10 sales_targets  check sales_targets_source_check CHECK ((source = ANY (ARRAY['note'::text, 'scout'::text, 'web_visit'::text, 'manual'::text])))
--   11 sales_targets  fk sales_targets_signal_id_fkey  FOREIGN KEY (signal_id) REFERENCES sales_signals(id) ON DELETE SET NULL
SELECT 1 AS n, 'sales_signals' AS tbl, '(' || count(*) || ' columns)' AS item, '' AS detail
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_signals'
UNION ALL
SELECT 2, 'sales_signals', '(' || count(*) || ' checks)', '' FROM pg_constraint
  WHERE conrelid = 'public.sales_signals'::regclass AND contype = 'c'
UNION ALL
SELECT 3, 'sales_signals', '(' || count(*) || ' foreign keys)', '' FROM pg_constraint
  WHERE conrelid = 'public.sales_signals'::regclass AND contype = 'f'
UNION ALL
SELECT 4, tablename, 'index ' || indexname, indexdef FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'sales_signals_dedupe_idx'
UNION ALL
SELECT 5, 'sales_signals', 'rls enabled', relrowsecurity::text FROM pg_class
  WHERE oid = 'public.sales_signals'::regclass
UNION ALL
SELECT 6, tablename, 'policy ' || policyname, cmd FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'sales_signals'
UNION ALL
SELECT 7, 'sales_signals', 'anon can select sales_signals',
  has_table_privilege('anon', 'public.sales_signals', 'SELECT')::text
UNION ALL
SELECT 8, table_name, 'column ' || column_name,
  data_type || ' default ' || coalesce(column_default, 'none') || CASE WHEN is_nullable = 'NO' THEN ' not null' ELSE '' END
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_targets' AND column_name = 'source'
UNION ALL
SELECT 9, table_name, 'column ' || column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_targets' AND column_name = 'signal_id'
UNION ALL
SELECT 10, 'sales_targets', 'check ' || conname, pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conrelid = 'public.sales_targets'::regclass AND conname = 'sales_targets_source_check'
UNION ALL
SELECT 11, 'sales_targets', 'fk ' || conname, pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conrelid = 'public.sales_targets'::regclass AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE '%sales_signals%'
ORDER BY 1;
