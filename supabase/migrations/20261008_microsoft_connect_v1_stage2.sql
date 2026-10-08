-- microsoft-connect-v1 Stage 2 - the Outlook read layer: message + calendar
-- metadata pulled through Graph delta queries, per signed-in person.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Nothing beyond what a partner touch needs: no bodies, no previews, no
-- phone numbers. External addresses live in these tables only (never in
-- logs or files), same rule as partner_contacts.email. Messages whose
-- counterparts are all our own domains or all consumer-mail domains are
-- never stored - they're counted on the run row instead.
-- No policies: only the service key (server) can read or write these.

-- One row per Outlook message we keep (sent or received).
CREATE TABLE IF NOT EXISTS public.microsoft_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  graph_id            text NOT NULL,
  internet_message_id text,
  conversation_id     text,
  direction           text NOT NULL CHECK (direction IN ('sent', 'received')),
  mailbox_email       text NOT NULL CHECK (mailbox_email = lower(mailbox_email)),
  external_emails     text[] NOT NULL DEFAULT '{}',
  external_domains    text[] NOT NULL DEFAULT '{}',
  subject             text CHECK (subject IS NULL OR length(subject) <= 500),
  occurred_at         timestamptz NOT NULL,
  synced_at           timestamptz NOT NULL DEFAULT now()
);

-- Graph ids are per mailbox; a delta re-delivering a changed message upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS microsoft_messages_graph_idx
  ON public.microsoft_messages (user_id, graph_id);
-- Stage 3's dedupe key (the same message can sit in two mailboxes when both are cc'd).
CREATE INDEX IF NOT EXISTS microsoft_messages_imid_idx
  ON public.microsoft_messages (business_id, internet_message_id) WHERE internet_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS microsoft_messages_domains_idx
  ON public.microsoft_messages USING gin (external_domains);
CREATE INDEX IF NOT EXISTS microsoft_messages_occurred_idx
  ON public.microsoft_messages (business_id, occurred_at DESC);

ALTER TABLE public.microsoft_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.microsoft_messages FROM anon, authenticated;

-- One row per calendar event with at least one external attendee.
CREATE TABLE IF NOT EXISTS public.microsoft_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  graph_id         text NOT NULL,
  ical_uid         text,
  mailbox_email    text NOT NULL CHECK (mailbox_email = lower(mailbox_email)),
  organizer_email  text,
  external_emails  text[] NOT NULL DEFAULT '{}',
  external_domains text[] NOT NULL DEFAULT '{}',
  subject          text CHECK (subject IS NULL OR length(subject) <= 500),
  start_at         timestamptz NOT NULL,
  end_at           timestamptz NOT NULL,
  is_cancelled     boolean NOT NULL DEFAULT false,
  synced_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_events_graph_idx
  ON public.microsoft_events (user_id, graph_id);
-- The same meeting on Jack's and Cyrus's calendars shares an iCalUId.
CREATE INDEX IF NOT EXISTS microsoft_events_ical_idx
  ON public.microsoft_events (business_id, ical_uid) WHERE ical_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS microsoft_events_domains_idx
  ON public.microsoft_events USING gin (external_domains);
CREATE INDEX IF NOT EXISTS microsoft_events_start_idx
  ON public.microsoft_events (business_id, start_at DESC);

ALTER TABLE public.microsoft_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.microsoft_events FROM anon, authenticated;

-- Where each folder's delta left off, per person. A run that hits its cap
-- stores the @odata.nextLink here so the next run continues instead of
-- re-reading; a finished run stores the @odata.deltaLink. Deleting the row
-- (or a Reconnect to a different account) restarts the 90-day backfill.
CREATE TABLE IF NOT EXISTS public.microsoft_sync_state (
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  folder         text NOT NULL CHECK (folder IN ('sentitems', 'inbox', 'calendar')),
  account_email  text NOT NULL CHECK (account_email = lower(account_email)),
  delta_link     text,
  backfill_from  timestamptz NOT NULL,
  last_synced_at timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, folder)
);

ALTER TABLE public.microsoft_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.microsoft_sync_state FROM anon, authenticated;

-- One row per sync run per folder: counts only, never a subject or an address.
-- seen = items Graph returned; stored = rows written (0 on a dry run);
-- skipped_draft / skipped_internal (every counterpart is one of our own
-- domains) / skipped_personal (every counterpart is a consumer-mail domain);
-- capped = stopped at the per-run cap with more to read.
CREATE TABLE IF NOT EXISTS public.microsoft_sync_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  folder           text NOT NULL CHECK (folder IN ('sentitems', 'inbox', 'calendar')),
  trigger          text NOT NULL CHECK (trigger IN ('manual', 'piggyback', 'dry_run')),
  dry_run          boolean NOT NULL DEFAULT false,
  pages            integer NOT NULL DEFAULT 0,
  seen             integer NOT NULL DEFAULT 0,
  stored           integer NOT NULL DEFAULT 0,
  skipped_draft    integer NOT NULL DEFAULT 0,
  skipped_internal integer NOT NULL DEFAULT 0,
  skipped_personal integer NOT NULL DEFAULT 0,
  capped           boolean NOT NULL DEFAULT false,
  duration_ms      integer,
  error            text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

CREATE INDEX IF NOT EXISTS microsoft_sync_runs_user_idx
  ON public.microsoft_sync_runs (user_id, started_at DESC);

ALTER TABLE public.microsoft_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.microsoft_sync_runs FROM anon, authenticated;

-- Check: 4 tables, rls on everywhere, 0 policies, indexes besides the pk = 4 / 4 / 0 / 1
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies,
       (SELECT count(*) FROM pg_indexes i WHERE i.tablename = c.relname AND i.indexname NOT LIKE '%_pkey') AS indexes,
       (SELECT count(*) FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname) AS columns
FROM pg_class c
WHERE c.relname IN ('microsoft_messages', 'microsoft_events', 'microsoft_sync_state', 'microsoft_sync_runs')
ORDER BY c.relname;
