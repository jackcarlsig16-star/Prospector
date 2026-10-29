-- hkos-mcp-connector-v1 Stage 1 (M3) - storage for the OAuth server behind the HumanKind Claude connector (/mcp).
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste the whole file -> Run. Re-runnable (IF NOT EXISTS).
--
-- Every table: RLS ENABLED with NO policies; anon + authenticated revoked - server only, service key.
-- Codes and tokens are random and stored only as SHA-256 hashes (hex); the plain value never touches the DB or a log.
-- No email column anywhere. Revoke = set revoked_at (a refresh-token reuse revokes its whole family_id).
-- hk_oauth_requests holds the pending /oauth/authorize request for 10 minutes (Stage 0 choice 2): the React
-- /oauth/consent page gets only its id and POSTs id + allow/deny; the server re-checks user_id and trusts nothing else.

CREATE TABLE IF NOT EXISTS public.hk_oauth_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     text NOT NULL UNIQUE CHECK (length(client_id) BETWEEN 1 AND 500),
  kind          text NOT NULL CHECK (kind IN ('cimd', 'dcr')),
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  name          text CHECK (length(name) <= 120),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hk_oauth_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      text NOT NULL REFERENCES public.hk_oauth_clients(client_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id    uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL CHECK (length(code_challenge) BETWEEN 43 AND 128),
  state          text CHECK (length(state) <= 500),
  scope          text NOT NULL DEFAULT 'hk',
  expires_at     timestamptz NOT NULL,
  decided_at     timestamptz,
  decision       text CHECK (decision IN ('allow', 'deny')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hk_oauth_requests_expires_idx ON public.hk_oauth_requests (expires_at);

CREATE TABLE IF NOT EXISTS public.hk_oauth_codes (
  code_hash      text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  client_id      text NOT NULL REFERENCES public.hk_oauth_clients(client_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL CHECK (length(code_challenge) BETWEEN 43 AND 128),
  scope          text NOT NULL DEFAULT 'hk',
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hk_oauth_codes_expires_idx ON public.hk_oauth_codes (expires_at);

CREATE TABLE IF NOT EXISTS public.hk_oauth_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  kind         text NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id    text NOT NULL REFERENCES public.hk_oauth_clients(client_id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  scope        text NOT NULL DEFAULT 'hk',
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hk_oauth_tokens_family_idx ON public.hk_oauth_tokens (family_id);
CREATE INDEX IF NOT EXISTS hk_oauth_tokens_user_idx   ON public.hk_oauth_tokens (business_id, user_id);

ALTER TABLE public.hk_oauth_clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_oauth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_oauth_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_oauth_tokens   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hk_oauth_clients  FROM anon, authenticated;
REVOKE ALL ON public.hk_oauth_requests FROM anon, authenticated;
REVOKE ALL ON public.hk_oauth_codes    FROM anon, authenticated;
REVOKE ALL ON public.hk_oauth_tokens   FROM anon, authenticated;

-- Proof - expect 4 rows, each: rls=true · policies=0 · rows=0 · anon_select=false · auth_select=false
--   columns: hk_oauth_clients 6 · hk_oauth_codes 10 · hk_oauth_requests 12 · hk_oauth_tokens 12
SELECT t.relname AS name,
       'rls=' || t.relrowsecurity ||
       ' · policies=' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname) ||
       ' · rows=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t.relname), false, true, '')))[1]::text ||
       ' · anon_select=' || has_table_privilege('anon', t.oid, 'SELECT') ||
       ' · auth_select=' || has_table_privilege('authenticated', t.oid, 'SELECT') ||
       ' · columns=' || (SELECT count(*) FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = t.relname) AS detail
  FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relname IN ('hk_oauth_clients', 'hk_oauth_requests', 'hk_oauth_codes', 'hk_oauth_tokens')
 ORDER BY 1;
