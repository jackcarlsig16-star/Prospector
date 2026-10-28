-- FIX headcount-auto-v1 REV2 Stage 1 (Oct 27 2026; Jack: "headcount: apollo 25/day") - Supabase SQL editor: paste -> Run.
-- Idempotent. Existing rows change only where a domain is backfilled (fill-only; employees / headcounts untouched here).
--
-- H2  sales_opportunities, sales_targets  + domain text (the partner_domains CHECK), domain_source visit | people |
--                                           research | manual | upload | apollo_name, domain_at. Backfilled once, in order,
--                                           exact single match only: (ii) a web_visits row with the same normalized name
--                                           and a domain, (iii) a linked sales_outreach_contacts email domain (consumer
--                                           domains excluded; the address is read inside the query, never output),
--                                           (iv) the latest done research run's domain with website_confidence high.
-- H4  sales_goals, sales_opportunities, sales_targets  + apollo_firmographics jsonb (keep-list only: industry,
--                                           annual_revenue_printed, founded_year - written by Stage 2).
--     sales_settings  + headcount_daily_credits int (HomeLover seeded 25).
-- Partners keep company_domain + partner_domains (untouched).
CREATE OR REPLACE FUNCTION public.sales_norm_name(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(s, '')), '\([^)]*\)', ' ', 'g'), '&', ' and ', 'g'), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g')),
               '( (inc|llc|ltd|corp|corporation|co|plc))+$', ''),
             '( (inc|llc|ltd|corp|corporation|co|plc))+$', ''),
           '^the ', '')
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_opportunities', 'sales_targets'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS domain text CHECK (domain IS NULL OR (domain = lower(domain) AND domain ~ ''^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'' AND length(domain) <= 253))', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS domain_source text CHECK (domain_source IS NULL OR domain_source IN (''visit'', ''people'', ''research'', ''manual'', ''upload'', ''apollo_name''))', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS domain_at timestamptz', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['sales_goals', 'sales_opportunities', 'sales_targets'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS apollo_firmographics jsonb', t);
  END LOOP;
END $$;
ALTER TABLE public.sales_settings ADD COLUMN IF NOT EXISTS headcount_daily_credits int NOT NULL DEFAULT 25 CHECK (headcount_daily_credits BETWEEN 0 AND 500);
INSERT INTO public.sales_settings (business_id) VALUES ('bc69beab-effd-452d-9e81-fd652333bb95') ON CONFLICT (business_id) DO NOTHING;
UPDATE public.sales_settings SET headcount_daily_credits = 25 WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95';

-- (ii) the visit row: one distinct domain per normalized name, or nothing.
WITH v AS (
  SELECT business_id, public.sales_norm_name(company_name) AS k, min(domain) AS domain
    FROM public.web_visits
   WHERE domain IS NOT NULL AND domain = lower(domain) AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
   GROUP BY business_id, public.sales_norm_name(company_name)
  HAVING count(DISTINCT domain) = 1)
UPDATE public.sales_opportunities o SET domain = v.domain, domain_source = 'visit', domain_at = now()
  FROM v WHERE o.domain IS NULL AND o.archived_at IS NULL AND v.business_id = o.business_id AND v.k = public.sales_norm_name(o.organization) AND v.k <> '';
WITH v AS (
  SELECT business_id, public.sales_norm_name(company_name) AS k, min(domain) AS domain
    FROM public.web_visits
   WHERE domain IS NOT NULL AND domain = lower(domain) AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
   GROUP BY business_id, public.sales_norm_name(company_name)
  HAVING count(DISTINCT domain) = 1)
UPDATE public.sales_targets t SET domain = v.domain, domain_source = 'visit', domain_at = now()
  FROM v WHERE t.domain IS NULL AND t.status <> 'rejected' AND v.business_id = t.business_id AND v.k = public.sales_norm_name(t.name) AND v.k <> '';

-- (iii) a linked person's email domain (consumer domains excluded): one distinct domain per record, or nothing.
WITH c AS (
  SELECT opportunity_id AS rid, min(lower(split_part(email, '@', 2))) AS domain
    FROM public.sales_outreach_contacts
   WHERE opportunity_id IS NOT NULL AND email IS NOT NULL AND position('@' IN email) > 0
     AND lower(split_part(email, '@', 2)) NOT IN ('gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'me.com', 'live.com', 'msn.com', 'comcast.net', 'att.net', 'proton.me', 'protonmail.com', 'ymail.com', 'sbcglobal.net', 'verizon.net')
     AND lower(split_part(email, '@', 2)) ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
   GROUP BY opportunity_id HAVING count(DISTINCT lower(split_part(email, '@', 2))) = 1)
UPDATE public.sales_opportunities o SET domain = c.domain, domain_source = 'people', domain_at = now() FROM c WHERE o.domain IS NULL AND o.id = c.rid;
WITH c AS (
  SELECT target_id AS rid, min(lower(split_part(email, '@', 2))) AS domain
    FROM public.sales_outreach_contacts
   WHERE target_id IS NOT NULL AND email IS NOT NULL AND position('@' IN email) > 0
     AND lower(split_part(email, '@', 2)) NOT IN ('gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'me.com', 'live.com', 'msn.com', 'comcast.net', 'att.net', 'proton.me', 'protonmail.com', 'ymail.com', 'sbcglobal.net', 'verizon.net')
     AND lower(split_part(email, '@', 2)) ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
   GROUP BY target_id HAVING count(DISTINCT lower(split_part(email, '@', 2))) = 1)
UPDATE public.sales_targets t SET domain = c.domain, domain_source = 'people', domain_at = now() FROM c WHERE t.domain IS NULL AND t.id = c.rid;

-- (iv) the latest done research run with a high-confidence domain.
WITH r AS (
  SELECT DISTINCT ON (entity_type, entity_id) entity_type, entity_id, lower(result->>'domain') AS domain
    FROM public.research_runs
   WHERE status = 'done' AND result->>'website_confidence' = 'high' AND result->>'domain' IS NOT NULL
   ORDER BY entity_type, entity_id, created_at DESC)
UPDATE public.sales_opportunities o SET domain = r.domain, domain_source = 'research', domain_at = now()
  FROM r WHERE o.domain IS NULL AND r.entity_type = 'employer' AND r.entity_id = o.id AND r.domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$';
WITH r AS (
  SELECT DISTINCT ON (entity_type, entity_id) entity_type, entity_id, lower(result->>'domain') AS domain
    FROM public.research_runs
   WHERE status = 'done' AND result->>'website_confidence' = 'high' AND result->>'domain' IS NOT NULL
   ORDER BY entity_type, entity_id, created_at DESC)
UPDATE public.sales_targets t SET domain = r.domain, domain_source = 'research', domain_at = now()
  FROM r WHERE t.domain IS NULL AND r.entity_type = 'target' AND r.entity_id = t.id AND r.domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$';

-- Proof (expect):
--   1 columns                employers domain,domain_at,domain_source,apollo_firmographics · targets the same · partners apollo_firmographics
--   2 settings               homelover headcount_daily_credits=25
--   3 employers by source    e.g. visit=3 · people=0 · research=4 (Stage 0 counted 3 / 0 / 4 look-up-able)
--   4 targets by source      e.g. visit=10 · research=1
--   5 bad domains            0 (every backfilled domain passes the CHECK; none holds "@")
SELECT 1 AS n, 'columns' AS what,
       'employers ' || (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_opportunities' AND column_name IN ('domain', 'domain_source', 'domain_at', 'apollo_firmographics')) ||
       ' · targets ' || (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_targets' AND column_name IN ('domain', 'domain_source', 'domain_at', 'apollo_firmographics')) ||
       ' · partners ' || (SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_goals' AND column_name = 'apollo_firmographics') AS detail
UNION ALL
SELECT 2, 'settings', 'homelover headcount_daily_credits=' || (SELECT headcount_daily_credits FROM public.sales_settings WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95')
UNION ALL
SELECT 3, 'employers by source', coalesce((SELECT string_agg(domain_source || '=' || c, ' · ' ORDER BY domain_source) FROM (SELECT domain_source, count(*) AS c FROM public.sales_opportunities WHERE domain IS NOT NULL GROUP BY domain_source) x), 'none')
UNION ALL
SELECT 4, 'targets by source', coalesce((SELECT string_agg(domain_source || '=' || c, ' · ' ORDER BY domain_source) FROM (SELECT domain_source, count(*) AS c FROM public.sales_targets WHERE domain IS NOT NULL GROUP BY domain_source) x), 'none')
UNION ALL
SELECT 5, 'bad domains', ((SELECT count(*) FROM public.sales_opportunities WHERE domain ~ '@') + (SELECT count(*) FROM public.sales_targets WHERE domain ~ '@'))::text
ORDER BY n;
