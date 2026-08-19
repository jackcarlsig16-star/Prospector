# SPEC: project-scoped-outreach-examples-v1

## Context

Supersedes Stage 2 of `projects-fix-and-multi-example-v1` — that
stage's premise (an `outreach_examples` table already existing at the
business level, selecting 2-4 examples by outcome/substyle match) was
based on the handoff notes, not real state. `outreach-context-flow-
audit-v1` (findings: `audits/outreach-context-flow-findings.txt`)
confirmed:

- No `outreach_examples` table exists anywhere — not in code, not in
  the live Supabase schema.
- What actually exists and is live in generation: `voiceExamples`
  (`src/constants/voice.js`) — per-AE, localStorage-only, not
  business-scoped, no selection logic at all. `getActiveVoice()`
  concatenates every doc marked active.
- `projects.outreach_example` is a real single plain-text column on
  the `projects` table — this is the actual thing to build on top of,
  not a phantom table.
- `CONTEXT_PROVIDERS` in `api/email.js:222-294` currently composes 10
  providers in order: `doctrineHard → doctrineDefault → voice →
  companyIntel → companyOutreachRules → accountIntel → project →
  directive → userProfile (stub, always null) → voiceExamples`.
- `outreach_rules` is a JSONB column on `business_profiles`, not its
  own table — has zero role/permission enforcement (any team member
  with business access can edit it), same as `project_hook`/project
  guidance.
- Real live redundancy found: HumanKind's `outreach_rules.key_points`
  and a project's `project_hook` independently describe the same
  positioning with no inheritance — this SPEC does not fix that; it's
  a separate, smaller cleanup, noted here so it isn't confused with
  the work below.

## Goal

Give each Project its own set of 1-20 real outreach examples (past
sent/approved messages), distilled and cached, and wire them into
generation as a genuine project-scoped context provider — separate
from, and not conflated with, `voiceExamples`.

## Scope

- New structure for project-level examples, replacing the single
  `projects.outreach_example` text column.
- New `CONTEXT_PROVIDERS` entry, project-scoped.
- Do not touch `voiceExamples` / `src/constants/voice.js` — that
  system stays as-is, per-AE, unrelated to this. Landmine: these are
  two different "examples" concepts: don't merge them, don't rename
  one to make them look unified. If in the same session you find a
  reason they should eventually converge, flag it back rather than
  doing it inside this SPEC.
- Do not touch `outreach_rules` (business-level) or attempt to fix the
  `key_points`/`project_hook` overlap — separate, smaller, deferred.
- Do not add role/permission enforcement to Project guidance editing in
  this pass — real gap, confirmed by the audit, but out of scope here;
  note it for the eventual Owner/Admin hierarchy work instead of fixing
  it piecemeal now.

## Implementation

- Schema: real migration via Supabase SQL Editor (manual-only). Decide
  between a `jsonb` array column on `projects` vs. a
  `project_outreach_examples` join table — state the choice and
  reasoning before implementing (does an example need independent
  metadata like date-added or outcome tag? if yes, join table; if it's
  just an ordered list of message bodies, jsonb array is simpler and
  matches the audit's finding that nothing here currently tracks
  outcome/substyle selection logic — don't build that selection
  machinery unless Jack confirms he wants it now, since the audit
  found it was never actually built despite being documented as
  shipped).
- Migrate existing `projects.outreach_example` single-text data into
  the new structure as the first item, not silently dropped.
- UI: replace `ProjectGuidanceCard.js`'s single textarea with a
  multi-item input (add/remove/reorder, up to 20), following the
  manual-edit-flag protection convention used elsewhere for human-
  tuned content.
- Distillation: reuse `OutreachRulesCard.js`'s exact shipped
  distill-and-cache mechanism (paste → LLM distills → cache the
  result, never resend raw text on every generation call) — do not
  build a second distillation path.
- Wire the cached distillation into `api/email.js`'s
  `CONTEXT_PROVIDERS` as a new project-scoped entry. Placement in
  composition order: insert immediately after the existing `project`
  provider, before `directive` — keep project-level context grouped
  together in the final prompt rather than scattered.
- Given the real found tension between doctrine's hard-constraint CTA
  rule and HumanKind's own business-level rule (Q3 of the audit): if
  any of a project's real distilled examples contain CTA language that
  conflicts with doctrine's hard constraints, that's a signal worth
  surfacing, not silently injecting. At minimum, log/flag the
  conflict rather than adding a third silent layer to an already-
  untested precedence question — do not attempt to resolve doctrine
  vs. rules vs. examples precedence inside this SPEC; that's a
  separate, real open question the audit surfaced and left unresolved.

## Verification bar

- Real Playwright click-through: add 3+ examples to a project, confirm
  they persist, distill, and reach the actual generation prompt —
  check via logged prompt content, not just that they're stored.
- Confirm the migrated single-example data from at least one real
  existing project (if any project currently has
  `outreach_example` populated) survived the migration correctly.
- Confirm `voiceExamples` is completely unaffected — same output
  before and after, regression check not just a new-feature check.
- Bundle/prompt-content verification that the new provider's output is
  clearly labeled and distinguishable from `voiceExamples`' output in
  the final composed prompt, not blended together indistinguishably.

## Commit discipline

Single-stage SPEC — commit and push once build/lint passes and live
verification confirms the new provider reaches real generation output.
Confirm push against the actual remote (`git ls-remote`), not just
local commit success. Don't leave commit/push as a follow-up question.
