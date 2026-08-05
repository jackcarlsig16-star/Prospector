-- Prospector - Create prospects and outreach_drafts tables (HumanKind outreach CRM)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Run this AFTER 20260805_create_projects.sql, BEFORE
-- 20260805_backfill_projects_and_seed_partners.sql (which seeds 13 founding
-- partners into prospects).
--
-- Supersedes the old humankind-outreach-schema-v1 spec - these two tables are
-- project-scoped from the start instead of being retrofitted later.

CREATE TABLE IF NOT EXISTS public.prospects (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_email            text NOT NULL,
  name                   text NOT NULL,
  name_normalized        text NOT NULL,
  category               text, -- 'business_sponsor' | 'individual_creator' | 'non_profit' | 'press' | 'podcast'
  website                text,
  contact_name           text,
  contact_email          text,
  source_list            text,
  status                 text NOT NULL DEFAULT 'not_contacted',
  -- 'not_contacted' | 'drafted_not_sent' | 'sent' | 'follow_up_1_sent' | 'follow_up_2_sent'
  -- | 'replied' | 'meeting_set' | 'confirmed_partner' | 'declined' | 'dead'
  is_founding_partner    boolean NOT NULL DEFAULT false,
  enrichment_notes       text,
  challenge_reward_idea  text,
  ask_type               text,
  personal_hook          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospects_project_id_idx ON public.prospects (project_id);
CREATE INDEX IF NOT EXISTS prospects_status_idx ON public.prospects (status);

CREATE TABLE IF NOT EXISTS public.outreach_drafts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id        uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_email        text NOT NULL,
  card_type          text NOT NULL, -- 'cold_email' | 'follow_up_1' | 'follow_up_2' | 'linkedin' | 'contact_form' | 'dm_single'
  voice_style        text,
  subject            text,
  body               text NOT NULL,
  sequence_position  int,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outreach_drafts_prospect_id_idx ON public.outreach_drafts (prospect_id);
CREATE INDEX IF NOT EXISTS outreach_drafts_project_id_idx ON public.outreach_drafts (project_id);

ALTER TABLE public.prospects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_drafts ENABLE ROW LEVEL SECURITY;

-- 2026-08-05: USING(true) for anon, matching today's actual security posture (see
-- 20260805_create_projects.sql for the full explanation - no Supabase Auth session
-- exists in this app yet, so an auth.jwt()-scoped policy would lock the anon-key
-- frontend out entirely). Real enforcement lands with the dedicated Supabase Auth SPEC.
DROP POLICY IF EXISTS "anon_read_prospects"   ON public.prospects;
DROP POLICY IF EXISTS "anon_write_prospects"  ON public.prospects;
DROP POLICY IF EXISTS "anon_update_prospects" ON public.prospects;
DROP POLICY IF EXISTS "anon_delete_prospects" ON public.prospects;
CREATE POLICY "anon_read_prospects"   ON public.prospects FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_prospects"  ON public.prospects FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_prospects" ON public.prospects FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_prospects" ON public.prospects FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "anon_read_outreach_drafts"   ON public.outreach_drafts;
DROP POLICY IF EXISTS "anon_write_outreach_drafts"  ON public.outreach_drafts;
DROP POLICY IF EXISTS "anon_update_outreach_drafts" ON public.outreach_drafts;
DROP POLICY IF EXISTS "anon_delete_outreach_drafts" ON public.outreach_drafts;
CREATE POLICY "anon_read_outreach_drafts"   ON public.outreach_drafts FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_outreach_drafts"  ON public.outreach_drafts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_outreach_drafts" ON public.outreach_drafts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_outreach_drafts" ON public.outreach_drafts FOR DELETE TO anon USING (true);
