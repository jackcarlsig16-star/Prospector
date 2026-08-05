-- Prospector - Create project_members table (real team membership per project)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Run this BEFORE 20260805_backfill_project_members.sql.
-- Depends on the projects table from projects-layer-and-scoping-v1
-- (supabase/migrations/20260805_create_projects.sql) already existing.

CREATE TABLE IF NOT EXISTS public.project_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_email  text NOT NULL,
  role        text NOT NULL DEFAULT 'member', -- 'owner' | 'member'
  invited_at  timestamptz DEFAULT now(),
  accepted_at timestamptz, -- null until real login/acceptance exists (no such signal today - see 2026-08-05 handoff)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_email)
);
CREATE INDEX IF NOT EXISTS project_members_user_email_idx ON public.project_members (user_email);

-- Not explicitly listed in this SPEC's Task 5 table list, but every other table in
-- this app has RLS enabled - leaving a brand-new table without it would be a bigger
-- gap than the one already accepted. Same USING(true) posture as everything else:
-- there is no Supabase Auth session in this app (confirmed again this SPEC), and
-- app-level "email" itself is self-reported/unverified (see 2026-08-05 handoff on
-- Task 1 findings), so membership-scoped enforcement isn't meaningful yet regardless
-- of the auth layer. Deferred to the same future Supabase Auth SPEC as everything else.
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_project_members"   ON public.project_members;
DROP POLICY IF EXISTS "anon_write_project_members"  ON public.project_members;
DROP POLICY IF EXISTS "anon_update_project_members" ON public.project_members;
DROP POLICY IF EXISTS "anon_delete_project_members" ON public.project_members;
CREATE POLICY "anon_read_project_members"   ON public.project_members FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_project_members"  ON public.project_members FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_project_members" ON public.project_members FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_project_members" ON public.project_members FOR DELETE TO anon USING (true);
