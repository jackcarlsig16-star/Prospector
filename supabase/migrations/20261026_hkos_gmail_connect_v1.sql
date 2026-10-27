-- hkos-gmail-connect-v1 Stage 1 (G2) - the sync bookkeeping for the HumanKind Gmail loop. Run in: Supabase Dashboard ->
-- SQL Editor -> New query -> paste the whole file -> Run. Re-runnable (IF NOT EXISTS everywhere).
--
-- hk_gmail_sync_state  one row per founder per workspace: the tethered grant it last synced, Gmail's historyId cursor,
--                      timestamps, a short last_error (never a body or an address), status. 'running' is the one-at-a-
--                      time lock (G5.1, PROPOSED: a 10-minute stale override lives in code).
-- hk_sync_runs         one row per sync (manual / pageload / test) with counts jsonb - counts only, never addresses.
-- hk_member_prefs      + signature_text (<= 400 chars, plain text): Gmail does not add the account signature to drafts
--                      created through the API, so the server appends this one (G2, PROPOSED).
-- hk_replies           + urgent boolean (G7: pricing / interested replies feed the step-4 digest).
-- All: business_id -> businesses ON DELETE CASCADE; RLS on, no policies; anon + authenticated revoked (server only).

CREATE TABLE IF NOT EXISTS public.hk_gmail_sync_state (
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  grant_id          uuid REFERENCES public.google_grants(id) ON DELETE SET NULL,
  history_id        text,
  last_synced_at    timestamptz,
  last_full_scan_at timestamptz,
  last_error        text CHECK (last_error IS NULL OR length(last_error) <= 200),
  status            text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'running', 'error', 'needs_reconnect')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.hk_sync_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trigger     text NOT NULL CHECK (trigger IN ('manual', 'pageload', 'test')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'partial', 'error')),
  counts      jsonb NOT NULL DEFAULT '{}',
  error       text CHECK (error IS NULL OR length(error) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hk_sync_runs_user_started_idx ON public.hk_sync_runs (business_id, user_id, started_at DESC);

ALTER TABLE public.hk_member_prefs ADD COLUMN IF NOT EXISTS signature_text text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hk_member_prefs_signature_len') THEN
    ALTER TABLE public.hk_member_prefs ADD CONSTRAINT hk_member_prefs_signature_len CHECK (signature_text IS NULL OR length(signature_text) <= 400);
  END IF;
END $$;
ALTER TABLE public.hk_replies ADD COLUMN IF NOT EXISTS urgent boolean NOT NULL DEFAULT false;

ALTER TABLE public.hk_gmail_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_sync_runs        ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hk_gmail_sync_state FROM anon, authenticated;
REVOKE ALL ON public.hk_sync_runs        FROM anon, authenticated;

-- Proof - expect 4 rows:
--   "table" hk_gmail_sync_state: rls=true · policies=0 · rows=0 · anon_select=false · auth_select=false · columns=10
--   "table" hk_sync_runs:        rls=true · policies=0 · rows=0 · anon_select=false · auth_select=false · columns=10
--   "column" hk_member_prefs.signature_text=present · len_check=present
--   "column" hk_replies.urgent=present
SELECT 'table' AS kind, t.relname AS name,
       'rls=' || t.relrowsecurity ||
       ' · policies=' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname) ||
       ' · rows=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t.relname), false, true, '')))[1]::text ||
       ' · anon_select=' || has_table_privilege('anon', t.oid, 'SELECT') ||
       ' · auth_select=' || has_table_privilege('authenticated', t.oid, 'SELECT') ||
       ' · columns=' || (SELECT count(*) FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = t.relname) AS detail
  FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relname IN ('hk_gmail_sync_state', 'hk_sync_runs')
UNION ALL
SELECT 'column', 'hk_member_prefs.signature_text',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_member_prefs' AND column_name = 'signature_text') THEN 'present' ELSE 'MISSING' END
       || ' · len_check=' || CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hk_member_prefs_signature_len') THEN 'present' ELSE 'MISSING' END
UNION ALL
SELECT 'column', 'hk_replies.urgent',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_replies' AND column_name = 'urgent') THEN 'present' ELSE 'MISSING' END
ORDER BY 1 DESC, 2;
