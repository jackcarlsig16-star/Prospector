-- sales-sequence-motion-v1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Replaces the is_partner boolean with a real 3-value audience field,
-- matching sales-pipeline-v1's org_type vocabulary (employer | membership |
-- channel_partner) so sequences and pipeline opportunities share one
-- vocabulary. is_partner stays in the table for one release (read-only,
-- unused by the app from this commit on) - dropped in a later FIX.

alter table sales_sequence_tags
  add column audience text not null default 'employer'
    check (audience in ('employer', 'membership', 'channel_partner'));

update sales_sequence_tags set audience = 'channel_partner' where is_partner = true;

-- Self-check - lists exactly the rows the backfill promoted to
-- channel_partner, for the report (expect the 2 real is_partner=true rows:
-- SaaS HCOL (B) and Rental Rewards, sequence_ids 6ab41f8e5ce3030020d38395
-- and 6a90cfbf126ca8000c3d6c0e).
select business_id, sequence_id, is_partner, audience, updated_at
from sales_sequence_tags
where audience = 'channel_partner';
