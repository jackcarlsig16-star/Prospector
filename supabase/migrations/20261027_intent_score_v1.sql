-- intent-score-v1 Stage 1 - one 0-100 intent score per company record (S1 / S2), the confirmed weights as data, saved
-- share views (S5) and a daily snapshot for the ▲ / ▼ markers. Run in: Supabase Dashboard -> SQL Editor -> New query ->
-- paste -> Run. Idempotent. No existing row changes except HomeLover's sales_settings gaining score_weights.
--
-- sales_company_scores     NEW. PK (business_id, company_type, company_id); company_type partner | employer | target
--                          (= the Pipeline row key the panel opens by). score, band P1-P4, components jsonb
--                          { visits: { points, inputs }, ... }, source_kind / source_label (legend bucket),
--                          closed (lost / Not a fit: score forced <= 10), flagged_out (closed-won / pilot: out of the
--                          ranking), duplicate_of ('employer:<id>' on a target that doubles an employer), override
--                          (a hand-set P and its expiry), computed_at. Written only by the recompute (Stage 2).
-- sales_company_score_days NEW. One row per company per LA day (score, band) - today vs the last snapshot = ▲ / ▼.
-- sales_settings           + score_weights jsonb (NULL = code defaults; HomeLover seeded with the CONFIRMED table,
--                          Oct 27: source Upside list +6 / Brad-named +12 / other partner referral +12 / inbound +12 /
--                          campaign reply +10 / sent +4 / website +6 / outreach +3 / scout +4; caps visits 25, pages 10,
--                          people 15, apollo_intent 5, fit 15 (unknown headcount 4), research -10..+10 (unresearched -3,
--                          > 60 d decays), engagement 10, stage 10, recency -10..0; bands P1 >= 60, P2 >= 40, P3 >= 15)
--                          + saved_views jsonb (S5 share views, [] by default). Members read (s5_read), writes via API.

CREATE TABLE IF NOT EXISTS public.sales_company_scores (
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  company_type      text NOT NULL CHECK (company_type IN ('partner', 'employer', 'target')),
  company_id        uuid NOT NULL,
  score             int  NOT NULL CHECK (score BETWEEN 0 AND 100),
  band              text NOT NULL CHECK (band IN ('P1', 'P2', 'P3', 'P4')),
  components        jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_kind       text,
  source_label      text,
  source_partner_id uuid,
  closed            boolean NOT NULL DEFAULT false,
  flagged_out       boolean NOT NULL DEFAULT false,
  duplicate_of      text CHECK (duplicate_of IS NULL OR length(duplicate_of) <= 80),
  override          jsonb,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, company_type, company_id)
);
CREATE INDEX IF NOT EXISTS sales_company_scores_rank_idx ON public.sales_company_scores (business_id, score DESC);
ALTER TABLE public.sales_company_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_company_scores;
CREATE POLICY s5_read ON public.sales_company_scores FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_company_scores FROM anon;

CREATE TABLE IF NOT EXISTS public.sales_company_score_days (
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  company_type text NOT NULL CHECK (company_type IN ('partner', 'employer', 'target')),
  company_id   uuid NOT NULL,
  day          date NOT NULL,
  score        int  NOT NULL CHECK (score BETWEEN 0 AND 100),
  band         text NOT NULL CHECK (band IN ('P1', 'P2', 'P3', 'P4')),
  PRIMARY KEY (business_id, company_type, company_id, day)
);
CREATE INDEX IF NOT EXISTS sales_company_score_days_day_idx ON public.sales_company_score_days (business_id, day DESC);
ALTER TABLE public.sales_company_score_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_company_score_days;
CREATE POLICY s5_read ON public.sales_company_score_days FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_company_score_days FROM anon;

ALTER TABLE public.sales_settings ADD COLUMN IF NOT EXISTS score_weights jsonb;
ALTER TABLE public.sales_settings ADD COLUMN IF NOT EXISTS saved_views jsonb NOT NULL DEFAULT '[]'::jsonb;

-- HomeLover's confirmed weights (= DEFAULT_WEIGHTS in api/sales/intentScore.js; the test pins the two equal).
INSERT INTO public.sales_settings (business_id) VALUES ('bc69beab-effd-452d-9e81-fd652333bb95') ON CONFLICT (business_id) DO NOTHING;
UPDATE public.sales_settings
   SET score_weights = $w${"version":1,"thresholds":{"P1":60,"P2":40,"P3":15},"closed_ceiling":10,"override_days":30,"caps":{"visits":25,"pages":10,"apollo_intent":5,"people":15,"fit":15,"research":10,"source":12,"engagement":10,"stage":10,"recency":10},"visits":{"visits_pts":17,"visits_full_at":20,"uniques_pts":8,"uniques_full_at":5,"decay_days":14},"pages":{"hot":10,"other":5,"home":2},"apollo_intent":{"high":5,"medium":3,"low":1,"score_divisor":20},"people":{"buyer":6,"other":2},"fit":{"us_500":15,"mid":8,"small":0,"unknown":4,"partner_category":10,"partner":5},"research":{"why_homelover":4,"first_angle":3,"titles":3,"housing_perk":-10,"watch_outs":-5,"unresearched":-3,"fresh_days":60},"source":{"upside_list":6,"upside_named":12,"partner_referral":12,"person_referral":10,"inbound":12,"campaign_reply":10,"campaign_sent":4,"website":6,"homelover_outreach":3,"scout":4,"event":4,"unknown":0},"engagement":{"replied":10,"clicked":6,"opened":3},"stage":{"contacted":2,"first_email_sent":2,"in_sequence":2,"responded":4,"replied":4,"meeting":8,"meeting_set":8},"stages":{"closed_won":["launched","live","contract","verbal"],"pilot":["proposal_pilot"],"closed":["lost","paused","rejected","on_hold"]},"recency":{"ok_days":30,"mid_days":60,"mid":-5,"far":-10}}$w$::jsonb, updated_at = now()
 WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND score_weights IS NULL;

-- Proof - expect 6 rows:
--   1 sales_company_scores      rls=true · policies=1 · anon_select=false · pk=3 cols · rows=0
--   2 sales_company_score_days  rls=true · policies=1 · anon_select=false · pk=4 cols · rows=0
--   3 sales_settings columns    score_weights,saved_views
--   4 homelover weights         version=1 · P1=60 · P2=40 · P3=15 · upside_list=6 · upside_named=12 · caps.visits=25
--   5 saved_views default       homelover=[] · rows_with_views=0
--   6 addresses                 0 (no email ever lands in weights or views)
SELECT 1 AS n, 'sales_company_scores' AS what,
       'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_company_scores'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_company_scores') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_company_scores', 'SELECT') ||
       ' · pk=' || (SELECT count(*) FROM information_schema.key_column_usage WHERE table_schema = 'public' AND table_name = 'sales_company_scores' AND constraint_name = 'sales_company_scores_pkey') || ' cols' ||
       ' · rows=' || (SELECT count(*) FROM public.sales_company_scores) AS detail
UNION ALL
SELECT 2, 'sales_company_score_days',
       'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_company_score_days'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_company_score_days') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_company_score_days', 'SELECT') ||
       ' · pk=' || (SELECT count(*) FROM information_schema.key_column_usage WHERE table_schema = 'public' AND table_name = 'sales_company_score_days' AND constraint_name = 'sales_company_score_days_pkey') || ' cols' ||
       ' · rows=' || (SELECT count(*) FROM public.sales_company_score_days)
UNION ALL
SELECT 3, 'sales_settings columns', (SELECT string_agg(column_name, ',' ORDER BY column_name DESC) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_settings' AND column_name IN ('score_weights', 'saved_views'))
UNION ALL
SELECT 4, 'homelover weights',
       (SELECT 'version=' || (score_weights->>'version') || ' · P1=' || (score_weights->'thresholds'->>'P1') || ' · P2=' || (score_weights->'thresholds'->>'P2') ||
               ' · P3=' || (score_weights->'thresholds'->>'P3') || ' · upside_list=' || (score_weights->'source'->>'upside_list') ||
               ' · upside_named=' || (score_weights->'source'->>'upside_named') || ' · caps.visits=' || (score_weights->'caps'->>'visits')
          FROM public.sales_settings WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95')
UNION ALL
SELECT 5, 'saved_views default',
       'homelover=' || COALESCE((SELECT saved_views::text FROM public.sales_settings WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95'), 'missing') ||
       ' · rows_with_views=' || (SELECT count(*) FROM public.sales_settings WHERE jsonb_array_length(saved_views) > 0)
UNION ALL
SELECT 6, 'addresses', (SELECT count(*) FROM public.sales_settings WHERE score_weights::text ~ '@' OR saved_views::text ~ '@')::text
ORDER BY 1;
