-- partner-360-v1 Stage 3b - a partner contact's Apollo sequence status.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Apollo's contact_campaign_statuses carries status / added_at /
-- finished_at / current_step_id only - no step number and no
-- step-completed date (probed live 2026-10-07 on Domuso's active contact).
-- So People can say "In sequence · active since Aug 28", nothing finer.
-- Stage 4 may use sequence_added_at only as a PROPOSED Sent move in its
-- dry run, never an automatic one (Jack, 2026-10-07). Written by the Stage
-- 3 sync only (source 'apollo' rows); manual / outlook rows keep nulls.

ALTER TABLE public.partner_contacts
  ADD COLUMN IF NOT EXISTS sequence_status      text CHECK (sequence_status IS NULL OR length(sequence_status) <= 40),
  ADD COLUMN IF NOT EXISTS sequence_added_at    timestamptz,
  ADD COLUMN IF NOT EXISTS sequence_finished_at timestamptz;

-- Check: 17 columns, rls still on, 0 policies
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'partner_contacts') AS columns,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'partner_contacts') AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'partner_contacts') AS policies;
