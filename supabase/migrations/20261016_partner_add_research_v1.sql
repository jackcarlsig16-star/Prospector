-- partner-add-research-v1 REV3 Stage 1 - research_runs.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- One row per research run for any company on the Pipeline board, keyed by
-- (entity_type, entity_id): partner = sales_goals.id, employer =
-- sales_opportunities.id, target = sales_targets.id. Rows are written once
-- and never edited except status/result/error as the run finishes and
-- reviewed_at when Jack clicks Use / Dismiss; a re-run is a new row. No FK
-- on entity_id because it points at three tables; the route checks the
-- entity belongs to business_id before inserting. The research itself
-- writes nothing to the partner / employer / target - only a click does.
-- created_by is null for queue runs (Stage 4), which also carry
-- trigger = 'queue'. Token and cost columns mirror business_anthropic_usage
-- so the daily $ cap (Stage 4) can be read from this table alone.
-- Server-only like sales_sync_runs: RLS on, no policies, the API reads it
-- with the service key.

CREATE TABLE IF NOT EXISTS public.research_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  entity_type   text NOT NULL CHECK (entity_type IN ('partner', 'employer', 'target')),
  entity_id     uuid NOT NULL,
  trigger       text NOT NULL CHECK (trigger IN ('manual', 'create', 'queue')),
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
  result        jsonb,
  error         text CHECK (error IS NULL OR length(error) <= 1000),
  model         text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(10, 6),
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz
);
-- Latest run per entity (card, 30-day skip) and the day's runs per
-- workspace (ranToday guard, daily count / $ caps, re-run cap).
CREATE INDEX IF NOT EXISTS research_runs_entity_idx
  ON public.research_runs (business_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_runs_business_created_idx
  ON public.research_runs (business_id, created_at DESC);

ALTER TABLE public.research_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.research_runs FROM anon;

-- Check: 5 rows -
--   research_runs  (15 columns)
--   research_runs  index research_runs_business_created_idx
--   research_runs  index research_runs_entity_idx
--   research_runs  policies 0
--   research_runs  rls true
SELECT 'research_runs' AS tbl, '(' || count(*) || ' columns)' AS item
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'research_runs'
UNION ALL
SELECT tablename, 'index ' || indexname FROM pg_indexes
  WHERE schemaname = 'public' AND indexname IN ('research_runs_entity_idx', 'research_runs_business_created_idx')
UNION ALL
SELECT 'research_runs', 'policies ' || count(*) FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'research_runs'
UNION ALL
SELECT relname, 'rls ' || relrowsecurity::text FROM pg_class
  WHERE relnamespace = 'public'::regnamespace AND relname = 'research_runs'
ORDER BY 1, 2;
