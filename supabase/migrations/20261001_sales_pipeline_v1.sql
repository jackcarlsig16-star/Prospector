-- sales-pipeline-v1, Stage 1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Two tables: sales_opportunities (the pipeline itself) and
-- sales_opportunity_events (append-only stage history, written by a DB
-- trigger so it can't be skipped by the app). business_id, not tenant_id -
-- the real column name every other sales_* table in this schema uses
-- (sales_sync_runs/sales_raw_snapshots/sales_metrics_daily/
-- sales_sequence_tags). RLS enabled, ZERO policies - same posture as
-- those tables, not the permissive anon-open pattern most of the rest of
-- this schema carries. Every real read/write goes through Express routes
-- using SUPABASE_SERVICE_KEY.
--
-- org_type uses the same vocabulary as sales_sequence_tags.audience
-- (employer|membership|channel_partner), shipped in sales-sequence-
-- motion-v1 - sequences and pipeline opportunities share one vocabulary,
-- per the SPEC.
--
-- Partial unique index on (business_id, lower(organization)) excluding
-- archived rows - what Stage 2's CSV upsert-by-organization-name needs a
-- real unique target for, and archiving an opportunity frees its name for
-- reuse (a new deal with the same org name later isn't blocked). REVISABLE
-- interpretation, not explicit in the SPEC text - flagged in the report.

create table sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  organization text not null,
  cohort text,
  org_type text not null default 'employer' check (org_type in ('employer', 'membership', 'channel_partner')),
  covered_lives int,
  stage text not null default 'target' check (stage in (
    'target', 'contacted', 'responded', 'meeting', 'proposal_pilot', 'verbal', 'contract', 'launched', 'lost'
  )),
  probability numeric, -- null = use the stage default (defined in app code, not the DB)
  est_value numeric,
  owner text,
  next_action text,
  next_action_date date,
  expected_close date,
  expected_launch date,
  decision_makers text,
  champion text,
  objections text,
  competitors text,
  needed_to_advance text,
  notes text,
  is_top boolean not null default false,
  lost_reason text,
  source text not null default 'manual' check (source in ('manual', 'csv')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sales_opportunities_business_org_idx
  on sales_opportunities (business_id, lower(organization))
  where archived_at is null;

alter table sales_opportunities enable row level security;

create table sales_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  opportunity_id uuid not null references sales_opportunities(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'stage_change', 'archived')),
  from_stage text,
  to_stage text,
  changed_at timestamptz not null default now()
);

alter table sales_opportunity_events enable row level security;

-- Logs every insert/update to sales_opportunities as an event - the app
-- never writes to sales_opportunity_events directly, so history can't be
-- skipped by a code path that forgets to log it.
create or replace function sales_opportunities_log_event() returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    insert into sales_opportunity_events (business_id, opportunity_id, event_type, from_stage, to_stage)
    values (new.business_id, new.id, 'created', null, new.stage);
  elsif TG_OP = 'UPDATE' then
    if new.archived_at is not null and old.archived_at is null then
      insert into sales_opportunity_events (business_id, opportunity_id, event_type, from_stage, to_stage)
      values (new.business_id, new.id, 'archived', old.stage, new.stage);
    elsif new.stage is distinct from old.stage then
      insert into sales_opportunity_events (business_id, opportunity_id, event_type, from_stage, to_stage)
      values (new.business_id, new.id, 'stage_change', old.stage, new.stage);
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger sales_opportunities_log_event_trigger
  after insert or update on sales_opportunities
  for each row execute function sales_opportunities_log_event();

-- Self-check - both rows must show relrowsecurity = t, and the trigger
-- must appear attached to sales_opportunities.
select relname, relrowsecurity
from pg_class
where relname in ('sales_opportunities', 'sales_opportunity_events');

select tgname, tgrelid::regclass
from pg_trigger
where tgname = 'sales_opportunities_log_event_trigger';
