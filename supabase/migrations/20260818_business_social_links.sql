-- business-social-links-v1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Simple, extensible shape: { instagram, linkedin, twitter, facebook }.
-- Context/seed hints for generateProfile()'s synthesis and the web_research
-- call, never a direct fetch target - Instagram scraping is a confirmed
-- dead end (login wall, tested 3x already), and LinkedIn direct fetch is
-- deliberately out of scope for this pass too.
alter table public.businesses
  add column if not exists social_links jsonb;
