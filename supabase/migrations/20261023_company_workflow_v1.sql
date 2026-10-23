-- company-workflow-v1 Stage 1 - employee counts, partner reach, and an owner PERSON on employers + targets.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- W4 employees on partners (sales_goals), employers (sales_opportunities) and targets (sales_targets):
--   employees int >= 0, employees_source research | manual (typed; a manual value is never overwritten), employees_at.
--   No Apollo source: nothing stored holds a numeric headcount (Stage 0) and fetching one costs calls.
-- W5 reach on every partner: reach_employees (employees it administers across its clients) and reach_clients (number
--   of client companies), each with _source research | manual and _at. A partner's own headcount stays in employees.
-- W3 owner_user_id on employers and targets (-> profiles, on delete set null), like partners already have.
-- Backfills (HomeLover only, idempotent - each only fills an empty value):
--   1 employers.owner_user_id where the owner text equals ONE member's first name or full name (case-insensitive);
--     Stage 0 counted 25 (17 "Jack", 4 "Jack Carlson", 4 "Cyrus Radjoo"); anything else stays NULL.
--   2 employees (source 'manual') from sales_sequenced_accounts.employees (typed by a member) where the account name
--     equals the company name after the app's normName (api/sales/intakeMatch.js: lowercase, "(...)" and punctuation
--     out, & -> and, trailing inc/llc/ltd/corp/corporation/co/plc and a leading "the" dropped; accents are not folded
--     here). A name that maps to two different typed counts is skipped.
-- RLS: unchanged (new columns on existing tables). Re-runnable: IF NOT EXISTS everywhere; backfills skip filled rows.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_goals', 'sales_opportunities', 'sales_targets'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS employees         int CHECK (employees IS NULL OR employees >= 0),
      ADD COLUMN IF NOT EXISTS employees_source  text CHECK (employees_source IS NULL OR employees_source IN (''research'', ''manual'')),
      ADD COLUMN IF NOT EXISTS employees_at      timestamptz', t);
  END LOOP;
END $$;

ALTER TABLE public.sales_goals
  ADD COLUMN IF NOT EXISTS reach_employees        int CHECK (reach_employees IS NULL OR reach_employees >= 0),
  ADD COLUMN IF NOT EXISTS reach_employees_source text CHECK (reach_employees_source IS NULL OR reach_employees_source IN ('research', 'manual')),
  ADD COLUMN IF NOT EXISTS reach_employees_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reach_clients          int CHECK (reach_clients IS NULL OR reach_clients >= 0),
  ADD COLUMN IF NOT EXISTS reach_clients_source   text CHECK (reach_clients_source IS NULL OR reach_clients_source IN ('research', 'manual')),
  ADD COLUMN IF NOT EXISTS reach_clients_at       timestamptz;

ALTER TABLE public.sales_opportunities ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.sales_targets       ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- normName (api/sales/intakeMatch.js), session-only.
CREATE OR REPLACE FUNCTION pg_temp.cw_norm(s text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n text;
BEGIN
  n := lower(coalesce(s, ''));
  n := regexp_replace(n, '\([^)]*\)', ' ', 'g');
  n := replace(n, '&', ' and ');
  n := regexp_replace(n, '[^a-z0-9 ]+', ' ', 'g');
  n := btrim(regexp_replace(n, '\s+', ' ', 'g'));
  WHILE n ~ '\m(inc|llc|ltd|corp|corporation|co|plc)$' LOOP
    n := btrim(regexp_replace(n, '\m(inc|llc|ltd|corp|corporation|co|plc)$', ''));
  END LOOP;
  RETURN regexp_replace(n, '^the ', '');
END $$;

-- Backfill 1: employer owner text -> the one member it names.
WITH m AS (
  SELECT user_id, lower(btrim(name)) AS full_name, lower(split_part(btrim(name), ' ', 1)) AS first_name
  FROM public.business_members
  WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND user_id IS NOT NULL AND name IS NOT NULL
), hit AS (
  SELECT o.id, min(m.user_id::text)::uuid AS uid, count(DISTINCT m.user_id) AS n
  FROM public.sales_opportunities o
  JOIN m ON lower(btrim(o.owner)) IN (m.full_name, m.first_name)
  WHERE o.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND o.owner_user_id IS NULL AND o.owner IS NOT NULL
  GROUP BY o.id
)
UPDATE public.sales_opportunities o SET owner_user_id = hit.uid
FROM hit WHERE o.id = hit.id AND hit.n = 1;

-- Backfill 2: typed employee counts from the sequenced accounts, by normalised name.
DROP TABLE IF EXISTS pg_temp.cw_acc;
CREATE TEMP TABLE cw_acc AS
  SELECT pg_temp.cw_norm(name) AS k, min(employees) AS e
  FROM public.sales_sequenced_accounts
  WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND employees IS NOT NULL AND name IS NOT NULL
  GROUP BY 1 HAVING count(DISTINCT employees) = 1;

UPDATE public.sales_goals g SET employees = a.e, employees_source = 'manual', employees_at = now()
FROM cw_acc a WHERE g.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND g.goal_type = 'partnership'
  AND g.employees IS NULL AND a.k <> '' AND pg_temp.cw_norm(g.name) = a.k;
UPDATE public.sales_opportunities o SET employees = a.e, employees_source = 'manual', employees_at = now()
FROM cw_acc a WHERE o.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95'
  AND o.employees IS NULL AND a.k <> '' AND pg_temp.cw_norm(o.organization) = a.k;
UPDATE public.sales_targets t SET employees = a.e, employees_source = 'manual', employees_at = now()
FROM cw_acc a WHERE t.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95'
  AND t.employees IS NULL AND a.k <> '' AND pg_temp.cw_norm(t.name) = a.k;
DROP TABLE IF EXISTS pg_temp.cw_acc;

-- Proof (counts only). Expect (dry count 2026-10-23, read-only): new_columns_17 = 17; employers_owner_person = 26 (25 live
-- + 1 archived); employers_owner_text_unmatched = 0; partners 0 / employers 7 / targets 0 with employees; reach 0.
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND
     ((table_name IN ('sales_goals', 'sales_opportunities', 'sales_targets') AND column_name IN ('employees', 'employees_source', 'employees_at'))
      OR (table_name = 'sales_goals' AND column_name LIKE 'reach\_%')
      OR (table_name IN ('sales_opportunities', 'sales_targets') AND column_name = 'owner_user_id'))) AS new_columns_17,
  (SELECT count(*) FROM public.sales_opportunities WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND owner_user_id IS NOT NULL) AS employers_owner_person,
  (SELECT count(*) FROM public.sales_opportunities WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND owner IS NOT NULL AND owner_user_id IS NULL) AS employers_owner_text_unmatched,
  (SELECT count(*) FROM public.sales_goals WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND employees IS NOT NULL) AS partners_with_employees,
  (SELECT count(*) FROM public.sales_opportunities WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND employees IS NOT NULL) AS employers_with_employees,
  (SELECT count(*) FROM public.sales_targets WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND employees IS NOT NULL) AS targets_with_employees,
  (SELECT count(*) FROM public.sales_goals WHERE reach_employees IS NOT NULL OR reach_clients IS NOT NULL) AS partners_with_reach;
