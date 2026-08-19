-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- campaign-layer-v1 follow-up — live audit (node scripts/live-audit.js rls
-- campaigns) found the campaigns table has zero RLS policies, unlike
-- projects (4 permissive anon policies: read/write/update/delete). Per the
-- spec: "do not add new gating for Campaign that doesn't exist for
-- Project; stay consistent with current (lack of) enforcement." Mirrors
-- projects' 4 policies exactly, same permissive-RLS posture as every other
-- CRUD path in this app (src/utils/db.js).
alter table campaigns enable row level security;

create policy anon_read_campaigns on campaigns for select to anon using (true);
create policy anon_write_campaigns on campaigns for insert to anon with check (true);
create policy anon_update_campaigns on campaigns for update to anon using (true) with check (true);
create policy anon_delete_campaigns on campaigns for delete to anon using (true);
