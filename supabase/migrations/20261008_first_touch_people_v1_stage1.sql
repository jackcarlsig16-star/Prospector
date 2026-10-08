-- first-touch-people-v1 Stage 1 - a unit on the first-touched goal.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Jack's 100 is people (first-touch emails), not partners. The goal row
-- stays on metric_key 'partners_first_touched' and gets a unit the card
-- reads: 'people' | 'partners'. NULL reads as people in the app, so there
-- is no column default (a default would also land on every other
-- metric's rows, where the unit means nothing). Only meaningful on the
-- first-touched key; the constraint keeps it off the others.
-- Data fix: HomeLover's one existing first-touched goal (week 2026-10-05,
-- goal 100) -> people.

ALTER TABLE public.sales_metric_targets
  ADD COLUMN IF NOT EXISTS unit text;

DO $$ BEGIN
  ALTER TABLE public.sales_metric_targets ADD CONSTRAINT sales_metric_targets_unit_check
    CHECK (unit IS NULL OR (metric_key = 'partners_first_touched' AND unit IN ('people', 'partners')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.sales_metric_targets
   SET unit = 'people'
 WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95'
   AND metric_key = 'partners_first_touched'
   AND unit IS NULL;

-- Check: one row, unit 'people', goal 100, period_start 2026-10-05
SELECT period_start, metric_key, goal, unit FROM public.sales_metric_targets
 WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND metric_key = 'partners_first_touched';
