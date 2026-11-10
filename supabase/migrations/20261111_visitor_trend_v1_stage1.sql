-- visitor-trend-v1 Stage 1 (T4) - the owner's weekend switch for the visitor pull and the visitor email:
-- sales_team_email_settings.weekend_on, OFF by default. When ON, jobs.js runs visitor-pull (06:30) and
-- team-visitor-email (07:00) EVERY_DAY instead of Mon-Fri (Monday's window then covers Sunday only). The switch changes
-- the schedule only - it never fires a pull or a send by itself. Stage 0 (2026-11-10) measured 0 Apollo credits on every
-- pull run to date (apollo_credit_spend this month 0 of 500; 4-10 API calls per run), so the copy beside the switch
-- quotes the measured number from visit_pull_runs, never a constant. RLS and grants: the table's existing policies
-- apply unchanged (the column is read by the owner's settings route and the scheduler, written by the owner only).

ALTER TABLE public.sales_team_email_settings ADD COLUMN IF NOT EXISTS weekend_on boolean NOT NULL DEFAULT false;

-- Proof (expected: 1 column=weekend_on boolean default false · 2 rows=<workspaces with team emails> on=0).
SELECT 1 AS n, 'column' AS what,
       (SELECT column_name || ' ' || data_type || ' default ' || column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_team_email_settings' AND column_name = 'weekend_on') AS value
UNION ALL
SELECT 2, 'rows', 'rows=' || (SELECT count(*) FROM public.sales_team_email_settings) || ' · on=' || (SELECT count(*) FROM public.sales_team_email_settings WHERE weekend_on)
ORDER BY n;
