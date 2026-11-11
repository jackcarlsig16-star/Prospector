-- person-owner-v1 Stage 1 - every person has an owner: owner_user_id on the three people tables, the person event
-- log, and the one declared backfill. Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run. Idempotent.
--
-- owner_user_id (O1)       NEW on sales_prospect_state, sales_people and partner_contacts: uuid -> profiles.id,
--   NULL = Unassigned. The prospect's text enum `owner` (jack | cyrus | unassigned) stays and is NOT changed here;
--   nothing writes it once Stage 1's code is live (K8) and data-keys-v1 drops it.
-- sales_person_events (O2) NEW - one row per write to a person's owner: kind assign | undo, before / after hold the
--   changed fields only (owner_user_id), never an address or phone; person_key is the People row key
--   (prospect:<contact id> | person:<id> | contact:<id>, K4) and has no foreign key (three tables); the actor is a
--   user id. An Undo adds an 'undo' row (undo_of) and stamps undone_at on the original; rows are never deleted.
--   RLS as the sibling event tables: members read (s5_read), every write is the server's.
-- Backfill, ONCE - each table only in the run that adds its column (a re-run must not overwrite an assignment):
--   sales_prospect_state  enum 'jack' / 'cyrus' -> the ONE member of that workspace whose first name is that word
--                         (business_members.name, as the Huddle reads it); everyone else -> the linked employer's
--                         owner_user_id, else the linked partner's; else NULL.
--   sales_people          the linked employer's owner_user_id, else the linked target's; else NULL.
--   partner_contacts      the partner's owner_user_id; else NULL.
--   Measured read-only Nov 11 (HomeLover, the only workspace with rows): prospects 215 = jack 198 + cyrus 17, none
--   'unassigned'; sales_people 64 -> 14 from the company, 50 NULL; partner_contacts 114 -> 111, 3 NULL.
--   No event rows are written for the backfill. updated_at is not touched. The prospect history trigger does not
--   list owner_user_id, so it logs nothing.

CREATE TABLE IF NOT EXISTS public.sales_person_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  person_key    text NOT NULL CHECK (length(person_key) BETWEEN 3 AND 200 AND person_key !~ '@' AND person_key ~ '^(prospect|person|contact):.'),
  kind          text NOT NULL CHECK (kind IN ('assign', 'undo')),
  before        jsonb NOT NULL DEFAULT '{}'::jsonb,
  after         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  origin        text NOT NULL CHECK (origin IN ('manual', 'scout', 'panel', 'system')),
  batch_id      uuid,
  at            timestamptz NOT NULL DEFAULT now(),
  undone_at     timestamptz,
  undo_of       uuid REFERENCES public.sales_person_events(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS sales_person_events_person_idx ON public.sales_person_events (business_id, person_key, at);
CREATE INDEX IF NOT EXISTS sales_person_events_batch_idx  ON public.sales_person_events (business_id, batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_person_events_at_idx     ON public.sales_person_events (business_id, at DESC);
ALTER TABLE public.sales_person_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_person_events;
CREATE POLICY s5_read ON public.sales_person_events FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_person_events FROM anon;

-- sales_prospect_state: the column + its backfill, only when this run adds it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_prospect_state' AND column_name = 'owner_user_id') THEN
    ALTER TABLE public.sales_prospect_state ADD COLUMN owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
    UPDATE public.sales_prospect_state p
       SET owner_user_id = COALESCE(
             CASE WHEN p.owner IN ('jack', 'cyrus') THEN (
               SELECT min(m.user_id::text)::uuid FROM public.business_members m
                WHERE m.business_id = p.business_id AND m.user_id IS NOT NULL
                  AND lower(split_part(COALESCE(m.name, ''), ' ', 1)) = p.owner
               HAVING count(*) = 1) END,
             CASE WHEN p.owner NOT IN ('jack', 'cyrus') THEN COALESCE(
               (SELECT o.owner_user_id FROM public.sales_opportunities o WHERE o.id = p.opportunity_id AND o.business_id = p.business_id),
               (SELECT g.owner_user_id FROM public.sales_goals g         WHERE g.id = p.goal_id        AND g.business_id = p.business_id)) END);
  END IF;
END $$;

-- sales_people
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_people' AND column_name = 'owner_user_id') THEN
    ALTER TABLE public.sales_people ADD COLUMN owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
    UPDATE public.sales_people s
       SET owner_user_id = COALESCE(
             (SELECT o.owner_user_id FROM public.sales_opportunities o WHERE o.id = s.opportunity_id AND o.business_id = s.business_id),
             (SELECT t.owner_user_id FROM public.sales_targets t       WHERE t.id = s.target_id      AND t.business_id = s.business_id));
  END IF;
END $$;

-- partner_contacts
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'partner_contacts' AND column_name = 'owner_user_id') THEN
    ALTER TABLE public.partner_contacts ADD COLUMN owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
    UPDATE public.partner_contacts c
       SET owner_user_id = (SELECT g.owner_user_id FROM public.sales_goals g WHERE g.id = c.goal_id AND g.business_id = c.business_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sales_prospect_state_owner_user_idx ON public.sales_prospect_state (business_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_people_owner_user_idx         ON public.sales_people (business_id, owner_user_id)         WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_contacts_owner_user_idx     ON public.partner_contacts (business_id, owner_user_id)     WHERE owner_user_id IS NOT NULL;

-- Proof - expect 8 rows (HomeLover's numbers as measured Nov 11; a person added since moves 3-6 by that much):
--   1 sales_person_events   columns=12 · rls=true · policies=1 · anon_select=false · indexes=4
--   2 new columns           partner_contacts.owner_user_id:uuid · sales_people.owner_user_id:uuid · sales_prospect_state.owner_user_id:uuid
--   3 sales_prospect_state  rows=215 · owner set=215 · unassigned=0 · by owner: cyrus=17 · jack=198
--   4 sales_people          rows=64 · owner set=14 · unassigned=50
--   5 partner_contacts      rows=114 · owner set=111 · unassigned=3
--   6 all people by owner   cyrus=52 · jack=286 · seif=2 · unassigned=53
--   7 enum vs owner         enum unchanged: cyrus=17 · jack=198 · a jack/cyrus prospect whose owner is not that member=0
--   8 untouched             person events=0 · owners who are not members=0 · prospect history rows for owner_user_id=0
WITH people AS (
  SELECT business_id, owner_user_id FROM public.sales_prospect_state
  UNION ALL SELECT business_id, owner_user_id FROM public.sales_people
  UNION ALL SELECT business_id, owner_user_id FROM public.partner_contacts
), named AS (
  SELECT p.owner_user_id, COALESCE(lower(split_part(m.name, ' ', 1)), CASE WHEN p.owner_user_id IS NULL THEN 'unassigned' ELSE 'not a member' END) AS who
    FROM people p LEFT JOIN public.business_members m ON m.business_id = p.business_id AND m.user_id = p.owner_user_id
)
SELECT 1 AS n, 'sales_person_events' AS what,
       'columns=' || (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_person_events') ||
       ' · rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_person_events'::regclass) ||
       ' · policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_person_events') ||
       ' · anon_select=' || has_table_privilege('anon', 'public.sales_person_events', 'SELECT') ||
       ' · indexes=' || (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sales_person_events') AS value
UNION ALL
SELECT 2, 'new columns', (SELECT string_agg(table_name || '.' || column_name || ':' || data_type, ' · ' ORDER BY table_name) FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'owner_user_id' AND table_name IN ('sales_prospect_state', 'sales_people', 'partner_contacts'))
UNION ALL
SELECT 3, 'sales_prospect_state',
       'rows=' || (SELECT count(*) FROM public.sales_prospect_state) ||
       ' · owner set=' || (SELECT count(*) FROM public.sales_prospect_state WHERE owner_user_id IS NOT NULL) ||
       ' · unassigned=' || (SELECT count(*) FROM public.sales_prospect_state WHERE owner_user_id IS NULL) ||
       ' · by owner: ' || COALESCE((SELECT string_agg(who || '=' || c, ' · ' ORDER BY who) FROM (
           SELECT lower(split_part(m.name, ' ', 1)) AS who, count(*) AS c FROM public.sales_prospect_state p
             JOIN public.business_members m ON m.business_id = p.business_id AND m.user_id = p.owner_user_id GROUP BY 1) x), 'none')
UNION ALL
SELECT 4, 'sales_people',
       'rows=' || (SELECT count(*) FROM public.sales_people) ||
       ' · owner set=' || (SELECT count(*) FROM public.sales_people WHERE owner_user_id IS NOT NULL) ||
       ' · unassigned=' || (SELECT count(*) FROM public.sales_people WHERE owner_user_id IS NULL)
UNION ALL
SELECT 5, 'partner_contacts',
       'rows=' || (SELECT count(*) FROM public.partner_contacts) ||
       ' · owner set=' || (SELECT count(*) FROM public.partner_contacts WHERE owner_user_id IS NOT NULL) ||
       ' · unassigned=' || (SELECT count(*) FROM public.partner_contacts WHERE owner_user_id IS NULL)
UNION ALL
SELECT 6, 'all people by owner', (SELECT string_agg(who || '=' || c, ' · ' ORDER BY who) FROM (SELECT who, count(*) AS c FROM named GROUP BY who) x)
UNION ALL
SELECT 7, 'enum vs owner',
       'enum unchanged: ' || (SELECT string_agg(owner || '=' || c, ' · ' ORDER BY owner) FROM (SELECT owner, count(*) AS c FROM public.sales_prospect_state GROUP BY owner) x) ||
       ' · a jack/cyrus prospect whose owner is not that member=' || (SELECT count(*) FROM public.sales_prospect_state p
           WHERE p.owner IN ('jack', 'cyrus') AND NOT EXISTS (SELECT 1 FROM public.business_members m
             WHERE m.business_id = p.business_id AND m.user_id = p.owner_user_id AND lower(split_part(COALESCE(m.name, ''), ' ', 1)) = p.owner))
UNION ALL
SELECT 8, 'untouched',
       'person events=' || (SELECT count(*) FROM public.sales_person_events) ||
       ' · owners who are not members=' || (SELECT count(*) FROM named WHERE who = 'not a member') ||
       ' · prospect history rows for owner_user_id=' || (SELECT count(*) FROM public.sales_prospect_events WHERE field = 'owner_user_id')
ORDER BY n;
