-- data-keys-v1 Stage 1 - ONE migration (spec inbox/2026-11-19-1415-data-keys-v1.txt; rulings Nov 19 5:50 PM section C,
-- K-1..K-6, and Nov 19 6:35 PM C4). Supabase SQL editor: paste the WHOLE file -> Run once.
--
-- It is one transaction: if any guard below fails, NOTHING is changed and the error says which guard. A second run
-- changes nothing (every step only touches rows still in the old state). No row is deleted anywhere. 0 Apollo.
-- The last statement prints the proof: one row per step with BEFORE and AFTER.
--
-- NOT RUN ANYWHERE YET: there is no local Postgres on the build machine, so this file has been read, not executed.
-- The guards are what make that safe - a mistake in a step aborts the whole file.
--
-- What it does, in this order (read on prod HomeLover Nov 19 by scripts/verify/data-keys-v1-stage1-dry.mjs):
--   CHECKs first  web_visits.matched_type admits 'employer' (K1; 'opportunity' stays for one release)
--                 sales_week_goals.link_type admits 'employer' (K1) and 'todo' (actions-v2 R2: this week's five)
--                 sales_week_goals.origin admits 'reply' (actions-v2 R3) - and so does sales_todo_events.origin,
--                 because every to-do write logs an event with the SAME origin (todoWrite.js:59): without it a
--                 reply to-do could not be created
--   columns       sales_targets + employer_id (the probe api/sales/dataKeysFlag.js reads), promoted_from_note,
--                 apollo_account_id
--   K6            sales_norm_name redefined ONCE to match normName (api/sales/intakeMatch.js:28) exactly: accents are
--                 folded the way JS does it (NFD, combining marks dropped), not with unaccent - unaccent also rewrites
--                 letters JS leaves alone (ø, ß, æ) and would differ from normName. Guard: 0 mismatches on the 100
--                 real names below (19 non-ASCII, 45 with punctuation; the 2 that differ today are among them).
--   K1            'opportunity' -> 'employer' in web_visits.matched_type (127 rows) and sales_week_goals.link_type (19)
--   K2            the 17 declared accepted targets -> their employer (employer_id); on the 3 headcount conflicts
--                 (Cloudflare 7,330 / 5,200 · Mace 8,200 / 5,000 · Ascension 120,000 / 142,000) the employer's
--                 number wins and the target's own number is kept in promoted_from_note. Guard: exactly 17 pairs.
--   K3            apollo_account_id from sales_email_delivered + sales_sequenced_accounts by name, the Stage 0 rule
--                 (one Apollo account per name, one record per name, never over an id already held):
--                 employers +2 (Bass Pro Shops, Lidl US), targets +4 (Advocacy and Resource Center, Intuit, Kroger,
--                 Plaid). The email rows are read for their account id only; nothing of them is printed.
--                 Guard: more than 18 fills (3x the 6 declared) aborts.
--   K7            sales_goals.company_domain from partner_domains, CONFIRMED rows only, primary first - that is what
--                 the partner window reads (companyPanel.js:283). 21 partners have a confirmed row (all 21 primary);
--                 1 already agrees, 20 are set. The 30 unconfirmed suggestions are not a source.
--   K8            no backfill (ruling K-5): 0 employers hold an owner text without owner_user_id. Proof row only.
--   K10           the visit row still on a target that was promoted to a partner follows the record
--                 (American Family Insurance, 1 row, Oct 20). Guard: more than 3 rows aborts.
--
-- BEFORE YOU RUN IT - one thing to decide (see the Stage 1 report): the code on prod today still reads and writes
-- 'opportunity' in the two K1 columns. Between this run and the deploy of the post-"ran" code, the 127 employer visit
-- rows and the 19 employer to-do links are read by their fallbacks only (the company name / nothing). Nothing is lost
-- and the deploy puts it right, but run this when that code can ship straight after.
BEGIN;

CREATE TEMP TABLE IF NOT EXISTS dk_proof (n int PRIMARY KEY, step text, what text, before text, after text);
TRUNCATE dk_proof;
CREATE TEMP TABLE dk_names (name text, js text) ON COMMIT DROP;
INSERT INTO dk_names (name, js) VALUES
  ('InShapeMD® Corporate', 'inshapemd corporate'),
  ('L''Oréal', 'l oreal'),
  ('Hospitales Star Médica', 'hospitales star medica'),
  ('CALIFORNIA ASSOCIATION OF REALTORS®', 'california association of realtors'),
  ('Instituto Geográfico Nacional de España y O.A. CNIG', 'instituto geografico nacional de espana y o a cnig'),
  ('Cégep de la Pocatière', 'cegep de la pocatiere'),
  ('Secretaría de Educación Pública', 'secretaria de educacion publica'),
  ('Universidad del Valle de México', 'universidad del valle de mexico'),
  ('Tecnológico de Monterrey', 'tecnologico de monterrey'),
  ('Forté Flavors', 'forte flavors'),
  ('CENTURY 21®', 'century 21'),
  ('Piñata', 'pinata'),
  ('Resort Český les', 'resort cesky les'),
  ('Reachr Soluções Inovadoras em RH', 'reachr solucoes inovadoras em rh'),
  ('DTW Group Tianjin Daitian Group Co., Ltd. (DTW Group 天津大田集团有限公司)', 'dtw group tianjin daitian group'),
  ('Citizen Agency 🐻', 'citizen agency'),
  ('Bureau des Élèves Télécom SudParis & Institut Mines-Télécom Business School', 'bureau des eleves telecom sudparis and institut mines telecom business school'),
  ('K. Hovnanian® Homes', 'k hovnanian homes'),
  ('MTS Sales Compass™', 'mts sales compass'),
  ('U.S. Border Patrol', 'u s border patrol'),
  ('U.S. Food and Drug Administration', 'u s food and drug administration'),
  ('Mellano & Company/Enterprises', 'mellano and company enterprises'),
  ('Gate Gourmet, Inc.', 'gate gourmet'),
  ('Domino''s', 'domino s'),
  ('Bloomin'' Brands', 'bloomin brands'),
  ('StarPlus Energy, LLC', 'starplus energy'),
  ('Johnson & Johnson', 'johnson and johnson'),
  ('T&T Power Group', 't and t power group'),
  ('Papa John''s', 'papa john s'),
  ('7-Eleven Franchise', '7 eleven franchise'),
  ('Ski & Snowboard Club Vail', 'ski and snowboard club vail'),
  ('S&P Global', 's and p global'),
  ('Nike, Inc.', 'nike'),
  ('Appcast, Inc', 'appcast'),
  ('Walmart, Inc.', 'walmart'),
  ('Sheriff''s Protective Association', 'sheriff s protective association'),
  ('Passport Technology USA, Inc.', 'passport technology usa'),
  ('U.S. Court', 'u s court'),
  ('Brinker International (Chili''s)', 'brinker international'),
  ('Macy''s', 'macy s'),
  ('Big Joe Lift Trucks, Inc.', 'big joe lift trucks'),
  ('Bally''s', 'bally s'),
  ('LifeCare, Inc', 'lifecare'),
  ('ezCater, Inc.', 'ezcater'),
  ('Wendy''s', 'wendy s'),
  ('G&M Oil Company, Inc.', 'g and m oil company'),
  ('The Anchor Group Inc.', 'anchor group'),
  ('Third Federal Savings & Loan', 'third federal savings and loan'),
  ('Piedmont Ear Nose and Throat Assoc., PA', 'piedmont ear nose and throat assoc pa'),
  ('Personal / other', 'personal other'),
  ('U.S. District Court and Probation', 'u s district court and probation'),
  ('McDonald''s', 'mcdonald s'),
  ('Independent Purchasing Cooperative, Inc. (Subway) Master Site', 'independent purchasing cooperative inc master site'),
  ('Noodles & Company', 'noodles and company'),
  ('Soapy Joe''s', 'soapy joe s'),
  ('Miller Cooper & Company LTD', 'miller cooper and company'),
  ('Dine Brands (IHOP / Applebee''s)', 'dine brands'),
  ('Americas Styrenics, LLC', 'americas styrenics'),
  ('HPI Real Estate Services & Investments', 'hpi real estate services and investments'),
  ('Emirates Palace (Mandarin Oriental)', 'emirates palace'),
  ('Hamner, Jewell & Associates', 'hamner jewell and associates'),
  ('Dave & Buster''s', 'dave and buster s'),
  ('Enterprise Rent-A-Car', 'enterprise rent a car'),
  ('PhenomeX Inc.', 'phenomex'),
  ('GlaxoSmithKline', 'glaxosmithkline'),
  ('Netskope', 'netskope'),
  ('Citi', 'citi'),
  ('Citizens Bank of Kansas', 'citizens bank of kansas'),
  ('AutoNation', 'autonation'),
  ('Chop Shop', 'chop shop'),
  ('Best Western', 'best western'),
  ('DHL Express', 'dhl express'),
  ('College Basketball Officials Organization', 'college basketball officials organization'),
  ('Shake Shack', 'shake shack'),
  ('El Camino Health', 'el camino health'),
  ('City of Santa Monica', 'city of santa monica'),
  ('Bass Pro Shops', 'bass pro shops'),
  ('Veterinary Specialty Hospital', 'veterinary specialty hospital'),
  ('Six Flags', 'six flags'),
  ('Feeding America', 'feeding america'),
  ('Mace', 'mace'),
  ('Geico', 'geico'),
  ('Blue Shield of California', 'blue shield of california'),
  ('Delaware North', 'delaware north'),
  ('Restaurant Brands International', 'restaurant brands international'),
  ('Sysco', 'sysco'),
  ('BrainPOP', 'brainpop'),
  ('Andy Gump', 'andy gump'),
  ('Habitat for Humanity', 'habitat for humanity'),
  ('IXL Learning', 'ixl learning'),
  ('Silverado Senior Living', 'silverado senior living'),
  ('American Marketing Association', 'american marketing association'),
  ('Memorial Health', 'memorial health'),
  ('US Foods', 'us foods'),
  ('Bob Evans', 'bob evans'),
  ('Stingray Boats', 'stingray boats'),
  ('Wyndham Hotels', 'wyndham hotels'),
  ('Boston Pharmaceuticals', 'boston pharmaceuticals'),
  ('Torani', 'torani'),
  ('Trinity Health', 'trinity health');
CREATE TEMP TABLE dk_declared (name text) ON COMMIT DROP;
INSERT INTO dk_declared (name) VALUES ('El Camino Health'), ('Apple'), ('IXL Learning'), ('City of Minneapolis'), ('Flowserve Corporation'), ('Calpine'), ('Berklee College of Music'), ('The Peninsula Hotels'), ('PCL Construction'), ('HPI Real Estate Services & Investments'), ('Northrop Grumman'), ('Appcast, Inc'), ('DaVita'), ('InShapeMD® Corporate'), ('Cloudflare'), ('Mace'), ('Ascension');

-- BEFORE, part 1: what the catalog says, and the normaliser as it is live.
INSERT INTO dk_proof (n, step, what, before) VALUES
  (1, 'CHECK', 'web_visits.matched_type admits employer',
     (SELECT coalesce(bool_or(pg_get_constraintdef(oid) LIKE '%''employer''%'), false)::text FROM pg_constraint WHERE conrelid = 'public.web_visits'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%matched_type%')),
  (2, 'CHECK', 'sales_week_goals.link_type admits employer · todo (actions-v2 R2)',
     (SELECT coalesce(bool_or(pg_get_constraintdef(oid) LIKE '%''employer''%'), false)::text || ' · ' || coalesce(bool_or(pg_get_constraintdef(oid) LIKE '%''todo''%'), false)::text FROM pg_constraint WHERE conname = 'sales_week_goals_link_check')),
  (3, 'CHECK', 'origin admits reply (actions-v2 R3): to-dos · their events',
     (SELECT coalesce(bool_or(pg_get_constraintdef(oid) LIKE '%''reply''%'), false)::text FROM pg_constraint WHERE conname = 'sales_week_goals_origin_check') || ' · ' ||
     (SELECT coalesce(bool_or(pg_get_constraintdef(oid) LIKE '%''reply''%'), false)::text FROM pg_constraint WHERE conrelid = 'public.sales_todo_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%origin%')),
  (4, 'columns', 'sales_targets: employer_id · promoted_from_note · apollo_account_id',
     (SELECT coalesce(string_agg(column_name, ' · ' ORDER BY column_name), 'none') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_targets' AND column_name IN ('employer_id', 'promoted_from_note', 'apollo_account_id'))),
  (5, 'K6', 'sales_norm_name <> normName on the 100 names',
     (SELECT count(*)::text || coalesce(' (' || string_agg(name, ' | ' ORDER BY name) || ')', '') FROM dk_names WHERE public.sales_norm_name(name) IS DISTINCT FROM js));

-- 1. CHECKs, before any rewrite ----------------------------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.web_visits'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%matched_type%' LOOP
    EXECUTE format('ALTER TABLE public.web_visits DROP CONSTRAINT %I', c.conname);
  END LOOP;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.sales_todo_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%origin%' LOOP
    EXECUTE format('ALTER TABLE public.sales_todo_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.web_visits ADD CONSTRAINT web_visits_matched_type_check
  CHECK (matched_type IS NULL OR matched_type IN ('partner', 'opportunity', 'employer', 'target'));
ALTER TABLE public.sales_week_goals DROP CONSTRAINT IF EXISTS sales_week_goals_link_check;
ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_link_check CHECK (
  (link_type IS NULL AND link_id IS NULL)
  OR (link_type IN ('commitment', 'metric', 'partner', 'company', 'target', 'opportunity', 'employer', 'todo') AND length(trim(link_id)) > 0)
);
ALTER TABLE public.sales_week_goals DROP CONSTRAINT IF EXISTS sales_week_goals_origin_check;
ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_origin_check
  CHECK (origin IN ('manual', 'scout', 'call_notes', 'signal', 'tidy', 'panel', 'plan', 'nudge', 'carry_over', 'import', 'system', 'reply'));
ALTER TABLE public.sales_todo_events ADD CONSTRAINT sales_todo_events_origin_check
  CHECK (origin IN ('manual', 'scout', 'call_notes', 'signal', 'tidy', 'panel', 'plan', 'nudge', 'carry_over', 'import', 'system', 'reply'));

-- 2. Columns ---------------------------------------------------------------------------------------------------------
ALTER TABLE public.sales_targets
  ADD COLUMN IF NOT EXISTS employer_id        uuid REFERENCES public.sales_opportunities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_from_note text CHECK (promoted_from_note IS NULL OR length(promoted_from_note) <= 400),
  ADD COLUMN IF NOT EXISTS apollo_account_id  text;
CREATE INDEX IF NOT EXISTS sales_targets_employer_idx ON public.sales_targets (employer_id) WHERE employer_id IS NOT NULL;

-- 3. K6: the one SQL normaliser = normName -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_norm_name(s text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  n text;
  prev text;
BEGIN
  n := lower(regexp_replace(normalize(coalesce(s, ''), NFD), E'[̀-ͯ]', '', 'g'));
  n := regexp_replace(n, '\([^)]*\)', ' ', 'g');
  n := replace(n, '&', ' and ');
  n := regexp_replace(n, '[^a-z0-9 ]+', ' ', 'g');
  n := btrim(regexp_replace(n, ' +', ' ', 'g'));
  LOOP
    prev := n;
    n := btrim(regexp_replace(n, '(^|[^a-z0-9])(inc|llc|ltd|corp|corporation|co|plc)$', '\1'));
    EXIT WHEN n = prev;
  END LOOP;
  RETURN regexp_replace(n, '^the ', '');
END;
$fn$;
DO $$
DECLARE bad int; which text;
BEGIN
  SELECT count(*), string_agg(name || ' -> sql "' || public.sales_norm_name(name) || '" / js "' || js || '"', ' | ') INTO bad, which FROM dk_names WHERE public.sales_norm_name(name) IS DISTINCT FROM js;
  IF bad > 0 THEN RAISE EXCEPTION 'data-keys K6 guard: sales_norm_name differs from normName on % of the 100 names (%). Nothing was changed.', bad, which; END IF;
END $$;

-- The records by their normalised name (HomeLover), as they are before any backfill.
CREATE TEMP TABLE dk_emp ON COMMIT DROP AS
  SELECT id, organization AS name, public.sales_norm_name(organization) AS k, apollo_account_id, employees, employees_source, employees_at, (archived_at IS NULL) AS live
    FROM public.sales_opportunities WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95';
CREATE TEMP TABLE dk_tgt ON COMMIT DROP AS
  SELECT id, name, public.sales_norm_name(name) AS k, status, promoted_goal_id, employer_id, employees, apollo_account_id
    FROM public.sales_targets WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95';
CREATE TEMP TABLE dk_pair ON COMMIT DROP AS
  SELECT t.id AS target_id, e.id AS employer_id, t.name AS target_name, e.name AS employer_name, t.employer_id AS held, t.employees AS t_emp, e.employees AS e_emp, e.employees_source AS e_src, e.employees_at AS e_at
    FROM dk_tgt t JOIN dk_emp e ON e.live AND e.k = t.k
   WHERE t.status = 'accepted' AND t.promoted_goal_id IS NULL AND t.k <> ''
     AND t.k IN (SELECT public.sales_norm_name(name) FROM dk_declared)
     AND (SELECT count(*) FROM dk_emp e2 WHERE e2.live AND e2.k = t.k) = 1
     AND (SELECT count(*) FROM dk_tgt t2 WHERE t2.status = 'accepted' AND t2.promoted_goal_id IS NULL AND t2.k = t.k) = 1;
CREATE TEMP TABLE dk_acct ON COMMIT DROP AS
  SELECT x.account_id, s.name, public.sales_norm_name(s.name) AS k
    FROM (SELECT account_id FROM public.sales_email_delivered WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND account_id IS NOT NULL
          UNION
          SELECT account_id FROM public.sales_sequenced_accounts WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95') x
    JOIN public.sales_sequenced_accounts s ON s.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND s.account_id = x.account_id
   WHERE public.sales_norm_name(s.name) <> '';
CREATE TEMP TABLE dk_fill ON COMMIT DROP AS
  SELECT a.account_id, a.k
    FROM dk_acct a
   WHERE (SELECT count(*) FROM dk_acct b WHERE b.k = a.k) = 1
     AND NOT EXISTS (SELECT 1 FROM dk_emp e WHERE e.apollo_account_id = a.account_id)
     AND (SELECT count(*) FROM dk_emp e WHERE e.live AND e.k = a.k) <= 1
     AND (SELECT count(*) FROM dk_tgt t WHERE t.status <> 'rejected' AND t.k = a.k) <= 1
     AND NOT EXISTS (SELECT 1 FROM dk_emp e WHERE e.live AND e.k = a.k AND e.apollo_account_id IS NOT NULL)
     AND (EXISTS (SELECT 1 FROM dk_emp e WHERE e.live AND e.k = a.k) OR EXISTS (SELECT 1 FROM dk_tgt t WHERE t.status <> 'rejected' AND t.k = a.k));
DO $$
DECLARE pairs int; fills int; stale int;
BEGIN
  SELECT count(*) INTO pairs FROM dk_pair;
  IF pairs <> 17 THEN RAISE EXCEPTION 'data-keys K2 guard: % of the 17 declared target -> employer pairs resolve 1:1 by name today (a target or employer was renamed, archived or re-decided since Nov 19). Nothing was changed.', pairs; END IF;
  IF EXISTS (SELECT 1 FROM dk_pair WHERE held IS NOT NULL AND held <> employer_id) THEN RAISE EXCEPTION 'data-keys K2 guard: a declared target already points at a different employer. Nothing was changed.'; END IF;
  SELECT count(*) INTO fills FROM dk_fill;
  IF fills > 18 THEN RAISE EXCEPTION 'data-keys K3 guard: % Apollo account ids would be placed, more than 3x the 6 declared on Nov 19. Nothing was changed.', fills; END IF;
  SELECT count(*) INTO stale FROM public.web_visits v JOIN public.sales_targets t ON t.id = v.matched_id AND t.business_id = v.business_id WHERE v.matched_type = 'target' AND t.promoted_goal_id IS NOT NULL;
  IF stale > 3 THEN RAISE EXCEPTION 'data-keys K10 guard: % visit rows sit on a target promoted to a partner, more than 3x the 1 declared on Nov 19. Nothing was changed.', stale; END IF;
END $$;

-- BEFORE, part 2: the data.
INSERT INTO dk_proof (n, step, what, before) VALUES
  (6, 'K1', 'web_visits.matched_type', (SELECT string_agg(coalesce(matched_type, 'null') || '=' || c, ' · ' ORDER BY coalesce(matched_type, 'null')) FROM (SELECT matched_type, count(*) AS c FROM public.web_visits GROUP BY matched_type) x)),
  (7, 'K1', 'sales_week_goals.link_type', (SELECT string_agg(coalesce(link_type, 'null') || '=' || c, ' · ' ORDER BY coalesce(link_type, 'null')) FROM (SELECT link_type, count(*) AS c FROM public.sales_week_goals GROUP BY link_type) x)),
  (8, 'K2', 'targets linked to their employer (of 17 declared)', (SELECT count(*)::text FROM public.sales_targets WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND employer_id IS NOT NULL)),
  (9, 'K2', 'headcount: target / employer where they differ', (SELECT coalesce(string_agg(target_name || ' ' || t_emp || ' / ' || e_emp, ' · ' ORDER BY target_name), 'none') FROM dk_pair WHERE t_emp IS NOT NULL AND e_emp IS NOT NULL AND t_emp <> e_emp)),
  (10, 'K3', 'employers with apollo_account_id', (SELECT count(*)::text FROM public.sales_opportunities WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND apollo_account_id IS NOT NULL)),
  (11, 'K3', 'targets with apollo_account_id', (SELECT count(*)::text FROM public.sales_targets WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND apollo_account_id IS NOT NULL)),
  (12, 'K7', 'partners with company_domain · of them equal to their confirmed partner_domains row',
     (SELECT count(*) FILTER (WHERE g.company_domain IS NOT NULL)::text || ' · ' || count(*) FILTER (WHERE g.company_domain = d.domain)::text
        FROM public.sales_goals g LEFT JOIN (SELECT DISTINCT ON (goal_id) goal_id, domain FROM public.partner_domains WHERE confirmed ORDER BY goal_id, is_primary DESC, updated_at, id) d ON d.goal_id = g.id
       WHERE g.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND g.goal_type = 'partnership')),
  (13, 'K8', 'employers with an owner text and no owner_user_id (no backfill)', (SELECT count(*)::text FROM public.sales_opportunities WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND btrim(coalesce(owner, '')) <> '' AND owner_user_id IS NULL)),
  (14, 'K10', 'visit rows on a target that was promoted to a partner',
     (SELECT count(*)::text || coalesce(' (' || string_agg(DISTINCT t.name, ', ') || ')', '') FROM public.web_visits v JOIN public.sales_targets t ON t.id = v.matched_id AND t.business_id = v.business_id WHERE v.matched_type = 'target' AND t.promoted_goal_id IS NOT NULL)),
  (15, 'rows', 'web_visits · sales_week_goals · sales_targets · sales_opportunities · sales_goals · partner_domains',
     (SELECT count(*) FROM public.web_visits)::text || ' · ' || (SELECT count(*) FROM public.sales_week_goals)::text || ' · ' || (SELECT count(*) FROM public.sales_targets)::text || ' · ' || (SELECT count(*) FROM public.sales_opportunities)::text || ' · ' || (SELECT count(*) FROM public.sales_goals)::text || ' · ' || (SELECT count(*) FROM public.partner_domains)::text);

-- 4. K1: one word for the employer ------------------------------------------------------------------------------------
UPDATE public.web_visits SET matched_type = 'employer' WHERE matched_type = 'opportunity';
UPDATE public.sales_week_goals SET link_type = 'employer' WHERE link_type = 'opportunity';

-- 5. K2: a promoted target knows its employer --------------------------------------------------------------------------
UPDATE public.sales_targets t
   SET employer_id = p.employer_id,
       promoted_from_note = CASE WHEN p.t_emp IS NOT NULL AND p.e_emp IS NOT NULL AND p.t_emp <> p.e_emp
                                 THEN 'Headcount on the target before it was linked: ' || p.t_emp || ' (the employer row holds ' || p.e_emp || ')' ELSE t.promoted_from_note END,
       employees        = CASE WHEN p.t_emp IS NOT NULL AND p.e_emp IS NOT NULL AND p.t_emp <> p.e_emp THEN p.e_emp ELSE t.employees END,
       employees_source = CASE WHEN p.t_emp IS NOT NULL AND p.e_emp IS NOT NULL AND p.t_emp <> p.e_emp THEN p.e_src ELSE t.employees_source END,
       employees_at     = CASE WHEN p.t_emp IS NOT NULL AND p.e_emp IS NOT NULL AND p.t_emp <> p.e_emp THEN p.e_at  ELSE t.employees_at END
  FROM dk_pair p
 WHERE t.id = p.target_id AND t.employer_id IS NULL;

-- 6. K3: email resolves to a company by Apollo id ----------------------------------------------------------------------
UPDATE public.sales_opportunities o SET apollo_account_id = f.account_id
  FROM dk_fill f JOIN dk_emp e ON e.live AND e.k = f.k
 WHERE o.id = e.id AND o.apollo_account_id IS NULL;
UPDATE public.sales_targets t SET apollo_account_id = f.account_id
  FROM dk_fill f JOIN dk_tgt d ON d.status <> 'rejected' AND d.k = f.k
 WHERE t.id = d.id AND t.apollo_account_id IS NULL;

-- 7. K7: the partner's domain is the one the window reads --------------------------------------------------------------
UPDATE public.sales_goals g SET company_domain = d.domain
  FROM (SELECT DISTINCT ON (goal_id) goal_id, domain FROM public.partner_domains WHERE confirmed ORDER BY goal_id, is_primary DESC, updated_at, id) d
 WHERE g.id = d.goal_id AND g.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND g.goal_type = 'partnership' AND g.company_domain IS DISTINCT FROM d.domain;

-- 8. K10: visits follow the record -------------------------------------------------------------------------------------
UPDATE public.web_visits v SET matched_type = 'partner', matched_id = t.promoted_goal_id
  FROM public.sales_targets t
 WHERE v.matched_type = 'target' AND v.matched_id = t.id AND v.business_id = t.business_id AND t.promoted_goal_id IS NOT NULL;

-- AFTER.
UPDATE dk_proof SET after = CASE n
  WHEN 1 THEN (SELECT bool_or(pg_get_constraintdef(oid) LIKE '%''employer''%')::text FROM pg_constraint WHERE conname = 'web_visits_matched_type_check')
  WHEN 2 THEN (SELECT bool_or(pg_get_constraintdef(oid) LIKE '%''employer''%')::text || ' · ' || bool_or(pg_get_constraintdef(oid) LIKE '%''todo''%')::text FROM pg_constraint WHERE conname = 'sales_week_goals_link_check')
  WHEN 3 THEN (SELECT bool_or(pg_get_constraintdef(oid) LIKE '%''reply''%')::text FROM pg_constraint WHERE conname = 'sales_week_goals_origin_check') || ' · ' || (SELECT bool_or(pg_get_constraintdef(oid) LIKE '%''reply''%')::text FROM pg_constraint WHERE conname = 'sales_todo_events_origin_check')
  WHEN 4 THEN (SELECT string_agg(column_name, ' · ' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_targets' AND column_name IN ('employer_id', 'promoted_from_note', 'apollo_account_id'))
  WHEN 5 THEN (SELECT count(*)::text || ' of ' || (SELECT count(*) FROM dk_names)::text || ' names differ' FROM dk_names WHERE public.sales_norm_name(name) IS DISTINCT FROM js)
  WHEN 6 THEN (SELECT string_agg(coalesce(matched_type, 'null') || '=' || c, ' · ' ORDER BY coalesce(matched_type, 'null')) FROM (SELECT matched_type, count(*) AS c FROM public.web_visits GROUP BY matched_type) x)
  WHEN 7 THEN (SELECT string_agg(coalesce(link_type, 'null') || '=' || c, ' · ' ORDER BY coalesce(link_type, 'null')) FROM (SELECT link_type, count(*) AS c FROM public.sales_week_goals GROUP BY link_type) x)
  WHEN 8 THEN (SELECT count(*)::text || ': ' || string_agg(t.name || ' -> ' || o.organization, '; ' ORDER BY t.name) FROM public.sales_targets t JOIN public.sales_opportunities o ON o.id = t.employer_id WHERE t.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95')
  WHEN 9 THEN (SELECT coalesce(string_agg(name || ' now ' || employees || ' · note: ' || promoted_from_note, ' | ' ORDER BY name), 'none') FROM public.sales_targets WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND promoted_from_note IS NOT NULL)
  WHEN 10 THEN (SELECT count(*)::text FROM public.sales_opportunities WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND apollo_account_id IS NOT NULL) || ' · placed by this file''s rule: ' || (SELECT coalesce(string_agg(e.name, ', ' ORDER BY e.name), 'none') FROM dk_fill f JOIN dk_emp e ON e.live AND e.k = f.k)
  WHEN 11 THEN (SELECT count(*)::text || coalesce(': ' || string_agg(name, ', ' ORDER BY name), '') FROM public.sales_targets WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND apollo_account_id IS NOT NULL)
  WHEN 12 THEN (SELECT count(*) FILTER (WHERE g.company_domain IS NOT NULL)::text || ' · ' || count(*) FILTER (WHERE g.company_domain = d.domain)::text
                  FROM public.sales_goals g LEFT JOIN (SELECT DISTINCT ON (goal_id) goal_id, domain FROM public.partner_domains WHERE confirmed ORDER BY goal_id, is_primary DESC, updated_at, id) d ON d.goal_id = g.id
                 WHERE g.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND g.goal_type = 'partnership')
  WHEN 13 THEN (SELECT count(*)::text FROM public.sales_opportunities WHERE business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND btrim(coalesce(owner, '')) <> '' AND owner_user_id IS NULL)
  WHEN 14 THEN (SELECT count(*)::text FROM public.web_visits v JOIN public.sales_targets t ON t.id = v.matched_id AND t.business_id = v.business_id WHERE v.matched_type = 'target' AND t.promoted_goal_id IS NOT NULL)
  WHEN 15 THEN (SELECT count(*) FROM public.web_visits)::text || ' · ' || (SELECT count(*) FROM public.sales_week_goals)::text || ' · ' || (SELECT count(*) FROM public.sales_targets)::text || ' · ' || (SELECT count(*) FROM public.sales_opportunities)::text || ' · ' || (SELECT count(*) FROM public.sales_goals)::text || ' · ' || (SELECT count(*) FROM public.partner_domains)::text
END;

COMMIT;

-- The proof. Expected on the first run (HomeLover, read Nov 19; a count that moved since is explained by its names):
--    n  step     what                                             before                         after
--    1  CHECK    web_visits.matched_type admits employer          false                          true
--    2  CHECK    link_type admits employer · todo                 false · false                  true · true
--    3  CHECK    origin admits reply: to-dos · events             false · false                  true · true
--    4  columns  sales_targets new columns                        none                           apollo_account_id · employer_id · promoted_from_note
--    5  K6       sales_norm_name <> normName                      2 (Hospitales Star Médica | L'Oréal)   0 of 100 names differ
--    6  K1       web_visits.matched_type                          null=469 · opportunity=127 · partner=13 · target=499   employer=127 · null=469 · partner=14 · target=498
--    7  K1       sales_week_goals.link_type                       … opportunity=19 …             … employer=19 … (no opportunity)
--    8  K2       targets linked to their employer                 0                              17: the 17 pairs by name
--    9  K2       headcount conflicts                              Ascension 120000 / 142000 · Cloudflare 7330 / 5200 · Mace 8200 / 5000   the 3 targets with the employer's number + the note
--   10  K3       employers with apollo_account_id                 12                             14 · placed: Bass Pro Shops, Lidl US
--   11  K3       targets with apollo_account_id                   0                              4: Advocacy and Resource Center, Intuit, Kroger, Plaid
--   12  K7       partners with company_domain · equal to the row  1 · 1                          21 · 21
--   13  K8       owner text without owner_user_id                 0                              0
--   14  K10      visit rows on a target promoted to a partner     1 (American Family Insurance)  0
--   15  rows     the six tables' row counts                       identical before and after (no row added or deleted)
SELECT n, step, what, before, after FROM dk_proof ORDER BY n;
