-- email-funnel-v1 Stage 1 (F3 + Stage 0 rulings R1 / R4) - two tables.
--
-- 1. sales_email_delivered: ONE row per delivered Apollo message - the funnel's denominator (R1). Stage 0 measured that
--    sales_email_messages is engaged-only (api/sales/activitySync.js:19 syncs opened / clicked / replied messages: 47 rows
--    against Apollo's 780 delivered since Oct 26), so no rate is ever computed on it. The weekly counts fetch
--    (api/sales/emailCounts.js fetchWeek) already pages every delivered message with its contact_id and account_id and
--    kept only the per-day counts; from this stage it also writes these rows (0 extra Apollo calls). delivered_day is
--    the LA calendar day of Apollo's completed_at, the same bucketing sales_email_daily_counts uses, so Σ rows per day
--    equals the counts table's delivered for that day once a week is fetched. Backfill since Oct 26 through the same
--    fetch (declared, capped at 20 calls). No address, no phone, no name is stored here: ids, mailbox, sequence, step.
--    mailbox = the sending mailbox's address as sales_email_daily_counts.mailbox already stores it (the same column, the
--    same two values) - never a recipient.
-- 2. sales_funnel_days: ONE row per workspace per LA day - the funnel kept day by day (F3), written by the existing syncs
--    (the Apollo sync refreshes the email steps, the visitor pull the visit steps for the days its window covers; last
--    write of the day wins), never a cron of its own, never page load. Backfilled from Oct 20 (the first web_visits day)
--    by the companion script: a day with one side only carries the other side as 0 and says so in sides_present (R4);
--    a visit window longer than a day attributes its visits to the window's last day with window_days = its length.
--    Steps are COHORT numbers (R3): of the messages delivered that day, what has happened to them so far - so a day's
--    row is rewritten by every later sync, not frozen.
-- Sibling-table RLS (sales_person_heat_days, sales_email_daily_counts): members read (s5_read), anon nothing; every
-- write goes through the server's service key.

CREATE TABLE IF NOT EXISTS public.sales_email_delivered (
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  apollo_message_id text NOT NULL CHECK (length(apollo_message_id) BETWEEN 1 AND 80),
  contact_id        text NOT NULL CHECK (length(contact_id) BETWEEN 1 AND 80),
  account_id        text CHECK (account_id IS NULL OR length(account_id) BETWEEN 1 AND 80),
  mailbox           text NOT NULL CHECK (mailbox = lower(mailbox) AND length(mailbox) <= 200),
  delivered_at      timestamptz NOT NULL,
  delivered_day     date NOT NULL,
  sequence_id       text NOT NULL DEFAULT '' CHECK (length(sequence_id) <= 80),
  step              int  NOT NULL DEFAULT 0 CHECK (step >= 0),
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, apollo_message_id)
);
CREATE INDEX IF NOT EXISTS sales_email_delivered_day_idx     ON public.sales_email_delivered (business_id, delivered_day);
CREATE INDEX IF NOT EXISTS sales_email_delivered_contact_idx ON public.sales_email_delivered (business_id, contact_id);

ALTER TABLE public.sales_email_delivered ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_email_delivered;
CREATE POLICY s5_read ON public.sales_email_delivered FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_email_delivered FROM anon;

CREATE TABLE IF NOT EXISTS public.sales_funnel_days (
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  day                date NOT NULL,
  delivered          int  NOT NULL DEFAULT 0 CHECK (delivered >= 0),
  people_emailed     int  NOT NULL DEFAULT 0 CHECK (people_emailed >= 0),
  companies_emailed  int  NOT NULL DEFAULT 0 CHECK (companies_emailed >= 0),
  companies_no_record int NOT NULL DEFAULT 0 CHECK (companies_no_record >= 0),
  human_opens        int  NOT NULL DEFAULT 0 CHECK (human_opens >= 0),
  human_clicks       int  NOT NULL DEFAULT 0 CHECK (human_clicks >= 0),
  companies_visited  int  NOT NULL DEFAULT 0 CHECK (companies_visited >= 0),
  people_identified  int  NOT NULL DEFAULT 0 CHECK (people_identified >= 0),
  replies            int  NOT NULL DEFAULT 0 CHECK (replies >= 0),
  meetings           int  NOT NULL DEFAULT 0 CHECK (meetings >= 0),
  sides_present      text NOT NULL CHECK (sides_present IN ('email', 'visits', 'both', 'none')),
  window_days        int  NOT NULL DEFAULT 1 CHECK (window_days >= 1),
  computed_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, day),
  CHECK (human_opens <= delivered AND human_clicks <= delivered AND replies <= delivered AND people_emailed <= delivered
         AND companies_emailed <= delivered AND companies_no_record <= companies_emailed
         AND companies_visited <= companies_emailed AND people_identified <= people_emailed)
);
CREATE INDEX IF NOT EXISTS sales_funnel_days_day_idx ON public.sales_funnel_days (business_id, day);

ALTER TABLE public.sales_funnel_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_funnel_days;
CREATE POLICY s5_read ON public.sales_funnel_days FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_funnel_days FROM anon;

-- Proof (expected right after this runs: 1 delivered columns=10 · 2 funnel columns=15 · 3 rls=true · policies=1 ·
-- anon_select=false for both · 4 rows=0 · days=0 · since=none on both (the backfill + the next sync fill them) ·
-- 5 addresses=0).
SELECT 1 AS n, 'delivered columns' AS what, (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_email_delivered') AS value
UNION ALL
SELECT 2, 'funnel columns', (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_funnel_days')
UNION ALL
SELECT 3, 'rls',
       'delivered: rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_email_delivered'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_email_delivered') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_email_delivered', 'SELECT') ||
       ' | funnel: rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_funnel_days'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_funnel_days') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_funnel_days', 'SELECT')
UNION ALL
SELECT 4, 'history',
       'delivered rows=' || (SELECT count(*) FROM public.sales_email_delivered) ||
       ' · days=' || (SELECT count(DISTINCT delivered_day) FROM public.sales_email_delivered) ||
       ' · since=' || COALESCE((SELECT min(delivered_day)::text FROM public.sales_email_delivered), 'none') ||
       ' | funnel rows=' || (SELECT count(*) FROM public.sales_funnel_days) ||
       ' · since=' || COALESCE((SELECT min(day)::text FROM public.sales_funnel_days), 'none')
UNION ALL
SELECT 5, 'addresses', (SELECT count(*)::text FROM public.sales_email_delivered WHERE contact_id ~ '@' OR account_id ~ '@' OR apollo_message_id ~ '@')
ORDER BY n;
