-- Prospector - plospect_compliance RLS fix
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Same bug class as voice_profiles (20260814_voice_profiles_rls.sql):
-- RLS enabled, zero policies, silently rejecting every browser-side write.
-- Confirmed live via anon-key probe insert: 42501 "new row violates row-
-- level security policy". saveComplianceToDb (src/utils/db.js) is the real
-- write path for compliance-step tracking - every save has been silently
-- failing. Same standard anon-permissive posture as every other table in
-- this schema (projects, business_profiles, accounts, voice_profiles).

create policy anon_read_plospect_compliance on plospect_compliance
  for select to anon using (true);

create policy anon_write_plospect_compliance on plospect_compliance
  for insert to anon with check (true);

create policy anon_update_plospect_compliance on plospect_compliance
  for update to anon using (true) with check (true);

create policy anon_delete_plospect_compliance on plospect_compliance
  for delete to anon using (true);
