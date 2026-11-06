-- people-v2 Stage 1 - sales_person_activity: one materialised per-person email summary for Pipeline › People, refreshed
-- by the existing Apollo activity sync (api/sales/personActivity.js writePersonActivity, after syncActivity and after
-- syncPartnerContacts in api/sales/sync.js) - never on page load, never a cron. Sibling-table RLS: members read (s5_read),
-- anon nothing; every write goes through the server's service key.
--
-- Backfill (same file): the counts and dates from sales_email_messages + sales_email_activity so the table is never empty
-- after this runs. opened_h mirrors the bot-open rule of api/sales/heatScore.js isBotOpen (a tracking service, a "generic
-- linux" agent, or an open within 60 s of delivery unless the agent is Gmail) and clicked mirrors the scanner rule
-- (a click within 120 s of delivery, or with no delivery time, is a scanner - nextBestAction.js). heat / heat_band stay
-- NULL here on purpose: the score lives in ONE JS function (heatScore.js scoreProspect + huddleSignals) and the first
-- sync after this migration rewrites every row through it. Nothing here reads or stores an address.

CREATE TABLE IF NOT EXISTS public.sales_person_activity (
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  person_key     text NOT NULL CHECK (person_key ~ '^(prospect|contact|person):.+$' AND length(person_key) <= 140),
  source_table   text NOT NULL CHECK (source_table IN ('sales_prospect_state', 'partner_contacts', 'sales_people')),
  contact_id     text CHECK (contact_id IS NULL OR length(contact_id) <= 80),
  sent           int  NOT NULL DEFAULT 0 CHECK (sent >= 0),
  opened_h       int  NOT NULL DEFAULT 0 CHECK (opened_h >= 0),
  bot_opens      int  NOT NULL DEFAULT 0 CHECK (bot_opens >= 0),
  clicked        int  NOT NULL DEFAULT 0 CHECK (clicked >= 0),
  replied        int  NOT NULL DEFAULT 0 CHECK (replied >= 0),
  last_sent_at   timestamptz,
  last_open_at   timestamptz,
  last_click_at  timestamptz,
  last_reply_at  timestamptz,
  reply_class    text CHECK (reply_class IS NULL OR length(reply_class) <= 80),
  heat           int  CHECK (heat IS NULL OR heat >= 0),
  heat_band      text CHECK (heat_band IS NULL OR heat_band IN ('hot', 'warm', 'cold')),
  last_signal_at timestamptz,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, person_key)
);
CREATE INDEX IF NOT EXISTS sales_person_activity_contact_idx ON public.sales_person_activity (business_id, contact_id);
CREATE INDEX IF NOT EXISTS sales_person_activity_heat_idx ON public.sales_person_activity (business_id, heat DESC);

ALTER TABLE public.sales_person_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_person_activity;
CREATE POLICY s5_read ON public.sales_person_activity FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_person_activity FROM anon;

-- Backfill: every prospect with a message or an activity row, counts + dates (heat left to the sync).
WITH msgs AS (
  SELECT m.business_id, m.contact_id, m.apollo_message_id, m.delivered_at, m.replied, m.reply_class,
         COALESCE(m.replied_at, m.replied_seen_at) AS reply_at
  FROM public.sales_email_messages m
),
ev AS (
  SELECT a.business_id, a.contact_id, a.event, a.occurred_at,
         CASE
           WHEN a.event = 'open' THEN (
             a.tracking_service IS NOT NULL
             OR a.user_agent ~* 'generic linux'
             OR (m.delivered_at IS NOT NULL AND NOT (a.user_agent ~* '^gmail$')
                 AND EXTRACT(EPOCH FROM (a.occurred_at - m.delivered_at)) <= 60)
           )
           WHEN a.event = 'click' THEN (m.delivered_at IS NULL OR EXTRACT(EPOCH FROM (a.occurred_at - m.delivered_at)) <= 120)
           ELSE false
         END AS automated
  FROM public.sales_email_activity a
  LEFT JOIN public.sales_email_messages m
    ON m.business_id = a.business_id AND m.apollo_message_id = a.apollo_message_id
  WHERE a.event IN ('open', 'click')
),
people AS (
  SELECT business_id, contact_id FROM msgs
  UNION
  SELECT business_id, contact_id FROM ev
),
agg AS (
  SELECT p.business_id, p.contact_id,
         (SELECT count(*) FROM msgs x WHERE x.business_id = p.business_id AND x.contact_id = p.contact_id AND x.delivered_at IS NOT NULL) AS sent,
         (SELECT count(*) FROM ev x WHERE x.business_id = p.business_id AND x.contact_id = p.contact_id AND x.event = 'open' AND NOT x.automated) AS opened_h,
         (SELECT count(*) FROM ev x WHERE x.business_id = p.business_id AND x.contact_id = p.contact_id AND x.event = 'open' AND x.automated) AS bot_opens,
         (SELECT count(*) FROM ev x WHERE x.business_id = p.business_id AND x.contact_id = p.contact_id AND x.event = 'click' AND NOT x.automated) AS clicked,
         (SELECT count(*) FROM msgs x WHERE x.business_id = p.business_id AND x.contact_id = p.contact_id AND x.replied) AS replied,
         (SELECT max(delivered_at) FROM msgs x WHERE x.business_id = p.business_id AND x.contact_id = p.contact_id) AS last_sent_at,
         (SELECT max(occurred_at) FROM ev x WHERE x.business_id = p.business_id AND x.contact_id = p.contact_id AND x.event = 'open' AND NOT x.automated) AS last_open_at,
         (SELECT max(occurred_at) FROM ev x WHERE x.business_id = p.business_id AND x.contact_id = p.contact_id AND x.event = 'click' AND NOT x.automated) AS last_click_at,
         (SELECT max(COALESCE(reply_at, delivered_at)) FROM msgs x WHERE x.business_id = p.business_id AND x.contact_id = p.contact_id AND x.replied) AS last_reply_at,
         (SELECT reply_class FROM msgs x WHERE x.business_id = p.business_id AND x.contact_id = p.contact_id AND x.replied ORDER BY COALESCE(reply_at, delivered_at) DESC NULLS LAST LIMIT 1) AS reply_class
  FROM people p
)
INSERT INTO public.sales_person_activity
  (business_id, person_key, source_table, contact_id, sent, opened_h, bot_opens, clicked, replied, last_sent_at, last_open_at, last_click_at, last_reply_at, reply_class, heat, heat_band, last_signal_at, computed_at)
SELECT a.business_id, 'prospect:' || a.contact_id, 'sales_prospect_state', a.contact_id,
       a.sent, a.opened_h, a.bot_opens, a.clicked, a.replied, a.last_sent_at, a.last_open_at, a.last_click_at, a.last_reply_at, a.reply_class,
       NULL, NULL, GREATEST(a.last_open_at, a.last_click_at, a.last_reply_at), now()
FROM agg a
JOIN public.sales_prospect_state s ON s.business_id = a.business_id AND s.contact_id = a.contact_id
ON CONFLICT (business_id, person_key) DO UPDATE SET
  sent = EXCLUDED.sent, opened_h = EXCLUDED.opened_h, bot_opens = EXCLUDED.bot_opens, clicked = EXCLUDED.clicked, replied = EXCLUDED.replied,
  last_sent_at = EXCLUDED.last_sent_at, last_open_at = EXCLUDED.last_open_at, last_click_at = EXCLUDED.last_click_at, last_reply_at = EXCLUDED.last_reply_at,
  reply_class = EXCLUDED.reply_class, last_signal_at = EXCLUDED.last_signal_at, computed_at = now();

-- Proof (expected on HomeLover, Nov 6: 1 columns=18 · 2 rls=true · policies=1 · anon_select=false · 3 rows=196 (every prospect
-- with a message or an activity row) · sent=294 (one per delivered message) · 4 heat pending=196 (the next sync fills it) ·
-- 5 addresses=0).
SELECT 1 AS n, 'columns' AS what, (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_person_activity') AS value
UNION ALL
SELECT 2, 'rls',
       'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_person_activity'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_person_activity') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_person_activity', 'SELECT')
UNION ALL
SELECT 3, 'backfill',
       'rows=' || (SELECT count(*) FROM public.sales_person_activity) ||
       ' · sent=' || (SELECT COALESCE(sum(sent), 0) FROM public.sales_person_activity) ||
       ' · opened_h=' || (SELECT COALESCE(sum(opened_h), 0) FROM public.sales_person_activity) ||
       ' · bot_opens=' || (SELECT COALESCE(sum(bot_opens), 0) FROM public.sales_person_activity) ||
       ' · clicked=' || (SELECT COALESCE(sum(clicked), 0) FROM public.sales_person_activity) ||
       ' · replied=' || (SELECT count(*) FROM public.sales_person_activity WHERE replied > 0)
UNION ALL
SELECT 4, 'heat pending', (SELECT count(*)::text FROM public.sales_person_activity WHERE heat IS NULL)
UNION ALL
SELECT 5, 'addresses', (SELECT count(*)::text FROM public.sales_person_activity WHERE person_key ~ '@' OR contact_id ~ '@' OR reply_class ~ '@')
ORDER BY n;
