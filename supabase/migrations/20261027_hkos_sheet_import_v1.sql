-- hkos-sheet-import-v1 Stage 1 (Jack runs this in the Supabase SQL editor, then replies "ran").
-- owner_hint: the founder an imported row belongs to when that founder has no profile yet (Pete's tab). shell.js resolves
-- it to owner_user_id on the founder's first load. REVISABLE: generic text instead of the two names.
ALTER TABLE public.hk_brands
  ADD COLUMN IF NOT EXISTS owner_hint text CHECK (owner_hint IS NULL OR owner_hint IN ('jack', 'pete'));
CREATE INDEX IF NOT EXISTS hk_brands_owner_hint_idx ON public.hk_brands (business_id, owner_hint) WHERE owner_hint IS NOT NULL;

-- The import run carries its own state (S1): 'preview' holds the parsed plan (server-only jsonb, wiped on commit or
-- after 24 h), 'committed' keeps the undo set (every created id), 'undone' / 'failed' close it. summary = per-tab counts
-- shown after the plan is wiped. Additive and nullable, so the data-foundation rows stay valid.
ALTER TABLE public.hk_import_runs
  ADD COLUMN IF NOT EXISTS status   text NOT NULL DEFAULT 'committed' CHECK (status IN ('preview', 'committed', 'undone', 'failed')),
  ADD COLUMN IF NOT EXISTS plan     jsonb,
  ADD COLUMN IF NOT EXISTS summary  jsonb,
  ADD COLUMN IF NOT EXISTS undo_set jsonb;
