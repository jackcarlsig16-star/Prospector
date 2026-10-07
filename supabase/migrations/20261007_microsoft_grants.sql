-- microsoft-connect-v1 Stage 1 - Microsoft 365 access lives server-side, per user.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- One row per signed-in person: the Microsoft account they connected, its
-- tenant, the scopes Microsoft actually granted, and the refresh token
-- encrypted with MICROSOFT_TOKEN_KEY (AES-256-GCM, api/lib/microsoftGrants.js).
-- Microsoft rotates the refresh token on every use, so it's rewritten each
-- refresh. Access tokens are minted on demand and never stored or sent to
-- the browser. No policies: only the service key (server) can read or write it.

CREATE TABLE IF NOT EXISTS public.microsoft_grants (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_email     text NOT NULL CHECK (account_email = lower(account_email)),
  tenant_id         text NOT NULL,
  scopes            text[] NOT NULL DEFAULT '{}',
  refresh_token_enc text NOT NULL,
  connected_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz,
  error             text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.microsoft_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.microsoft_grants FROM anon, authenticated;

SELECT relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'microsoft_grants') AS policies
FROM pg_class WHERE relname = 'microsoft_grants';
