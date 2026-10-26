-- hk-legacy-cleanup-v1 Stage 3 - archive the HumanKind legacy rows Jack ruled scrap (Oct 26: "salvage the important
-- ones, clean up and scrap everything else"), per rulings R1-R4. Archive = copy to a service-only table, then delete
-- from the live table, in ONE transaction, with every count asserted. Exactly ONE row is deleted without a copy: the
-- raw mail-thread dump in business_intel_entries (third-party names + addresses inline).
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Re-running raises (the archive already holds rows).
--
-- Archived NOW (business_id 981b790c-a3b0-4265-b32e-1f701d5731ff), child -> parent:
--   account_lists rows of the influencer accounts   2
--   account_influencer_details                     26
--   accounts WHERE account_kind = 'influencer'     26
--   business_intel_entries (all but the dump)       9   + the dump 07735e4f-b821-4c8f-bcd2-e297866564bf deleted outright
--   business_profiles                               1   (carried first: specs/playbook/humankind-legacy-carry.txt, 34cbb3d)
-- DEFERRED until hkos-sheet-import-v1 has read them (asserted present, untouched): prospects 14, projects 3,
--   35 business accounts + account_business_details 25 + their account_lists 42, lists 4, member_list_permissions 3.
-- NOT touched: outreach_doctrine, voice_profiles, business_members, auth_events, businesses.features, every other
--   workspace (HomeLover accounts 66 / lists 7 asserted before and after).

CREATE TABLE IF NOT EXISTS public.legacy_archive (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid,
  source_table text NOT NULL,
  source_id    text NOT NULL,
  row          jsonb NOT NULL,
  archived_at  timestamptz NOT NULL DEFAULT now(),
  archived_by  text
);
CREATE INDEX IF NOT EXISTS legacy_archive_business_source_idx ON public.legacy_archive (business_id, source_table);
ALTER TABLE public.legacy_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legacy_archive FROM anon, authenticated;

-- Session-temporary assert helper (PL/pgSQL has no local procedures); it vanishes with the SQL editor session.
CREATE OR REPLACE FUNCTION pg_temp.expect(what text, got int, want int) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN IF got <> want THEN RAISE EXCEPTION '% = % (expected %) - nothing changed', what, got, want; END IF; END $f$;

DO $$
DECLARE
  hk   CONSTANT uuid := '981b790c-a3b0-4265-b32e-1f701d5731ff';
  dump CONSTANT uuid := '07735e4f-b821-4c8f-bcd2-e297866564bf';
  who  CONSTANT text := 'hk-legacy-cleanup-v1 Stage 3';
  hl   CONSTANT uuid := (SELECT id FROM public.businesses WHERE name = 'HomeLover' LIMIT 1);
  n int; hl_accounts int; hl_lists int;
BEGIN
  -- Guards: the archive is empty for HumanKind, the live counts are exactly the audited ones.
  SELECT count(*) INTO n FROM public.legacy_archive WHERE business_id = hk;                       PERFORM pg_temp.expect('legacy_archive rows for HumanKind', n, 0);
  SELECT count(*) INTO hl_accounts FROM public.accounts WHERE business_id = hl;                   PERFORM pg_temp.expect('HomeLover accounts', hl_accounts, 66);
  SELECT count(*) INTO hl_lists FROM public.lists WHERE business_id = hl;                         PERFORM pg_temp.expect('HomeLover lists', hl_lists, 7);
  SELECT count(*) INTO n FROM public.accounts WHERE business_id = hk AND account_kind = 'influencer';  PERFORM pg_temp.expect('influencer accounts', n, 26);
  SELECT count(*) INTO n FROM public.accounts WHERE business_id = hk AND account_kind = 'business';    PERFORM pg_temp.expect('business accounts (deferred)', n, 35);
  SELECT count(*) INTO n FROM public.accounts WHERE business_id = hk;                             PERFORM pg_temp.expect('accounts total', n, 61);
  SELECT count(*) INTO n FROM public.account_influencer_details d JOIN public.accounts a ON a.id = d.account_id
    WHERE a.business_id = hk;                                                                     PERFORM pg_temp.expect('account_influencer_details', n, 26);
  SELECT count(*) INTO n FROM public.account_business_details d JOIN public.accounts a ON a.id = d.account_id
    WHERE a.business_id = hk AND a.account_kind = 'influencer';                                   PERFORM pg_temp.expect('business_details on influencer accounts', n, 0);
  SELECT count(*) INTO n FROM public.account_business_details d JOIN public.accounts a ON a.id = d.account_id
    WHERE a.business_id = hk;                                                                     PERFORM pg_temp.expect('account_business_details (deferred)', n, 25);
  SELECT count(*) INTO n FROM public.account_lists l JOIN public.accounts a ON a.id = l.account_id
    WHERE a.business_id = hk AND a.account_kind = 'influencer';                                   PERFORM pg_temp.expect('influencer account_lists', n, 2);
  SELECT count(*) INTO n FROM public.account_lists l JOIN public.accounts a ON a.id = l.account_id
    WHERE a.business_id = hk AND a.account_kind = 'business';                                     PERFORM pg_temp.expect('business account_lists (deferred)', n, 42);
  SELECT count(*) INTO n FROM public.business_intel_entries WHERE business_id = hk;              PERFORM pg_temp.expect('business_intel_entries', n, 10);
  SELECT count(*) INTO n FROM public.business_intel_entries WHERE business_id = hk AND id = dump
    AND source_type = 'note' AND length(content) > 70000;                                        PERFORM pg_temp.expect('the mail-thread dump row', n, 1);
  SELECT count(*) INTO n FROM public.zoom_webhook_events WHERE call_log_entry_id IN
    (SELECT id FROM public.business_intel_entries WHERE business_id = hk);                        PERFORM pg_temp.expect('zoom events pointing at HK intel', n, 0);
  SELECT count(*) INTO n FROM public.business_profiles WHERE business_id = hk;                   PERFORM pg_temp.expect('business_profiles', n, 1);
  SELECT count(*) INTO n FROM public.lists WHERE business_id = hk;                               PERFORM pg_temp.expect('lists (deferred)', n, 4);
  SELECT count(*) INTO n FROM public.projects WHERE business_id = hk;                            PERFORM pg_temp.expect('projects (deferred)', n, 3);
  SELECT count(*) INTO n FROM public.prospects WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('prospects (deferred)', n, 14);
  SELECT count(*) INTO n FROM public.member_list_permissions WHERE list_id IN (SELECT id FROM public.lists WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('member_list_permissions (deferred)', n, 3);

  -- Archive, child -> parent. Each INSERT's row count is asserted; nothing is deleted until every copy is in.
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'account_lists', l.id::text, to_jsonb(l), who FROM public.account_lists l
    JOIN public.accounts a ON a.id = l.account_id WHERE a.business_id = hk AND a.account_kind = 'influencer';
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived account_lists', n, 2);
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'account_influencer_details', d.id::text, to_jsonb(d), who FROM public.account_influencer_details d
    JOIN public.accounts a ON a.id = d.account_id WHERE a.business_id = hk AND a.account_kind = 'influencer';
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived account_influencer_details', n, 26);
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'accounts', a.id, to_jsonb(a), who FROM public.accounts a WHERE a.business_id = hk AND a.account_kind = 'influencer';
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived accounts', n, 26);
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'business_intel_entries', e.id::text, to_jsonb(e), who FROM public.business_intel_entries e
    WHERE e.business_id = hk AND e.id <> dump;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived business_intel_entries', n, 9);
  INSERT INTO public.legacy_archive (business_id, source_table, source_id, row, archived_by)
    SELECT hk, 'business_profiles', p.id::text, to_jsonb(p), who FROM public.business_profiles p WHERE p.business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('archived business_profiles', n, 1);

  -- Delete the same rows, children first (explicit, so the CASCADE never does silent work).
  DELETE FROM public.account_lists l USING public.accounts a
    WHERE a.id = l.account_id AND a.business_id = hk AND a.account_kind = 'influencer';
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted account_lists', n, 2);
  DELETE FROM public.account_influencer_details d USING public.accounts a
    WHERE a.id = d.account_id AND a.business_id = hk AND a.account_kind = 'influencer';
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted account_influencer_details', n, 26);
  DELETE FROM public.accounts WHERE business_id = hk AND account_kind = 'influencer';
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted accounts', n, 26);
  DELETE FROM public.business_intel_entries WHERE business_id = hk AND id <> dump;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted business_intel_entries (archived)', n, 9);
  DELETE FROM public.business_intel_entries WHERE business_id = hk AND id = dump;                -- the one outright delete
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted the dump', n, 1);
  DELETE FROM public.business_profiles WHERE business_id = hk;
  GET DIAGNOSTICS n = ROW_COUNT;                                                                  PERFORM pg_temp.expect('deleted business_profiles', n, 1);

  -- After: the deferred set and every other workspace are exactly as before.
  SELECT count(*) INTO n FROM public.legacy_archive WHERE business_id = hk;                       PERFORM pg_temp.expect('legacy_archive rows for HumanKind', n, 64);
  SELECT count(*) INTO n FROM public.accounts WHERE business_id = hk;                             PERFORM pg_temp.expect('accounts left (all business)', n, 35);
  SELECT count(*) INTO n FROM public.account_business_details d JOIN public.accounts a ON a.id = d.account_id
    WHERE a.business_id = hk;                                                                     PERFORM pg_temp.expect('account_business_details left', n, 25);
  SELECT count(*) INTO n FROM public.account_lists l JOIN public.accounts a ON a.id = l.account_id
    WHERE a.business_id = hk;                                                                     PERFORM pg_temp.expect('account_lists left', n, 42);
  SELECT count(*) INTO n FROM public.business_intel_entries WHERE business_id = hk;              PERFORM pg_temp.expect('business_intel_entries left', n, 0);
  SELECT count(*) INTO n FROM public.lists WHERE business_id = hk;                               PERFORM pg_temp.expect('lists left', n, 4);
  SELECT count(*) INTO n FROM public.projects WHERE business_id = hk;                            PERFORM pg_temp.expect('projects left', n, 3);
  SELECT count(*) INTO n FROM public.prospects WHERE project_id IN (SELECT id FROM public.projects WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('prospects left', n, 14);
  SELECT count(*) INTO n FROM public.member_list_permissions WHERE list_id IN (SELECT id FROM public.lists WHERE business_id = hk);
                                                                                                 PERFORM pg_temp.expect('member_list_permissions left', n, 3);
  SELECT count(*) INTO n FROM public.accounts WHERE business_id = hl;                             PERFORM pg_temp.expect('HomeLover accounts after', n, hl_accounts);
  SELECT count(*) INTO n FROM public.lists WHERE business_id = hl;                               PERFORM pg_temp.expect('HomeLover lists after', n, hl_lists);
END $$;

-- Proof - paste these rows back. Expect:
--   archive: account_lists=2 · account_influencer_details=26 · accounts=26 · business_intel_entries=9 · business_profiles=1
--   HumanKind live: accounts=35 · account_influencer_details=0 · account_lists=42 · account_business_details=25 ·
--     business_intel_entries=0 · business_profiles=0 · lists=4 · projects=3 · prospects=14 · member_list_permissions=3
--   HomeLover: accounts=66 · lists=7
--   grants: legacy_archive readable by anon/authenticated = 0 rows (service role only), rls = true
WITH hk AS (SELECT '981b790c-a3b0-4265-b32e-1f701d5731ff'::uuid AS id),
     hl AS (SELECT id FROM public.businesses WHERE name = 'HomeLover' LIMIT 1)
SELECT 'archive' AS kind, string_agg(source_table || '=' || n, ' · ' ORDER BY source_table) AS detail
  FROM (SELECT source_table, count(*) AS n FROM public.legacy_archive, hk WHERE business_id = hk.id GROUP BY 1) s
UNION ALL
SELECT 'HumanKind live',
  'accounts=' || (SELECT count(*) FROM public.accounts, hk WHERE business_id = hk.id)
  || ' · account_influencer_details=' || (SELECT count(*) FROM public.account_influencer_details d JOIN public.accounts a ON a.id = d.account_id, hk WHERE a.business_id = hk.id)
  || ' · account_lists=' || (SELECT count(*) FROM public.account_lists l JOIN public.accounts a ON a.id = l.account_id, hk WHERE a.business_id = hk.id)
  || ' · account_business_details=' || (SELECT count(*) FROM public.account_business_details d JOIN public.accounts a ON a.id = d.account_id, hk WHERE a.business_id = hk.id)
  || ' · business_intel_entries=' || (SELECT count(*) FROM public.business_intel_entries, hk WHERE business_id = hk.id)
  || ' · business_profiles=' || (SELECT count(*) FROM public.business_profiles, hk WHERE business_id = hk.id)
  || ' · lists=' || (SELECT count(*) FROM public.lists, hk WHERE business_id = hk.id)
  || ' · projects=' || (SELECT count(*) FROM public.projects, hk WHERE business_id = hk.id)
  || ' · prospects=' || (SELECT count(*) FROM public.prospects WHERE project_id IN (SELECT p.id FROM public.projects p, hk WHERE p.business_id = hk.id))
  || ' · member_list_permissions=' || (SELECT count(*) FROM public.member_list_permissions WHERE list_id IN (SELECT l.id FROM public.lists l, hk WHERE l.business_id = hk.id))
UNION ALL
SELECT 'HomeLover',
  'accounts=' || (SELECT count(*) FROM public.accounts, hl WHERE business_id = hl.id) || ' · lists=' || (SELECT count(*) FROM public.lists, hl WHERE business_id = hl.id)
UNION ALL
SELECT 'grants',
  'anon/authenticated privileges=' || (SELECT count(*) FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'legacy_archive' AND grantee IN ('anon', 'authenticated'))
  || ' · rls=' || (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.legacy_archive'::regclass);
