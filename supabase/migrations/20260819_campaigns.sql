-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- campaign-layer-v1 — a Campaign is a nested content-grouping entity under
-- a Project: one specific pitch angle to one specific type of recipient
-- within that project. Doctrine layers on top of the project's own
-- guidance (see api/email.js CONTEXT_PROVIDERS); examples fully replace
-- the project's own outreach_examples when a campaign is selected.
--
-- Shape mirrors projects' own outreach_examples/outreach_examples_distilled
-- columns exactly (confirmed via live audit before writing this migration):
-- outreach_examples is a plain ordered jsonb array of strings, distilled is
-- plain text, not jsonb.
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  business_id uuid not null references businesses(id),
  name text not null,
  recipient_description text,
  doctrine text,
  outreach_examples jsonb not null default '[]'::jsonb,
  outreach_examples_distilled text,
  outreach_examples_distilled_at timestamptz,
  outreach_examples_distilled_edited_manually boolean not null default false,
  list_id uuid references lists(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on campaigns(project_id);
