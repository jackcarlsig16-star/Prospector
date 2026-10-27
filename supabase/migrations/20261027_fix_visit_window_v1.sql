-- FIX visit-window-v1 Stage 1 - the visitor pull records the window it covered, and a visit row says which window
-- produced it. Until now every pull asked Apollo for the past 1 day and nothing wrote down what a run covered, so a day
-- with no page load was a hole nobody could see (HomeLover: Oct 14-19, 24-25 have no ok run; the Oct 17 visitors Jack
-- named are in Apollo's 14-day view and absent from web_visits).
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Idempotent (IF NOT EXISTS / IS NULL guards).
--
-- visit_pull_runs  + kind daily | backfill (the unique-per-LA-day index becomes (business_id, la_date, kind), so one
--                    backfill is allowed on top of the daily run) · window_start / window_end (LA dates the run asked
--                    Apollo for) · lookback_days (what website_visitors_from_past was sent). Existing rows: the pull
--                    always sent 1, so window_end = la_date, window_start = la_date - 1, lookback_days = 1.
-- web_visits       + seen_from / seen_to (LA dates of the window that produced the row; first_visit / last_visit stay
--                    Apollo's). Existing rows: seen_from = seen_to = pulled_on (a 1-day window ending that day).

ALTER TABLE public.visit_pull_runs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'daily' CHECK (kind IN ('daily', 'backfill'));
ALTER TABLE public.visit_pull_runs ADD COLUMN IF NOT EXISTS window_start date;
ALTER TABLE public.visit_pull_runs ADD COLUMN IF NOT EXISTS window_end date;
ALTER TABLE public.visit_pull_runs ADD COLUMN IF NOT EXISTS lookback_days int CHECK (lookback_days IS NULL OR lookback_days BETWEEN 1 AND 90);
UPDATE public.visit_pull_runs SET window_end = la_date, window_start = la_date - 1, lookback_days = 1 WHERE window_end IS NULL;
DROP INDEX IF EXISTS public.visit_pull_runs_day_idx;
CREATE UNIQUE INDEX IF NOT EXISTS visit_pull_runs_day_idx ON public.visit_pull_runs (business_id, la_date, kind);

ALTER TABLE public.web_visits ADD COLUMN IF NOT EXISTS seen_from date;
ALTER TABLE public.web_visits ADD COLUMN IF NOT EXISTS seen_to date;
UPDATE public.web_visits SET seen_from = pulled_on, seen_to = pulled_on WHERE seen_from IS NULL OR seen_to IS NULL;
CREATE INDEX IF NOT EXISTS web_visits_seen_to_idx ON public.web_visits (business_id, seen_to);

-- Proof - expect 5 rows:
--   1 visit_pull_runs  columns kind,lookback_days,window_end,window_start    4 of 4
--   2 visit_pull_runs  index visit_pull_runs_day_idx                         (business_id, la_date, kind)
--   3 visit_pull_runs  rows without a window                                 0
--   4 web_visits       columns seen_from,seen_to                             2 of 2
--   5 web_visits       rows without seen_from/seen_to                        0
SELECT 1 AS n, 'visit_pull_runs' AS what, 'columns ' || string_agg(column_name, ',' ORDER BY column_name) AS detail, count(*) || ' of 4' AS expect
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'visit_pull_runs' AND column_name IN ('kind', 'window_start', 'window_end', 'lookback_days')
UNION ALL
SELECT 2, 'visit_pull_runs', 'index visit_pull_runs_day_idx', regexp_replace(indexdef, '^.*USING btree ', '')
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'visit_pull_runs_day_idx'
UNION ALL
SELECT 3, 'visit_pull_runs', 'rows without a window', count(*)::text FROM public.visit_pull_runs WHERE window_end IS NULL OR window_start IS NULL OR lookback_days IS NULL
UNION ALL
SELECT 4, 'web_visits', 'columns ' || string_agg(column_name, ',' ORDER BY column_name), count(*) || ' of 2'
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'web_visits' AND column_name IN ('seen_from', 'seen_to')
UNION ALL
SELECT 5, 'web_visits', 'rows without seen_from/seen_to', count(*)::text FROM public.web_visits WHERE seen_from IS NULL OR seen_to IS NULL
ORDER BY 1;
