-- Prospector - Enforce project_id NOT NULL on backfilled tables
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Run this LAST, after 20260805_backfill_projects_and_seed_partners.sql has
-- completed and you've confirmed the backfill covered every row.
--
-- Run the verification query first. If any row shows a count > 0, STOP - do not
-- run the ALTER TABLE statements below. Report back which table/rows are still
-- NULL instead of forcing it.

SELECT 'accounts' AS table_name, count(*) FROM public.accounts WHERE project_id IS NULL
UNION ALL
SELECT 'team_users', count(*) FROM public.team_users WHERE project_id IS NULL
UNION ALL
SELECT 'frontier', count(*) FROM public.frontier WHERE project_id IS NULL
UNION ALL
SELECT 'bdr_assignments', count(*) FROM public.bdr_assignments WHERE project_id IS NULL
UNION ALL
SELECT 'handoff_intel', count(*) FROM public.handoff_intel WHERE project_id IS NULL;

-- Only run the ALTERs below once every count above is 0.
ALTER TABLE public.accounts        ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.team_users      ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.frontier        ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.bdr_assignments ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.handoff_intel   ALTER COLUMN project_id SET NOT NULL;

-- sfdc_tokens.project_id intentionally stays nullable (singleton row, no per-owner
-- concept - see 20260805_add_project_id_columns.sql). Not included above.
-- plospect_compliance has no project_id column at all (inherits scope via
-- acc_id -> accounts.id - see 20260805_add_project_id_columns.sql). Not included above.
