-- FIX email-simplify-v1 (E2) - the owner's switch for the three funnel tables in the daily visitor email:
-- sales_team_email_settings.funnel_tables, OFF by default. OFF = the email carries the 7-window strip, the tiles and
-- the lists and no funnel table (HTML and text); ON = the tables return above the tiles, under the strip. The funnel
-- route and the Web visitors page do not read this column. The switch changes the next email only - it never fires a
-- send. Until this file has run the code reads the column as OFF and Settings shows no switch. RLS and grants: the
-- table's existing policies apply unchanged (read by the owner's settings route and the email job, written by the owner).

ALTER TABLE public.sales_team_email_settings ADD COLUMN IF NOT EXISTS funnel_tables boolean NOT NULL DEFAULT false;

-- Proof (expected: 1 column=funnel_tables boolean default false · 2 rows=<workspaces with team emails> on=0).
SELECT 1 AS n, 'column' AS what,
       (SELECT column_name || ' ' || data_type || ' default ' || column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_team_email_settings' AND column_name = 'funnel_tables') AS value
UNION ALL
SELECT 2, 'rows', 'rows=' || (SELECT count(*) FROM public.sales_team_email_settings) || ' · on=' || (SELECT count(*) FROM public.sales_team_email_settings WHERE funnel_tables)
ORDER BY n;
