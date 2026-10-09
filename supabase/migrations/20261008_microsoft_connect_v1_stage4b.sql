-- microsoft-connect-v1 Stage 4b - when a meeting was put on the calendar.
-- "Meetings booked" in a week needs the day the event was created, which
-- Graph returns (createdDateTime) and the Stage 2 sync drops; synced_at
-- can't stand in for it (the upsert refreshes it on every delta). "Meetings
-- held" needs only end_at and is_cancelled, which are already stored.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Existing rows stay NULL until Graph re-delivers them: the calendar delta
-- only sends changed events, so the choice after this runs is Jack's -
-- delete the calendar row in microsoft_sync_state for the mailbox (the
-- next Sync Outlook re-reads the window, ~134 events on HomeLover, and
-- the upsert fills the column in place) or let it fill as events change.
-- A NULL is never counted as booked; held is unaffected either way.

ALTER TABLE public.microsoft_events ADD COLUMN IF NOT EXISTS created_at_graph timestamptz;

CREATE INDEX IF NOT EXISTS microsoft_events_created_idx
  ON public.microsoft_events (business_id, created_at_graph) WHERE created_at_graph IS NOT NULL;

-- Check: column present, index present, rls still on, 0 policies, every row NULL for now
SELECT (SELECT count(*) FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = 'microsoft_events' AND k.column_name = 'created_at_graph') AS has_column,
       (SELECT count(*) FROM pg_indexes i WHERE i.tablename = 'microsoft_events' AND i.indexname = 'microsoft_events_created_idx') AS has_index,
       c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies,
       (SELECT count(*) FROM public.microsoft_events) AS events,
       (SELECT count(*) FROM public.microsoft_events WHERE created_at_graph IS NULL) AS still_null
FROM pg_class c WHERE c.relname = 'microsoft_events';
