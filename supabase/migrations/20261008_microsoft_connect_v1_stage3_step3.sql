-- microsoft-connect-v1 Stage 3 Step 3 - the daily step (record touches +
-- people, auto-apply Sent / in-thread Replied, never meetings) writes one
-- microsoft_sync_runs row per run under folder 'moves', with its counts and
-- the applied / refused / held moves in a jsonb block (ids and partner
-- names only - the same shape as sales_sync_runs.counts.apollo_moves).
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run

ALTER TABLE public.microsoft_sync_runs DROP CONSTRAINT IF EXISTS microsoft_sync_runs_folder_check;
ALTER TABLE public.microsoft_sync_runs ADD CONSTRAINT microsoft_sync_runs_folder_check
  CHECK (folder IN ('sentitems', 'inbox', 'calendar', 'moves'));
ALTER TABLE public.microsoft_sync_runs ADD COLUMN IF NOT EXISTS counts jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Check: the new folder value is accepted, counts exists, rls still on, 0 policies
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'microsoft_sync_runs_folder_check') AS folder_check,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'microsoft_sync_runs' AND column_name = 'counts') AS has_counts,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'microsoft_sync_runs') AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'microsoft_sync_runs') AS policies;
