-- homelover-team-emails-v1 Stage 1 - the two internal team emails (weekday visitors, new client) and HomeLover's own
-- scheduler. Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- sales_team_email_settings  one row per workspace that gets team emails (seeded for HomeLover only): the sending
--                            member (null = the owner), each email on / off, and client_alert_since (clients made
--                            before this never alert - the ones that existed when this ran stay quiet).
-- sales_team_email_optouts   a member's own "Send me this" = off, per email kind.
-- sales_team_email_sends     every send attempt: kind, slot, the company it was about, sent / failed / needs_reconnect /
--                            skipped, how many recipients (a count, never an address), subject, a short error.
-- sales_job_slots            the scheduler's claims: one row per (job, scope, slot); the primary key is what stops a
--                            restart or a second instance from running a slot twice.
-- sales_client_events        kind + 'alert_sent', via + 'scheduler' (the company's Activity shows the alert went out).
-- No browser access: the server reads and writes all four with the service key.

CREATE TABLE IF NOT EXISTS public.sales_team_email_settings (
  business_id        uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  sender_user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  visitor_on         boolean NOT NULL DEFAULT true,
  client_on          boolean NOT NULL DEFAULT true,
  client_alert_since timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_team_email_optouts (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('visitor', 'client')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id, kind)
);

CREATE TABLE IF NOT EXISTS public.sales_team_email_sends (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('visitor', 'client')),
  slot           text,
  ref_id         uuid,
  test           boolean NOT NULL DEFAULT false,
  sender_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipients     int NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  status         text NOT NULL CHECK (status IN ('sent', 'failed', 'needs_reconnect', 'skipped')),
  subject        text CHECK (subject IS NULL OR length(subject) <= 200),
  error          text CHECK (error IS NULL OR length(error) <= 300),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_team_email_sends_recent_idx ON public.sales_team_email_sends (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sales_job_slots (
  job         text NOT NULL CHECK (length(job) BETWEEN 1 AND 40),
  scope       text NOT NULL CHECK (length(scope) BETWEEN 1 AND 60),
  slot        text NOT NULL CHECK (length(slot) BETWEEN 1 AND 60),
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  detail      jsonb,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (job, scope, slot)
);

ALTER TABLE public.sales_team_email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_team_email_optouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_team_email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_job_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_team_email_settings, public.sales_team_email_optouts, public.sales_team_email_sends, public.sales_job_slots FROM anon, authenticated;

ALTER TABLE public.sales_client_events DROP CONSTRAINT IF EXISTS sales_client_events_kind_check;
ALTER TABLE public.sales_client_events ADD CONSTRAINT sales_client_events_kind_check
  CHECK (kind IN ('made_client', 'status', 'signed', 'launched', 'undo', 'file_added', 'file_archived', 'alert_sent'));
ALTER TABLE public.sales_client_events DROP CONSTRAINT IF EXISTS sales_client_events_via_check;
ALTER TABLE public.sales_client_events ADD CONSTRAINT sales_client_events_via_check CHECK (via IN ('panel', 'connector', 'scheduler'));

INSERT INTO public.sales_team_email_settings (business_id)
SELECT id FROM public.businesses WHERE name = 'HomeLover'
ON CONFLICT (business_id) DO NOTHING;

-- Proof (7 rows): 4 tables with RLS on and 0 policies, both checks true, 1 settings row.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
FROM pg_class c
WHERE c.relname IN ('sales_team_email_settings', 'sales_team_email_optouts', 'sales_team_email_sends', 'sales_job_slots')
UNION ALL
SELECT 'kind check allows alert_sent', pg_get_constraintdef(oid) LIKE '%alert_sent%', NULL
FROM pg_constraint WHERE conname = 'sales_client_events_kind_check'
UNION ALL
SELECT 'via check allows scheduler', pg_get_constraintdef(oid) LIKE '%scheduler%', NULL
FROM pg_constraint WHERE conname = 'sales_client_events_via_check'
UNION ALL
SELECT 'settings rows', true, (SELECT count(*) FROM public.sales_team_email_settings);
