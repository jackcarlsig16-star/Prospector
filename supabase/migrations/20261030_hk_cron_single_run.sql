-- FIX hk-cron-single-run Stage 1 (Oct 30 2026) - Supabase SQL editor: paste -> Run. Idempotent. No existing row changes.
--
-- hk_job_runs.cron_slot   NEW. text, NULL. Set only by trigger 'cron': gmail-sync-all -> Chicago 'YYYY-MM-DD HH',
--                         research-sweep / daily-check -> Chicago 'YYYY-MM-DD'. Page-load / manual / test rows stay NULL.
-- hk_job_runs_cron_slot_once  NEW partial UNIQUE index (business_id, job, cron_slot) WHERE cron_slot IS NOT NULL AND
--                         status <> 'error': when two server processes fire the same tick, the second run-row insert
--                         fails and that process skips the job. An errored slot frees it for a retry. Existing rows
--                         (cron_slot NULL, incl. the two 2:00 PM gmail-sync-all rows) are outside the index.
ALTER TABLE public.hk_job_runs ADD COLUMN IF NOT EXISTS cron_slot text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hk_job_runs_cron_slot_once ON public.hk_job_runs (business_id, job, cron_slot)
  WHERE cron_slot IS NOT NULL AND status <> 'error';

-- Proof (expect):
--   1 cron_slot   text, nullable=YES
--   2 index       CREATE UNIQUE INDEX hk_job_runs_cron_slot_once ON public.hk_job_runs USING btree (business_id, job, cron_slot) WHERE ((cron_slot IS NOT NULL) AND (status <> 'error'::text))
--   3 rows        n rows, n with cron_slot NULL
SELECT 1 AS n, 'cron_slot' AS what, coalesce((SELECT data_type || ', nullable=' || is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_job_runs' AND column_name = 'cron_slot'), 'MISSING') AS detail
UNION ALL
SELECT 2, 'index', coalesce((SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'hk_job_runs_cron_slot_once'), 'MISSING')
UNION ALL
SELECT 3, 'rows', (SELECT count(*) || ' rows, ' || count(*) FILTER (WHERE cron_slot IS NULL) || ' with cron_slot NULL' FROM public.hk_job_runs);
