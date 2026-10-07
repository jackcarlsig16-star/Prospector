-- sales-partners-workflow-v1 Stage 1 - the team's manual partner order.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- sort_rank orders partners inside their category group (lower = higher up;
-- null = not placed by hand, sorts after placed rows by priority / hot /
-- tier / name). One shared order per workspace. Written only by the API
-- (POST /api/sales/:businessId/goals/partners/:id/rank, service key);
-- sales_goals has no browser write policy since builds-audit FIX-1, so
-- nothing else is needed for access.

ALTER TABLE public.sales_goals ADD COLUMN IF NOT EXISTS sort_rank numeric;

-- Check: one row, data_type numeric
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_goals' AND column_name = 'sort_rank';
