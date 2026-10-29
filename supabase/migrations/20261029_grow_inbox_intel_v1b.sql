-- grow-inbox-intel-v1 REV3 Stage 2 follow-up (M2) - hk_job_runs.job also allows 'research-sweep'. Stage 1 missed it:
-- the table's CHECK (20261027_hkos_daily_check_v1.sql) lists only 'gmail-sync-all' and 'daily-check', so the sweep's
-- run row would be refused (and with it the sweep, before any Claude call).
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste the whole file -> Run. Re-runnable.

ALTER TABLE public.hk_job_runs DROP CONSTRAINT IF EXISTS hk_job_runs_job_check;
ALTER TABLE public.hk_job_runs ADD CONSTRAINT hk_job_runs_job_check CHECK (job IN ('gmail-sync-all', 'daily-check', 'research-sweep'));

-- Proof - expect 1 row: hk_job_runs_job_check | CHECK ((job = ANY (ARRAY['gmail-sync-all'::text, 'daily-check'::text, 'research-sweep'::text])))
SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'public.hk_job_runs'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%job%';
