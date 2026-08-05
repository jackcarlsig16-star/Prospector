-- Prospector - Enable RLS on all public tables
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Uses DROP POLICY IF EXISTS before each CREATE so re-runs are safe.
-- Server-side handlers use SUPABASE_SERVICE_KEY which bypasses RLS always.
-- Frontend uses REACT_APP_SUPABASE_ANON_KEY and is subject to these policies.

-- Step 1: Enable RLS on every table
ALTER TABLE public.accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frontier            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bdr_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handoff_intel       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plospect_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sfdc_tokens         ENABLE ROW LEVEL SECURITY;

-- Step 2: sfdc_tokens - NO policies = anon denied entirely (server-only via service key)

-- Step 3: handoff_intel - anon read + insert/update only (no delete from browser)
DROP POLICY IF EXISTS "anon_read_handoff_intel"   ON public.handoff_intel;
DROP POLICY IF EXISTS "anon_write_handoff_intel"  ON public.handoff_intel;
DROP POLICY IF EXISTS "anon_update_handoff_intel" ON public.handoff_intel;
CREATE POLICY "anon_read_handoff_intel"   ON public.handoff_intel FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_handoff_intel"  ON public.handoff_intel FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_handoff_intel" ON public.handoff_intel FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Step 4: team_users - anon read + write (onboarding, approval flow, admin UI)
DROP POLICY IF EXISTS "anon_read_team_users"   ON public.team_users;
DROP POLICY IF EXISTS "anon_write_team_users"  ON public.team_users;
DROP POLICY IF EXISTS "anon_update_team_users" ON public.team_users;
DROP POLICY IF EXISTS "anon_delete_team_users" ON public.team_users;
CREATE POLICY "anon_read_team_users"   ON public.team_users FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_team_users"  ON public.team_users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_team_users" ON public.team_users FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_team_users" ON public.team_users FOR DELETE TO anon USING (true);

-- Step 5: accounts - anon read + write (filtered by owner_email in app code)
DROP POLICY IF EXISTS "anon_read_accounts"   ON public.accounts;
DROP POLICY IF EXISTS "anon_write_accounts"  ON public.accounts;
DROP POLICY IF EXISTS "anon_update_accounts" ON public.accounts;
DROP POLICY IF EXISTS "anon_delete_accounts" ON public.accounts;
CREATE POLICY "anon_read_accounts"   ON public.accounts FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_accounts"  ON public.accounts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_accounts" ON public.accounts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_accounts" ON public.accounts FOR DELETE TO anon USING (true);

-- Step 6: frontier - anon read + write (BDR assignment data)
DROP POLICY IF EXISTS "anon_read_frontier"   ON public.frontier;
DROP POLICY IF EXISTS "anon_write_frontier"  ON public.frontier;
DROP POLICY IF EXISTS "anon_update_frontier" ON public.frontier;
DROP POLICY IF EXISTS "anon_delete_frontier" ON public.frontier;
CREATE POLICY "anon_read_frontier"   ON public.frontier FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_frontier"  ON public.frontier FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_frontier" ON public.frontier FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_frontier" ON public.frontier FOR DELETE TO anon USING (true);

-- Step 7: bdr_assignments - anon read + write
DROP POLICY IF EXISTS "anon_read_bdr_assignments"   ON public.bdr_assignments;
DROP POLICY IF EXISTS "anon_write_bdr_assignments"  ON public.bdr_assignments;
DROP POLICY IF EXISTS "anon_update_bdr_assignments" ON public.bdr_assignments;
DROP POLICY IF EXISTS "anon_delete_bdr_assignments" ON public.bdr_assignments;
CREATE POLICY "anon_read_bdr_assignments"   ON public.bdr_assignments FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_bdr_assignments"  ON public.bdr_assignments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_bdr_assignments" ON public.bdr_assignments FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_bdr_assignments" ON public.bdr_assignments FOR DELETE TO anon USING (true);

-- Step 8: plospect_compliance - anon read + write (frontend + server cron both write)
DROP POLICY IF EXISTS "anon_read_compliance"   ON public.plospect_compliance;
DROP POLICY IF EXISTS "anon_write_compliance"  ON public.plospect_compliance;
DROP POLICY IF EXISTS "anon_update_compliance" ON public.plospect_compliance;
DROP POLICY IF EXISTS "anon_delete_compliance" ON public.plospect_compliance;
CREATE POLICY "anon_read_compliance"   ON public.plospect_compliance FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_compliance"  ON public.plospect_compliance FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_compliance" ON public.plospect_compliance FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_compliance" ON public.plospect_compliance FOR DELETE TO anon USING (true);

-- Grants template for NEW tables after Oct 30, 2026:
--   GRANT USAGE ON SCHEMA public TO anon, authenticated;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.<new_table> TO anon, authenticated;
