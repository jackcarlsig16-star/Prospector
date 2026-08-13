-- Prospector - Allow anon read/write on accounts (business-workspace-v1)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- accounts never got the same anon RLS policies that projects/businesses
-- have. RLS is enabled but no INSERT policy exists for anon, so every
-- browser-side save (both the legacy owner_email-keyed path and the new
-- business_id-scoped path) has been silently rejected with 42501 - caught
-- and console.warn'd, never surfaced to the UI. Same permissive posture as
-- every other table in this app (ownership enforced in app code, not at
-- the DB layer, until real Supabase Auth lands).

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_accounts   ON public.accounts;
DROP POLICY IF EXISTS anon_write_accounts  ON public.accounts;
DROP POLICY IF EXISTS anon_update_accounts ON public.accounts;
DROP POLICY IF EXISTS anon_delete_accounts ON public.accounts;
CREATE POLICY anon_read_accounts   ON public.accounts FOR SELECT TO anon USING (true);
CREATE POLICY anon_write_accounts  ON public.accounts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_update_accounts ON public.accounts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_delete_accounts ON public.accounts FOR DELETE TO anon USING (true);
