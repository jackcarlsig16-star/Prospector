-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- outreach-intelligence-v1, Section 0a — voice profiles today live only in
-- localStorage (prospector_voice_profile_${name}), invisible to any
-- server-side flow. This table makes them queryable server-side so bulk
-- outreach generation can pull the running user's own voice by email.

create table if not exists voice_profiles (
  id uuid primary key default gen_random_uuid(),
  user_email text not null unique,
  profile jsonb not null,
  learned_at timestamptz,
  email_count integer,
  teach_count integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
