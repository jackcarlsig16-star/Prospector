-- homelover-team-emails-v1 REV2 Stage 2 - the owner-edited recipient list. Run in: Supabase Dashboard -> SQL Editor ->
-- New query -> paste -> Run. Safe to re-run. Starts EMPTY: the owner types the addresses in Sales › Settings › Team emails.
--
-- sales_team_email_recipients  one row per address: which emails it gets (visitor_email, client_alert), who added it;
--                              removing archives (archived_at), never deletes. One live row per address per workspace.
-- sales_team_email_changes     the Activity for the list: counts only (before -> after), never an address; prior holds
--                              the flags an edit replaced, so Undo can put them back.
-- sales_team_email_settings    + allowed_domains (null = the sending mailbox's own domain, read from its grant).
-- No browser access: the server reads and writes them with the service key.

CREATE TABLE IF NOT EXISTS public.sales_team_email_recipients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  address       text NOT NULL CHECK (length(address) BETWEEN 3 AND 254 AND address = lower(address) AND address LIKE '%_@_%'),
  visitor_email boolean NOT NULL DEFAULT true,
  client_alert  boolean NOT NULL DEFAULT true,
  added_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_team_email_recipients_live_uq
  ON public.sales_team_email_recipients (business_id, address) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sales_team_email_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  action       text NOT NULL CHECK (action IN ('add', 'remove', 'edit', 'undo')),
  recipient_id uuid REFERENCES public.sales_team_email_recipients(id) ON DELETE SET NULL,
  replaced_id  uuid REFERENCES public.sales_team_email_recipients(id) ON DELETE SET NULL,
  prior        jsonb,
  count_before int NOT NULL CHECK (count_before >= 0),
  count_after  int NOT NULL CHECK (count_after >= 0),
  undone_at    timestamptz,
  by_user      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_team_email_changes_recent_idx ON public.sales_team_email_changes (business_id, at DESC);

ALTER TABLE public.sales_team_email_settings ADD COLUMN IF NOT EXISTS allowed_domains text[];

ALTER TABLE public.sales_team_email_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_team_email_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_team_email_recipients, public.sales_team_email_changes FROM anon, authenticated;

-- Proof (5 rows): 2 tables with RLS on and 0 policies, 0 recipients, the column, the unique index.
SELECT c.relname AS check_name, c.relrowsecurity AS ok,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS n
FROM pg_class c
WHERE c.relname IN ('sales_team_email_recipients', 'sales_team_email_changes') AND c.relkind = 'r'
UNION ALL
SELECT 'recipients (expect 0)', true, (SELECT count(*) FROM public.sales_team_email_recipients)
UNION ALL
SELECT 'settings.allowed_domains', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_team_email_settings' AND column_name = 'allowed_domains'), NULL
UNION ALL
SELECT 'one live row per address', EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'sales_team_email_recipients_live_uq'), NULL;
