-- weekly-funnel-v1 Stage 3 (W7) - the Friday weekly funnel email.
-- 1. sales_team_email_settings.weekly_on: the owner's switch "Weekly funnel email", OFF by default (it ships OFF; the
--    switch changes the next Friday only and never fires a send by itself).
-- 2. sales_team_email_sends.kind: the send log's CHECK admits 'weekly' beside 'visitor' and 'client', so the one send
--    path can log this email as its own kind. The weekly email goes to the visitor email's list (same recipients, same
--    domain rule) - no recipient column is added.
-- Until this file has run the code reads the switch as OFF, Settings shows no weekly card, and a weekly send is refused
-- before anything leaves. RLS and grants: both tables keep what they have (service key only).

ALTER TABLE public.sales_team_email_settings ADD COLUMN IF NOT EXISTS weekly_on boolean NOT NULL DEFAULT false;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.sales_team_email_sends'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%visitor%'
  LOOP EXECUTE format('ALTER TABLE public.sales_team_email_sends DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE public.sales_team_email_sends ADD CONSTRAINT sales_team_email_sends_kind_check CHECK (kind IN ('visitor', 'client', 'weekly'));

-- Proof (expected: 1 column = weekly_on boolean default false · 2 kind check allows weekly = true · 3 rows=<n> · on=0).
SELECT 1 AS n, 'column' AS what,
       (SELECT column_name || ' ' || data_type || ' default ' || column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_team_email_settings' AND column_name = 'weekly_on') AS value
UNION ALL
SELECT 2, 'kind check allows weekly', (SELECT (pg_get_constraintdef(oid) LIKE '%weekly%')::text FROM pg_constraint WHERE conname = 'sales_team_email_sends_kind_check')
UNION ALL
SELECT 3, 'rows', 'rows=' || (SELECT count(*) FROM public.sales_team_email_settings) || ' · on=' || (SELECT count(*) FROM public.sales_team_email_settings WHERE weekly_on)
ORDER BY n;
