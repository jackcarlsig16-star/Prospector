-- Prospector - influencer-scrape-flag-v1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- The scrape source is a URL parsed out of bio_snapshot, NOT instagram_url -
-- that column stays unread on purpose (Instagram's login wall blocks Jina
-- Reader even with a real API key, tested live against 3 real handles,
-- influencer-accounts-v1 Phase 0). A creator's linktree/personal-site link
-- is already sitting in every assessed bio, unparsed, and that IS fetchable.
--
-- scraped_url is kept alongside the extracted values so a wrong-URL pick is
-- debuggable after the fact - the exclusion rule (skip social domains, take
-- the first remaining link) is a starting point tuned against real bios, not
-- a measured decision.

ALTER TABLE public.account_influencer_details
  ADD COLUMN IF NOT EXISTS scraped_email   text,
  ADD COLUMN IF NOT EXISTS scraped_company text,
  ADD COLUMN IF NOT EXISTS scraped_url     text,
  ADD COLUMN IF NOT EXISTS scraped_at      timestamptz;
