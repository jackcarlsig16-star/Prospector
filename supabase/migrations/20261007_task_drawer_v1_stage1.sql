-- task-drawer-v1 Stage 1 - a to-do can link to ONE thing it serves, and
-- carries a due date and who created it.
-- link_type/link_id: commitment (sales_week_goals id), metric (metric key,
-- e.g. partners_first_touched), partner (sales_goals id), company (Apollo
-- account_id from Goals > Companies). link_id is text and not a foreign key
-- because it points at four different things; the API checks it belongs to
-- the workspace. A link never changes metric math.
-- created_by: lets the "delete = creator within 2 min, or Owner/Admin" rule
-- (builds-audit FIX-5) cover plain to-dos, not only flags (flagged_by).
-- No RLS change: the API writes with the service key; s5_read stays.

ALTER TABLE public.sales_week_goals
  ADD COLUMN IF NOT EXISTS link_type  text,
  ADD COLUMN IF NOT EXISTS link_id    text,
  ADD COLUMN IF NOT EXISTS due_date   date,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_link_check CHECK (
    (link_type IS NULL AND link_id IS NULL)
    OR (link_type IN ('commitment', 'metric', 'partner', 'company') AND length(trim(link_id)) > 0)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS sales_week_goals_link_idx
  ON public.sales_week_goals (business_id, link_type, link_id) WHERE link_type IS NOT NULL;

-- Check: 4 rows (created_by uuid, due_date date, link_id text, link_type text)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sales_week_goals'
  AND column_name IN ('link_type', 'link_id', 'due_date', 'created_by')
ORDER BY column_name;
