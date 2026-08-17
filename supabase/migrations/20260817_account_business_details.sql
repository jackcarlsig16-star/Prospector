-- Prospector - account-business-details-v1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Mirrors account_influencer_details' shape/RLS pattern exactly (see
-- 20260814_influencer_accounts.sql) - a real, structured enrichment profile
-- for business accounts instead of Assay output dumped flat into
-- accounts.data alongside identity and pipeline state. Single current
-- snapshot, no history/versioning (deliberately deferred).
--
-- Field mapping decided during Step 0 audit (2026-08-17), since the SPEC
-- explicitly left exact consolidation to that audit's findings. Every real
-- account_kind='business' account was checked live - only 2 of 16 have ever
-- been analyzed, and both write the same duplicated shape: an abbreviated
-- key (bm/pf/dis/sigs/tier/score) AND a full-name key (businessModel/
-- productFit/disqualifier/keySignals) for the same value. This table gives
-- each concept exactly one name:
--   business_model  <- businessModel/bm ("what this company does")
--   fit_rationale    <- productFit/pf ("why/how it fits" - same semantic
--                       role as account_influencer_details.fit_rationale)
--   disqualifier     <- disqualifier/dis
--   score, tier       <- score/tier (unchanged names, weren't duplicated)
--   ungrounded_claims <- ungroundedClaims (assay-grounding-fix-v1, shipped
--                       2026-08-15 - confirmed live that no real account has
--                       this populated yet, nothing to lose in the mapping)
-- Everything else clientAssay() returns (keySignals, signalBreakdown,
-- tractionSignals, confidence, isActive, bankConnectSignal,
-- businessModelPattern, estimatedDownstreamUsers, isEstablished,
-- distributionMultiplier, useCases, products, fetchMethod, linkedin) is
-- supporting evidence behind the fit call, not a first-class concept on its
-- own - nested under fit_signals jsonb rather than given 14 more top-level
-- columns the SPEC didn't ask for. Nothing is dropped, per instruction.
--
-- Narrow-scope decision (Jack, 2026-08-17): only src/utils/assay.js's
-- callers in AccountsPage.js (single + bulk re-assay - the "account card"
-- and "bulk Assay modal" consumers) read/write this table. assay.js's
-- own accounts.data writes are UNCHANGED (dual-write) so the ~43 other
-- confirmed consumers of the legacy flat fields keep working untouched -
-- see project_account_business_details_followup.md memory for that list.

CREATE TABLE IF NOT EXISTS public.account_business_details (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        text NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  score             integer,
  tier              text,
  business_model    text,
  fit_rationale     text,
  fit_signals       jsonb,
  disqualifier      text,
  ungrounded_claims jsonb,
  assessment_status text NOT NULL DEFAULT 'not_assessed', -- 'not_assessed' | 'assessed' ('stale' deferred - not needed until re-enrichment prompting exists)
  last_assayed_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_business_details_account_id_idx ON public.account_business_details (account_id);

ALTER TABLE public.account_business_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_read_account_business_details   ON public.account_business_details;
DROP POLICY IF EXISTS anon_write_account_business_details  ON public.account_business_details;
DROP POLICY IF EXISTS anon_update_account_business_details ON public.account_business_details;
DROP POLICY IF EXISTS anon_delete_account_business_details ON public.account_business_details;
CREATE POLICY anon_read_account_business_details   ON public.account_business_details FOR SELECT TO anon USING (true);
CREATE POLICY anon_write_account_business_details  ON public.account_business_details FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_update_account_business_details ON public.account_business_details FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_delete_account_business_details ON public.account_business_details FOR DELETE TO anon USING (true);
