-- call-log-v1, Phase 1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Extends business_intel_entries to carry call-transcript metadata, and adds
-- account_id - which does NOT currently exist on this table (confirmed live,
-- Phase 0 audit: business_intel_entries has 7 columns, none linking to
-- accounts; the only existing account-note mechanism is
-- recordAccountActivity(), which writes into accounts.data.handoffNotes
-- directly and has zero dependency on business_intel_entries). Without
-- account_id, a filed call-log row has nowhere to persist which account it's
-- matched to, which Phase 4 (matched-account column) and Phase 5
-- (reassignment dropdown) both require.
--
-- accounts.id is `text`, not `uuid` (confirmed live) - account_id here must
-- match that type, not follow project_id's uuid FK pattern.

alter table public.business_intel_entries
  add column if not exists source_type text not null default 'note',
  add column if not exists call_platform text,
  add column if not exists call_date timestamptz,
  add column if not exists call_duration_seconds integer,
  add column if not exists call_participants jsonb,
  add column if not exists account_id text references public.accounts(id);

alter table public.business_intel_entries
  add constraint business_intel_entries_source_type_check
  check (source_type in ('note', 'call'));

alter table public.business_intel_entries
  add constraint business_intel_entries_call_platform_check
  check (call_platform is null or call_platform in ('zoom', 'google_meet', 'manual'));

create index if not exists idx_business_intel_entries_account_id
  on public.business_intel_entries(account_id) where account_id is not null;

create index if not exists idx_business_intel_entries_source_type
  on public.business_intel_entries(business_id, source_type);
