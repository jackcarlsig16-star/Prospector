-- prospector-auth-v1 addendum - first-run flow.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Set when someone clicks "Go to my workspace" on the one-time Welcome screen.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS welcomed_at timestamptz;

-- Everyone who already has a profile has been using the app - don't show
-- them a Welcome screen.
UPDATE public.profiles SET welcomed_at = now() WHERE welcomed_at IS NULL;
