-- homelover-flow-v1 Stage 1 - one Fit level separate from Due, deprioritize with a reason, the fit radar's US footprint,
-- stored member colors and the flow Activity log. Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Idempotent. Existing rows change only where the spec says (F2: priority 1-4 -> fit_level; F-b: three member colors).
--
-- sales_goals / sales_opportunities / sales_targets
--   + fit_level (strong | good | low | deprioritized), fit_set_by, fit_set_at   (F2: a hand-set Fit wins until cleared)
--   + deprioritized_reason (mostly_outside_us | too_small | wrong_industry | has_housing_perk | upside_owns | other),
--     deprioritized_note (<= 200), deprioritized_at, deprioritized_by          (F4)
--   + us_footprint (mostly_us | mixed | mostly_outside_us), us_footprint_source (research | manual | deprioritize),
--     us_footprint_at                                                          (F3 axis 4; research fills it, never over manual)
--   F2 migration: priority 1 -> strong, 2 -> good, 3 / 4 -> low on rows with a priority and no fit_level yet;
--   fit_set_by / fit_set_at copy priority_set_by / priority_set_at. The priority column stays (its words changed in code).
-- visit_priority_override  + deprioritized_reason, deprioritized_note, deprioritized_at, deprioritized_by (F4, a visitor
--   with no record). Independent of not_a_fit / priority so Bring back restores exactly.
-- sales_settings           + fit_settings jsonb (NULL = code defaults: thresholds strong 70 / good 45, equal axis weights).
-- business_members         + member_color (hex, nullable; F-b). Seeded for HomeLover's Jack (green), Cyrus (amber) and
--   Seif (violet) by first name where such a member exists; others get MEMBER_COLORS by join order from code and are
--   saved then, so a color never shifts.
-- sales_flow_events        NEW - the Activity + Undo log for flow actions on any record kind (deprioritize, bring_back,
--   fit_set, assign, reply_move, meeting_move, they_replied, undo). prev holds what each changed column held before, so
--   Undo restores exactly; rows are never deleted (an Undo adds an 'undo' row and stamps undone_at on the original).
--   record_id is text: a uuid for partner / employer / target, the company_key for a visitor. No address or phone
--   ever lands here (meta carries reasons, stages, keys and names only).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_goals', 'sales_opportunities', 'sales_targets'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS fit_level text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS fit_set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS fit_set_at timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deprioritized_reason text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deprioritized_note text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deprioritized_at timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deprioritized_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS us_footprint text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS us_footprint_source text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS us_footprint_at timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_fit_check');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      (fit_level IS NULL OR fit_level IN (''strong'', ''good'', ''low'', ''deprioritized''))
      AND (deprioritized_reason IS NULL OR deprioritized_reason IN (''mostly_outside_us'', ''too_small'', ''wrong_industry'', ''has_housing_perk'', ''upside_owns'', ''other''))
      AND (deprioritized_note IS NULL OR length(deprioritized_note) <= 200)
      AND (fit_level IS DISTINCT FROM ''deprioritized'' OR deprioritized_reason IS NOT NULL)
      AND (us_footprint IS NULL OR us_footprint IN (''mostly_us'', ''mixed'', ''mostly_outside_us''))
      AND (us_footprint_source IS NULL OR us_footprint_source IN (''research'', ''manual'', ''deprioritize'')))', t, t || '_fit_check');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (business_id, fit_level) WHERE fit_level IS NOT NULL', t || '_fit_idx', t);
  END LOOP;
END $$;

-- F2: the hand-set priority becomes the hand-set Fit (targets have no priority column).
UPDATE public.sales_goals
   SET fit_level = CASE priority WHEN 1 THEN 'strong' WHEN 2 THEN 'good' ELSE 'low' END,
       fit_set_by = priority_set_by, fit_set_at = COALESCE(priority_set_at, now())
 WHERE priority BETWEEN 1 AND 4 AND fit_level IS NULL;
UPDATE public.sales_opportunities
   SET fit_level = CASE priority WHEN 1 THEN 'strong' WHEN 2 THEN 'good' ELSE 'low' END,
       fit_set_by = priority_set_by, fit_set_at = COALESCE(priority_set_at, now())
 WHERE priority BETWEEN 1 AND 4 AND fit_level IS NULL;

ALTER TABLE public.visit_priority_override
  ADD COLUMN IF NOT EXISTS deprioritized_reason text,
  ADD COLUMN IF NOT EXISTS deprioritized_note   text,
  ADD COLUMN IF NOT EXISTS deprioritized_at     timestamptz,
  ADD COLUMN IF NOT EXISTS deprioritized_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.visit_priority_override DROP CONSTRAINT IF EXISTS visit_priority_override_deprioritized_check;
ALTER TABLE public.visit_priority_override ADD CONSTRAINT visit_priority_override_deprioritized_check CHECK (
  (deprioritized_reason IS NULL OR deprioritized_reason IN ('mostly_outside_us', 'too_small', 'wrong_industry', 'has_housing_perk', 'upside_owns', 'other'))
  AND (deprioritized_note IS NULL OR length(deprioritized_note) <= 200));

ALTER TABLE public.sales_settings ADD COLUMN IF NOT EXISTS fit_settings jsonb;

ALTER TABLE public.business_members ADD COLUMN IF NOT EXISTS member_color text;
ALTER TABLE public.business_members DROP CONSTRAINT IF EXISTS business_members_color_check;
ALTER TABLE public.business_members ADD CONSTRAINT business_members_color_check CHECK (member_color IS NULL OR member_color ~ '^#[0-9A-Fa-f]{6}$');
-- F-b seed (mockup B): Jack green, Cyrus amber, Seif violet - HomeLover only, only where that member exists and has no color yet.
UPDATE public.business_members bm
   SET member_color = c.color
  FROM public.profiles p,
       (VALUES ('jack', '#3DBA8C'), ('cyrus', '#D9A441'), ('seif', '#9D7BE0')) AS c(first, color)
 WHERE bm.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95'
   AND bm.user_id = p.id AND bm.member_color IS NULL
   AND lower(split_part(btrim(COALESCE(NULLIF(p.display_name, ''), bm.name)), ' ', 1)) = c.first;

CREATE TABLE IF NOT EXISTS public.sales_flow_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type IN ('partner', 'employer', 'target', 'visitor')),
  record_id   text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 200),
  kind        text NOT NULL CHECK (kind IN ('deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'undo')),
  text        text NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
  prev        jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  by_user     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz,
  undone_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS sales_flow_events_record_idx ON public.sales_flow_events (business_id, record_type, record_id, at DESC);
-- One automatic move per source key (meta.key): the reply / meeting rules never apply twice.
CREATE UNIQUE INDEX IF NOT EXISTS sales_flow_events_key_idx ON public.sales_flow_events (business_id, (meta->>'key')) WHERE meta ? 'key';
ALTER TABLE public.sales_flow_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_flow_events;
CREATE POLICY s5_read ON public.sales_flow_events FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_flow_events FROM anon;

-- Proof - expect 7 rows:
--   1 fit columns        3 tables x 10 columns = 30
--   2 priority migrated  goals=<n> opps=<n> (= rows with priority 1-4) · unmigrated=0
--   3 visit override     4 new columns
--   4 fit_settings       1
--   5 member colors      homelover colored=<0-3> (the members named above that exist)
--   6 sales_flow_events  rls=true · policies=1 · anon_select=false · rows=0
--   7 addresses          0 (no email lands in any new column)
SELECT 1 AS n, 'fit columns' AS what,
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('sales_goals', 'sales_opportunities', 'sales_targets')
          AND column_name IN ('fit_level', 'fit_set_by', 'fit_set_at', 'deprioritized_reason', 'deprioritized_note', 'deprioritized_at', 'deprioritized_by', 'us_footprint', 'us_footprint_source', 'us_footprint_at')) AS detail
UNION ALL
SELECT 2, 'priority migrated',
       'goals=' || (SELECT count(*) FROM public.sales_goals WHERE priority BETWEEN 1 AND 4 AND fit_level IS NOT NULL) ||
       ' opps=' || (SELECT count(*) FROM public.sales_opportunities WHERE priority BETWEEN 1 AND 4 AND fit_level IS NOT NULL) ||
       ' · unmigrated=' || ((SELECT count(*) FROM public.sales_goals WHERE priority BETWEEN 1 AND 4 AND fit_level IS NULL) + (SELECT count(*) FROM public.sales_opportunities WHERE priority BETWEEN 1 AND 4 AND fit_level IS NULL))
UNION ALL
SELECT 3, 'visit override', (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'visit_priority_override' AND column_name LIKE 'deprioritized_%')
UNION ALL
SELECT 4, 'fit_settings', (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_settings' AND column_name = 'fit_settings')
UNION ALL
SELECT 5, 'member colors', 'homelover colored=' || (SELECT count(*) FROM public.business_members WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND member_color IS NOT NULL)
UNION ALL
SELECT 6, 'sales_flow_events',
       'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_flow_events'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_flow_events') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_flow_events', 'SELECT') ||
       ' · rows=' || (SELECT count(*) FROM public.sales_flow_events)
UNION ALL
SELECT 7, 'addresses', ((SELECT count(*) FROM public.sales_goals WHERE deprioritized_note ~ '@') + (SELECT count(*) FROM public.sales_opportunities WHERE deprioritized_note ~ '@') + (SELECT count(*) FROM public.sales_targets WHERE deprioritized_note ~ '@'))::text
ORDER BY n;
