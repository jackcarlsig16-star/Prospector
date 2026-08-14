-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- outreach-intelligence-v1, Section 2 — lightweight, directly-editable
-- fields, no generation/auto-regen (deliberately not the strategy_synthesis
-- pattern, which auto-overwrites with no manual-edit protection).

alter table projects
  add column if not exists outreach_prompt text,
  add column if not exists outreach_example text;
