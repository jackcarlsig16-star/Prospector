-- hk-legacy-cleanup-v1 Stage 5 - archive the set ruling R3 deferred until hkos-sheet-import-v1 had read it (the Sheet
-- import ran and reached bar 5 on 2026-10-27). Same shape as Stage 3 (20261026_legacy_archive.sql): copy child -> parent
-- into the service-only legacy_archive, then delete the same rows children first, in ONE transaction, every count
-- asserted against the literal numbers below. Nothing is deleted without a copy.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Re-running raises (the live counts are then 0).
--
-- Archived NOW (business_id 981b790c-a3b0-4265-b32e-1f701d5731ff), child -> parent:
--   prospects of the 3 HumanKind projects           14   (prospects -> projects CASCADE: copied and deleted FIRST)
--   projects                                         3   (deleted before lists: projects.list_id is ON DELETE SET NULL)
--   account_lists of the 35 business accounts       42   (every one on a HumanKind list)
--   account_business_details                        25
--   accounts (all 35 left are account_kind business) 35
--   member_list_permissions on HumanKind lists       0   (Stage 3 counted 3 on 2026-10-26; they followed the invited member
--                                                         row out through member_id ON DELETE CASCADE - HumanKind has 1
--                                                         business_members row now. Asserted 0 so a reappearance raises.)
--   lists                                            4
-- Referencing tables asserted empty for these projects / accounts first: outreach_drafts, campaigns, frontier,
--   bdr_assignments, handoff_intel, sfdc_tokens, business_intel_entries (project_id), accounts (project_id, any workspace),
--   plospect_compliance (acc_id), project_members when the table exists.
-- NOT touched: hk_* tables (the Sheet import), legacy_archive's 64 Stage 3 rows, business_members, auth_events,
--   outreach_doctrine, voice_profiles, every other workspace (HomeLover accounts 66 / lists 7 asserted before and after).

-- Session-temporary assert helper (PL/pgSQL has no local procedures); it vanishes with the SQL editor session.
CREATE OR REPLACE FUNCTION pg_temp.expect(what text, got int, want int) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN IF got <> want THEN RAISE EXCEPTION '% = % (expected %) - nothing changed', what, got, want; END IF; END $f$;

DO $$
DECLARE
  hk   CONSTANT uuid := '981b790c-a3b0-4265-b32e-1f701d5731ff';
  who  CONSTANT text := 'hk-legacy-cleanup-v1 Stage 5';
  hl   CONSTANT uuid := (SELECT id FROM public.businesses WHERE name = 'HomeLover' LIMIT 1);
  n int; hl_accounts int; hl_lists int;
BEGIN
  -- Guards: Stage 3's 64 archive rows are there, the deferred set is exactly as counted, nothing else hangs off it.
  SELECT count(*) INTO n FROM public.legacy_archive WHERE business_id = hk;                       PERFORM pg_temp.expect('legacy_archive rows for HumanKind (Stage 3)', n, 64);
  SELECT count(*) INTO hl_accounts FROM public.accounts WHERE business_id = hl;                   PERFORM pg_temp.expect('HomeLover accounts', hl_accounts, 66);
  SELECT count(*) INTO hl_lists FROM public.lists WHERE business_id = hl;                         PERFORM pg_temp.expect('HomeLover lists', hl_lists, 7);
  SELECT count(*) INTO n FROM public.projects WHERE business_id = hk;                            PERFORM pg_temp.expect('projects', n, 3);
  SELECT count(*) INTO n FROM public.prospects WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('prospects', n, 14);
  SELECT count(*) INTO n FROM public.prospects p WHERE p.project_id IN (SELECT id FROM public.projects WHERE business_id = hk)
    AND p.is_founding_partner;                                                                   PERFORM pg_temp.expect('prospects flagged founding partner', n, 14);
  SELECT count(*) INTO n FROM public.accounts WHERE business_id = hk;                             PERFORM pg_temp.expect('accounts total', n, 35);
  SELECT count(*) INTO n FROM public.accounts WHERE business_id = hk AND account_kind = 'business';    PERFORM pg_temp.expect('business accounts', n, 35);
  SELECT count(*) INTO n FROM public.account_business_details d JOIN public.accounts a ON a.id = d.account_id
    WHERE a.business_id = hk;                                                                     PERFORM pg_temp.expect('account_business_details', n, 25);
  SELECT count(*) INTO n FROM public.account_lists l JOIN public.accounts a ON a.id = l.account_id
    WHERE a.business_id = hk;                                                                     PERFORM pg_temp.expect('account_lists by account', n, 42);
  SELECT count(*) INTO n FROM public.account_lists l WHERE l.list_id IN (SELECT id FROM public.lists WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('account_lists by list', n, 42);
  SELECT count(*) INTO n FROM public.account_lists l JOIN public.accounts a ON a.id = l.account_id
    WHERE a.business_id = hk AND l.list_id NOT IN (SELECT id FROM public.lists WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('account_lists pointing outside HumanKind', n, 0);
  SELECT count(*) INTO n FROM public.lists WHERE business_id = hk;                               PERFORM pg_temp.expect('lists', n, 4);
  SELECT count(*) INTO n FROM public.member_list_permissions WHERE list_id IN (SELECT id FROM public.lists WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('member_list_permissions', n, 0);
  -- Nothing else references these projects / accounts (per the FK map + live reads on 2026-10-27).
  SELECT count(*) INTO n FROM public.outreach_drafts WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk)
    OR prospect_id IN (SELECT p.id FROM public.prospects p JOIN public.projects j ON j.id = p.project_id WHERE j.business_id = hk);
                                                                                                 PERFORM pg_temp.expect('outreach_drafts on HumanKind projects', n, 0);
  SELECT count(*) INTO n FROM public.campaigns WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('campaigns on HumanKind projects', n, 0);
  SELECT count(*) INTO n FROM public.frontier WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('frontier on HumanKind projects', n, 0);
  SELECT count(*) INTO n FROM public.bdr_assignments WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('bdr_assignments on HumanKind projects', n, 0);
  SELECT count(*) INTO n FROM public.handoff_intel WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('handoff_intel on HumanKind projects', n, 0);
  SELECT count(*) INTO n FROM public.sfdc_tokens WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('sfdc_tokens on HumanKind projects', n, 0);
  SELECT count(*) INTO n FROM public.business_intel_entries WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('business_intel_entries on HumanKind projects', n, 0);
  SELECT count(*) INTO n FROM public.accounts WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('accounts (any workspace) on HumanKind projects', n, 0);
  SELECT count(*) INTO n FROM public.plospect_compliance WHERE acc_id IN (SELECT id FROM public.accounts WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('plospect_compliance on HumanKind accounts', n, 0);
  IF to_regclass('public.project_members') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.project_members WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = $1)' INTO n USING hk;
                                                                                                 PERFORM pg_temp.expect('project_members on HumanKind projects', n, 0);
  END IF;

  -- Archive, child -> parent. Each INSERT's row count is asserted; nothing is deleted until every copy is in.
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'prospects', p.id::text, to_jsonb(p), who FROM public.prospects p
    WHERE p.project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived prospects', n, 14);
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'projects', j.id::text, to_jsonb(j), who FROM public.projects j WHERE j.business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived projects', n, 3);
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'account_lists', l.id::text, to_jsonb(l), who FROM public.account_lists l
    JOIN public.accounts a ON a.id = l.account_id WHERE a.business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived account_lists', n, 42);
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'account_business_details', d.id::text, to_jsonb(d), who FROM public.account_business_details d
    JOIN public.accounts a ON a.id = d.account_id WHERE a.business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived account_business_details', n, 25);
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'accounts', a.id, to_jsonb(a), who FROM public.accounts a WHERE a.business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived accounts', n, 35);
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'member_list_permissions', m.id::text, to_jsonb(m), who FROM public.member_list_permissions m
    WHERE m.list_id IN (SELECT id FROM public.lists WHERE business_id = hk);
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived member_list_permissions', n, 0);
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'lists', l.id::text, to_jsonb(l), who FROM public.lists l WHERE l.business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived lists', n, 4);

  -- Delete the same rows, children first (explicit, so no CASCADE or SET NULL does silent work).
  DELETE FROM public.prospects WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted prospects', n, 14);
  DELETE FROM public.projects WHERE business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted projects', n, 3);
  DELETE FROM public.account_lists l USING public.accounts a WHERE a.id = l.account_id AND a.business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted account_lists', n, 42);
  DELETE FROM public.account_business_details d USING public.accounts a WHERE a.id = d.account_id AND a.business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted account_business_details', n, 25);
  DELETE FROM public.accounts WHERE business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted accounts', n, 35);
  DELETE FROM public.member_list_permissions WHERE list_id IN (SELECT id FROM public.lists WHERE business_id = hk);
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted member_list_permissions', n, 0);
  DELETE FROM public.lists WHERE business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted lists', n, 4);

  -- After: HumanKind's legacy layer is empty, the archive holds 64 + 123, every other workspace is exactly as before.
  SELECT count(*) INTO n FROM public.legacy_archive WHERE business_id = hk;                       PERFORM pg_temp.expect('legacy_archive rows for HumanKind', n, 187);
  SELECT count(*) INTO n FROM public.legacy_archive WHERE business_id = hk AND archived_by = who;   PERFORM pg_temp.expect('legacy_archive rows from this run', n, 123);
  SELECT count(*) INTO n FROM public.projects WHERE business_id = hk;                            PERFORM pg_temp.expect('projects left', n, 0);
  SELECT count(*) INTO n FROM public.accounts WHERE business_id = hk;                             PERFORM pg_temp.expect('accounts left', n, 0);
  SELECT count(*) INTO n FROM public.lists WHERE business_id = hk;                               PERFORM pg_temp.expect('lists left', n, 0);
  SELECT count(*) INTO n FROM public.accounts WHERE business_id = hl;                             PERFORM pg_temp.expect('HomeLover accounts after', n, hl_accounts);
  SELECT count(*) INTO n FROM public.lists WHERE business_id = hl;                               PERFORM pg_temp.expect('HomeLover lists after', n, hl_lists);
  SELECT count(*) INTO n FROM public.prospects p LEFT JOIN public.projects j ON j.id = p.project_id WHERE j.id IS NULL;
                                                                                                 PERFORM pg_temp.expect('orphan prospects', n, 0);
  SELECT count(*) INTO n FROM public.hk_brands WHERE business_id = hk AND relationship = 'founding_partner' AND archived_at IS NULL;
                                                                                                 PERFORM pg_temp.expect('hk_brands founding partners (the Sheet import, untouched)', n, 14);
END $$;

-- Proof - paste these rows back. Expect:
--   archive: account_business_details=25 · account_influencer_details=26 · account_lists=44 · accounts=61 ·
--     business_intel_entries=9 · business_profiles=1 · lists=4 · projects=3 · prospects=14   (member_list_permissions absent: 0 rows)
--   HumanKind live: accounts=0 · account_business_details=0 · account_lists=0 · lists=0 · projects=0 · prospects=0 ·
--     member_list_permissions=0 · hk_brands=<unchanged> · hk_brands founding partners=14
--   HomeLover: accounts=66 · lists=7
WITH hk AS (SELECT '981b790c-a3b0-4265-b32e-1f701d5731ff'::uuid AS id),
     hl AS (SELECT id FROM public.businesses WHERE name = 'HomeLover' LIMIT 1)
SELECT 'archive' AS kind, string_agg(source_table || '=' || n, ' · ' ORDER BY source_table) AS detail
  FROM (SELECT source_table, count(*) AS n FROM public.legacy_archive, hk WHERE business_id = hk.id GROUP BY 1) s
UNION ALL
SELECT 'HumanKind live',
  'accounts=' || (SELECT count(*) FROM public.accounts, hk WHERE business_id = hk.id)
  || ' · account_business_details=' || (SELECT count(*) FROM public.account_business_details d JOIN public.accounts a ON a.id = d.account_id, hk WHERE a.business_id = hk.id)
  || ' · account_lists=' || (SELECT count(*) FROM public.account_lists l JOIN public.accounts a ON a.id = l.account_id, hk WHERE a.business_id = hk.id)
  || ' · lists=' || (SELECT count(*) FROM public.lists, hk WHERE business_id = hk.id)
  || ' · projects=' || (SELECT count(*) FROM public.projects, hk WHERE business_id = hk.id)
  || ' · prospects=' || (SELECT count(*) FROM public.prospects WHERE project_id IN (SELECT p.id FROM public.projects p, hk WHERE p.business_id = hk.id))
  || ' · member_list_permissions=' || (SELECT count(*) FROM public.member_list_permissions WHERE list_id IN (SELECT l.id FROM public.lists l, hk WHERE l.business_id = hk.id))
  || ' · hk_brands=' || (SELECT count(*) FROM public.hk_brands b, hk WHERE b.business_id = hk.id AND b.archived_at IS NULL)
  || ' · hk_brands founding partners=' || (SELECT count(*) FROM public.hk_brands b, hk WHERE b.business_id = hk.id AND b.relationship = 'founding_partner' AND b.archived_at IS NULL)
UNION ALL
SELECT 'HomeLover',
  'accounts=' || (SELECT count(*) FROM public.accounts, hl WHERE business_id = hl.id) || ' · lists=' || (SELECT count(*) FROM public.lists, hl WHERE business_id = hl.id);
