-- mailbox-connections-v1 REV2 Stage 1 - many Google accounts per person (M1) and the workspace -> mailbox tethers (M2).
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste the whole file -> Run. Re-runnable (every step checks
-- the catalog first). Jack: do NOT connect or reconnect Google between running this and Stage 2 going Live - today's
-- saveGrant upserts on user_id, which stops being a unique key here (Stage 2 switches it to (user_id, google_email)).
--
-- M1 google_grants: id uuid becomes the PRIMARY KEY (the old user_id PK is dropped; user_id keeps its FK + an index);
--    is_default (every existing row = true: one account per person today), error ('needs_reconnect' or NULL), error_at,
--    last_used_at; UNIQUE (user_id, google_email); at most one default per user (partial unique index); addresses lowercase.
-- M2 workspace_mailboxes: one Google mailbox per person per workspace, purposes within drafts / inbox / calendar; RLS on,
--    no policies, anon + authenticated revoked (server only). Nothing is ever re-pointed automatically.

ALTER TABLE public.google_grants ADD COLUMN IF NOT EXISTS id           uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.google_grants ADD COLUMN IF NOT EXISTS is_default   boolean NOT NULL DEFAULT false;
ALTER TABLE public.google_grants ADD COLUMN IF NOT EXISTS error        text;
ALTER TABLE public.google_grants ADD COLUMN IF NOT EXISTS error_at     timestamptz;
ALTER TABLE public.google_grants ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- Every row today is its person's only account, so it is the default. The one-default rule below then holds.
UPDATE public.google_grants SET is_default = true WHERE is_default = false;
UPDATE public.google_grants SET google_email = lower(google_email) WHERE google_email <> lower(google_email);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.google_grants'::regclass AND conname = 'google_grants_pkey'
             AND pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id)') THEN
    ALTER TABLE public.google_grants DROP CONSTRAINT google_grants_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.google_grants'::regclass AND contype = 'p') THEN
    ALTER TABLE public.google_grants ADD CONSTRAINT google_grants_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_grants_user_email_uniq') THEN
    ALTER TABLE public.google_grants ADD CONSTRAINT google_grants_user_email_uniq UNIQUE (user_id, google_email);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_grants_email_lower_check') THEN
    ALTER TABLE public.google_grants ADD CONSTRAINT google_grants_email_lower_check CHECK (google_email = lower(google_email));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_grants_error_check') THEN
    ALTER TABLE public.google_grants ADD CONSTRAINT google_grants_error_check CHECK (error IS NULL OR error IN ('needs_reconnect'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS google_grants_one_default_per_user ON public.google_grants (user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS google_grants_user_idx ON public.google_grants (user_id);

CREATE TABLE IF NOT EXISTS public.workspace_mailboxes (
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('google')),
  google_grant_id uuid NOT NULL REFERENCES public.google_grants(id) ON DELETE CASCADE,
  purposes        text[] NOT NULL CHECK (purposes <@ ARRAY['drafts', 'inbox', 'calendar'] AND cardinality(purposes) > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id, provider)
);
CREATE INDEX IF NOT EXISTS workspace_mailboxes_grant_idx ON public.workspace_mailboxes (google_grant_id);
ALTER TABLE public.workspace_mailboxes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_mailboxes FROM anon, authenticated;

-- Verification - expect 6 rows:
--   "grants per user"   <n> users, each "1" (today: 2 users)        "defaults per user"  every user = 1, max 1
--   "grant flags"       error_null=<all rows> · needs_reconnect=0     "tethers"            workspace_mailboxes rows=0
--   "constraints"       pkey=PRIMARY KEY (id) · user_email_uniq=present · one_default_idx=present · email_lower=present
--   "rls"               google_grants rls=true anon=false · workspace_mailboxes rls=true policies=0 anon=false auth=false
SELECT 'grants per user' AS kind,
       (SELECT count(DISTINCT user_id) FROM public.google_grants) || ' users · per user ' ||
       coalesce((SELECT string_agg(n::text, ',' ORDER BY n) FROM (SELECT count(*) AS n FROM public.google_grants GROUP BY user_id) s), 'none') AS detail
UNION ALL
SELECT 'defaults per user',
       'min ' || coalesce((SELECT min(n) FROM (SELECT count(*) FILTER (WHERE is_default) AS n FROM public.google_grants GROUP BY user_id) s), 0)
       || ' · max ' || coalesce((SELECT max(n) FROM (SELECT count(*) FILTER (WHERE is_default) AS n FROM public.google_grants GROUP BY user_id) s), 0)
UNION ALL
SELECT 'grant flags',
       'error_null=' || (SELECT count(*) FROM public.google_grants WHERE error IS NULL) || ' · needs_reconnect=' || (SELECT count(*) FROM public.google_grants WHERE error = 'needs_reconnect')
       || ' · rows=' || (SELECT count(*) FROM public.google_grants)
UNION ALL
SELECT 'tethers', 'workspace_mailboxes rows=' || (SELECT count(*) FROM public.workspace_mailboxes)
UNION ALL
SELECT 'constraints',
       'pkey=' || coalesce((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.google_grants'::regclass AND contype = 'p'), 'MISSING')
       || ' · user_email_uniq=' || CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_grants_user_email_uniq') THEN 'present' ELSE 'MISSING' END
       || ' · one_default_idx=' || CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'google_grants_one_default_per_user') THEN 'present' ELSE 'MISSING' END
       || ' · email_lower=' || CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_grants_email_lower_check') THEN 'present' ELSE 'MISSING' END
UNION ALL
SELECT 'rls',
       'google_grants rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.google_grants'::regclass) || ' anon=' || has_table_privilege('anon', 'public.google_grants', 'SELECT')
       || ' · workspace_mailboxes rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.workspace_mailboxes'::regclass)
       || ' policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_mailboxes')
       || ' anon=' || has_table_privilege('anon', 'public.workspace_mailboxes', 'SELECT') || ' auth=' || has_table_privilege('authenticated', 'public.workspace_mailboxes', 'SELECT')
ORDER BY 1;
