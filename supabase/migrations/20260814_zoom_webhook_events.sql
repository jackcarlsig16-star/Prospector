-- zoom-meet-auto-ingest-v1, Step 1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Raw log of every recording.completed / recording.transcript_completed
-- event received. Deliberately business-agnostic (matched_business_id is
-- nullable) - business_intel_entries.business_id is NOT NULL, so an event
-- that can't be auto-attributed has nowhere else to live until a human
-- assigns it (confirmed live, zoom-meet-auto-ingest-v1 Phase 0: neither
-- webhook payload carries a participant list, and host_email is identical
-- across all 3 businesses, so auto-attribution isn't guaranteed to resolve).
--
-- zoom_meeting_uuid and call_log_entry_id are additions beyond the exact
-- field list discussed - zoom_meeting_uuid lets recording.completed and
-- recording.transcript_completed for the same meeting be correlated without
-- parsing payload_json on every query; call_log_entry_id links a
-- successfully-filed event back to the business_intel_entries row Step 4
-- creates, for the reconciliation view's click-through.
--
-- transcript_text is a further addition: the download_token used to fetch
-- it from Zoom is a one-time JWT that expires in 24h. If an event lands
-- unmatched (held for manual assignment), Step 5's reassignment can't
-- re-download the transcript later without this - the already-parsed text
-- has to be persisted at processing time, not re-fetched on demand.

create table if not exists public.zoom_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('recording.completed', 'recording.transcript_completed')),
  zoom_meeting_uuid text,
  payload_json jsonb not null,
  transcript_text text,
  participants_json jsonb,
  received_at timestamptz not null default now(),
  processed boolean not null default false,
  processing_error text,
  matched_business_id uuid references public.businesses(id),
  matched_account_id text references public.accounts(id),
  match_reason text,
  call_log_entry_id uuid references public.business_intel_entries(id)
);

create index if not exists idx_zoom_webhook_events_meeting_uuid on public.zoom_webhook_events(zoom_meeting_uuid);
create index if not exists idx_zoom_webhook_events_processed on public.zoom_webhook_events(processed);
create index if not exists idx_zoom_webhook_events_unmatched on public.zoom_webhook_events(matched_business_id) where matched_business_id is null;

-- audit-triage-v1 follow-up (2026-08-17) — RLS: enabled, zero anon
-- policies, same as access_log. Every real consumer (api/zoom/webhook.js,
-- events.js, events-reassign.js) uses the service-role key. Confirmed live:
-- anon insert throws 42501 as expected; anon select returns an empty set
-- (not an error) - standard Postgres RLS behavior for a policyless table,
-- not a read bypass - real row count was 0 at the time of this check either
-- way. Deliberately left locked, not opened to match this app's usual
-- permissive-RLS default: raw webhook payloads/transcripts are more
-- sensitive than most tables here and nothing client-side needs to touch
-- this table. If a future feature needs client-side read/write, add a
-- narrowly-scoped policy then - don't default to permissive.
