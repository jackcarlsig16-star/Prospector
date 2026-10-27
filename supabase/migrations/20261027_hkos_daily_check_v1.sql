-- hkos-daily-check-v1 Stage 1 - the job ledger the two runners (in-process cron behind HK_SCHEDULER=cron, and the
-- page-load fallback) share, plus the quiet-weekends switch. One row per job run; the partial UNIQUE index is what makes
-- "daily-check never runs twice for the same Chicago day" a database fact, not a code promise: a second start the same
-- day (status running / ok / partial) fails the insert, an errored day may retry.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Idempotent (IF NOT EXISTS everywhere).
--
-- hk_job_runs           job gmail-sync-all | daily-check · trigger cron | pageload | manual | test · chicago_day (the
--                       settings-timezone calendar day the run belongs to) · status running | ok | partial | error ·
--                       counts jsonb (numbers only) · digest jsonb (J4 payload: names / domains / summaries, never an
--                       address) · error <= 200 chars · started_by (the member behind a manual run, else NULL).
-- hk_settings           + quiet_weekends boolean NOT NULL DEFAULT true (REVISABLE: J6 Settings > Follow-up timing).

CREATE TABLE IF NOT EXISTS public.hk_job_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job         text NOT NULL CHECK (job IN ('gmail-sync-all', 'daily-check')),
  trigger     text NOT NULL CHECK (trigger IN ('cron', 'pageload', 'manual', 'test')),
  chicago_day date NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'error')),
  counts      jsonb NOT NULL DEFAULT '{}',
  digest      jsonb,
  error       text CHECK (error IS NULL OR length(error) <= 200),
  started_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Once per Chicago day per workspace: running, ok and partial all hold the day; only an error frees it for a retry.
CREATE UNIQUE INDEX IF NOT EXISTS hk_job_runs_daily_check_once ON public.hk_job_runs (business_id, job, chicago_day)
  WHERE job = 'daily-check' AND status <> 'error';
CREATE INDEX IF NOT EXISTS hk_job_runs_business_job_started_idx ON public.hk_job_runs (business_id, job, started_at DESC);

ALTER TABLE public.hk_job_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hk_job_runs FROM anon, authenticated;

ALTER TABLE public.hk_settings ADD COLUMN IF NOT EXISTS quiet_weekends boolean NOT NULL DEFAULT true;

-- Proof - expect 4 rows:
--   "table"  hk_job_runs: rls=true · policies=0 · rows=0 · anon_select=false · auth_select=false
--   "index"  hk_job_runs_daily_check_once: present=true · partial=true
--   "column" hk_settings.quiet_weekends: present=true · default=true
--   "seed"   hk_settings HumanKind: quiet_weekends=true · digest_time=07:30 · digest_days=weekdays · timezone=America/Chicago
SELECT 'table' AS kind, 'hk_job_runs' AS name,
       'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.hk_job_runs'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hk_job_runs') ||
       ' · rows=' || (SELECT count(*) FROM public.hk_job_runs) ||
       ' · anon_select=' || has_table_privilege('anon', 'public.hk_job_runs', 'SELECT') ||
       ' · auth_select=' || has_table_privilege('authenticated', 'public.hk_job_runs', 'SELECT') AS detail
UNION ALL
SELECT 'index', 'hk_job_runs_daily_check_once',
       'present=' || EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'hk_job_runs_daily_check_once') ||
       ' · partial=' || COALESCE((SELECT indexdef LIKE '%WHERE%' FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'hk_job_runs_daily_check_once'), false)
UNION ALL
SELECT 'column', 'hk_settings.quiet_weekends',
       'present=' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_settings' AND column_name = 'quiet_weekends') ||
       ' · default=' || COALESCE((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_settings' AND column_name = 'quiet_weekends'), 'none')
UNION ALL
SELECT 'seed', 'hk_settings HumanKind',
       'quiet_weekends=' || quiet_weekends || ' · digest_time=' || digest_time || ' · digest_days=' || digest_days || ' · timezone=' || timezone
  FROM public.hk_settings WHERE business_id = '981b790c-a3b0-4265-b32e-1f701d5731ff';
