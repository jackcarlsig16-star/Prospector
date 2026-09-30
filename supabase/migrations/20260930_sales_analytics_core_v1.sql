-- sales-analytics-core-v1, Stage 1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Three server-only tables backing the Apollo sync for the HomeLover Sales
-- Analytics dashboard (audit: audits/sales-analytics-audit-v1-report.md).
--
-- RLS is enabled with ZERO policies on all three - the access_log /
-- zoom_webhook_events posture, not the permissive anon-open pattern most
-- other tables in this schema carry. The audit found RLS effectively off
-- (anon qual:"true" for select/insert/update/delete) on 18 of 26 existing
-- tables, because the anon key ships in the public JS bundle - deliberately
-- not repeating that here. Every real read/write goes through Express
-- routes using SUPABASE_SERVICE_KEY (api/sales/*), which bypasses RLS by
-- design; the anon key must see nothing on these three tables.
--
-- sales_sync_runs - one row per sync attempt (cron or manual). A 'running'
-- row older than 15 minutes is treated as a stale lock by the app
-- (guardrail 5) and gets marked 'error'. status defaults to 'running'
-- since a row is inserted the moment a run starts, before any outcome is
-- known.
--
-- sales_raw_snapshots - trimmed raw Apollo payloads per run, per entity
-- (sequences/accounts/prospects/mailboxes - entity is plain text, not a
-- check constraint, since the adapter list in sync.js is meant to grow
-- without a schema change). Indexed for the 180-day retention cleanup and
-- for reading a business's snapshot history.
--
-- sales_metrics_daily - the derived daily metric rows the dashboard reads.
-- dim_type/dim_value let one metric_key carry an 'all' total row plus
-- per-cohort or per-sequence breakdown rows without new columns. The
-- UNIQUE constraint is what makes the daily upsert idempotent. source
-- 'manual'/'derived' aren't written by this SPEC - later SPECs use them
-- without a schema change.

create table sales_sync_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  trigger text not null check (trigger in ('cron', 'manual')),
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_text text,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Supports "GET /api/sales/:businessId/runs?limit=10" (Stage 2) - most
-- recent runs for a business, not explicitly requested in the Stage 1
-- column list but a direct, low-risk match for that named route.
create index on sales_sync_runs(business_id, started_at desc);

create table sales_raw_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  run_id uuid not null references sales_sync_runs(id) on delete cascade,
  entity text not null,
  captured_at timestamptz not null default now(),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index on sales_raw_snapshots(business_id, captured_at);

create table sales_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  metric_date date not null,
  metric_key text not null,
  dim_type text not null default 'all',
  dim_value text not null default 'all',
  value numeric not null,
  source text not null check (source in ('apollo', 'manual', 'derived')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (business_id, metric_date, metric_key, dim_type, dim_value)
);

alter table sales_sync_runs enable row level security;
alter table sales_raw_snapshots enable row level security;
alter table sales_metrics_daily enable row level security;

-- Self-check - all three rows must show relrowsecurity = t. No rows means
-- the create table statements above didn't run. Zero policies exist on any
-- of the three because none were created in this file.
select relname, relrowsecurity
from pg_class
where relname in ('sales_sync_runs', 'sales_raw_snapshots', 'sales_metrics_daily');
