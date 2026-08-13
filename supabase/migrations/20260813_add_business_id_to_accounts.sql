-- Prospector - Scope accounts per business (business-workspace-v1)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Nullable by design, same as projects.business_id. No backfill needed: the
-- accounts table has zero real rows (confirmed live) - there is no legacy
-- data to reassign. Every business, including any future Plaid row, starts
-- with a genuinely empty account list.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id);

CREATE INDEX IF NOT EXISTS accounts_business_id_idx ON public.accounts (business_id);
