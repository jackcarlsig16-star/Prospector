-- sales-analytics-dashboard-v2, Stage 1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- One server-only table: the Partner yes/no tag and the cached per-sequence
-- sender email. RLS enabled, ZERO policies - same posture as the three
-- core-v1 tables (audits/sales-analytics-audit-v1-report.md), not the
-- permissive anon-open pattern most other tables in this schema carry.
-- Every real read/write goes through Express routes using
-- SUPABASE_SERVICE_KEY (api/sales/*); the anon key must see nothing here.
--
-- sequence_id is `text`, not a uuid FK, because it's Apollo's own id
-- (an opaque string from emailer_campaigns/search), not a Prospector
-- table's primary key - there's nothing in this schema to reference.
--
-- sender_email/sender_checked_at are populated by the sender-lookup step
-- in sync.js (Stage 2) - resolved once per sequence from
-- contact_campaign_statuses[].send_email_from_email_address (confirmed via
-- breadcrumbs, audit F3), cached here so steady-state syncs don't repeat
-- the lookup. is_partner is set only via the Stage 2 PUT route, by a human
-- click - the sync never touches it.

create table sales_sequence_tags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sequence_id text not null,
  is_partner boolean not null default false,
  sender_email text,
  sender_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, sequence_id)
);

alter table sales_sequence_tags enable row level security;

-- Self-check - must show relrowsecurity = t. No row means the create table
-- statement above didn't run. Zero policies exist because none were
-- created in this file.
select relname, relrowsecurity
from pg_class
where relname = 'sales_sequence_tags';
