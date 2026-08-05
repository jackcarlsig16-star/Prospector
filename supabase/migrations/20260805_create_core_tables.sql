-- Prospector - Create core application tables
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Run this BEFORE 20260527_enable_rls.sql — that migration only runs
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY and CREATE POLICY statements
-- and assumes these 7 tables already exist.
--
-- Column names/types below are reverse-engineered from actual
-- .from(...).select()/.upsert()/.update() calls in the app code
-- (src/utils/db.js, api/handoff.js, api/sfdc/sync-compliance.js,
-- server.js) — not guessed from scratch. Cross-check against those
-- files if you add new fields later.

-- ── team_users ─────────────────────────────────────────────────────────────
-- Written by: src/utils/db.js (saveTeamUsers, registerUser, patchUser, approveUser)
-- Read by:    src/utils/db.js (getTeamUsers, getUserApprovalStatus, getPendingUsers)
CREATE TABLE IF NOT EXISTS public.team_users (
  id         text PRIMARY KEY,
  email      text NOT NULL DEFAULT '',
  name       text NOT NULL DEFAULT '',
  role       text NOT NULL DEFAULT 'AE',
  status     text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved'
  location   text,
  data       jsonb,                            -- full user object, read back verbatim
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_users_status_idx ON public.team_users (status);

-- ── frontier ───────────────────────────────────────────────────────────────
-- Written/read by: src/utils/db.js (saveFrontier, getFrontier)
CREATE TABLE IF NOT EXISTS public.frontier (
  id         text PRIMARY KEY,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── accounts ───────────────────────────────────────────────────────────────
-- Written/read by: src/utils/db.js (saveAccountsToDb, getAccounts, subscribeToAccounts)
-- Also read by:    api/sfdc/sync-compliance.js (select id, data)
CREATE TABLE IF NOT EXISTS public.accounts (
  id          text PRIMARY KEY,
  owner_email text NOT NULL,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_owner_email_idx ON public.accounts (owner_email);

-- ── bdr_assignments ────────────────────────────────────────────────────────
-- Written/read by: src/utils/db.js (getBdrAssignments, upsertBdrAssignment, removeBdrAssignment)
-- onConflict target is the (bdr_email, ae_email) pair, so that's the natural PK.
CREATE TABLE IF NOT EXISTS public.bdr_assignments (
  bdr_email text NOT NULL,
  ae_email  text NOT NULL,
  PRIMARY KEY (bdr_email, ae_email)
);

-- ── handoff_intel ──────────────────────────────────────────────────────────
-- Written by: src/utils/db.js (saveHandoffIntel, updateHandoffStatus) — basic fields
--             api/handoff.js (DiscoCoach auto-write) — full field set
-- Read by:    src/utils/db.js (getHandoffIntels, select *)
--             src/components/HandoffsPage.js (status, accepted_account_id, decline_reason)
CREATE TABLE IF NOT EXISTS public.handoff_intel (
  event_id            text PRIMARY KEY,
  company             text,
  meeting_date        date,
  intel                text,
  source               text,                   -- 'BDR' | 'DiscoCoach'
  status               text DEFAULT 'pending',  -- 'pending' | 'accepted' | 'declined'
  contact_name         text,
  contact_email        text,
  accepted_account_id  text,
  decline_reason       text,
  -- Extended DiscoCoach columns (api/handoff.js)
  ae_sfdc              text,
  ae_segment           text,
  ae_meeting_time      text,
  sfdc_link            text,
  contacts             jsonb,
  pain_points          jsonb,
  key_signals          jsonb,
  pricing_notes        text,
  raw_transcript       text,
  debrief_result       jsonb,
  raw_payload          jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS handoff_intel_updated_at_idx ON public.handoff_intel (updated_at DESC);

-- ── plospect_compliance ───────────────────────────────────────────────────
-- Written/read by: src/utils/db.js (getAllComplianceFromDb, saveComplianceToDb)
--                  api/sfdc/sync-compliance.js (syncAllCompliance)
CREATE TABLE IF NOT EXISTS public.plospect_compliance (
  acc_id         text PRIMARY KEY,
  acc_name       text,
  type           text NOT NULL DEFAULT 'standard',  -- 'standard' | 'partner'
  steps          jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_sfdc_sync timestamptz,
  sfdc_raw       jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── sfdc_tokens ────────────────────────────────────────────────────────────
-- Written by: server.js (SFDC OAuth callback), api/sfdc/sync-compliance.js (re-store)
-- Read by:    api/sfdc/sync-compliance.js (select access_token, instance_url where id='primary')
-- Server-only table — no anon policies are ever created for this one (see enable_rls.sql).
CREATE TABLE IF NOT EXISTS public.sfdc_tokens (
  id            text PRIMARY KEY,   -- always the literal string 'primary'
  access_token  text NOT NULL,
  instance_url  text NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now()
);
