-- Prospector - influencer-card-v2 Phase 1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- account_kind was unconstrained since influencer-accounts-v1 (just a
-- default, no CHECK) - locking it down now that a second real value exists
-- and the app depends on the distinction. Only 'business' and 'influencer'
-- rows exist in the live table as of this migration (verified via a real
-- select before writing this), so backfill is a no-op.
--
-- Four-layer shape for account_influencer_details: Creator fields already
-- exist (instagram_handle, follower_count, bio_snapshot, category etc live
-- in niche_assessment jsonb). This adds Fit (fit_score/fit_signals/
-- fit_rationale, Phase 2) and Relationship (relationship_stage/temperature/
-- priority/next_action/decline_reason/tags, Phase 3-4). Deal/Campaign is
-- explicitly out of scope until a real campaign exists to build against.

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_account_kind_check;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_account_kind_check CHECK (account_kind IN ('business', 'influencer'));

ALTER TABLE public.account_influencer_details
  ADD COLUMN IF NOT EXISTS relationship_stage text NOT NULL DEFAULT 'not_contacted',
  ADD COLUMN IF NOT EXISTS relationship_temperature text,
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fit_score integer,
  ADD COLUMN IF NOT EXISTS fit_signals jsonb,
  ADD COLUMN IF NOT EXISTS fit_rationale text;

ALTER TABLE public.account_influencer_details
  DROP CONSTRAINT IF EXISTS account_influencer_details_relationship_stage_check;
ALTER TABLE public.account_influencer_details
  ADD CONSTRAINT account_influencer_details_relationship_stage_check
    CHECK (relationship_stage IN ('not_contacted','contacted','replied','interested','negotiating','partnered','declined','do_not_contact'));

ALTER TABLE public.account_influencer_details
  DROP CONSTRAINT IF EXISTS account_influencer_details_relationship_temperature_check;
ALTER TABLE public.account_influencer_details
  ADD CONSTRAINT account_influencer_details_relationship_temperature_check
    CHECK (relationship_temperature IS NULL OR relationship_temperature IN ('warm','familiar','cold'));

ALTER TABLE public.account_influencer_details
  DROP CONSTRAINT IF EXISTS account_influencer_details_priority_check;
ALTER TABLE public.account_influencer_details
  ADD CONSTRAINT account_influencer_details_priority_check
    CHECK (priority IS NULL OR priority IN ('low','medium','high'));

ALTER TABLE public.account_influencer_details
  DROP CONSTRAINT IF EXISTS account_influencer_details_fit_score_check;
ALTER TABLE public.account_influencer_details
  ADD CONSTRAINT account_influencer_details_fit_score_check
    CHECK (fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100));
