-- sales-ia-v2 REV2 Stage 1 - channel, P1-P4 priority everywhere, visitor priority override, 'opportunity' to-do links.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- channel: where a partner / employer / target came from. Added as 'unknown', then backfilled once by the Stage 0
-- rules; the UPDATEs only touch rows still 'unknown', so a re-run never undoes a hand correction. Apollo outbound is
-- a filter (has an Apollo id / sequenced), not a channel value.
--   partners:  created on the seed day (LA 2026-10-06) -> import, else manual. Not record_id: partners added by hand
--              later got a record_id when the master import matched them (Alliant, Brown & Brown).
--   employers: source 'csv' -> import, source 'manual' -> manual
--   targets:   source_note_id set -> call_note, else record_id set -> import (nothing else exists; stays unknown)
-- priority: one P1-P4 scale stored as 1-4. sales_goals keeps its values, the check widens 1-3 -> 1-4.
-- visit_priority_override: a person's P1-P4 / Not a fit for a visiting company; the pull never overwrites it and
-- readers use override ?? computed. RLS s5_read like web_visits; the API writes with the service key.
-- Re-runnable: IF NOT EXISTS / DROP ... IF EXISTS everywhere.

ALTER TABLE public.sales_goals         ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'unknown';
ALTER TABLE public.sales_opportunities ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'unknown';
ALTER TABLE public.sales_targets       ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.sales_goals DROP CONSTRAINT IF EXISTS sales_goals_channel_check;
ALTER TABLE public.sales_goals ADD CONSTRAINT sales_goals_channel_check CHECK (channel IN
  ('website_visit', 'scout', 'apollo_outbound', 'partner_referral', 'call_note', 'import', 'manual', 'unknown'));
ALTER TABLE public.sales_opportunities DROP CONSTRAINT IF EXISTS sales_opportunities_channel_check;
ALTER TABLE public.sales_opportunities ADD CONSTRAINT sales_opportunities_channel_check CHECK (channel IN
  ('website_visit', 'scout', 'apollo_outbound', 'partner_referral', 'call_note', 'import', 'manual', 'unknown'));
ALTER TABLE public.sales_targets DROP CONSTRAINT IF EXISTS sales_targets_channel_check;
ALTER TABLE public.sales_targets ADD CONSTRAINT sales_targets_channel_check CHECK (channel IN
  ('website_visit', 'scout', 'apollo_outbound', 'partner_referral', 'call_note', 'import', 'manual', 'unknown'));

UPDATE public.sales_goals SET channel = CASE
    WHEN (created_at AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-10-06' THEN 'import'
    ELSE 'manual' END
  WHERE channel = 'unknown';
UPDATE public.sales_opportunities SET channel = CASE source WHEN 'csv' THEN 'import' ELSE 'manual' END
  WHERE channel = 'unknown';
UPDATE public.sales_targets SET channel = CASE
    WHEN source_note_id IS NOT NULL THEN 'call_note'
    WHEN record_id IS NOT NULL THEN 'import'
    ELSE 'unknown' END
  WHERE channel = 'unknown';

ALTER TABLE public.sales_goals DROP CONSTRAINT IF EXISTS sales_goals_priority_check;
ALTER TABLE public.sales_goals ADD CONSTRAINT sales_goals_priority_check CHECK (priority IS NULL OR priority BETWEEN 1 AND 4);
ALTER TABLE public.sales_goals
  ADD COLUMN IF NOT EXISTS priority_set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority_set_at timestamptz;

ALTER TABLE public.sales_opportunities
  ADD COLUMN IF NOT EXISTS priority        integer,
  ADD COLUMN IF NOT EXISTS priority_set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority_set_at timestamptz;
ALTER TABLE public.sales_opportunities DROP CONSTRAINT IF EXISTS sales_opportunities_priority_check;
ALTER TABLE public.sales_opportunities ADD CONSTRAINT sales_opportunities_priority_check CHECK (priority IS NULL OR priority BETWEEN 1 AND 4);

CREATE TABLE IF NOT EXISTS public.visit_priority_override (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  company_key text NOT NULL,
  priority    integer CHECK (priority IS NULL OR priority BETWEEN 1 AND 4),
  not_a_fit   boolean NOT NULL DEFAULT false,
  set_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  set_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS visit_priority_override_key_idx
  ON public.visit_priority_override (business_id, company_key);

ALTER TABLE public.visit_priority_override ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.visit_priority_override;
CREATE POLICY s5_read ON public.visit_priority_override FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.visit_priority_override FROM anon;

ALTER TABLE public.sales_week_goals DROP CONSTRAINT IF EXISTS sales_week_goals_link_check;
ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_link_check CHECK (
  (link_type IS NULL AND link_id IS NULL)
  OR (link_type IN ('commitment', 'metric', 'partner', 'company', 'target', 'opportunity') AND length(trim(link_id)) > 0)
);

-- Check: 9 fixed rows + one backfill row per (business, table, channel) -
--    1 (3 tables)               channel columns         sales_goals:text:'unknown',sales_opportunities:...,sales_targets:...
--    2 (3 tables)               channel checks          sales_goals_channel_check,sales_opportunities_channel_check,sales_targets_channel_check
--    3 sales_goals              priority check          CHECK (priority IS NULL OR (priority >= 1 AND priority <= 4))
--    4 sales_opportunities      priority check          CHECK (priority IS NULL OR (priority >= 1 AND priority <= 4))
--    5 (2 tables)               priority columns        sales_goals: priority,priority_set_at,priority_set_by · sales_opportunities: same 3
--    6 visit_priority_override  (7 columns)             index visit_priority_override_key_idx (business_id, company_key)
--    7 visit_priority_override  rls / policy / anon     rls true · s5_read:SELECT · anon 0
--    8 sales_week_goals         link check              ... 'opportunity' ...
--    9 sales_goals              priority values         1:6 2:7 3:4 null:60 (unchanged)
--   10+ backfill <business>     <table> <channel>       HomeLover: sales_goals import 75 / manual 2,
--                                                       sales_opportunities import 221 / manual 2,
--                                                       sales_targets call_note 10 / import 28; no 'unknown' rows
SELECT 1 AS n, '(3 tables)' AS tbl, 'channel columns' AS item,
  string_agg(table_name || ':' || data_type || ':' || column_default, ',' ORDER BY table_name) AS detail
  FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'channel'
    AND table_name IN ('sales_goals', 'sales_opportunities', 'sales_targets')
UNION ALL
SELECT 2, '(3 tables)', 'channel checks', string_agg(conname, ',' ORDER BY conname) FROM pg_constraint
  WHERE conname IN ('sales_goals_channel_check', 'sales_opportunities_channel_check', 'sales_targets_channel_check')
UNION ALL
SELECT 3, 'sales_goals', 'priority check', pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conname = 'sales_goals_priority_check'
UNION ALL
SELECT 4, 'sales_opportunities', 'priority check', pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conname = 'sales_opportunities_priority_check'
UNION ALL
SELECT 5, '(2 tables)', 'priority columns', string_agg(table_name || ': ' || cols, ' · ' ORDER BY table_name) FROM (
  SELECT table_name, string_agg(column_name, ',' ORDER BY column_name) AS cols FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('sales_goals', 'sales_opportunities')
      AND column_name IN ('priority', 'priority_set_by', 'priority_set_at')
    GROUP BY table_name) c
UNION ALL
SELECT 6, 'visit_priority_override',
  '(' || (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'visit_priority_override') || ' columns)',
  (SELECT 'index ' || indexname || ' ' || substring(indexdef FROM '\(.*\)') FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'visit_priority_override_key_idx')
UNION ALL
SELECT 7, 'visit_priority_override', 'rls / policy / anon',
  'rls ' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.visit_priority_override'::regclass)
  || ' · ' || coalesce((SELECT string_agg(policyname || ':' || cmd, ',') FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'visit_priority_override'), 'none')
  || ' · anon ' || (CASE WHEN has_table_privilege('anon', 'public.visit_priority_override', 'SELECT') THEN 1 ELSE 0 END)
UNION ALL
SELECT 8, 'sales_week_goals', 'link check', pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conname = 'sales_week_goals_link_check'
UNION ALL
SELECT 9, 'sales_goals', 'priority values', string_agg(p || ':' || c, ' ' ORDER BY p) FROM (
  SELECT coalesce(priority::text, 'null') AS p, count(*) AS c FROM public.sales_goals GROUP BY 1) v
UNION ALL
SELECT 10, 'backfill ' || coalesce(b.name, x.business_id::text), x.tbl || ' ' || x.channel, x.c::text FROM (
  SELECT business_id, 'sales_goals' AS tbl, channel, count(*) AS c FROM public.sales_goals GROUP BY 1, 3
  UNION ALL
  SELECT business_id, 'sales_opportunities', channel, count(*) FROM public.sales_opportunities GROUP BY 1, 3
  UNION ALL
  SELECT business_id, 'sales_targets', channel, count(*) FROM public.sales_targets GROUP BY 1, 3) x
  LEFT JOIN public.businesses b ON b.id = x.business_id
ORDER BY 1, 2, 3;
