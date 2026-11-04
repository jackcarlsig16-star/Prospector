-- homelover-clients-v1 REV2 Stage 3 (C11) - storage for the HomeLover Claude connector's own OAuth server (/hl/mcp), in
-- its own tables. Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Idempotent. No existing row value
-- changes.
--
-- hl_oauth_clients / _requests / _codes / _tokens  RLS on,
--   no policies, anon + authenticated revoked - server only. Codes and tokens are stored only as SHA-256 hashes. No email
--   column anywhere. Revoke = revoked_at (a refresh-token reuse revokes its whole family_id).
-- sales_source_events.reason  gains 'undo' (Make client's Undo when it changed the source - Stage 1 wrote it, the check
--   refused it; nothing was undone that way yet). The connector's source writes log as 'edit' / 'create' like the panel.

CREATE TABLE IF NOT EXISTS public.hl_oauth_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     text NOT NULL UNIQUE CHECK (length(client_id) BETWEEN 1 AND 500),
  kind          text NOT NULL CHECK (kind IN ('cimd', 'dcr')),
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  name          text CHECK (length(name) <= 120),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hl_oauth_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      text NOT NULL REFERENCES public.hl_oauth_clients(client_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id    uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL CHECK (length(code_challenge) BETWEEN 43 AND 128),
  state          text CHECK (length(state) <= 500),
  scope          text NOT NULL DEFAULT 'hl',
  expires_at     timestamptz NOT NULL,
  decided_at     timestamptz,
  decision       text CHECK (decision IN ('allow', 'deny')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hl_oauth_requests_expires_idx ON public.hl_oauth_requests (expires_at);

CREATE TABLE IF NOT EXISTS public.hl_oauth_codes (
  code_hash      text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  client_id      text NOT NULL REFERENCES public.hl_oauth_clients(client_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL CHECK (length(code_challenge) BETWEEN 43 AND 128),
  scope          text NOT NULL DEFAULT 'hl',
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hl_oauth_codes_expires_idx ON public.hl_oauth_codes (expires_at);

CREATE TABLE IF NOT EXISTS public.hl_oauth_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  kind         text NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id    text NOT NULL REFERENCES public.hl_oauth_clients(client_id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  scope        text NOT NULL DEFAULT 'hl',
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hl_oauth_tokens_family_idx ON public.hl_oauth_tokens (family_id);
CREATE INDEX IF NOT EXISTS hl_oauth_tokens_user_idx   ON public.hl_oauth_tokens (business_id, user_id);

ALTER TABLE public.hl_oauth_clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_oauth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_oauth_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_oauth_tokens   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hl_oauth_clients  FROM anon, authenticated;
REVOKE ALL ON public.hl_oauth_requests FROM anon, authenticated;
REVOKE ALL ON public.hl_oauth_codes    FROM anon, authenticated;
REVOKE ALL ON public.hl_oauth_tokens   FROM anon, authenticated;

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'public.sales_source_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%reason%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.sales_source_events DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE public.sales_source_events ADD CONSTRAINT sales_source_events_reason_check
  CHECK (reason IN ('create', 'edit', 'backfill', 'promote', 'import', 'undo'));

-- Proof - expect 5 rows:
--   hl_oauth_clients / codes / requests / tokens   rls=true · policies=0 · rows=0 · anon_select=false · auth_select=false
--   sales_source_events reason                     checks=1 · undo=true
SELECT t.relname::text AS name,
       'rls=' || t.relrowsecurity ||
       ' · policies=' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname) ||
       ' · rows=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t.relname), false, true, '')))[1]::text ||
       ' · anon_select=' || has_table_privilege('anon', format('public.%I', t.relname), 'SELECT') ||
       ' · auth_select=' || has_table_privilege('authenticated', format('public.%I', t.relname), 'SELECT') AS detail
FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname IN ('hl_oauth_clients', 'hl_oauth_requests', 'hl_oauth_codes', 'hl_oauth_tokens')
UNION ALL
SELECT 'sales_source_events reason',
       'checks=' || (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.sales_source_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%reason%') ||
       ' · undo=' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_source_events_reason_check' AND pg_get_constraintdef(oid) LIKE '%undo%')
ORDER BY 1;
