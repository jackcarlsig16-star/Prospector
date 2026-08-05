-- Prospector — Approved Users
-- Replaces the hardcoded WHITELISTED_EMAILS array in src/utils/invites.js.
-- Rows in this table whose `auto_approve = true` are auto-approved at onboarding
-- without admin review. Other approved emails (auto_approve = false) must still
-- be manually flipped via the admin Pending Users panel.
--
-- Run this in the Supabase SQL editor or psql against the project DB.

create table if not exists approved_users (
  email        text primary key,
  auto_approve boolean not null default true,
  role         text,
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   text
);

-- Seed with your own approved emails
insert into approved_users (email, auto_approve, role, created_by) values
  ('jackcarlsig16@gmail.com', true, 'Admin', 'seed')
on conflict (email) do nothing;

-- Read policy: anyone authenticated can read (or anon if you want OAuth-less reads)
-- Adjust based on your existing RLS posture.
alter table approved_users enable row level security;

drop policy if exists "approved_users_read" on approved_users;
create policy "approved_users_read"
  on approved_users for select
  using (true);

-- Write policy: only authenticated admins. Tighten to match your existing pattern.
drop policy if exists "approved_users_admin_write" on approved_users;
create policy "approved_users_admin_write"
  on approved_users for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
