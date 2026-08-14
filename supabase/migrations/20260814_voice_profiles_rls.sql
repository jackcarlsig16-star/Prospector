-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- outreach-intelligence-v1, Section 0a follow-up — voice_profiles was
-- created with RLS enabled and zero policies, silently rejecting every
-- browser-side write (confirmed live via anon-key test: 42501 "new row
-- violates row-level security policy"). Matches the standard anon policy
-- set already present on every other table in this schema (projects,
-- business_profiles, accounts, etc) — app-level enforcement only, same
-- permissive posture as the rest of the app.

create policy anon_read_voice_profiles on voice_profiles
  for select to anon using (true);

create policy anon_write_voice_profiles on voice_profiles
  for insert to anon with check (true);

create policy anon_update_voice_profiles on voice_profiles
  for update to anon using (true) with check (true);

create policy anon_delete_voice_profiles on voice_profiles
  for delete to anon using (true);
