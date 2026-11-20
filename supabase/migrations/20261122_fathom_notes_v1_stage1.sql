-- fathom-notes-v1 Stage 1 - ONE migration (spec inbox/2026-11-19-1730-fathom-notes-v1.txt; rulings Nov 19 6:00 PM
-- R2, R5, R8). Supabase Dashboard -> SQL Editor -> New query -> paste the WHOLE file -> Run once.
--
-- One transaction: if any statement fails, NOTHING is changed. A second run changes nothing (IF NOT EXISTS on every
-- object; the accepted_at backfill runs only on the run that creates the column). No row is deleted. No address, no
-- phone, no key in this file. The last statement prints the proof: one row per step with BEFORE and AFTER.
--
-- NOT RUN ANYWHERE YET: there is no local Postgres on the build machine, so this file has been read, not executed.
--
-- 1. sales_fathom_connections (F1): one Fathom API key per member per workspace. key_enc / webhook_secret_enc are
--    AES-256-GCM blobs sealed by api/lib/tokenCrypto.js with FATHOM_TOKEN_KEY - that key lives on Render and in .env
--    only and must move WITH this database, or every connection has to be re-pasted. webhook_token is the random
--    part of the destination URL (/api/fathom/webhook/<token>), so the URL alone routes to the workspace.
--    backfill_cursor / backfill_after (R5): where "Pull my last 30 days" stopped after 5 pages, so a second click
--    continues the same window instead of reading it again. Disconnect = status 'disconnected'; the row is kept.
--    RLS on with NO policy and every grant revoked (as microsoft_grants): the browser can never read a key, sealed
--    or not. The API reads and writes with the service key.
-- 2. sales_fathom_events (F3): one row per webhook-id received - the dedupe ledger and the event log Stage 3 counts.
--    The payload itself is NOT stored. status is checked by shape only, so a new status needs no migration.
--    Server-only like the table above.
-- 3. sales_call_notes + 5 columns (F4, F7): fathom_recording_id (Fathom's integer id; unique per workspace, pasted
--    notes keep NULL), fathom_url, transcript (<= 200 000), attendees (jsonb array of { name, is_external, domain }),
--    accepted_at.
--    R2: every note that exists when this runs was accepted the moment it was pasted (the paste path only stores a
--    note on accept), so accepted_at = created_at on all of them (36 on Nov 19) - otherwise each one holding an
--    extract would appear on Today as "Review call notes" when Stage 2 ships.
-- 4. sales_settings.fathom_extract_cap (F5, R8): automatic extractions per workspace per day, default 10,
--    owner-editable, 0 = never extract automatically.
BEGIN;

CREATE TEMP TABLE IF NOT EXISTS fn_proof (n int PRIMARY KEY, what text, before text, after text);
TRUNCATE fn_proof;

INSERT INTO fn_proof (n, what, before) VALUES
  (1, 'call notes (rows · with extract)',
      (SELECT count(*) || ' · ' || count(extract) FROM public.sales_call_notes)),
  (2, 'call notes: new columns present (of 5)',
      (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_call_notes'
        AND column_name IN ('fathom_recording_id', 'fathom_url', 'transcript', 'attendees', 'accepted_at'))),
  (3, 'accepted_at (set · null · = created_at)', 'no column'),
  (4, 'unique (business_id, fathom_recording_id)',
      (SELECT count(*)::text FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'sales_call_notes_fathom_recording_key')),
  (5, 'sales_fathom_connections', COALESCE(to_regclass('public.sales_fathom_connections')::text, 'absent')),
  (6, 'sales_fathom_events', COALESCE(to_regclass('public.sales_fathom_events')::text, 'absent')),
  (7, 'fathom_extract_cap (settings rows · at 10)',
      (SELECT count(*) || ' · no column' FROM public.sales_settings));

CREATE TABLE IF NOT EXISTS public.sales_fathom_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  key_enc            text NOT NULL,
  webhook_secret_enc text,
  webhook_token      text NOT NULL UNIQUE CHECK (webhook_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  fathom_webhook_id  text,
  connected_at       timestamptz NOT NULL DEFAULT now(),
  last_event_at      timestamptz,
  backfill_after     timestamptz,
  backfill_cursor    text,
  status             text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
  UNIQUE (business_id, user_id)
);
ALTER TABLE public.sales_fathom_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_fathom_connections FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.sales_fathom_events (
  webhook_id   text PRIMARY KEY CHECK (length(webhook_id) BETWEEN 1 AND 200),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recording_id bigint,
  received_at  timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'received' CHECK (status ~ '^[a-z][a-z_]{1,29}$'),
  error        text CHECK (error IS NULL OR length(error) <= 500)
);
CREATE INDEX IF NOT EXISTS sales_fathom_events_business_idx ON public.sales_fathom_events (business_id, received_at DESC);
ALTER TABLE public.sales_fathom_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_fathom_events FROM anon, authenticated;

-- The backfill is tied to the run that CREATES accepted_at: on a later run the column exists, the block does nothing,
-- and a Fathom note waiting for its review is never marked accepted by this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'sales_call_notes' AND column_name = 'accepted_at') THEN
    ALTER TABLE public.sales_call_notes ADD COLUMN accepted_at timestamptz;
    UPDATE public.sales_call_notes SET accepted_at = created_at;
  END IF;
END $$;

ALTER TABLE public.sales_call_notes
  ADD COLUMN IF NOT EXISTS fathom_recording_id bigint,
  ADD COLUMN IF NOT EXISTS fathom_url          text CHECK (fathom_url IS NULL OR length(fathom_url) <= 500),
  ADD COLUMN IF NOT EXISTS transcript          text CHECK (transcript IS NULL OR length(transcript) <= 200000),
  ADD COLUMN IF NOT EXISTS attendees           jsonb CHECK (attendees IS NULL OR jsonb_typeof(attendees) = 'array');
CREATE UNIQUE INDEX IF NOT EXISTS sales_call_notes_fathom_recording_key
  ON public.sales_call_notes (business_id, fathom_recording_id);

ALTER TABLE public.sales_settings
  ADD COLUMN IF NOT EXISTS fathom_extract_cap int NOT NULL DEFAULT 10 CHECK (fathom_extract_cap BETWEEN 0 AND 200);

UPDATE fn_proof SET after = (SELECT count(*) || ' · ' || count(extract) FROM public.sales_call_notes) WHERE n = 1;
UPDATE fn_proof SET after = (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'
  AND table_name = 'sales_call_notes'
  AND column_name IN ('fathom_recording_id', 'fathom_url', 'transcript', 'attendees', 'accepted_at')) WHERE n = 2;
UPDATE fn_proof SET after = (SELECT count(accepted_at) || ' · ' || count(*) FILTER (WHERE accepted_at IS NULL) || ' · ' ||
  count(*) FILTER (WHERE accepted_at = created_at) FROM public.sales_call_notes) WHERE n = 3;
UPDATE fn_proof SET after = (SELECT count(*)::text FROM pg_indexes WHERE schemaname = 'public'
  AND indexname = 'sales_call_notes_fathom_recording_key') WHERE n = 4;
UPDATE fn_proof SET after = (SELECT
  'rows=' || (SELECT count(*) FROM public.sales_fathom_connections) ||
  ' · rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_fathom_connections'::regclass) ||
  ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_fathom_connections') ||
  ' · anon_select=' || has_table_privilege('anon', 'public.sales_fathom_connections', 'SELECT') ||
  ' · authenticated_select=' || has_table_privilege('authenticated', 'public.sales_fathom_connections', 'SELECT')) WHERE n = 5;
UPDATE fn_proof SET after = (SELECT
  'rows=' || (SELECT count(*) FROM public.sales_fathom_events) ||
  ' · rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_fathom_events'::regclass) ||
  ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_fathom_events') ||
  ' · anon_select=' || has_table_privilege('anon', 'public.sales_fathom_events', 'SELECT') ||
  ' · authenticated_select=' || has_table_privilege('authenticated', 'public.sales_fathom_events', 'SELECT')) WHERE n = 6;
UPDATE fn_proof SET after = (SELECT count(*) || ' · ' || count(*) FILTER (WHERE fathom_extract_cap = 10)
  FROM public.sales_settings) WHERE n = 7;

COMMIT;

-- Proof. Expected on the first run, N = the note count in row 1 (36 on Nov 19; more if notes were pasted since):
--   1  before = after (no note added or removed; the extract count unchanged)
--   2  0 -> 5
--   3  no column -> N · 0 · N   (every existing note accepted at its created_at; none left null)
--   4  0 -> 1
--   5  absent -> rows=0 · rls=true · policies=0 · anon_select=false · authenticated_select=false
--   6  absent -> rows=0 · rls=true · policies=0 · anon_select=false · authenticated_select=false
--   7  S · no column -> S · S   (every settings row at the default 10)
SELECT n, what, before, after FROM fn_proof ORDER BY n;
