-- weekly-plan-v1 Stage 1 - "Plan this week" -> Focus 5.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- sales_week_plans: one row per propose-and-save (prompt, the compact context
-- that was sent, the validated proposals). Re-planning mid-week adds a row,
-- never edits one. inputs holds names, stages, dates, counts and ids only -
-- no contact emails or phone numbers.
-- sales_week_goals.plan_id / plan_rank / plan_reason mark a commitment or
-- to-do as planned; everything else about the row is an ordinary week goal.
-- RLS: members read (s5_read). No write policy - the API writes with the
-- service key, same as every Goals table since builds-audit FIX-1.

CREATE TABLE IF NOT EXISTS public.sales_week_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  week_start    date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  prompt        text NOT NULL DEFAULT '',
  inputs        jsonb NOT NULL,
  proposals     jsonb NOT NULL,
  chosen_count  int NOT NULL DEFAULT 0,
  model         text,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_week_plans_week_owner_idx
  ON public.sales_week_plans (business_id, week_start, owner_user_id);

ALTER TABLE public.sales_week_goals
  ADD COLUMN IF NOT EXISTS plan_id     uuid REFERENCES public.sales_week_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_rank   int,
  ADD COLUMN IF NOT EXISTS plan_reason text;

ALTER TABLE public.sales_week_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_week_plans;
CREATE POLICY s5_read ON public.sales_week_plans FOR SELECT TO authenticated USING (public.is_member(business_id));

-- Check: 5 rows -
--   sales_week_goals  plan_id     uuid
--   sales_week_goals  plan_rank   integer
--   sales_week_goals  plan_reason text
--   sales_week_plans  (11 columns)
--   sales_week_plans  policy s5_read SELECT (the only policy)
SELECT 'sales_week_goals' AS tbl, column_name AS item, data_type AS detail FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_week_goals' AND column_name IN ('plan_id', 'plan_rank', 'plan_reason')
UNION ALL
SELECT 'sales_week_plans', '(' || count(*) || ' columns)', '' FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_week_plans'
UNION ALL
SELECT tablename, 'policy ' || policyname, cmd FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'sales_week_plans'
ORDER BY 1, 2;
