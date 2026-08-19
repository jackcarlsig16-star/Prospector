# SPEC: Campaign layer under Project (`campaign-layer-v1`)

## Status
All audit items closed, no open questions blocking the build. Design
decisions below were worked through directly with Jack and are locked — do
not re-litigate them mid-build. Concrete schema/UI/routing details are now
CONFIRMED per live audit and marked as such throughout.

## Problem
Project is currently the only content-grouping entity above an individual
Account. Jack needs a second, nested level: a **Campaign**, which represents
one specific pitch angle to one specific type of recipient within a Project
(e.g. Project = "HomeLover Influencer Strategy," Campaign = "Employers
offering employee benefits"). Nothing resembling this exists today as a real
entity — "Campaign" currently only appears as loose, non-structural prose in
three files that shipped today (`ProjectGuidanceCard.js`, `api/email.js`,
`shared.js`), and a recent migration explicitly deferred a real
"Deal/Campaign" entity until one was actually needed. It's needed now.

## Design decisions (locked)

**1. Project vs. Campaign division of responsibility.**
Project = durable, general context about the whole strategy: what is the
goal of this project, and what rules/parameters should always apply within
it (tone constraints, things to avoid, CTA style — project-scoped doctrine,
same spirit as `outreach_doctrine`'s hard/default split but scoped to one
project). Campaign = the specific pitch: who the recipient is, what doctrine
content should drive messaging for that recipient (e.g. a pasted deck), and
what example emails have actually worked for that angle.

**1a. `target_type` (existing Project field) vs. `recipient_description`
(new Campaign field) — resolved.** `ProjectGuidanceCard.js`'s existing
`target_type` field ("Who this project is reaching…") stays exactly as-is —
it remains the Project's general/default audience description. Campaign's
`recipient_description` narrows it for one specific pitch angle, same
layering relationship as doctrine (decision #2). Do not rename, deprecate,
merge, or make `target_type` vestigial. The only real fix here is
`ProjectGuidanceCard.js`'s `objective` field placeholder text, which
currently reads "What this campaign is trying to accomplish…" — that's a
genuine prose collision (should say "project," not "campaign") and belongs
in the Disambiguation step below, not a schema change.

**2. Doctrine inheritance: layered, not isolated.**
When a Campaign is selected, its doctrine is *added on top of* the Project's
general context, not a replacement for it. This matches the existing
doctrine hard/default layering pattern. Composition order (see CONTEXT_PROVIDERS
section below): `project` still renders, then `campaignDoctrine` renders
after it and takes priority where they'd otherwise conflict.

**3. Examples: campaign-only, not layered.**
Unlike doctrine, example emails do NOT layer. When a Campaign is selected,
its examples fully replace `projectExamples` for that generation — mixing
project-level and campaign-level example emails risks muddying the actual
writing voice. When no Campaign is selected, `projectExamples` behaves
exactly as it does today (unchanged).

**4. Campaign examples reuse the existing distillation pipeline — do not
build a second one.**
`projectExamples` already has a working manual-add + bulk-paste-and-segment
+ distill-and-cache mechanism (shipped in `project-scoped-outreach-examples-v1`).
Campaign examples must reuse this exact mechanism, scoped to campaign_id
instead of project_id. Do not write a new distillation pipeline.

**5. Explicitly NOT merging with `voiceExamples`.**
`voiceExamples` (`src/constants/voice.js`) is a separate, per-AE,
localStorage-only mechanism representing one person's personal writing
voice. Campaign examples are shared, server-side, and scoped to a pitch
angle, not a person. These stay architecturally separate — do not merge,
do not rename either to look unified. Final composition stacks three voices,
each doing a different job: `voice` (personal tone, early) →
`campaignDoctrine`/`campaignExamples` (this angle's facts + proven style,
mid-stack) → `voiceExamples` (personal writing samples, still last).

**6. Account association: reuse the existing `list_id` pattern, don't invent
a third mechanism.**
Projects already have two parallel account-association mechanisms
(`accounts.project_id` FK, and `list_id`/`lists` membership — the
latter is what the live UI actually uses). Do not add a third for Campaign.
Give each Campaign its own `list_id`, exactly mirroring how Project's
`list_id` already works.

**7. Deck/document ingestion: paste text, not file upload.**
Confirmed with Jack: pasting a document's text (e.g. a sales deck) into the
Campaign doctrine field is sufficient and is the intended workflow — this
already works today via Smart Intake with zero new code. Real PDF/PPTX file
upload is explicitly out of scope for this SPEC; do not build multipart
upload handling.

**8. No data hardcoding.**
This SPEC builds structure only. Do not hardcode any specific project's or
campaign's real content (e.g. the HomeLover Employer Partner Program deck
Jack shared for context) into migrations, seed data, or code. All content
is user-entered through the UI this SPEC builds.

## Schema changes

CONFIRMED by live audit:
- No `campaigns` table or `campaign_id` column exists anywhere in
  migrations or code — clear to build.
- `outreach_examples` is a plain array of strings (raw pasted example
  text) — see `[...d.outreach_examples, newExample.trim()]` in
  `ProjectGuidanceCard.js`. The jsonb default in the draft SQL below is
  correct as-is.

```sql
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,       -- CONFIRMED: projects table
  business_id uuid not null references businesses(id),                     -- CONFIRMED: table is `businesses`, not `business_profiles`
  name text not null,
  recipient_description text,       -- who this campaign targets
  doctrine text,                    -- pasted pitch content, deck-style material
  outreach_examples jsonb default '[]'::jsonb,   -- CONFIRMED: plain array of strings (raw pasted example text), matches projects.outreach_examples shape exactly
  outreach_examples_distilled text,              -- CONFIRMED: plain text distilled prose, NOT jsonb (corrected from earlier draft)
  list_id uuid references lists(id),             -- CONFIRMED: table is `lists`, not `account_lists`
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on campaigns(project_id);
```

Permissions: match whatever gating (if any) currently applies to
`projects`/`outreach_examples`. Per the open-threads note, neither
`outreach_rules` nor Project guidance currently has permission checks — do
not add new gating for Campaign that doesn't exist for Project; stay
consistent with current (lack of) enforcement rather than inventing a new
standard here.

## Backend changes

### `api/email.js` — CONTEXT_PROVIDERS

CONFIRMED exact match, live in `api/email.js`:
```
doctrineHard → doctrineDefault → voice → companyIntel → companyOutreachRules
→ accountIntel → project → projectExamples → directive → userProfile (stub) → voiceExamples
```

New order:
```
doctrineHard → doctrineDefault → voice → companyIntel → companyOutreachRules
→ accountIntel → project
→ [if campaign_id present: campaignDoctrine, then campaignExamples]
→ [else: projectExamples]
→ directive → userProfile (stub) → voiceExamples
```

- `campaignDoctrine`: new provider. Given a `campaign_id` on the generation
  request, fetch `campaigns.doctrine` and `campaigns.recipient_description`
  for that campaign, render into the prompt.
- `campaignExamples`: new provider. Given `campaign_id`, fetch
  `campaigns.outreach_examples_distilled` (falling back to distilling live
  if no cache, exactly mirroring how `projectExamples` handles this today —
  audit that fallback behavior before reimplementing it).
- `projectExamples`: add a guard so it no-ops (returns null/skips) when a
  `campaign_id` is present on the request, per decision #3.

### New endpoints
Confirmed: Project create/update has no server route at all —
`createProject()` in `src/utils/db.js:830` inserts directly to Supabase from
the client, with an explicit "no server route needed" comment. The only
three `/api/projects/:id/...` server routes that exist
(`outreach-examples/generate`, `outreach-examples-distilled`,
`outreach-examples/segment`) exist specifically because they call the AI
distillation pipeline — this repo's architecture rule is AI calls are
server-only; plain field writes never get a route. Campaign follows the
same split:

- **Campaign create/update (name, `recipient_description`, `doctrine`)** —
  plain field writes, NO server route. Mirror `createProject()`'s
  direct-client-to-Supabase insert/update pattern exactly.
- **Campaign examples (generate/save/segment)** — these call the AI
  distillation pipeline, so they DO get real server routes, mirroring the
  three existing project routes above 1:1, parameterized to accept
  `campaign_id` in place of/alongside `project_id`. Do not fork the
  distillation pipeline into a second copy — parameterize the existing one.

## Frontend changes

### Project creation/edit flow — CONFIRMED, nothing to build
"Goal" and "rules/parameters" already exist and are already built:
`ProjectGuidanceCard.js`'s `objective` field ("What this project is trying
to accomplish…") is the goal; `exclusions` ("Anything outreach for this
project should avoid…") is rules/parameters. (`project_hook` and
`strategy_synthesis` are unrelated — hook is the opening angle,
synthesis is AI-generated — do not touch either.) No new Project-level UI
in this SPEC.

### Campaign creation/edit flow (new)
CONFIRMED placement: `ProjectGuidanceCard.js` renders inline inside a
per-project `.map()` block in `BusinessDetailPage.js:231`. A Campaigns
section belongs there, as a sibling within that same per-project block.
Fields:
- Name
- Recipient description (who this campaign targets — text input, generous
  size, this is meant to hold real descriptive paragraphs)
- Doctrine (large paste-friendly textarea — this is where a deck's pasted
  text goes)
- Example emails — reuse the existing `outreach_examples` add/bulk-paste UI
  component, scoped to `campaign_id` instead of `project_id`. Do not build a
  new component; parameterize the existing one.

### Generation modal picker — CORRECTED, not LinkedProjects.js
`LinkedProjects.js` is an account-card widget for linking one account into
a project (writes `list_id` membership) — unrelated to generation-time
selection, do not touch it. The real picker is inside `EmailModal.js`:
`selectProject()`/`selectedProjectId`/`allProjectsMerged`, which sends
`projectId` in the generation request body (~line 190). Nest the Campaign
selector into that existing logic — appears once a Project with at least
one Campaign is selected; optional, "no campaign" preserves exact current
project-level behavior and still sends only `projectId` as today.

## Disambiguation step (do first, before any schema work)

Three files already use the word "Campaign" as loose prose, shipped today,
predating this real entity:
- `ProjectGuidanceCard.js` — CONFIRMED specific instance: the `objective`
  field's placeholder text reads "What this campaign is trying to
  accomplish…" but the field is Project-scoped. Fix to say "project," not
  "campaign." (Its `target_type` field is fine as-is — see decision #1a,
  not a collision, just semantically adjacent to the new
  `recipient_description` and intentionally left alone.)
- `api/email.js`
- `shared.js`

Audit each usage and rename/reword so none of them collide with or get
confused for the real `Campaign` entity this SPEC introduces. Do this first
and as part of the same commit — do not ship a real Campaign entity while
stale prose "campaign" references still exist uncorrected nearby.

## Out of scope (explicitly not part of this build)
- Real PDF/PPTX file upload (decision #7).
- Any change to `accounts.project_id` FK vs. `list_id` duality at the
  Project level — Campaign reuses `list_id` only, per decision #6; the
  existing Project-level duality is untouched.
- Permission/role gating beyond what already exists on Project-level
  equivalents.
- The 5 known synchronous-timeout-risk routes noted in the current handoff
  — unrelated, do not fix incidentally.
- `LinkedProjects.js` list-less-project blind spot fix — separate, already
  a parked SPEC item, do not fold in here.

## Verification (required before calling this done)
- Real Playwright click-through on prod (or staging, then re-verify on
  prod): create a Project, create a Campaign under it with a recipient
  description, doctrine text, and at least one pasted example email;
  generate outreach with the Campaign selected and confirm the live output
  actually reflects the campaign doctrine and campaign example voice (not
  just that the request succeeded).
- Generate outreach with the same Project but no Campaign selected and
  confirm behavior is byte-for-byte unchanged from before this SPEC
  (`projectExamples` still fires, no regression).
- Live-bundle content check confirming the new Campaign UI is actually in
  the deployed bundle, not just present in the local build.
- Confirm the three disambiguated "Campaign" prose references no longer
  read ambiguously next to the real entity.

## Commit instructions
Build in stages (schema → backend providers/endpoints → frontend →
disambiguation cleanup) but land as a single commit, per standing practice.
Commit message should reference `campaign-layer-v1`. Explicit instruction:
**commit and push to `origin/main` when verification above passes** — do
not leave this staged locally.
