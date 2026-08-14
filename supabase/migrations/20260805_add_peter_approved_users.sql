-- Prospector - add Peter to the approved_users allowlist
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- (Already applied directly via the service-role connection on 2026-08-05 -
-- this file exists for the record, matching migrations/001_approved_users.sql's
-- seed-row pattern. Safe to re-run - ON CONFLICT DO NOTHING.)

INSERT INTO approved_users (email, auto_approve, role, created_by)
VALUES ('peter@humankindcollective.app', true, 'Member', 'seed')
ON CONFLICT (email) DO NOTHING;
