-- call-notes-targets-v1 REV5 Stage 4 - waiting-on, next meeting, stored extract.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- M1 sales_week_goals: a 'waiting' row is something THEY owe us - waiting_on is
--    the counterpart's name as written (never an email or phone), owner_user_id
--    stays NULL. The kind CHECK is dropped and re-added widened (same name).
-- M2 sales_goals.next_meeting_at: the partner's Due on the Pipeline board.
-- M3 sales_call_notes.extract: the model's scrubbed structured result, written
--    at extract time so audits can compare what the model said with what
--    Accept wrote.
-- Decisions and terms need no migration (partner note events with
-- meta.kind = 'decision'; terms appended to sales_goals.notes).
-- RLS unchanged: all three are existing tables.

ALTER TABLE public.sales_week_goals ADD COLUMN IF NOT EXISTS waiting_on text;
ALTER TABLE public.sales_week_goals DROP CONSTRAINT IF EXISTS sales_week_goals_waiting_on_check;
ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_waiting_on_check
  CHECK (waiting_on IS NULL OR length(waiting_on) <= 120);
ALTER TABLE public.sales_week_goals DROP CONSTRAINT IF EXISTS sales_week_goals_kind_check;
ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_kind_check
  CHECK (kind IN ('commitment', 'todo', 'waiting'));

ALTER TABLE public.sales_goals ADD COLUMN IF NOT EXISTS next_meeting_at date;

ALTER TABLE public.sales_call_notes ADD COLUMN IF NOT EXISTS extract jsonb;

-- Check: 6 rows -
--   sales_call_notes  column extract                      jsonb
--   sales_goals       column next_meeting_at              date
--   sales_week_goals  check sales_week_goals_kind_check        CHECK ((kind = ANY (ARRAY['commitment'::text, 'todo'::text, 'waiting'::text])))
--   sales_week_goals  check sales_week_goals_waiting_on_check  CHECK (((waiting_on IS NULL) OR (length(waiting_on) <= 120)))
--   sales_week_goals  column waiting_on                   text
--   sales_week_goals  kind checks                          1
SELECT table_name AS tbl, 'column ' || column_name AS item, data_type AS detail
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (table_name, column_name) IN (('sales_week_goals', 'waiting_on'), ('sales_goals', 'next_meeting_at'), ('sales_call_notes', 'extract'))
UNION ALL
SELECT conrelid::regclass::text, 'check ' || conname, pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conrelid = 'public.sales_week_goals'::regclass
    AND conname IN ('sales_week_goals_kind_check', 'sales_week_goals_waiting_on_check')
UNION ALL
SELECT 'sales_week_goals', 'kind checks', count(*)::text FROM pg_constraint
  WHERE conrelid = 'public.sales_week_goals'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%'
ORDER BY 1, 2;
