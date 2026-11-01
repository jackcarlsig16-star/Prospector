-- grow-mailbox-link-v1 Stage 2 (Oct 31 2026) - Supabase SQL editor: paste -> Run. Idempotent. No existing row changes.
--
-- hk_job_runs.job CHECK   + 'thread-backfill' (one member's one-time mailbox backfill, L2; its runs carry the resumable
--                         cursor in counts) + 'thread-read' (the capped deal-fact reads, L5; a cron run claims its hour's
--                         cron_slot). Same pattern as grow-inbox-intel-v1b (research-sweep). Must run before Stage 3.
ALTER TABLE public.hk_job_runs DROP CONSTRAINT IF EXISTS hk_job_runs_job_check;
ALTER TABLE public.hk_job_runs ADD CONSTRAINT hk_job_runs_job_check CHECK (job IN ('gmail-sync-all', 'daily-check', 'research-sweep', 'thread-backfill', 'thread-read'));

-- Proof - expect 1 row: hk_job_runs_job_check | CHECK ((job = ANY (ARRAY['gmail-sync-all'::text, 'daily-check'::text, 'research-sweep'::text, 'thread-backfill'::text, 'thread-read'::text])))
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'hk_job_runs_job_check';
