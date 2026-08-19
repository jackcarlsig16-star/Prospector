-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- project-scoped-outreach-examples-v1 — replaces the single-text
-- projects.outreach_example column with a real multi-example structure.
--
-- outreach-context-flow-audit-v1 confirmed no outreach_examples table
-- exists anywhere (that was a documentation error, not real state) and
-- that nothing in this app currently does outcome/substyle-based example
-- selection. Per that finding, this stays a simple ordered jsonb array
-- of message bodies (no per-example metadata table) - selection/tagging
-- machinery isn't built elsewhere and isn't being introduced here.
--
-- outreach_examples: the raw ordered list a person adds/removes/reorders
-- in the UI, up to 20 items, each a plain string (past sent/approved
-- message body). This is the editable source of truth.
--
-- outreach_examples_distilled / _at / _edited_manually: the cached
-- LLM-distilled summary actually sent to generation, mirroring
-- business_profiles.outreach_rules' distill-and-cache shape exactly
-- (paste/add -> distill -> cache -> never resend raw examples on every
-- generation call). edited_manually protects a hand-tweaked distillation
-- from being silently relabeled as machine-generated, same semantics as
-- outreach_rules_edited_manually.
alter table projects
  add column if not exists outreach_examples jsonb not null default '[]'::jsonb,
  add column if not exists outreach_examples_distilled text,
  add column if not exists outreach_examples_distilled_at timestamptz,
  add column if not exists outreach_examples_distilled_edited_manually boolean not null default false;

-- Migrate the single old outreach_example column into the new array as
-- its first (only) item, for the one real row that has it populated -
-- confirmed via live query, exactly one project
-- (89108d81-b422-4cf6-8651-70d12bbf0f28, "Q3 Jack's Outbound Strategy")
-- has non-null outreach_example today. Old column is left in place,
-- unread going forward - same precedent as outreach_prompt
-- (project-guidance-and-creation-flow-v1's comment in api/email.js),
-- not dropped, so nothing is silently destroyed if this migration needs
-- to be re-examined later.
update projects
set outreach_examples = jsonb_build_array(outreach_example)
where outreach_example is not null
  and trim(outreach_example) <> ''
  and outreach_examples = '[]'::jsonb;
