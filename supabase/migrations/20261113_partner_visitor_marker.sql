-- FIX visitor-people-filing-v1 (ruling of Nov 13 2026) - Supabase SQL editor: paste -> Run. Idempotent. No existing row
-- changes.
--
-- partner_contacts.role_in_notes gains 'identified_visitor': the marker on a website visitor filed on a partner (the
-- partner-visitor count in the intent score reads it). The check allowed champion | blocker | referrer | counterpart |
-- other only, so that insert was refused and the visitor-people pull failed on the first visitor from a partner company
-- (Nov 13, 17:35 UTC). Read on Nov 13 before writing this: 114 rows - 91 NULL, 16 counterpart, 5 other, 1 champion,
-- 1 referrer; none outside the old list, so the new check accepts every row that exists.
ALTER TABLE public.partner_contacts DROP CONSTRAINT IF EXISTS partner_contacts_role_in_notes_check;
ALTER TABLE public.partner_contacts ADD CONSTRAINT partner_contacts_role_in_notes_check
  CHECK (role_in_notes IS NULL OR role_in_notes IN ('champion', 'blocker', 'referrer', 'counterpart', 'other', 'identified_visitor'));

-- Proof (expect):
--   1 check allows identified_visitor   true
--   2 check keeps the five roles        true
--   3 rows outside the check            0
--   4 rows by role                      (null) 91 · counterpart 16 · other 5 · champion 1 · referrer 1   (unchanged)
SELECT 1 AS n, 'check allows identified_visitor' AS what, EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_contacts_role_in_notes_check' AND conrelid = 'public.partner_contacts'::regclass AND pg_get_constraintdef(oid) LIKE '%identified_visitor%')::text AS det
UNION ALL
SELECT 2, 'check keeps the five roles', (SELECT bool_and(pg_get_constraintdef(c.oid) LIKE '%' || r || '%') FROM pg_constraint c, unnest(ARRAY['champion', 'blocker', 'referrer', 'counterpart', 'other']) r WHERE c.conname = 'partner_contacts_role_in_notes_check' AND c.conrelid = 'public.partner_contacts'::regclass)::text
UNION ALL
SELECT 3, 'rows outside the check', (SELECT count(*) FROM public.partner_contacts WHERE role_in_notes IS NOT NULL AND role_in_notes NOT IN ('champion', 'blocker', 'referrer', 'counterpart', 'other', 'identified_visitor'))::text
UNION ALL
SELECT 4, 'rows by role', (SELECT string_agg(r || ' ' || n, ' · ' ORDER BY n DESC, r) FROM (SELECT coalesce(role_in_notes, '(null)') AS r, count(*) AS n FROM public.partner_contacts GROUP BY 1) t)
ORDER BY n;
