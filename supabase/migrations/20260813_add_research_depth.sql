-- Prospector - Add research_depth to businesses (light vs full research pipeline)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Verified against the live businesses table first (not assumed): no existing
-- field distinguishes own-company vs prospect. Adding one.

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS research_depth text NOT NULL DEFAULT 'full'; -- 'light' | 'full'

-- Backfill: only ONE of Jack's "known businesses" actually exists as a row
-- right now - Master Magnetics (owner_email = jackcarlsig16@gmail.com). The
-- other 2 mentioned in the SPEC haven't been created yet, so there's nothing
-- else to backfill. Matched by name, not owner_email - owner_email is who
-- added the row to Prospector, not whether the business itself is Jack's own
-- company (a future prospect business would have the same owner_email).
UPDATE public.businesses
SET research_depth = 'light'
WHERE name = 'Master Magnetics';
