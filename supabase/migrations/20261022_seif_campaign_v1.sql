-- seif-campaign-v1 REV2 Stage 1 - outreach campaigns (list in, schedule out, sends and replies tracked).
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Five NEW tables, all sales_outreach_*. The legacy `campaigns` table
-- (20260819_campaigns.sql, content grouping under Projects) is a different
-- thing and is not touched here.
-- sales_outreach_contacts.email is the only place a contact address lives:
-- it is read server-side to match Outlook sends/replies and never returned to
-- a browser. That is why none of these tables gets s5_read: RLS on, no
-- policies, anon + authenticated revoked - service key only (like
-- microsoft_messages).
-- One track per segment x warmth per campaign: the import picks the track
-- from those two columns.
-- current_step = the next step to send; after the last step the contact goes
-- to status done and current_step stays on the last one.

CREATE TABLE IF NOT EXISTS public.sales_outreach_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  sender_user_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_user_ids  uuid[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'done')),
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_outreach_campaigns_business_idx
  ON public.sales_outreach_campaigns (business_id);

CREATE TABLE IF NOT EXISTS public.sales_outreach_tracks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES public.sales_outreach_campaigns(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  segment      text NOT NULL CHECK (segment IN ('consultant_broker', 'corporate')),
  warmth       text NOT NULL CHECK (warmth IN ('warm', 'cold')),
  sort         int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_outreach_tracks_campaign_kind_idx
  ON public.sales_outreach_tracks (campaign_id, segment, warmth);

CREATE TABLE IF NOT EXISTS public.sales_outreach_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id    uuid NOT NULL REFERENCES public.sales_outreach_tracks(id) ON DELETE CASCADE,
  step_no     int NOT NULL CHECK (step_no BETWEEN 1 AND 5),
  day_offset  int NOT NULL DEFAULT 0 CHECK (day_offset BETWEEN 0 AND 60),
  subject     text NOT NULL DEFAULT '' CHECK (length(subject) <= 200),
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 5000),
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_outreach_steps_track_step_idx
  ON public.sales_outreach_steps (track_id, step_no);

CREATE TABLE IF NOT EXISTS public.sales_outreach_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES public.sales_outreach_campaigns(id) ON DELETE CASCADE,
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  title           text CHECK (title IS NULL OR length(title) <= 200),
  company         text CHECK (company IS NULL OR length(company) <= 200),
  email           text NOT NULL CHECK (length(email) <= 320 AND position('@' IN email) > 1),
  segment         text CHECK (segment IS NULL OR segment IN ('consultant_broker', 'corporate')),
  warmth          text CHECK (warmth IS NULL OR warmth IN ('warm', 'cold')),
  track_id        uuid REFERENCES public.sales_outreach_tracks(id) ON DELETE SET NULL,
  owner_user_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'active', 'replied', 'meeting', 'not_interested', 'bounced', 'opted_out', 'done')),
  current_step    int NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
  next_due_date   date,
  last_sent_at    timestamptz,
  replied_at      timestamptz,
  goal_id         uuid REFERENCES public.sales_goals(id) ON DELETE SET NULL,
  opportunity_id  uuid REFERENCES public.sales_opportunities(id) ON DELETE SET NULL,
  target_id       uuid REFERENCES public.sales_targets(id) ON DELETE SET NULL,
  conflict        text CHECK (conflict IS NULL OR length(conflict) <= 400),
  notes           text CHECK (notes IS NULL OR length(notes) <= 2000),
  import_row      int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_outreach_contacts_campaign_email_idx
  ON public.sales_outreach_contacts (campaign_id, lower(email));
-- B6a / B6 look up a contact by address within a workspace on every Outlook sync.
CREATE INDEX IF NOT EXISTS sales_outreach_contacts_business_email_idx
  ON public.sales_outreach_contacts (business_id, lower(email));
CREATE INDEX IF NOT EXISTS sales_outreach_contacts_due_idx
  ON public.sales_outreach_contacts (business_id, status, next_due_date);

CREATE TABLE IF NOT EXISTS public.sales_outreach_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   uuid NOT NULL REFERENCES public.sales_outreach_contacts(id) ON DELETE CASCADE,
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('sent', 'replied', 'bounced', 'status', 'note', 'promoted')),
  step_no      int CHECK (step_no IS NULL OR step_no BETWEEN 1 AND 5),
  at           timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'outlook')),
  by_user      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  meta         jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS sales_outreach_events_contact_idx
  ON public.sales_outreach_events (contact_id, at DESC);
CREATE INDEX IF NOT EXISTS sales_outreach_events_business_idx
  ON public.sales_outreach_events (business_id, at DESC);

ALTER TABLE public.sales_outreach_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_outreach_tracks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_outreach_steps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_outreach_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_outreach_events    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_outreach_campaigns FROM anon, authenticated;
REVOKE ALL ON public.sales_outreach_tracks    FROM anon, authenticated;
REVOKE ALL ON public.sales_outreach_steps     FROM anon, authenticated;
REVOKE ALL ON public.sales_outreach_contacts  FROM anon, authenticated;
REVOKE ALL ON public.sales_outreach_events    FROM anon, authenticated;

-- Proof - expect 5 rows, each rls true · policies 0 · rows 0 · anon_select false · auth_select false;
-- uniq: campaigns 0 · contacts 1 · events 0 · steps 1 · tracks 1.
SELECT c.relname AS tbl,
       c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
       (SELECT count(*) FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = c.relname AND i.indexdef LIKE 'CREATE UNIQUE INDEX%' AND i.indexname <> c.relname || '_pkey') AS uniq,
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text::int AS rows,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'sales_outreach_%'
  ORDER BY 1;
