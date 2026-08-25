-- generation-engine-rebuild-v1 Stage 2
--
-- sales_methodology: business-level "how we sell" doctrine, entered as one
-- pasted block. Deliberately plain text rather than a structured jsonb shape
-- like outreach_rules — it mirrors campaigns.doctrine, which is the existing
-- pattern for paste-in guidance with no AI distillation step. It renders as
-- its own CONTEXT_PROVIDER immediately after doctrineHard, so it is read at
-- full authority rather than buried behind the business/project layers.
--
-- sequence_outline: reserved for a future multi-touch sequence feature. No
-- generation code reads it today; the column exists so that feature does not
-- need its own migration later.
--
-- Both start NULL everywhere. No backfill.

alter table public.business_profiles
  add column if not exists sales_methodology text,
  add column if not exists sales_methodology_updated_at timestamptz;

alter table public.campaigns
  add column if not exists sequence_outline text;
