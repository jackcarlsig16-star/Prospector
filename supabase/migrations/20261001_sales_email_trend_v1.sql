-- sales-email-trend-v1 REVISION 2, Stage 2
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- business_id, not tenant_id - the real column name every other sales_*
-- table uses. RLS enabled, ZERO policies - same posture as the other
-- sales_* tables; every read/write goes through Express routes using
-- SUPABASE_SERVICE_KEY.
--
-- sales_email_daily_counts is new rather than more rows in
-- sales_metrics_daily: that table carries one dimension per row
-- (dim_type/dim_value), and these counts are per day x mailbox x
-- sequence x step at once. Counts only - no message ids, no contacts.
-- day is the America/Los_Angeles calendar day the email was delivered
-- (Apollo's only date filter is delivery date), so opened/clicked/replied
-- are "of the emails sent that day", not "events that happened that day".
-- sequence_id '' and step 0 stand in for "none" so the primary key can
-- stay NOT NULL.

create table sales_email_daily_counts (
  business_id uuid not null references businesses(id) on delete cascade,
  day date not null,
  mailbox text not null,
  sequence_id text not null default '',
  step int not null default 0,
  delivered int not null default 0,
  hard_bounced int not null default 0,
  spam_blocked int not null default 0,
  opened int not null default 0,
  clicked int not null default 0,
  replied int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (business_id, day, mailbox, sequence_id, step)
);

alter table sales_email_daily_counts enable row level security;

-- One row per Mon-Sun week fetched. What makes the backfill resumable
-- (a week with a row here is done unless refreshed) and honest (complete =
-- false when any stat hit its page cap, so the week may be undercounted).
create table sales_email_backfill_weeks (
  business_id uuid not null references businesses(id) on delete cascade,
  week_start date not null,
  fetched_at timestamptz not null default now(),
  apollo_calls int not null,
  complete boolean not null,
  note text,
  primary key (business_id, week_start)
);

alter table sales_email_backfill_weeks enable row level security;

create table sales_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  event_date date not null,
  label text not null,
  category text not null default 'other' check (category in ('deliverability', 'mailbox', 'sequence', 'list', 'other')),
  created_by text,
  created_at timestamptz not null default now()
);

create index sales_events_business_date_idx on sales_events (business_id, event_date);

alter table sales_events enable row level security;

-- scope_key is the affected item an insight was about (a sequence id,
-- mailbox, or week), so dismissing "Fitness bouncing" doesn't also hide
-- the same rule firing for Retail.
create table sales_insight_dismissals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  insight_id text not null,
  scope_key text not null default '',
  dismissed_until timestamptz not null,
  dismissed_by text,
  dismissed_at timestamptz not null default now()
);

create index sales_insight_dismissals_lookup_idx on sales_insight_dismissals (business_id, insight_id, scope_key);

alter table sales_insight_dismissals enable row level security;

-- Self-check - all four rows must show relrowsecurity = t.
select relname, relrowsecurity
from pg_class
where relname in ('sales_email_daily_counts', 'sales_email_backfill_weeks', 'sales_events', 'sales_insight_dismissals')
order by relname;
