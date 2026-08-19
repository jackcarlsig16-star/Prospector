# SPEC: smart-intake-internal-meeting-v1

## Context

`smart-intake-classification-audit-v1` (findings: `audits/smart-
intake-classification-findings.txt`) confirmed Smart Intake is
single-target by construction at all three layers:

- Schema: `classifyIntake()` (`shared.js:807`) returns one
  `classification` (one of 7: `company_intel | existing_project |
  new_project | existing_account | new_account | ambiguous` +
  Instagram short-circuit's influencer shape), never more than one.
- Client: `confirmState = { classification, proposal, text,
  overrideType }` — a single object, mutually-exclusive branches, the
  override picker only swaps between single destinations.
- Server: routing is bespoke (two files, `intake.js` and
  `intake-confirm.js`, explicit if-blocks, no shared dispatch table) —
  every branch writes to exactly one destination.
- Real precedent found and confirmed dead: `new_account`'s classifier
  already computes a second target (`related_project_id`), ships it to
  the client, and nothing reads it anywhere in the repo. Grepped and
  confirmed. Don't repeat this pattern — if this SPEC computes a second
  target, it must actually be wired to a real write, not left dangling
  again.
- The classifier's existing project-matching technique (already used
  for other categories) extends cleanly to identifying "which project"
  Internal Meeting text relates to — this part is not new territory,
  reuse it.
- Confirmed this is NOT the same shape as the already-queued
  bulk-import item (`feedback_modular_tools_discipline.md:13`) — that
  batches the existing single-target classifier across many separate
  pastes; Internal Meeting is one paste needing two simultaneous
  writes. Different problem, correctly kept as its own SPEC.

## Goal

Add "Internal Meeting" as a real Smart Intake category: pasted
internal call notes/transcripts get classified, optionally matched to
a related project, and can update BOTH a project's content and
business-level internal intel from a single confirm action — not a
generalized multi-target system for every category, just this one
real, scoped need.

## Scope

- New classification value: `internal_meeting`.
- New confirm-flow support for exactly this one category having two
  independently-confirmable destinations. Do not build a fully generic
  N-target architecture for all 7 categories — that's solving a
  hypothetical, not the real ask. Scope the UI/schema changes to
  support Internal Meeting's specific two-target case cleanly, in a way
  that wouldn't be absurd to extend later, but don't build the general
  case now.
- Do not touch the existing single-target categories' routing logic —
  `fileCompanyIntel()`, `fileProjectIntel()`, etc. stay as-is; this
  SPEC calls them (potentially both), it doesn't rewrite them.
- Do not wire up the dead `related_project_id` on `new_account` as part
  of this SPEC — different category, different bug, flag it back
  separately if worth fixing, don't fold it in here.

## Implementation

- Classifier: extend `classifyIntake()`'s prompt/schema to recognize
  internal-meeting content (strategy discussion, project planning,
  internal team conversation — not a customer/prospect interaction).
  Reuse the existing project-matching technique to attempt identifying
  a related project from the text; this can come back null (meeting
  was general/company-level, no specific project match) — that's a
  valid, expected outcome, not an error case.
- Confirm UI: for `internal_meeting` specifically, `confirmState` needs
  to represent two potential destinations — company intel (always
  offered) and a matched project (offered only if one was identified).
  Each should be independently confirmable: Jack can file to company
  intel only, project only, both, or discard — don't force an
  all-or-nothing single action once two real destinations exist.
- Server: on confirm, write to whichever destination(s) were actually
  confirmed — reuse `fileCompanyIntel()` for the company-intel side and
  the existing project-content update path (whatever
  `fileProjectIntel()` or equivalent already does) for the project
  side. No new storage mechanism — this SPEC composes existing writes,
  it doesn't invent a new one.
- If no project match is found, the flow should look and feel like
  today's single-target `company_intel` flow — don't surface an empty/
  disabled second destination that just adds visual noise for the
  common case.

## Verification bar

- Real Playwright click-through: paste real/realistic internal meeting
  content that clearly relates to an existing project, confirm both
  destinations are offered, confirm both independently, verify both
  writes actually landed (project content updated AND company intel
  filed) — not just that the UI showed two options.
- Real click-through: paste internal meeting content with no clear
  project match, confirm it behaves like today's single-target flow
  (no phantom second option).
- Confirm existing single-target categories (company_intel,
  existing_project, etc.) are completely unaffected — regression check,
  not just new-feature check.
- Confirm the Instagram short-circuit path is unaffected — different
  code path, but verify it wasn't accidentally touched.

## Commit discipline

Commit and push once build/lint passes and live verification confirms
both destinations write correctly on a real dual-match case. Confirm
push against the actual remote (`git ls-remote`), not just local commit
success. Don't leave commit/push as a follow-up question.
