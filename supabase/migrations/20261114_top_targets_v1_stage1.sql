-- top-targets-v1 Stage 1 (rulings of Nov 13 2026, Q1 + Q4) - Supabase SQL editor: paste -> Run. Idempotent (a second
-- run changes nothing: every backfill step only touches rows whose pinned_until is still empty).
--
-- The Pin = the hand-set priority clamp, renamed. Four columns on the three record tables:
--   pinned_until  when the pin stops lifting the company (the clamp's expiry: 30 days from when it was set)
--   pin_reason    why, <= 140 characters
--   pinned_by     who (a profile; empty for the rows this file fills from the star / hot, which never recorded who)
--   pinned_at     when it was pinned - the Top targets order among pins
-- No weight seed (Q2: no impact component). No column is dropped. Partner tier is not touched (it feeds a KPI).
--
-- Backfill (Q4), read on Nov 13 before writing this - HomeLover is the only workspace with such rows:
--   employers with a DATED priority (priority + priority_set_at) 12 -> pinned as they are: pinned_at = the day it was
--     set, pinned_until = that + 30 days, pinned_by = who set it, reason "priority set <date>"
--   employers starred (is_top) 13 -> reason "was Top": 9 of them are among the 12 above (reason "was Top · priority
--     set <date>", their own expiry kept); the other 4 (Cloudflare, The Peninsula Hotels, Flowserve Corporation, Bass
--     Pro Shops) are pinned from the moment this runs for 30 days
--   partners hot 12 -> reason "was hot", pinned from now for 30 days - except the 2 that also carry a dated priority
--     (ADP TotalSource, MetLife): their own expiry, reason "was hot · priority set <date>"
--   partners with a dated priority and not hot 2 (Sylvia, Norton / Gen Digital) -> pinned as they are
--   targets 0 (they have no priority column; the 5 rows of visit_priority_override are not touched)
-- A priority set between that read and this run is picked up by the same rules - the proof prints what was found.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_opportunities', 'sales_targets', 'sales_goals'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS pinned_until timestamptz,
      ADD COLUMN IF NOT EXISTS pin_reason   text CHECK (pin_reason IS NULL OR length(pin_reason) <= 140),
      ADD COLUMN IF NOT EXISTS pinned_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS pinned_at    timestamptz', t);
  END LOOP;
END $$;

-- 1 employers: a dated priority is the pin as it stands (starred ones say so too)
UPDATE public.sales_opportunities
   SET pinned_at = priority_set_at, pinned_until = priority_set_at + interval '30 days', pinned_by = priority_set_by,
       pin_reason = CASE WHEN is_top THEN 'was Top · ' ELSE '' END || 'priority set ' || to_char(priority_set_at AT TIME ZONE 'America/Los_Angeles', 'Mon FMDD')
 WHERE pinned_until IS NULL AND priority IS NOT NULL AND priority_set_at IS NOT NULL;
-- 2 employers: starred without a dated priority
UPDATE public.sales_opportunities
   SET pinned_at = now(), pinned_until = now() + interval '30 days', pin_reason = 'was Top'
 WHERE pinned_until IS NULL AND is_top = true;
-- 3 partners: a dated priority is the pin as it stands (hot ones say so too)
UPDATE public.sales_goals
   SET pinned_at = priority_set_at, pinned_until = priority_set_at + interval '30 days', pinned_by = priority_set_by,
       pin_reason = CASE WHEN hot THEN 'was hot · ' ELSE '' END || 'priority set ' || to_char(priority_set_at AT TIME ZONE 'America/Los_Angeles', 'Mon FMDD')
 WHERE pinned_until IS NULL AND goal_type = 'partnership' AND priority IS NOT NULL AND priority_set_at IS NOT NULL;
-- 4 partners: hot without a dated priority
UPDATE public.sales_goals
   SET pinned_at = now(), pinned_until = now() + interval '30 days', pin_reason = 'was hot'
 WHERE pinned_until IS NULL AND goal_type = 'partnership' AND hot = true;

-- Proof (expect, as read on Nov 13 - rows 3-8 move only if someone set a priority or a star since):
--   1 pin columns                          12 (4 on each of the 3 tables)
--   2 pin_reason check                     3 tables
--   3 employers pinned                     16 · still running 16
--   4 employers "was Top"                  13 (of 13 starred)
--   5 employers "priority set"             12 (of 12 with a dated priority) · expiry = set + 30 d on all: true
--   6 partners pinned                      14 · still running 14
--   7 partners "was hot"                   12 (of 12 hot)
--   8 partners "priority set"              4 (of 4 with a dated priority) · expiry = set + 30 d on all: true
--   9 targets pinned                       0
--  10 untouched                            partner tier 1 = 24 · employers is_top = 13 · partners hot = 12
--  11 the pinned companies                 (names, for the eye)
SELECT 1 AS n, 'pin columns' AS what, (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('sales_opportunities', 'sales_targets', 'sales_goals') AND column_name IN ('pinned_until', 'pin_reason', 'pinned_by', 'pinned_at'))::text AS det
UNION ALL
SELECT 2, 'pin_reason check', (SELECT count(DISTINCT conrelid) FROM pg_constraint WHERE contype = 'c' AND conrelid IN ('public.sales_opportunities'::regclass, 'public.sales_targets'::regclass, 'public.sales_goals'::regclass) AND pg_get_constraintdef(oid) LIKE '%pin_reason%140%')::text || ' tables'
UNION ALL
SELECT 3, 'employers pinned', (SELECT count(*) FROM public.sales_opportunities WHERE pinned_until IS NOT NULL)::text || ' · still running ' || (SELECT count(*) FROM public.sales_opportunities WHERE pinned_until > now())::text
UNION ALL
SELECT 4, 'employers "was Top"', (SELECT count(*) FROM public.sales_opportunities WHERE pin_reason LIKE 'was Top%')::text || ' (of ' || (SELECT count(*) FROM public.sales_opportunities WHERE is_top)::text || ' starred)'
UNION ALL
SELECT 5, 'employers "priority set"', (SELECT count(*) FROM public.sales_opportunities WHERE pin_reason LIKE '%priority set %')::text || ' (of ' || (SELECT count(*) FROM public.sales_opportunities WHERE priority IS NOT NULL AND priority_set_at IS NOT NULL)::text || ' with a dated priority) · expiry = set + 30 d on all: ' || (SELECT coalesce(bool_and(pinned_until = priority_set_at + interval '30 days'), true) FROM public.sales_opportunities WHERE pin_reason LIKE '%priority set %')::text
UNION ALL
SELECT 6, 'partners pinned', (SELECT count(*) FROM public.sales_goals WHERE pinned_until IS NOT NULL)::text || ' · still running ' || (SELECT count(*) FROM public.sales_goals WHERE pinned_until > now())::text
UNION ALL
SELECT 7, 'partners "was hot"', (SELECT count(*) FROM public.sales_goals WHERE pin_reason LIKE 'was hot%')::text || ' (of ' || (SELECT count(*) FROM public.sales_goals WHERE goal_type = 'partnership' AND hot)::text || ' hot)'
UNION ALL
SELECT 8, 'partners "priority set"', (SELECT count(*) FROM public.sales_goals WHERE pin_reason LIKE '%priority set %')::text || ' (of ' || (SELECT count(*) FROM public.sales_goals WHERE goal_type = 'partnership' AND priority IS NOT NULL AND priority_set_at IS NOT NULL)::text || ' with a dated priority) · expiry = set + 30 d on all: ' || (SELECT coalesce(bool_and(pinned_until = priority_set_at + interval '30 days'), true) FROM public.sales_goals WHERE pin_reason LIKE '%priority set %')::text
UNION ALL
SELECT 9, 'targets pinned', (SELECT count(*) FROM public.sales_targets WHERE pinned_until IS NOT NULL)::text
UNION ALL
SELECT 10, 'untouched', 'partner tier 1 = ' || (SELECT count(*) FROM public.sales_goals WHERE goal_type = 'partnership' AND tier = '1')::text || ' · employers is_top = ' || (SELECT count(*) FROM public.sales_opportunities WHERE is_top)::text || ' · partners hot = ' || (SELECT count(*) FROM public.sales_goals WHERE goal_type = 'partnership' AND hot)::text
UNION ALL
SELECT 11, 'the pinned companies', (SELECT string_agg(x.name || ' [' || x.reason || ', until ' || to_char(x.until AT TIME ZONE 'America/Los_Angeles', 'Mon FMDD') || ']', '; ' ORDER BY x.name) FROM (SELECT organization AS name, pin_reason AS reason, pinned_until AS until FROM public.sales_opportunities WHERE pinned_until IS NOT NULL UNION ALL SELECT name, pin_reason, pinned_until FROM public.sales_goals WHERE pinned_until IS NOT NULL) x)
ORDER BY n;
