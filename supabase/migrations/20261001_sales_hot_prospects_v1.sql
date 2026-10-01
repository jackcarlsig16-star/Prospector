-- sales-hot-prospects-v1, Stage 2
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- business_id, not tenant_id - the real column name every other sales_*
-- table uses. RLS enabled, ZERO policies - same posture as the other
-- sales_* tables; every read/write goes through Express routes using
-- SUPABASE_SERVICE_KEY.
--
-- sales_email_messages is a sixth table beyond the SPEC's five: one row per
-- Apollo message with a signal, holding the per-message summary Apollo
-- returns (num_opens, last_opened_at, ...) that the Stage 1 scoring
-- decision reads directly, plus activities_fetched_at, which drives which
-- messages the per-run activities budget is spent on. Reply/bounce flags
-- that Apollo gives without an event timestamp live here (replied,
-- reply_class, bounced), not in sales_email_activity.

create table sales_email_messages (
  business_id uuid not null references businesses(id) on delete cascade,
  apollo_message_id text not null,
  contact_id text not null,
  sequence_id text,
  step int,
  sender text,
  delivered_at timestamptz,
  replied boolean not null default false,
  reply_class text,
  bounced boolean not null default false,
  num_opens int,
  num_clicks int,
  last_opened_at timestamptz,
  last_clicked_at timestamptz,
  activities_fetched_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, apollo_message_id)
);

alter table sales_email_messages enable row level security;

-- Only events Apollo timestamps (from GET /emailer_messages/:id/activities)
-- - never an invented time. The UNIQUE constraint is what makes re-running
-- a sync idempotent.
create table sales_email_activity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  apollo_message_id text not null,
  contact_id text not null,
  sequence_id text,
  step int,
  sender text,
  event text not null check (event in ('open', 'click', 'reply', 'bounce', 'unsub')),
  occurred_at timestamptz not null,
  reply_class text,
  user_agent text,
  tracking_service text,
  first_seen_at timestamptz not null default now(),
  constraint sales_email_activity_dedupe
    unique (business_id, apollo_message_id, event, occurred_at)
);

create index sales_email_activity_contact_idx on sales_email_activity (business_id, contact_id);

alter table sales_email_activity enable row level security;

create table sales_prospect_state (
  business_id uuid not null references businesses(id) on delete cascade,
  contact_id text not null,
  name text,
  title text,
  company text,
  linkedin_url text,
  phone text, -- stays null until prospector-basic-auth-v1 is live (Jack, 2026-10-01)
  email_unsubscribed boolean not null default false,
  owner text not null default 'unassigned' check (owner in ('jack', 'cyrus', 'unassigned')),
  status text not null default 'new' check (status in ('new', 'claimed', 'contacted', 'booked', 'not_now', 'dead')),
  snooze_until date,
  next_action text check (next_action in ('call', 'email', 'linkedin', 'send_collateral', 'wait')),
  next_action_due date,
  notes text,
  opportunity_id uuid references sales_opportunities(id) on delete set null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, contact_id)
);

alter table sales_prospect_state enable row level security;

create table sales_prospect_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  contact_id text not null,
  field text not null,
  from_value text,
  to_value text,
  changed_by text,
  changed_at timestamptz not null default now(),
  foreign key (business_id, contact_id) references sales_prospect_state(business_id, contact_id) on delete cascade
);

alter table sales_prospect_events enable row level security;

-- Logs every change to the huddle-owned fields - the app never writes
-- sales_prospect_events directly, so history can't be skipped. The sync's
-- contact-snapshot updates (name/title/company/...) are deliberately not
-- logged.
create or replace function sales_prospect_state_log_event() returns trigger as $$
declare
  f text;
  old_v text;
  new_v text;
begin
  foreach f in array array['owner', 'status', 'snooze_until', 'next_action', 'next_action_due', 'notes', 'opportunity_id'] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into old_v, new_v using old, new;
    if old_v is distinct from new_v then
      insert into sales_prospect_events (business_id, contact_id, field, from_value, to_value, changed_by)
      values (new.business_id, new.contact_id, f, old_v, new_v, new.updated_by);
    end if;
  end loop;
  return new;
end;
$$ language plpgsql;

create trigger sales_prospect_state_log_event_trigger
  after update on sales_prospect_state
  for each row execute function sales_prospect_state_log_event();

create table sales_collateral (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  title text not null,
  url text not null,
  type text,
  cohort_tags text[] not null default '{}',
  snippet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sales_collateral enable row level security;

create table sales_huddles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  huddle_at timestamptz not null default now(),
  started_by text
);

create index sales_huddles_business_idx on sales_huddles (business_id, huddle_at desc);

alter table sales_huddles enable row level security;

-- Self-check - all six rows must show relrowsecurity = t, and the trigger
-- must appear attached to sales_prospect_state.
select relname, relrowsecurity
from pg_class
where relname in ('sales_email_messages', 'sales_email_activity', 'sales_prospect_state',
                  'sales_prospect_events', 'sales_collateral', 'sales_huddles')
order by relname;

select tgname, tgrelid::regclass
from pg_trigger
where tgname = 'sales_prospect_state_log_event_trigger';
