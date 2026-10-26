-- hkos-data-foundation-v1 Stage 1 - the HumanKind Sales OS data layer: the hk_* tables (D1), service-key only.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste the whole file -> Run. Re-runnable (IF NOT EXISTS,
-- ON CONFLICT DO NOTHING).
--
-- Every table: business_id -> businesses ON DELETE CASCADE; RLS ENABLED with NO policies; anon + authenticated
-- revoked - every read and write goes through /api/hk/:businessId/* behind hkGate with the service key.
-- Contact addresses live in hk_contacts.email (the scoped HumanKind exception, Jack Oct 26) and hk_replies.from_email
-- (server-only, never returned by a route). No phone column anywhere.
-- Seeds: ONE hk_settings row for HumanKind (stats from skill v2, stats_confirmed_at NULL so the UI asks to confirm;
-- banned_phrases = api/hk/lintSeed.json banned_words) and hk_member_prefs slot 1 for the signed-in owner. The second
-- member has no profile yet (business_members.user_id is null) - slot 2 is seeded when they sign in (Stage 2).
-- Nothing from the mockups is seeded.

CREATE TABLE IF NOT EXISTS public.hk_brands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  normalized_name text NOT NULL,
  domain          text,
  aliases         text[] NOT NULL DEFAULT '{}',
  segment         text NOT NULL DEFAULT 'sponsor_brand' CHECK (segment IN ('sponsor_brand', 'creator', 'nonprofit', 'press', 'podcast', 'university')),
  category        text,
  niche           text,
  size_band       text,
  is_local        boolean NOT NULL DEFAULT false,
  city            text,
  neighborhood    text,
  status          text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'claimed', 'drafted', 'sent', 'bumped', 'final_sent', 'replied', 'meeting', 'signed', 'passed', 'skipped', 'sponsor')),
  owner_user_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_unclear   boolean NOT NULL DEFAULT false,
  relationship    text NOT NULL DEFAULT 'prospect' CHECK (relationship IN ('prospect', 'sponsor', 'founding_partner', 'do_not_contact')),
  dnc_reason      text,
  source          text NOT NULL DEFAULT 'user_supplied' CHECK (source IN ('sourced', 'user_supplied', 'apollo_list', 'places', 'import')),
  last_touch_at   timestamptz,
  next_due_at     timestamptz,
  notes           text,
  challenge_idea  text,
  origin_hook     text,
  reward_idea     text,
  import_ref      text,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS hk_brands_live_name_uniq   ON public.hk_brands (business_id, normalized_name) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hk_brands_live_domain_uniq ON public.hk_brands (business_id, domain) WHERE domain IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS hk_brands_business_status_idx ON public.hk_brands (business_id, status);
CREATE INDEX IF NOT EXISTS hk_brands_business_owner_idx  ON public.hk_brands (business_id, owner_user_id);
-- Fuzzy name search only where pg_trgm is already enabled (Stage 0 could not read pg_extension through PostgREST);
-- matching itself runs in code (api/sales/intakeMatch.js), so the index is a speed-up, not a dependency.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS hk_brands_normalized_name_trgm_idx ON public.hk_brands USING gin (normalized_name gin_trgm_ops)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.hk_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id         uuid NOT NULL REFERENCES public.hk_brands(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  title            text,
  email            text CHECK (email IS NULL OR (length(email) <= 254 AND email ~* '^[^[:space:]@<>()]+@[^[:space:]@<>()]+\.[a-z]{2,}$')),
  email_source     text CHECK (email_source IN ('apollo_verified', 'site_published', 'user_supplied', 'import')),
  apollo_person_id text,
  is_primary       boolean NOT NULL DEFAULT false,
  role_checked_at  timestamptz,
  left_company     boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hk_contacts_one_primary_uniq ON public.hk_contacts (brand_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS hk_contacts_brand_idx ON public.hk_contacts (business_id, brand_id);

CREATE TABLE IF NOT EXISTS public.hk_touches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id          uuid NOT NULL REFERENCES public.hk_brands(id) ON DELETE CASCADE,
  contact_id        uuid REFERENCES public.hk_contacts(id) ON DELETE SET NULL,
  sender_user_id    uuid NOT NULL REFERENCES public.profiles(id),
  channel           text NOT NULL CHECK (channel IN ('email', 'ig_dm', 'linkedin', 'contact_form', 'phone', 'in_person')),
  kind              text NOT NULL CHECK (kind IN ('cold', 'bump', 'dm_text', 'final', 'reply', 'outside')),
  subject           text,
  body_text         text,
  body_html         text,
  challenge_concept text,
  gmail_draft_id    text,
  gmail_thread_id   text,
  gmail_message_id  text,
  state             text NOT NULL DEFAULT 'drafted' CHECK (state IN ('drafted', 'sent', 'discarded')),
  drafted_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  lint_passed       boolean,
  created_by        text NOT NULL CHECK (created_by IN ('claude', 'system', 'user')),
  campaign_id       uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hk_touches_brand_idx  ON public.hk_touches (business_id, brand_id);
CREATE INDEX IF NOT EXISTS hk_touches_thread_idx ON public.hk_touches (gmail_thread_id);

CREATE TABLE IF NOT EXISTS public.hk_replies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id            uuid NOT NULL REFERENCES public.hk_brands(id) ON DELETE CASCADE,
  touch_id            uuid REFERENCES public.hk_touches(id) ON DELETE SET NULL,
  gmail_message_id    text,
  gmail_thread_id     text,
  from_name           text,
  from_domain         text,
  from_email          text,
  received_at         timestamptz NOT NULL,
  label               text CHECK (label IN ('interested', 'pricing', 'referral', 'decline', 'auto_reply', 'prefers_email', 'new_thread', 'other')),
  label_overridden_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  summary             text,
  handled             boolean NOT NULL DEFAULT false,
  handled_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handled_at          timestamptz,
  snoozed_until       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hk_replies_message_uniq ON public.hk_replies (business_id, gmail_message_id) WHERE gmail_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hk_replies_brand_idx ON public.hk_replies (business_id, brand_id);

CREATE TABLE IF NOT EXISTS public.hk_sponsor_periods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id    uuid NOT NULL REFERENCES public.hk_brands(id) ON DELETE CASCADE,
  period      text NOT NULL CHECK (period = 'launch' OR period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind        text NOT NULL CHECK (kind IN ('launch', 'monthly')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, period, kind)
);

CREATE TABLE IF NOT EXISTS public.hk_settings (
  business_id          uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  members_stat         int,
  completions_stat     int,
  stats_confirmed_at   timestamptz,
  market_line_local    text,
  market_line_national text,
  subject_format       text,
  banned_phrases       text[] NOT NULL DEFAULT '{}',
  bump_after_days      int NOT NULL DEFAULT 5,
  dm_after_days        int NOT NULL DEFAULT 9,
  final_after_days     int NOT NULL DEFAULT 14,
  max_email_touches    int NOT NULL DEFAULT 3,
  apollo_batch_cap     int NOT NULL DEFAULT 25,
  digest_time          text NOT NULL DEFAULT '07:30',
  digest_days          text NOT NULL DEFAULT 'weekdays',
  timezone             text NOT NULL DEFAULT 'America/Chicago',
  modules              jsonb NOT NULL DEFAULT '{}',
  theme                jsonb NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hk_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_kind    text NOT NULL CHECK (actor_kind IN ('user', 'claude', 'system')),
  entity_type   text NOT NULL,
  entity_id     uuid,
  action        text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hk_events_business_time_idx ON public.hk_events (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hk_events_entity_idx        ON public.hk_events (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.hk_duplicate_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_a     uuid NOT NULL REFERENCES public.hk_brands(id) ON DELETE CASCADE,
  brand_b     uuid NOT NULL REFERENCES public.hk_brands(id) ON DELETE CASCADE,
  verdict     text NOT NULL CHECK (verdict IN ('not_duplicate', 'merged')),
  decided_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  pair_lo     uuid GENERATED ALWAYS AS (LEAST(brand_a, brand_b)) STORED,
  pair_hi     uuid GENERATED ALWAYS AS (GREATEST(brand_a, brand_b)) STORED,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (brand_a <> brand_b),
  UNIQUE (business_id, pair_lo, pair_hi)
);

CREATE TABLE IF NOT EXISTS public.hk_import_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  source        text NOT NULL,
  rows_read     int NOT NULL DEFAULT 0,
  created_count int NOT NULL DEFAULT 0,
  matched_count int NOT NULL DEFAULT 0,
  flagged_count int NOT NULL DEFAULT 0,
  started_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  finished_at   timestamptz,
  undone_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hk_ignored_senders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  domain      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id, domain)
);

CREATE TABLE IF NOT EXISTS public.hk_member_prefs (
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  avatar_slot  int CHECK (avatar_slot BETWEEN 1 AND 4),
  owner_filter text NOT NULL DEFAULT 'me' CHECK (owner_filter IN ('me', 'all') OR owner_filter ~ '^[0-9a-f-]{36}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS hk_member_prefs_slot_uniq ON public.hk_member_prefs (business_id, avatar_slot) WHERE avatar_slot IS NOT NULL;

ALTER TABLE public.hk_brands              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_contacts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_touches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_replies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_sponsor_periods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_duplicate_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_import_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_ignored_senders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hk_member_prefs        ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hk_brands              FROM anon, authenticated;
REVOKE ALL ON public.hk_contacts            FROM anon, authenticated;
REVOKE ALL ON public.hk_touches             FROM anon, authenticated;
REVOKE ALL ON public.hk_replies             FROM anon, authenticated;
REVOKE ALL ON public.hk_sponsor_periods     FROM anon, authenticated;
REVOKE ALL ON public.hk_settings            FROM anon, authenticated;
REVOKE ALL ON public.hk_events              FROM anon, authenticated;
REVOKE ALL ON public.hk_duplicate_decisions FROM anon, authenticated;
REVOKE ALL ON public.hk_import_runs         FROM anon, authenticated;
REVOKE ALL ON public.hk_ignored_senders     FROM anon, authenticated;
REVOKE ALL ON public.hk_member_prefs        FROM anon, authenticated;

-- Seeds (HumanKind only). Stats and wording REVISABLE; stats_confirmed_at stays NULL on purpose.
INSERT INTO public.hk_settings (business_id, members_stat, completions_stat, subject_format, market_line_local, market_line_national, banned_phrases)
VALUES ('981b790c-a3b0-4265-b32e-1f701d5731ff', 1500, 6000, 'HumanKind x [Brand] - [descriptor]',
        'launched in Chicago in April and built for our Chicago members',
        'launched in Chicago in April and growing nationally',
        ARRAY['synergies', 'solutions', 'leverage', 'excited to connect', 'hope this finds you well', 'reach out', 'touch base', 'circle back', 'innovative', 'best-in-class', 'seamlessly'])
ON CONFLICT (business_id) DO NOTHING;
INSERT INTO public.hk_member_prefs (business_id, user_id, avatar_slot)
VALUES ('981b790c-a3b0-4265-b32e-1f701d5731ff', '68e2a844-90c2-4051-b2f9-1604c81fc8b3', 1)
ON CONFLICT (business_id, user_id) DO NOTHING;

-- Proof - expect 14 rows:
--   11 "table" rows: rls=true · policies=0 · rows=0 (hk_settings 1, hk_member_prefs 1) · anon_select=false · auth_select=false
--   "seed" hk_settings: members=1500 · completions=6000 · confirmed=null · banned=11 · subject=HumanKind x [Brand] - [descriptor]
--   "seed" hk_member_prefs: slots=1 (slot 1 = the owner)
--   "ext"  pg_trgm: installed=true|false · trgm_index=true|false (both false is fine - matching runs in code)
SELECT 'table' AS kind, t.relname AS name,
       'rls=' || t.relrowsecurity ||
       ' · policies=' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname) ||
       ' · rows=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t.relname), false, true, '')))[1]::text ||
       ' · anon_select=' || has_table_privilege('anon', t.oid, 'SELECT') ||
       ' · auth_select=' || has_table_privilege('authenticated', t.oid, 'SELECT') ||
       ' · columns=' || (SELECT count(*) FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = t.relname) AS detail
  FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relname IN ('hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_events', 'hk_duplicate_decisions', 'hk_import_runs', 'hk_ignored_senders', 'hk_member_prefs')
UNION ALL
SELECT 'seed', 'hk_settings',
       coalesce((SELECT 'members=' || members_stat || ' · completions=' || completions_stat || ' · confirmed=' || coalesce(stats_confirmed_at::text, 'null') || ' · banned=' || cardinality(banned_phrases) || ' · subject=' || subject_format
                   FROM public.hk_settings WHERE business_id = '981b790c-a3b0-4265-b32e-1f701d5731ff'), 'MISSING')
UNION ALL
SELECT 'seed', 'hk_member_prefs',
       'slots=' || (SELECT count(*) FROM public.hk_member_prefs WHERE business_id = '981b790c-a3b0-4265-b32e-1f701d5731ff')
UNION ALL
SELECT 'ext', 'pg_trgm',
       'installed=' || EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') ||
       ' · trgm_index=' || EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'hk_brands_normalized_name_trgm_idx')
ORDER BY 1 DESC, 2;
