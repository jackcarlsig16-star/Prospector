-- fathom-notes-v1 REV 2 Stage 3 - ONE migration (spec inbox/2026-11-21-2030-fathom-notes-v1-REV2.txt, F11 + F12).
-- Supabase Dashboard -> SQL Editor -> New query -> paste the WHOLE file -> Run once.
--
-- One transaction: if any statement fails, NOTHING is changed. A second run changes nothing (IF NOT EXISTS on every
-- object; the backfill runs only on the run that creates record_type, so a note a member later unmaps is never mapped
-- again by this file). No row is deleted. No address, no phone, no key in this file. The last statement prints the
-- proof: one row per step with BEFORE and AFTER.
--
-- NOT RUN ANYWHERE YET: there is no local Postgres on the build machine, so this file has been read, not executed.
-- The backfill counts below were predicted on Nov 24 by a read-only script running the same rule with normName
-- (sales_norm_name returns the same text - data-keys K6).
--
-- 1. sales_call_notes.record_type + record_id (F12): the ONE primary record a call is about. 'employer' =
--    sales_opportunities.id, 'partner' = sales_goals.id, 'target' = sales_targets.id. Both set or both null. No
--    foreign key (three tables); the view below resolves the name.
-- 2. sales_call_notes.recording_start + recording_end: NOT in the spec's migration line. F11's Calls log shows a
--    duration (recording_end - recording_start) and neither time is stored today (toNote keeps the LA date only).
--    Two nullable columns, filled by the webhook from now on; the 8 Fathom notes that exist read "-". Strike these
--    two lines (and the two view columns marked DURATION) before running if the planner rules otherwise.
-- 3. Backfill, F12 rule (3): the extract's FIRST company, normalised, equal to the normalised name of exactly ONE
--    live record of the note's workspace -> that record. Live = a partnership goal or an employer not archived, or a
--    target that has not been promoted (promoted_goal_id / employer_id null: a promoted target IS the partner or
--    employer it points at, so counting both would call one company "ambiguous"). Two or more records -> left null
--    (the review shows the candidates). Never an ILIKE or partial match.
-- 4. sales_calls_v (F11): one row per call note from any source, without text / transcript / extract. The one read
--    of the Calls tab and Scout's call intents. security_invoker + every grant revoked from anon / authenticated:
--    the API reads it with the service key.
BEGIN;

CREATE TEMP TABLE IF NOT EXISTS fn3_proof (n int PRIMARY KEY, what text, before text, after text);
TRUNCATE fn3_proof;

INSERT INTO fn3_proof (n, what, before) VALUES
  (1, 'call notes (rows · with extract · accepted)',
      (SELECT count(*) || ' · ' || count(extract) || ' · ' || count(accepted_at) FROM public.sales_call_notes)),
  (2, 'new columns present (of 4)',
      (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_call_notes'
        AND column_name IN ('record_type', 'record_id', 'recording_start', 'recording_end'))),
  (3, 'rule (3): matched · ambiguous · none · no extract', 'not run'),
  (4, 'mapped notes (partner · employer · target)', 'no column'),
  (5, 'half-set links (type without id, or id without type)', 'no column'),
  (6, 'sales_calls_v', COALESCE(to_regclass('public.sales_calls_v')::text, 'absent'));

-- Rule (3) candidates, computed before anything changes: one row per (note, live record with the same name key).
CREATE TEMP TABLE IF NOT EXISTS fn3_cands (note_id uuid, record_type text, record_id uuid);
TRUNCATE fn3_cands;
WITH first AS (
  SELECT n.id, n.business_id, COALESCE(public.sales_norm_name(n.extract->'companies'->0->>'name'), '') AS k
    FROM public.sales_call_notes n
   WHERE jsonb_typeof(n.extract->'companies') = 'array'
)
INSERT INTO fn3_cands
SELECT f.id, 'partner', g.id FROM first f JOIN public.sales_goals g
    ON g.business_id = f.business_id AND g.goal_type = 'partnership' AND g.archived_at IS NULL AND public.sales_norm_name(g.name) = f.k
 WHERE f.k <> ''
UNION ALL
SELECT f.id, 'employer', o.id FROM first f JOIN public.sales_opportunities o
    ON o.business_id = f.business_id AND o.archived_at IS NULL AND public.sales_norm_name(o.organization) = f.k
 WHERE f.k <> ''
UNION ALL
SELECT f.id, 'target', t.id FROM first f JOIN public.sales_targets t
    ON t.business_id = f.business_id AND t.promoted_goal_id IS NULL AND t.employer_id IS NULL AND public.sales_norm_name(t.name) = f.k
 WHERE f.k <> '';

UPDATE fn3_proof SET after = (
  SELECT count(*) FILTER (WHERE c = 1) || ' · ' || count(*) FILTER (WHERE c > 1) || ' · ' ||
         count(*) FILTER (WHERE c = 0 AND has_extract) || ' · ' || count(*) FILTER (WHERE NOT has_extract)
    FROM (SELECT n.id, n.extract IS NOT NULL AS has_extract, (SELECT count(*) FROM fn3_cands x WHERE x.note_id = n.id) AS c
            FROM public.sales_call_notes n) s) WHERE n = 3;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'sales_call_notes' AND column_name = 'record_type') THEN
    ALTER TABLE public.sales_call_notes
      ADD COLUMN record_type text CHECK (record_type IS NULL OR record_type IN ('employer', 'partner', 'target')),
      ADD COLUMN record_id   uuid,
      ADD CONSTRAINT sales_call_notes_record_link_check CHECK ((record_type IS NULL) = (record_id IS NULL));
    UPDATE public.sales_call_notes n SET record_type = c.record_type, record_id = c.record_id
      FROM fn3_cands c
     WHERE c.note_id = n.id
       AND (SELECT count(*) FROM fn3_cands x WHERE x.note_id = n.id) = 1;
  END IF;
END $$;

ALTER TABLE public.sales_call_notes
  ADD COLUMN IF NOT EXISTS recording_start timestamptz,
  ADD COLUMN IF NOT EXISTS recording_end   timestamptz;

CREATE INDEX IF NOT EXISTS sales_call_notes_record_idx
  ON public.sales_call_notes (business_id, record_type, record_id) WHERE record_id IS NOT NULL;

CREATE OR REPLACE VIEW public.sales_calls_v WITH (security_invoker = true) AS
SELECT n.id,
       n.business_id,
       n.call_date,
       n.title,
       n.source_type,
       n.source_label,
       n.created_by,
       n.created_at,
       n.accepted_at,
       (n.extract IS NOT NULL) AS has_extract,
       CASE WHEN n.accepted_at IS NOT NULL THEN 'reviewed' WHEN n.extract IS NOT NULL THEN 'unreviewed' ELSE 'no_proposal' END AS status,
       n.fathom_recording_id,
       n.fathom_url,
       n.attendees,
       n.recording_start,                                                            -- DURATION
       n.recording_end,                                                              -- DURATION
       CASE WHEN n.recording_end > n.recording_start
            THEN extract(epoch FROM n.recording_end - n.recording_start)::int END AS duration_seconds,
       n.record_type,
       n.record_id,
       COALESCE(g.name, o.organization, t.name) AS record_name
  FROM public.sales_call_notes n
  LEFT JOIN public.sales_goals         g ON n.record_type = 'partner'  AND g.id = n.record_id AND g.business_id = n.business_id
  LEFT JOIN public.sales_opportunities o ON n.record_type = 'employer' AND o.id = n.record_id AND o.business_id = n.business_id
  LEFT JOIN public.sales_targets       t ON n.record_type = 'target'   AND t.id = n.record_id AND t.business_id = n.business_id;
REVOKE ALL ON public.sales_calls_v FROM anon, authenticated;

UPDATE fn3_proof SET after = (SELECT count(*) || ' · ' || count(extract) || ' · ' || count(accepted_at) FROM public.sales_call_notes) WHERE n = 1;
UPDATE fn3_proof SET after = (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'
  AND table_name = 'sales_call_notes' AND column_name IN ('record_type', 'record_id', 'recording_start', 'recording_end')) WHERE n = 2;
UPDATE fn3_proof SET after = (SELECT count(record_id) || ' (' || count(*) FILTER (WHERE record_type = 'partner') || ' · ' ||
  count(*) FILTER (WHERE record_type = 'employer') || ' · ' || count(*) FILTER (WHERE record_type = 'target') || ')'
  FROM public.sales_call_notes) WHERE n = 4;
UPDATE fn3_proof SET after = (SELECT count(*)::text FROM public.sales_call_notes WHERE (record_type IS NULL) <> (record_id IS NULL)) WHERE n = 5;
UPDATE fn3_proof SET after = (SELECT
  'rows=' || (SELECT count(*) FROM public.sales_calls_v) ||
  ' · with a company=' || (SELECT count(*) FROM public.sales_calls_v WHERE record_name IS NOT NULL) ||
  ' · reviewed/unreviewed/no_proposal=' || (SELECT count(*) FILTER (WHERE status = 'reviewed') || '/' ||
      count(*) FILTER (WHERE status = 'unreviewed') || '/' || count(*) FILTER (WHERE status = 'no_proposal') FROM public.sales_calls_v) ||
  ' · anon_select=' || has_table_privilege('anon', 'public.sales_calls_v', 'SELECT') ||
  ' · authenticated_select=' || has_table_privilege('authenticated', 'public.sales_calls_v', 'SELECT')) WHERE n = 6;

COMMIT;

-- Proof. Expected on the first run, with the Nov 24 rows (N = 44 notes, 19 with an extract, 36 accepted; the numbers
-- move if a call was recorded or pasted since):
--   1  before = after (no note added or removed)
--   2  0 -> 4
--   3  not run -> 16 · 0 · 3 · 25   (matched · ambiguous · none · no extract; the 3 "none" name no record today)
--   4  no column -> 16 (13 · 1 · 2)  (partner · employer · target) - the matched count of row 3
--   5  no column -> 0
--   6  absent -> rows=N · with a company=16 · reviewed/unreviewed/no_proposal=36/x/y · anon_select=false · authenticated_select=false
SELECT n, what, before, after FROM fn3_proof ORDER BY n;
