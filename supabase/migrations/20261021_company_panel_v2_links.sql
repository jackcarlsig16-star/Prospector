-- company-panel-v2 Stage 1 (REV2 D1) - person -> company links on sales_prospect_state.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Idempotent: a second run changes 0 rows and
-- prints the same proof. Only the last SELECT shows in the editor - paste those rows back.
--
-- Schema (every workspace):
--   goal_id uuid -> sales_goals (on delete set null)          goal_link_via         'domain' | 'name' | 'manual'
--   opportunity_link_via for the existing opportunity_id      opportunity_link_via  'name' | 'manual' | 'pipeline'
--   goal_id joins the fields the history trigger logs (sales_prospect_events), like opportunity_id already is.
--   sales_norm_name(text): the SQL twin of api/sales/intakeMatch.js normName (lowercase, parenthesised text dropped,
--   & -> and, non-alphanumerics -> space, inc/llc/ltd/corp/corporation/co/plc stripped, leading "the " dropped). Accents:
--   the JS strips every combining mark (letters with no decomposition, e.g. ø, become a space); this folds the same
--   common Latin set via translate(). The only accented HomeLover name today is Piñata - both give "pinata".
--
-- Backfill (HomeLover only, fill-only, exact only - a name or domain that hits 2+ records links nothing):
--   1. existing opportunity_id with no link_via  -> 'pipeline' (Huddle's Add to pipeline made them)
--   2. goal_id by CONFIRMED partner domain (email domain, read only inside this statement, never output)
--   3. goal_id by exact partnership name (rows step 2 did not fill)
--   4. opportunity_id by exact NON-archived opportunity name, only where opportunity_id is null
--   'manual' rows are never touched. The history trigger logs the opportunity_id / goal_id changes with
--   changed_by = 'company-panel-v2 Stage 1 backfill'.
--
-- Expected proof on HomeLover (Stage 1 pre-check, 2026-10-21): goal_link_via all null (0 by domain, 0 by name, 141 unlinked);
-- opportunity_link_via pipeline 1, name 12, null 128; ambiguous 0 / 0 / 0; both linked 0; pairs: Target -> Target (2),
-- [solidcore] -> Solidcore (1), 24 Hour Fitness -> 24 Hour Fitness (8), Nike -> Nike, Inc. (1).

-- 1. Columns, constraints, index -------------------------------------------------------------------------------------
ALTER TABLE public.sales_prospect_state ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES public.sales_goals(id) ON DELETE SET NULL;
ALTER TABLE public.sales_prospect_state ADD COLUMN IF NOT EXISTS goal_link_via text;
ALTER TABLE public.sales_prospect_state ADD COLUMN IF NOT EXISTS opportunity_link_via text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_prospect_state_goal_link_via_check') THEN
    ALTER TABLE public.sales_prospect_state ADD CONSTRAINT sales_prospect_state_goal_link_via_check
      CHECK (goal_link_via IS NULL OR goal_link_via IN ('domain', 'name', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_prospect_state_opportunity_link_via_check') THEN
    ALTER TABLE public.sales_prospect_state ADD CONSTRAINT sales_prospect_state_opportunity_link_via_check
      CHECK (opportunity_link_via IS NULL OR opportunity_link_via IN ('name', 'manual', 'pipeline'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sales_prospect_state_goal_idx ON public.sales_prospect_state (business_id, goal_id);

-- 2. History trigger: goal_id is logged like opportunity_id -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_prospect_state_log_event() RETURNS trigger AS $$
DECLARE
  f text;
  old_v text;
  new_v text;
BEGIN
  FOREACH f IN ARRAY ARRAY['owner', 'status', 'snooze_until', 'next_action', 'next_action_due', 'notes', 'opportunity_id', 'goal_id'] LOOP
    EXECUTE format('select ($1).%I::text, ($2).%I::text', f, f) INTO old_v, new_v USING old, new;
    IF old_v IS DISTINCT FROM new_v THEN
      INSERT INTO public.sales_prospect_events (business_id, contact_id, field, from_value, to_value, changed_by)
      VALUES (new.business_id, new.contact_id, f, old_v, new_v, new.updated_by);
    END IF;
  END LOOP;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- 3. The name normaliser (SQL twin of intakeMatch.js normName) -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_norm_name(s text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n text;
  prev text;
BEGIN
  n := lower(translate(coalesce(s, ''),
         'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÑñÇçÝýÿŠšŽž',
         'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcYyySsZz'));
  n := regexp_replace(n, '\([^)]*\)', ' ', 'g');
  n := replace(n, '&', ' and ');
  n := regexp_replace(n, '[^a-z0-9 ]+', ' ', 'g');
  n := btrim(regexp_replace(n, '\s+', ' ', 'g'));
  LOOP
    prev := n;
    n := btrim(regexp_replace(n, '(^|[^a-z0-9])(inc|llc|ltd|corp|corporation|co|plc)$', '\1'));
    EXIT WHEN n = prev;
  END LOOP;
  RETURN regexp_replace(n, '^the ', '');
END;
$$;

-- 4. Backfill, HomeLover only -------------------------------------------------------------------------------------------
-- 4a. Links Huddle's Add to pipeline already made.
UPDATE public.sales_prospect_state p
SET opportunity_link_via = 'pipeline'
FROM public.businesses hl
WHERE hl.name = 'HomeLover' AND p.business_id = hl.id
  AND p.opportunity_id IS NOT NULL AND p.opportunity_link_via IS NULL;

-- 4b. goal_id by confirmed partner domain (one partner per domain, else skipped).
WITH hl AS (SELECT id FROM public.businesses WHERE name = 'HomeLover'),
dom AS (
  SELECT lower(regexp_replace(regexp_replace(d.domain, '^www\.', ''), '\.+$', '')) AS domain, min(d.goal_id::text)::uuid AS goal_id
  FROM public.partner_domains d JOIN hl ON d.business_id = hl.id
  WHERE d.confirmed = true
  GROUP BY 1
  HAVING count(DISTINCT d.goal_id) = 1
)
UPDATE public.sales_prospect_state p
SET goal_id = dom.goal_id, goal_link_via = 'domain', updated_by = 'company-panel-v2 Stage 1 backfill', updated_at = now()
FROM hl, dom
WHERE p.business_id = hl.id AND p.goal_id IS NULL AND p.goal_link_via IS DISTINCT FROM 'manual'
  AND p.email LIKE '%@%'
  AND lower(regexp_replace(regexp_replace(split_part(p.email, '@', 2), '^www\.', ''), '\.+$', '')) = dom.domain;

-- 4c. goal_id by exact partnership name (one partnership per normalised name, else skipped).
WITH hl AS (SELECT id FROM public.businesses WHERE name = 'HomeLover'),
pn AS (
  SELECT public.sales_norm_name(g.name) AS norm, min(g.id::text)::uuid AS goal_id
  FROM public.sales_goals g JOIN hl ON g.business_id = hl.id
  WHERE g.goal_type = 'partnership'
  GROUP BY 1
  HAVING count(*) = 1 AND public.sales_norm_name(g.name) <> ''
)
UPDATE public.sales_prospect_state p
SET goal_id = pn.goal_id, goal_link_via = 'name', updated_by = 'company-panel-v2 Stage 1 backfill', updated_at = now()
FROM hl, pn
WHERE p.business_id = hl.id AND p.goal_id IS NULL AND p.goal_link_via IS DISTINCT FROM 'manual'
  AND public.sales_norm_name(p.company) = pn.norm;

-- 4d. opportunity_id by exact non-archived opportunity name, fill-only.
WITH hl AS (SELECT id FROM public.businesses WHERE name = 'HomeLover'),
onm AS (
  SELECT public.sales_norm_name(o.organization) AS norm, min(o.id::text)::uuid AS opportunity_id
  FROM public.sales_opportunities o JOIN hl ON o.business_id = hl.id
  WHERE o.archived_at IS NULL
  GROUP BY 1
  HAVING count(*) = 1 AND public.sales_norm_name(o.organization) <> ''
)
UPDATE public.sales_prospect_state p
SET opportunity_id = onm.opportunity_id, opportunity_link_via = 'name', updated_by = 'company-panel-v2 Stage 1 backfill', updated_at = now()
FROM hl, onm
WHERE p.business_id = hl.id AND p.opportunity_id IS NULL AND p.opportunity_link_via IS DISTINCT FROM 'manual'
  AND public.sales_norm_name(p.company) = onm.norm;

-- 5. Proof (HomeLover): counts by link_via, ambiguity, both-linked, and the company -> organization pairs. No people. ---
WITH hl AS (SELECT id FROM public.businesses WHERE name = 'HomeLover'),
ppl AS (SELECT p.* FROM public.sales_prospect_state p JOIN hl ON p.business_id = hl.id),
amb_goal AS (
  SELECT public.sales_norm_name(g.name) AS norm FROM public.sales_goals g JOIN hl ON g.business_id = hl.id
  WHERE g.goal_type = 'partnership' GROUP BY 1 HAVING count(*) > 1
),
amb_opp AS (
  SELECT public.sales_norm_name(o.organization) AS norm FROM public.sales_opportunities o JOIN hl ON o.business_id = hl.id
  WHERE o.archived_at IS NULL GROUP BY 1 HAVING count(*) > 1
),
amb_dom AS (
  SELECT lower(regexp_replace(regexp_replace(d.domain, '^www\.', ''), '\.+$', '')) AS domain
  FROM public.partner_domains d JOIN hl ON d.business_id = hl.id WHERE d.confirmed = true
  GROUP BY 1 HAVING count(DISTINCT d.goal_id) > 1
),
rows_out AS (
  SELECT 1 AS ord, 'goal_link_via' AS what, coalesce(goal_link_via, '(null)') AS detail, count(*)::text AS n FROM ppl GROUP BY goal_link_via
  UNION ALL
  SELECT 2, 'opportunity_link_via', coalesce(opportunity_link_via, '(null)'), count(*)::text FROM ppl GROUP BY opportunity_link_via
  UNION ALL
  SELECT 3, 'ambiguous', 'people whose company name hits 2+ partnerships',
         (SELECT count(*) FROM ppl WHERE public.sales_norm_name(company) IN (SELECT norm FROM amb_goal))::text
  UNION ALL
  SELECT 3, 'ambiguous', 'people whose company name hits 2+ live opportunities',
         (SELECT count(*) FROM ppl WHERE public.sales_norm_name(company) IN (SELECT norm FROM amb_opp))::text
  UNION ALL
  SELECT 3, 'ambiguous', 'people whose email domain is confirmed on 2+ partners',
         (SELECT count(*) FROM ppl WHERE email LIKE '%@%'
            AND lower(regexp_replace(regexp_replace(split_part(email, '@', 2), '^www\.', ''), '\.+$', '')) IN (SELECT domain FROM amb_dom))::text
  UNION ALL
  SELECT 4, 'both linked', 'goal_id and opportunity_id', (SELECT count(*) FROM ppl WHERE goal_id IS NOT NULL AND opportunity_id IS NOT NULL)::text
  UNION ALL
  SELECT 5, 'opportunity name link', p.company || ' -> ' || o.organization, count(*)::text
  FROM ppl p JOIN public.sales_opportunities o ON o.id = p.opportunity_id
  WHERE p.opportunity_link_via = 'name'
  GROUP BY p.company, o.organization
  UNION ALL
  SELECT 6, 'partner link', coalesce(p.company, '(no company)') || ' -> ' || g.name || ' (' || p.goal_link_via || ')', count(*)::text
  FROM ppl p JOIN public.sales_goals g ON g.id = p.goal_id
  GROUP BY p.company, g.name, p.goal_link_via
)
SELECT what, detail, n FROM rows_out ORDER BY ord, what, detail;
