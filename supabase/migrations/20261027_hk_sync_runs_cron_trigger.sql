-- hkos-daily-check-v1 Stage 4 - hk_sync_runs.trigger learns 'cron' so a cron tick's per-mailbox sync rows read what
-- they are (Stage 2 mapped them to 'manual' because the gmail-connect CHECK did not list it). The inline CHECK from
-- 20261026_hkos_gmail_connect_v1.sql carries Postgres' default name hk_sync_runs_trigger_check.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Idempotent. Set HK_SCHEDULER=cron only after this ran.
ALTER TABLE public.hk_sync_runs DROP CONSTRAINT IF EXISTS hk_sync_runs_trigger_check, ADD CONSTRAINT hk_sync_runs_trigger_check CHECK (trigger IN ('cron', 'manual', 'pageload', 'test'));

-- Proof - expect 1 row: hk_sync_runs_trigger_check · CHECK ((trigger = ANY (ARRAY['cron'::text, 'manual'::text, 'pageload'::text, 'test'::text])))
SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public.hk_sync_runs'::regclass AND conname = 'hk_sync_runs_trigger_check';
