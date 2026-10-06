-- sales-huddle-v2 REVISION 1 Stage 3 - "Flag for ..." hand-offs.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- A flag is a normal Goals to-do (sales_week_goals kind 'todo', category
-- 'Huddle follow-ups') with its checklist as steps, so it shows in Goals ->
-- This week and the weekly report. These columns link it back to the
-- prospect and keep who flagged it and why. No RLS change: sales_week_goals
-- keeps its member-read / member-write policies; the API writes with the
-- service key. prospect_contact_id is not a foreign key on purpose: the
-- prospect row's key is (business_id, contact_id) and a to-do must survive
-- a prospect being removed by a sync.

ALTER TABLE public.sales_week_goals
  ADD COLUMN IF NOT EXISTS prospect_contact_id text,
  ADD COLUMN IF NOT EXISTS flag_note           text,
  ADD COLUMN IF NOT EXISTS flagged_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sales_week_goals_prospect_idx
  ON public.sales_week_goals (business_id, prospect_contact_id) WHERE prospect_contact_id IS NOT NULL;

-- Check: 3 new columns
SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_week_goals'
    AND column_name IN ('prospect_contact_id', 'flag_note', 'flagged_by') ORDER BY column_name;
