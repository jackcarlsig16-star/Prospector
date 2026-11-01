-- grow-mailbox-link-v1 follow-up (ruling 1, Nov 1 2026) - Supabase SQL editor: paste -> Run. Idempotent. No row changes.
--
-- hk_brand_threads.link_state CHECK  + 'ignored': a thread that turned out to be bulk mail only (a List-Unsubscribe
--                                    header or Gmail's Promotions / Updates tab). Archived, never deleted; never shown,
--                                    counted or acted on (every read filters link_state = 'linked').
ALTER TABLE public.hk_brand_threads DROP CONSTRAINT IF EXISTS hk_brand_threads_link_state_check;
ALTER TABLE public.hk_brand_threads ADD CONSTRAINT hk_brand_threads_link_state_check CHECK (link_state IN ('linked', 'review', 'not_this_brand', 'ignored'));

-- Proof - expect 1 row: hk_brand_threads_link_state_check | CHECK ((link_state = ANY (ARRAY['linked'::text, 'review'::text, 'not_this_brand'::text, 'ignored'::text])))
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'hk_brand_threads_link_state_check';
