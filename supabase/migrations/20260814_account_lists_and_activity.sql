-- Prospector - Accounts/Lists/Activity model (accounts-lists-and-activity-model-v1)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Turns list membership from a single FK (accounts.list_id) into a real
-- many-to-many join (account_lists) - a list is an entry point/grouping
-- lens, never ownership, so an account can belong to multiple lists.
-- Live-checked before writing this: only 1 real account exists anywhere in
-- this table today, and it has list_id = null - backfill is a no-op in
-- practice, this is not a risky migration on real data.
--
-- Real ALTER TABLE / DROP COLUMN, not an app-level-only change - the old
-- list_id column goes away for good once backfilled.

CREATE TABLE IF NOT EXISTS public.account_lists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  list_id    uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_lists_account_list_idx ON public.account_lists (account_id, list_id);
CREATE INDEX IF NOT EXISTS account_lists_account_id_idx ON public.account_lists (account_id);
CREATE INDEX IF NOT EXISTS account_lists_list_id_idx ON public.account_lists (list_id);

-- Backfill existing single-list assignments before dropping the column.
INSERT INTO public.account_lists (account_id, list_id, added_at)
SELECT id, list_id, updated_at FROM public.accounts WHERE list_id IS NOT NULL
ON CONFLICT (account_id, list_id) DO NOTHING;

ALTER TABLE public.accounts DROP COLUMN IF EXISTS list_id;

-- Denormalized "last contact" cache - updated by recordAccountActivity(),
-- never computed live on every render.
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS last_touched_by text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS last_touched_at timestamptz;

-- business_intel_entries.created_by already exists and is already populated
-- by the smart-intake flow (confirmed live in Phase 0 audit) - no column
-- needed there.

ALTER TABLE public.account_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_read_account_lists   ON public.account_lists;
DROP POLICY IF EXISTS anon_write_account_lists  ON public.account_lists;
DROP POLICY IF EXISTS anon_update_account_lists ON public.account_lists;
DROP POLICY IF EXISTS anon_delete_account_lists ON public.account_lists;
CREATE POLICY anon_read_account_lists   ON public.account_lists FOR SELECT TO anon USING (true);
CREATE POLICY anon_write_account_lists  ON public.account_lists FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_update_account_lists ON public.account_lists FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_delete_account_lists ON public.account_lists FOR DELETE TO anon USING (true);
