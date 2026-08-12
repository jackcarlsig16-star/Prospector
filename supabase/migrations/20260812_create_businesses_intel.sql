-- Prospector - Create businesses intelligence layer (standalone, separate from projects/HumanKind)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Supersedes the schema from the earlier businesses-layer-and-home-v1 pass
-- (never run against Supabase - safe to fully replace). This tree is still
-- fully independent of projects/project_members/prospects/outreach_drafts
-- and every project_id column on existing tables - none of that is touched.

CREATE TABLE IF NOT EXISTS public.businesses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  website_url     text NOT NULL,
  tagline         text,
  color           text NOT NULL,
  owner_email     text NOT NULL,
  research_status text NOT NULL DEFAULT 'pending', -- 'pending' | 'researching' | 'ready' | 'error'
  research_error  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS businesses_owner_email_idx ON public.businesses (owner_email);

CREATE TABLE IF NOT EXISTS public.business_intel_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  source      text NOT NULL, -- 'manual' | 'research_site' | 'research_web'
  content     text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_intel_entries_business_id_idx ON public.business_intel_entries (business_id);

CREATE TABLE IF NOT EXISTS public.business_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  vision         text,
  positioning    text,
  icp            text,
  gtm_strategy   text,
  competitors    text,
  raw_synthesis  text,
  model_version  text NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.businesses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_intel_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profiles      ENABLE ROW LEVEL SECURITY;

-- 2026-08-12: USING(true) for anon, same deferral rationale as every other
-- table this session - no Supabase Auth session exists in this app yet, so
-- an auth.jwt()-scoped policy would lock the anon-key frontend out entirely.
-- Real enforcement lands with the dedicated Supabase Auth SPEC.
DROP POLICY IF EXISTS "anon_read_businesses"   ON public.businesses;
DROP POLICY IF EXISTS "anon_write_businesses"  ON public.businesses;
DROP POLICY IF EXISTS "anon_update_businesses" ON public.businesses;
DROP POLICY IF EXISTS "anon_delete_businesses" ON public.businesses;
CREATE POLICY "anon_read_businesses"   ON public.businesses FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_businesses"  ON public.businesses FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_businesses" ON public.businesses FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_businesses" ON public.businesses FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "anon_read_business_intel_entries"   ON public.business_intel_entries;
DROP POLICY IF EXISTS "anon_write_business_intel_entries"  ON public.business_intel_entries;
DROP POLICY IF EXISTS "anon_update_business_intel_entries" ON public.business_intel_entries;
DROP POLICY IF EXISTS "anon_delete_business_intel_entries" ON public.business_intel_entries;
CREATE POLICY "anon_read_business_intel_entries"   ON public.business_intel_entries FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_business_intel_entries"  ON public.business_intel_entries FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_business_intel_entries" ON public.business_intel_entries FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_business_intel_entries" ON public.business_intel_entries FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "anon_read_business_profiles"   ON public.business_profiles;
DROP POLICY IF EXISTS "anon_write_business_profiles"  ON public.business_profiles;
DROP POLICY IF EXISTS "anon_update_business_profiles" ON public.business_profiles;
DROP POLICY IF EXISTS "anon_delete_business_profiles" ON public.business_profiles;
CREATE POLICY "anon_read_business_profiles"   ON public.business_profiles FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_business_profiles"  ON public.business_profiles FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_business_profiles" ON public.business_profiles FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_business_profiles" ON public.business_profiles FOR DELETE TO anon USING (true);
