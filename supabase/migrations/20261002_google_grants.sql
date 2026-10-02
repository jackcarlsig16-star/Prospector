-- FIX google-calendar-consent-once - Google access lives server-side, per user.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- One row per signed-in person: the Google account they connected, which
-- Prospector features it covers, and the refresh token encrypted with
-- GOOGLE_TOKEN_KEY (AES-256-GCM, api/lib/googleGrants.js). Access tokens are
-- minted on demand by the server and never stored or sent to the browser.
-- No policies: only the service key (server) can read or write it.

CREATE TABLE IF NOT EXISTS public.google_grants (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  google_email      text NOT NULL,
  features          text[] NOT NULL DEFAULT '{}' CHECK (features <@ ARRAY['gmail', 'calendar', 'slides']),
  refresh_token_enc text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_grants FROM anon, authenticated;
