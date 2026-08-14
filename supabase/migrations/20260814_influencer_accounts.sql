-- Prospector - Influencer account kind (influencer-accounts-v1)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- account_kind is a new dimension, distinct from accounts.data.type (which
-- means outreach method, e.g. "Sponsored Reward/Raffle") - don't confuse
-- the two. Default 'business' so every existing account keeps its current
-- meaning unchanged.
--
-- Phase 0 finding: Instagram profile fetching (Jina Reader, even with a
-- real API key) is confirmed blocked by Instagram's own login wall - not a
-- fetch/schema concern. assessInfluencerAccount() synthesizes from a
-- human-pasted bio, not a fetched one. Schema still supports that: no
-- fetch-specific columns needed beyond what a manual-paste flow uses too.

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'business';

CREATE TABLE IF NOT EXISTS public.account_influencer_details (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        text NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  instagram_handle  text NOT NULL,
  instagram_url     text,
  follower_count    integer,
  bio_snapshot      text,
  niche_assessment  jsonb,
  assessment_status text NOT NULL DEFAULT 'pending', -- 'pending' | 'assessing' | 'ready' | 'error'
  assessed_at       timestamptz
);
CREATE INDEX IF NOT EXISTS account_influencer_details_handle_idx ON public.account_influencer_details (instagram_handle);

ALTER TABLE public.account_influencer_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_read_account_influencer_details   ON public.account_influencer_details;
DROP POLICY IF EXISTS anon_write_account_influencer_details  ON public.account_influencer_details;
DROP POLICY IF EXISTS anon_update_account_influencer_details ON public.account_influencer_details;
DROP POLICY IF EXISTS anon_delete_account_influencer_details ON public.account_influencer_details;
CREATE POLICY anon_read_account_influencer_details   ON public.account_influencer_details FOR SELECT TO anon USING (true);
CREATE POLICY anon_write_account_influencer_details  ON public.account_influencer_details FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_update_account_influencer_details ON public.account_influencer_details FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_delete_account_influencer_details ON public.account_influencer_details FOR DELETE TO anon USING (true);
