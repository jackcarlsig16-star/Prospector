-- business-profile-emoji-v1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- One small addition to generateProfile()'s existing synthesis output
-- (same call as motto/industry) - a single emoji representing the
-- business (e.g. a magnet for a magnetics company, a coffee bean for a
-- coffee brand). No edit-manually protection or editing UI for this pass -
-- purely decorative, diff-check-on-write (Fix 4) still applies via the
-- normal candidateValues/field_sources path.
alter table public.business_profiles
  add column if not exists emoji text;
