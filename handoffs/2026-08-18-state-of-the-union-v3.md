# Prospector — Verified State of the Union (2026-08-18, v3)

Every claim below was checked directly before writing this — real `git log`/`git ls-remote`/`git merge-base --is-ancestor` against the actual commit graph, real Playwright renders against isolated harnesses, real live-bundle content grepping. No optimism, no "should work" — only what's confirmed. This supersedes nothing in the same-day `2026-08-18-state-of-the-union-v2.md` (that one ends at `d4c5576`) — this is the next chunk of the same day's work, picking up right after it.

Session covered: `outreach-intelligence-doctrine-v1`, `generation-modal-advanced-inputs-v1`, `assay-citation-leak-and-raw-edit-dual-write-v1`, two rounds of generation-modal Project-picker fixes, and two fresh audits (project-level multi-example outreach training, Projects process/UX).

**Local HEAD `0c32bdd` matches `origin/main` exactly** — confirmed via `git rev-parse HEAD` and `git rev-parse origin/main` after `git fetch origin main`, identical hash. All 19 commit hashes below individually re-verified this session via `git log --oneline -1 <hash>` + `git merge-base --is-ancestor <hash> origin/main` — every one resolved and is confirmed present on `origin/main`.

---

## 1. CONFIRMED COMMITTED AND PUSHED

- **`scout-global-persistent-v1` (`90bf890`)** — Scout made persistent across all pages instead of a tab.
- **`business-emoji-manual-picker-v1` (`1c48489`)** — AI-picked business emoji replaced with a manual picker.
- **`business-intel-strategy-visual-redesign-v1` (`a6e5493`)** — typography/chips/panels/source-drawer/KPI-strip redesign of the Business Intel page.
- **`tier-badge-metal-colors-v1` (`ea0cb34`)** — Gold/Silver/Tin/Slag tier badges de-duplicated into a single `TIER_COLOR` export.
- **`account-taxonomy-and-creation-upgrade-v1` (9 stages, `3a15eda`→`d5f73a9`)** — universal industry taxonomy, `relationship_type` field, stage-gating, Add Account modal redesign, Relationship Type as a top-level filter.
- **`account-taxonomy-gaps-fix-v1` (3 stages, `0c02816`→`e4957e2`)** — manual relationship_type editor, source/Partner naming-collision fix, 5-row→2-row+drawer filter bar.
- **`account-card-cleanup-v1` (6 stages, →`6aa9b4e`)** — orange Generate button, Debrief/Intel toggle fix, Extract fix, dead-button removal, Re-assay relocation, Website/LinkedIn/Email regrouping.
- **`GiftModal.js` archived (`90f140a`)** — the third independent generator found by the flow audit, closed out; confirmed nothing else referenced it before removal.
- **`generation-engine-consolidation-v1` (5 stages, →`fc1ec72`)** — `api/email.js` established as the single real generation engine (named-provider composition); AccountCardComms's independent generator and the static-template Generation tab retired.
- **`outreach-intelligence-doctrine-v1` (4 stages, →`00f0305`)** — new `outreach_doctrine` table, hard-constraint/default separation, AVOID_ALWAYS/CTA rules migrated out of code, new AdminPage.js "Outreach Intelligence" tab.
- **`generation-modal-advanced-inputs-v1` (`7d41df0`)** — Project/Account Intel/Voice/Company Intel exposed as real inputs behind a collapsed Advanced panel. **Real Playwright-verified** — first genuine screenshot click-through this session, not harness-only.
- **Generate-button-scope bugfix (`2138093`)** — `account-card-cleanup-v1` Stage 1's orange treatment had missed the modal's *internal* Generate button (only the outer trigger was fixed); corrected.
- **`assay-citation-leak-and-raw-edit-dual-write-v1` (`0088a69`, `de6f7f7`)** — Fix 1: real `<cite>` markup leak into `businessModel`/`productFit` stopped (prompt + defensive strip, new leaf util `textSanitize.js`, 2 real production rows backfilled). Fix 2: `AccountCardRawEdit.js`'s `businessDetail` dual-write gap closed, reusing `upsertAccountBusinessDetails` — partial-upsert safety **empirically tested against a real production row** (`RentTrack`, immediate restore) before relying on it, since this exact write path had never been exercised in production before.
- **`generation-modal-project-picker-and-advanced-visibility-v1` (`1aa7fe0`, `8e0282e`)** — Bug 1: real project picker replacing the old `.length > 1`-gated one. Bug 2: the "Advanced" toggle, previously plain gray/invisible, given a real cyan accent.
- **`generation-modal-project-promotion-and-visual-pass-v1` (`0c32bdd`)** — Bug 1: project picker no longer excludes list-less projects; selecting one now silently backfills a list behind the scenes (no "list" language ever surfaces). Bug 2: selecting a project now performs a real `linkAccountToLists()` assignment (previously it only set local component state — no real assignment happened at all). Change 1: Project promoted from the Advanced panel into the modal's default view. Change 2: orange (`ROLE.generateAccent`) extended into the modal's ambient chrome (outer glow, header border, section labels, active Message Type tab) without diluting Project's red or Advanced's cyan. **Six-marker bundle-verified**: after deploy, grepped the live production bundle directly for `"Couldn't assign this project"`, `"project backfill"`, `Assigning…`, confirmed absence of the old dead `"none selected"` string, confirmed the new `0 0 60px -20px` glow boxShadow, and confirmed the old `projectsWithLists`/`selectedProjectId` props are no longer passed into `AdvancedGenerationPanel` — all 6 checks passed against the actual deployed file, not just the local build. Also backed by a real live-Supabase E2E test (synthetic scratch project/account/list, full `createList`→`setProjectListId`→`linkAccountToLists` sequence, fully cleaned up after) and a real Playwright render confirming the promoted section, no "list" language, and the Advanced panel now holding only Account Intel/Voice/Company Intel.

## 2. VERIFICATION METHOD — A REAL DISTINCTION, NOT A BLANKET CAVEAT

Most of today shipped harness/code-trace verified — there is still no invite/master code available locally to get past `ProspectorGate`, and no `ANTHROPIC_API_KEY` locally, so most fixes relied on isolated component harnesses (mocked props/callbacks, Playwright-screenshotted, cleaned up before committing) or direct bounded read-write-verify-revert round-trips against production Supabase.

But **the last several fixes today are a real step up**: the citation-leak fix and both generation-modal Project-picker fixes (`1aa7fe0`/`8e0282e` and `0c32bdd`) got genuine Playwright-rendered screenshots plus, for the final one, direct grepping of the live deployed bundle's actual minified content — not just a local build check. Treat these specifically as more strongly verified than the harness-only work earlier in the session; don't flatten the distinction.

## 3. TWO AUDITS COMPLETED THIS SESSION — FINDINGS REAL, NOT YET BUILT

**`project-outreach-example-multi-v1`** — `projects.outreach_example` is a plain single `text` column today, entered via a single `<textarea>` in `ProjectGuidanceCard.js`, read into `api/email.js`'s `project` CONTEXT_PROVIDERS entry as one example string. Supporting 1-20 examples is a real structural change (new array/jsonb column or join table, provider rewrite, new multi-item UI), not just a formatting tweak. Recommendation (not yet decided): **distill-and-cache**, reusing `OutreachRulesCard.js`'s exact shipped pattern (paste → LLM distills once → cached structured result read cheaply on every generation) rather than raw-injecting all N examples into every prompt call.

**`projects-process-and-ux-audit-v1`** — generation-time mechanics (data model, ambiguity handling, resumable bulk generation) are solid and verified. Day-to-day process has real gaps: no Projects browse page (one collapsed per-business section only), no at-a-glance account count/last-used, add-only assignment, no lifecycle/archive state. One concrete, currently-live bug found: **`LinkedProjects.js` has a worse version of the list-less-project bug fixed in `EmailModal.js` today** — it filters both `linked` and `linkable` on `p.list_id` truthy, so a list-less project is silently invisible there with zero messaging (today's `EmailModal.js` fix did not touch this file). Real live data pull, all 4 businesses: only **1 of 4 `projects` rows is actually active/reachable** (`"Q3 Jack's Outbound Strategy"`, HumanKind, 1 account); the other 3 have `business_id: null` and are orphaned test/legacy junk, invisible in the app today. Verdict: technically complete but rough — not urgent yet given only 1 live Project exists, but would frustrate anyone but Jack once usage scales.

## 4. QUEUED NEXT STEPS — PROPOSED SEQUENCING

1. Fix `LinkedProjects.js`'s list-less-project blind spot — same silent-backfill treatment as today's `EmailModal.js` fix, closing the asymmetry between the two assignment surfaces.
2. Multi-example outreach training — new array/jsonb column + distill-and-cache, per the audit's recommendation.
3. Fold the 3 orphaned `projects` rows into the already-queued `aggressive-slimdown-v1` cleanup pass (full prompt exists, not yet sent).
4. Hold Projects browse-page/lifecycle/bulk-assignment work as explicitly premature — only 1 active Project exists today, real but low-stakes.

## 5. LOGGED, NOT BUILT — CARRIED FROM PRIOR HANDOFFS, STILL UNTOUCHED

- `#39FF14` (NEON terminal-green accent) hardcoded locally in ~15 files instead of `T.neon` from `constants/tokens.js`. Broad blast radius, needs its own pass.
- `getBusinessesForUser`/`getBusinessesForMember` (`db.js:837`, `:869`) share verbatim duplicate logic — real, distinct call sites (not dead code), touches primary auth/session-load flow for both session types. Needs its own dedicated pass, not a drive-by fix.
- Both logged in memory (`project_cleanup_todo_queue`) for triage.

## 6. FUTURE-PHASE, EXPLICITLY NOT BUILT

- Combinatorial-generate workflow — not started.
- Call Prep's "intelligent layer" visual treatment — not started.
- "My Profile" per-person role/objective context — not started.

Named here purely so a future session doesn't have to re-derive that these were considered and set aside on purpose.
