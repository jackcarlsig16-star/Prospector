-- FIX people-apollo-visibility-v1 F3b - the daily first-load Apollo sync runs with trigger 'pageload'
-- (api/sales/sync.js runPageloadSync). The live CHECK allows only cron | manual | test (probed 2026-10-23:
-- an insert with 'pageload' failed 23514). Adds 'pageload'; existing rows are untouched.

alter table sales_sync_runs drop constraint if exists sales_sync_runs_trigger_check;

alter table sales_sync_runs
  add constraint sales_sync_runs_trigger_check
  check (trigger in ('cron', 'manual', 'test', 'pageload'));

-- Self-check - must show the definition including 'pageload'.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'sales_sync_runs'::regclass
  and conname = 'sales_sync_runs_trigger_check';
