-- todo-events-v1 Stage 1 (rulings R1-R9 of 2026-11-10 20:25) - the to-do event log, three columns on the to-do, and
-- the two declared backfills. Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Idempotent.
--
-- sales_todo_events        NEW (T1) - one row per write to a to-do (sales_week_goals kind 'todo'): create · done ·
--   undone · reassign · due · drop · snooze · unsnooze · link · undo. before / after hold the changed fields only
--   (structured: status, owner_user_id, due_date, snooze_until, link_type, link_id, commitment_id, person_key ...),
--   never an address or phone; the actor is a user id (names resolve at read time). An Undo adds an 'undo' row
--   (undo_of = the event it reverses) and stamps undone_at / undone_by on the original; rows are never deleted.
--   todo_id has NO foreign key on purpose: the trail outlives an admin's physical delete (T9) and a same-request
--   rollback (R3). RLS as the sibling event tables: members read (s5_read), every write is the server's.
-- sales_week_goals         + origin (T2 / R5: manual · scout · call_notes · signal · tidy · panel · plan · nudge ·
--   carry_over · import · system; NOT NULL DEFAULT 'manual' so today's writers keep working until applyTodo owns them)
--   + snooze_until (T6: a date, distinct from due_date) + person_key (T7 / K4: the People row key, <= 200).
-- Origin backfill (R7), ONCE - only in the run that adds the column, in this order, to-dos only:
--   source_note_id set -> call_notes · text starts "Follow up: " -> scout · text starts "Contacted " and done -> panel ·
--   no creator -> system · the rest stay manual. Measured read-only on HomeLover Nov 10 (397 to-dos, the only
--   workspace with rows): call_notes 346 · scout 10 · panel 9 · system 13 · manual 19 - the ruling's counts exactly.
--   Commitments (32) keep the default; the 13 waiting rows came from call notes and get call_notes by the same rule.
--   updated_at is not touched (no trigger on the table).
-- Link backfill (R6), by id - 12 open to-dos with NO link whose text names exactly one live record (normalised name,
--   whole words), read by eye on Nov 10. Each gets link_type / link_id and ONE 'link' event (origin system, no actor,
--   one batch_id). A row that has gained a link, closed or gone since is skipped. NOT linked, listed in the Stage 1
--   report: 3 false name matches (records named "test" x2 and "Target"), 3 that already carry a company link, and
--   the 8 ambiguous (R6). The ruling said 18: 18 = these 12 + those 3 + those 3.

CREATE TABLE IF NOT EXISTS public.sales_todo_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  todo_id       uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('create', 'done', 'undone', 'reassign', 'due', 'drop', 'snooze', 'unsnooze', 'link', 'undo')),
  before        jsonb NOT NULL DEFAULT '{}'::jsonb,
  after         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  origin        text NOT NULL CHECK (origin IN ('manual', 'scout', 'call_notes', 'signal', 'tidy', 'panel', 'plan', 'nudge', 'carry_over', 'import', 'system')),
  batch_id      uuid,
  at            timestamptz NOT NULL DEFAULT now(),
  undone_at     timestamptz,
  undone_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  undo_of       uuid REFERENCES public.sales_todo_events(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS sales_todo_events_todo_idx  ON public.sales_todo_events (business_id, todo_id, at);
CREATE INDEX IF NOT EXISTS sales_todo_events_batch_idx ON public.sales_todo_events (business_id, batch_id) WHERE batch_id IS NOT NULL;
-- the week's lines ("Pipeline moves this week") and the week strip's count read by time
CREATE INDEX IF NOT EXISTS sales_todo_events_at_idx    ON public.sales_todo_events (business_id, at DESC);
ALTER TABLE public.sales_todo_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_todo_events;
CREATE POLICY s5_read ON public.sales_todo_events FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_todo_events FROM anon;

ALTER TABLE public.sales_week_goals ADD COLUMN IF NOT EXISTS snooze_until date;
ALTER TABLE public.sales_week_goals ADD COLUMN IF NOT EXISTS person_key text;
ALTER TABLE public.sales_week_goals DROP CONSTRAINT IF EXISTS sales_week_goals_person_key_check;
ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_person_key_check
  CHECK (person_key IS NULL OR (length(person_key) BETWEEN 1 AND 200 AND person_key !~ '@'));
CREATE INDEX IF NOT EXISTS sales_week_goals_snooze_idx ON public.sales_week_goals (business_id, snooze_until) WHERE snooze_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_week_goals_person_idx ON public.sales_week_goals (business_id, person_key) WHERE person_key IS NOT NULL;

-- origin + its backfill: only when this run adds the column (a re-run must not re-read text typed after today).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_week_goals' AND column_name = 'origin') THEN
    ALTER TABLE public.sales_week_goals ADD COLUMN origin text NOT NULL DEFAULT 'manual';
    UPDATE public.sales_week_goals
       SET origin = CASE
             WHEN source_note_id IS NOT NULL THEN 'call_notes'
             WHEN text LIKE 'Follow up: %' THEN 'scout'
             WHEN text LIKE 'Contacted %' AND status = 'done' THEN 'panel'
             WHEN created_by IS NULL THEN 'system'
             ELSE 'manual' END
     WHERE kind = 'todo' OR (kind = 'waiting' AND source_note_id IS NOT NULL);
  END IF;
END $$;
ALTER TABLE public.sales_week_goals DROP CONSTRAINT IF EXISTS sales_week_goals_origin_check;
ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_origin_check
  CHECK (origin IN ('manual', 'scout', 'call_notes', 'signal', 'tidy', 'panel', 'plan', 'nudge', 'carry_over', 'import', 'system'));

-- R6 link backfill: HomeLover, 12 rows by id, one 'link' event each, one batch.
WITH want(todo_id, link_type, link_id) AS (VALUES
    ('1d62f237-12f3-4798-8b61-3ae0ad5cc367'::uuid, 'target', '0ff9b5f5-c49f-4733-a06c-7728d7262812'),
    ('f19f4d86-d156-4d88-bd6a-3df1caf1f391'::uuid, 'partner', 'cda2bbc1-efeb-4bd1-814b-72bb1ce17d1b'),
    ('a11f0105-d757-49aa-83fe-1ed318f3e442'::uuid, 'target', 'ec739cc8-cbb1-4c3f-9f78-852bfb41dc6f'),
    ('04cf175b-872b-46ca-b165-f121cc56e11d'::uuid, 'partner', '08859093-99e6-4103-adfe-8314814a15da'),
    ('d7c1c68f-5bf4-467d-a320-7bb86667b6b2'::uuid, 'opportunity', '486ab5b3-9d3d-45a2-8678-4c4dff6cf45c'),
    ('1a849344-f57c-471c-804b-12623f99a0a9'::uuid, 'target', '7ed9fee3-1dce-4b53-87db-09119333ed0b'),
    ('bc13d0c8-8ab8-4857-b825-9b27797e34a3'::uuid, 'target', '7ed9fee3-1dce-4b53-87db-09119333ed0b'),
    ('c2b928cc-6216-493f-a143-9e18c9a68fc6'::uuid, 'target', '0ff9b5f5-c49f-4733-a06c-7728d7262812'),
    ('e689a7fe-efd3-4e5f-894a-4badfa9b85e8'::uuid, 'opportunity', 'f66d7361-4baa-4bc4-b5e0-4419fe20456e'),
    ('ffffad88-041a-443f-9d40-21e3f0620a30'::uuid, 'partner', '9303b2e5-dc4c-4cba-b1d9-e9def89a4e08'),
    ('12fee1e5-c7d3-458e-8d4b-d584ac7afa35'::uuid, 'partner', '6fb331b1-3d76-4f64-a66b-1bda29dd1a1c'),
    ('3aefd515-1df1-492f-8ec2-35163f8d3c61'::uuid, 'target', '7ed9fee3-1dce-4b53-87db-09119333ed0b')
), live AS (
  -- the record must still exist in this workspace (a partner / employer not archived)
  SELECT w.* FROM want w
   WHERE (w.link_type = 'partner'     AND EXISTS (SELECT 1 FROM public.sales_goals g         WHERE g.id::text = w.link_id AND g.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND g.archived_at IS NULL))
      OR (w.link_type = 'opportunity' AND EXISTS (SELECT 1 FROM public.sales_opportunities o WHERE o.id::text = w.link_id AND o.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND o.archived_at IS NULL))
      OR (w.link_type = 'target'      AND EXISTS (SELECT 1 FROM public.sales_targets t       WHERE t.id::text = w.link_id AND t.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95'))
), upd AS (
  UPDATE public.sales_week_goals g
     SET link_type = l.link_type, link_id = l.link_id
    FROM live l
   WHERE g.id = l.todo_id AND g.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95'
     AND g.kind = 'todo' AND g.status = 'open' AND g.link_type IS NULL AND g.link_id IS NULL
  RETURNING g.id, g.business_id, g.link_type, g.link_id
)
INSERT INTO public.sales_todo_events (business_id, todo_id, kind, before, after, actor_user_id, origin, batch_id)
SELECT business_id, id, 'link', jsonb_build_object('link_type', NULL, 'link_id', NULL),
       jsonb_build_object('link_type', link_type, 'link_id', link_id), NULL, 'system', '6629dacd-f92f-43aa-a0a0-5819170234c0'::uuid
  FROM upd;

-- Proof - expect 7 rows (HomeLover's numbers as measured Nov 10; a to-do added or closed since moves 4 and 6 by that much):
--   1 sales_todo_events   columns=13 · rls=true · policies=1 · anon_select=false · indexes=4
--   2 new columns         origin:text · person_key:text · snooze_until:date
--   3 checks              origin=1 · person_key=1
--   4 origin, to-dos      call_notes=346 · manual=19 · panel=9 · scout=10 · system=13
--   5 origin, other kinds commitment manual=32 · waiting call_notes=13
--   6 link backfill       events=12 (batch 6629dacd-f92f-43aa-a0a0-5819170234c0) · rows now linked=12 · open to-dos linked to a record=88 (76 + 12)
--   7 untouched           snoozed=0 · person_key set=0 · "@" in events=0
SELECT 1 AS n, 'sales_todo_events' AS what,
       'columns=' || (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_todo_events') ||
       ' · rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_todo_events'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_todo_events') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_todo_events', 'SELECT') ||
       ' · indexes=' || (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sales_todo_events') AS value
UNION ALL
SELECT 2, 'new columns', (SELECT string_agg(column_name || ':' || data_type, ' · ' ORDER BY column_name) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'sales_week_goals' AND column_name IN ('origin', 'snooze_until', 'person_key'))
UNION ALL
SELECT 3, 'checks', 'origin=' || (SELECT count(*) FROM pg_constraint WHERE conname = 'sales_week_goals_origin_check') ||
        ' · person_key=' || (SELECT count(*) FROM pg_constraint WHERE conname = 'sales_week_goals_person_key_check')
UNION ALL
SELECT 4, 'origin, to-dos', (SELECT string_agg(origin || '=' || c, ' · ' ORDER BY origin) FROM (SELECT origin, count(*) AS c FROM public.sales_week_goals WHERE kind = 'todo' GROUP BY origin) x)
UNION ALL
SELECT 5, 'origin, other kinds', (SELECT string_agg(kind || ' ' || origin || '=' || c, ' · ' ORDER BY kind, origin) FROM (SELECT kind, origin, count(*) AS c FROM public.sales_week_goals WHERE kind <> 'todo' GROUP BY kind, origin) x)
UNION ALL
SELECT 6, 'link backfill',
       'events=' || (SELECT count(*) FROM public.sales_todo_events WHERE kind = 'link' AND batch_id = '6629dacd-f92f-43aa-a0a0-5819170234c0') ||
       ' · rows now linked=' || (SELECT count(*) FROM public.sales_week_goals g JOIN public.sales_todo_events e ON e.todo_id = g.id AND e.batch_id = '6629dacd-f92f-43aa-a0a0-5819170234c0' WHERE g.link_type = e.after->>'link_type' AND g.link_id = e.after->>'link_id') ||
       ' · open to-dos linked to a record=' || (SELECT count(*) FROM public.sales_week_goals WHERE kind = 'todo' AND status = 'open' AND link_type IN ('partner', 'opportunity', 'target') AND link_id IS NOT NULL)
UNION ALL
SELECT 7, 'untouched',
       'snoozed=' || (SELECT count(*) FROM public.sales_week_goals WHERE snooze_until IS NOT NULL) ||
       ' · person_key set=' || (SELECT count(*) FROM public.sales_week_goals WHERE person_key IS NOT NULL) ||
       ' · "@" in events=' || (SELECT count(*) FROM public.sales_todo_events WHERE before::text ~ '@' OR after::text ~ '@')
ORDER BY n;
