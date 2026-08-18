-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- outreach-intelligence-doctrine-v1, Stage 1 — platform-wide (not
-- per-business) outreach doctrine: hard constraints and defaults that
-- apply to every business's generation. New table alongside outreach_rules,
-- not merged into it, per outreach-rules-doctrine-fit-audit-v1's finding
-- that outreach_rules is real, correctly business-scoped, and would
-- conflate two different authorities if doctrine were bolted onto it.
--
-- category: a loose taxonomy, not an enum - matches the app's existing
-- preference for text categories over hard enums elsewhere (assay
-- categories, content types) so a new category doesn't need a schema
-- change. is_hard_constraint is the actual point of this table - the
-- structural hard/default separation the audit confirmed the prompt has
-- never had. source_attribution is nullable - most of today's real rules
-- (AVOID_ALWAYS, the soft-CTA rule) were internal product decisions, not
-- literature-sourced, and forcing a citation on those would be fiction.
create table if not exists outreach_doctrine (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  rule_text text not null,
  is_hard_constraint boolean not null default false,
  source_attribution text,
  active boolean not null default true,
  created_by text,
  ai_assisted boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Same standard anon-permissive policy set as every other table in this
-- schema (projects, business_profiles, accounts, voice_profiles, etc) -
-- app-level enforcement only. Created inline with the table this time,
-- not as a same-day follow-up migration - voice_profiles (20260814) shipped
-- with RLS enabled and zero policies, silently rejecting every browser
-- write (confirmed live, 42501) until a second migration fixed it. Not
-- repeating that here: the admin CRUD surface (Stage 4) needs real anon
-- read/write/update/delete from the first commit that touches this table.
create policy anon_read_outreach_doctrine on outreach_doctrine
  for select to anon using (true);

create policy anon_write_outreach_doctrine on outreach_doctrine
  for insert to anon with check (true);

create policy anon_update_outreach_doctrine on outreach_doctrine
  for update to anon using (true) with check (true);

create policy anon_delete_outreach_doctrine on outreach_doctrine
  for delete to anon using (true);
