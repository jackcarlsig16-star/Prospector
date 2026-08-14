-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- outreach-intelligence-v1, Section 1 — General Outreach Rules, same cache
-- pattern as assay_criteria: generated once from a pasted document, cached,
-- regenerate-or-edit-manually.

alter table business_profiles
  add column if not exists outreach_rules jsonb,
  add column if not exists outreach_rules_updated_at timestamptz,
  add column if not exists outreach_rules_edited_manually boolean not null default false;
