-- call-notes-to-tasks-v1 Stage 1 - pasted internal call notes, the to-dos
-- made from them point back at them, and AI calls log who ran them + cost.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- sales_call_notes: the source text, members-only through the API. RLS on
-- with NO policies, so the browser (anon / s5_read) can't read note text at
-- all; the API reads and writes it with the service key.
-- hash: sha256 of the normalised text, so re-pasting the same notes finds
-- the earlier row instead of making a second one.
-- sales_week_goals.source_note_id: the to-do's "from this call" back-link.
-- business_anthropic_usage gains user_id + cost_usd (est. from tokens at
-- list price when logged); older rows stay null.

CREATE TABLE IF NOT EXISTS public.sales_call_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title       text,
  call_date   date NOT NULL,
  text        text NOT NULL CHECK (length(text) BETWEEN 1 AND 200000),
  hash        text NOT NULL,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, hash)
);
ALTER TABLE public.sales_call_notes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sales_week_goals
  ADD COLUMN IF NOT EXISTS source_note_id uuid REFERENCES public.sales_call_notes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_week_goals_source_note_idx
  ON public.sales_week_goals (source_note_id) WHERE source_note_id IS NOT NULL;

ALTER TABLE public.business_anthropic_usage
  ADD COLUMN IF NOT EXISTS user_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_usd numeric(10, 6);

-- Check: 4 rows -
--   business_anthropic_usage cost_usd numeric | business_anthropic_usage user_id uuid
--   sales_call_notes (policies: 0)             | sales_week_goals source_note_id uuid
SELECT table_name, column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND (
  (table_name = 'business_anthropic_usage' AND column_name IN ('user_id', 'cost_usd'))
  OR (table_name = 'sales_week_goals' AND column_name = 'source_note_id'))
UNION ALL
SELECT 'sales_call_notes', 'policies: ' || count(*), '' FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_call_notes'
ORDER BY 1, 2;
