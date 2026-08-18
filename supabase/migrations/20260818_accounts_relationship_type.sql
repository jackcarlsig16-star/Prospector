-- account-taxonomy-and-creation-upgrade-v1 Stage 3
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- New top-level field, separate from Stage (funnel position): what KIND of
-- relationship this account is, not what stage it's at. Only Prospect/Lead
-- accounts carry a meaningful Stage going forward (Stage 4 wires the
-- gating/Closed Won auto-conversion logic - this migration only adds and
-- defaults the column).
--
-- Confirmed via a real audit this session: all 44 existing accounts are
-- already Prospecting or stage-less, none Closed Won, none with any
-- existing client/partner/competitor signal - 'Prospect/Lead' as the
-- default covers 100% of current data with zero conflicts, no backfill
-- logic needed beyond the column default itself.
--
-- Lives on the accounts table directly (not the data jsonb blob) - a real,
-- constrained column rather than a loose jsonb key, since this is exactly
-- the kind of small fixed-vocabulary field account_kind already uses this
-- same pattern for (see 20260814_influencer_card_v2.sql).

alter table public.accounts
  add column if not exists relationship_type text not null default 'Prospect/Lead';

alter table public.accounts
  drop constraint if exists accounts_relationship_type_check;

alter table public.accounts
  add constraint accounts_relationship_type_check
    check (relationship_type in ('Prospect/Lead', 'Client', 'Partner', 'Competitor'));
