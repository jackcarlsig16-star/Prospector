-- Prospector - Create projects table (top-level container for multi-tenant scoping)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Run this FIRST, before the other 2026-08-05 migrations in this directory
-- (add_project_id_columns, create_prospects_outreach_drafts, backfill_projects_and_seed_partners,
-- enforce_project_id_not_null) - they all reference this table via FK.

CREATE TABLE IF NOT EXISTS public.projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  name       text NOT NULL,
  logo_url   text,
  color      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_owner_email_idx ON public.projects (owner_email);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- 2026-08-05: USING(true) for anon, matching today's actual security posture on every
-- other table in this app (ownership enforced in app code, not at the DB layer). This
-- SPEC originally called for policies keyed on auth.jwt()->>'email', but there is no
-- Supabase Auth session anywhere in this app - the frontend uses only the static anon
-- key, so that claim would always be NULL and would lock the anon-key frontend out of
-- this table entirely. Real per-owner enforcement is coming in a dedicated Supabase
-- Auth SPEC; until then this column exists but isn't yet DB-enforced.
DROP POLICY IF EXISTS "anon_read_projects"   ON public.projects;
DROP POLICY IF EXISTS "anon_write_projects"  ON public.projects;
DROP POLICY IF EXISTS "anon_update_projects" ON public.projects;
DROP POLICY IF EXISTS "anon_delete_projects" ON public.projects;
CREATE POLICY "anon_read_projects"   ON public.projects FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_projects"  ON public.projects FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_projects" ON public.projects FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_projects" ON public.projects FOR DELETE TO anon USING (true);
