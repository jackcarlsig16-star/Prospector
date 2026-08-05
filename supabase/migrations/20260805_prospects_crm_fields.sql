-- Prospector - Add CRM fields to prospects + supporting indexes
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Depends on the prospects table from projects-layer-and-scoping-v1
-- (supabase/migrations/20260805_create_prospects_outreach_drafts.sql) already existing.

-- sponsor_type tracks sponsor-relationship tier and is independent of `status`
-- (which tracks outreach-sequence stage). A row can be status='replied' and
-- sponsor_type='live' at the same time - these are not derived from each other.
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS sponsor_type text; -- 'prospective' | 'live' | 'former' | null
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS assigned_to  text; -- email of responsible team member, matches project_members.user_email

UPDATE public.prospects
SET sponsor_type = 'live'
WHERE is_founding_partner = true AND sponsor_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_prospects_project_assigned     ON public.prospects (project_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_prospects_project_sponsor_type ON public.prospects (project_id, sponsor_type);
CREATE INDEX IF NOT EXISTS idx_prospects_name_normalized      ON public.prospects (name_normalized);
