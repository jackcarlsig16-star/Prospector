-- FIX loop-quickfixes-v1 REV2 Q5: Tidy writes its run row first ('running')
-- and updates it to ok | error after, so a run that dies midway still leaves
-- a row the coming sync-status box can show. The check only allowed ok | error
-- (probed live 2026-10-21: a 'running' insert fails with 23514).
ALTER TABLE public.sales_tidy_runs DROP CONSTRAINT IF EXISTS sales_tidy_runs_status_check;
ALTER TABLE public.sales_tidy_runs ADD CONSTRAINT sales_tidy_runs_status_check CHECK (status IN ('running', 'ok', 'error'));

-- Self-check: one row, its definition lists running, ok and error.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.sales_tidy_runs'::regclass AND contype = 'c' AND conname = 'sales_tidy_runs_status_check';
