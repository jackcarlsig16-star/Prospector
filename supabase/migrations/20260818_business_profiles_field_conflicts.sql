-- business-intel-smart-upload-v1, Fix 4 follow-up
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Discovered mid-implementation, not in the original Fix 1 migration:
-- Section 5's diff-on-conflict banner ("New intel conflicts with 1 manual
-- edit - Review") needs somewhere to persist the freshly-resynthesized
-- candidate value that generateProfile() is deliberately NOT writing over a
-- user-edited field, so the UI has something real to show instead of
-- silently dropping it. jsonb, keyed by field name, same convention as
-- field_sources:
--   { "core_problem": { "candidate_value": "...", "candidate_sources": [...], "detected_at": "..." } }
alter table public.business_profiles
  add column if not exists field_conflicts jsonb;
