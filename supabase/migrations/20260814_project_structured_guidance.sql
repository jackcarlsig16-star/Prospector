-- Prospector - structured project guidance (project-guidance-and-creation-flow-v1)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Replaces the free-text outreach_prompt field with structured fields that
-- map directly onto the generation prompt (objective/target_type/ask_type/
-- project_hook/exclusions), same rationale as assay_criteria/outreach_rules
-- being structured jsonb instead of free text on business_profiles.
--
-- outreach_prompt is left in place, untouched and unread by the new
-- generation path (confirmed live pre-migration: 0/4 existing projects had
-- it populated, so there is nothing to backfill or lose). outreach_example
-- is unchanged and stays the active consumer field for tone/style.

alter table projects
  add column if not exists objective text,
  add column if not exists target_type text,
  add column if not exists ask_type text,
  add column if not exists project_hook text,
  add column if not exists exclusions text,
  add column if not exists guidance_updated_at timestamptz;
