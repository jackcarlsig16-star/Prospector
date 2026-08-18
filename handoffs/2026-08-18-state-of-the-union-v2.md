# Prospector — Verified State of the Union (2026-08-18, v2)

Every claim below was checked directly before writing this — real `git log`/`git ls-remote` against the actual commit graph, real `npm run build`, real Playwright screenshots against an isolated harness. No optimism, no "should work" — only what's confirmed. This supersedes nothing in the same-day `2026-08-18-state-of-the-union.md` (that one covers `business-intel-smart-upload-v1` and ends at `b489dc4`) — this is the next chunk of the same day's work, picking up right after it.

Session covered: Scout consolidation, a manual emoji picker, a Business Intel visual redesign + a real follow-up truncation fix, a tier-badge-color fix, two full multi-stage taxonomy SPECs (12 stages total), and a fresh repo-wide `/cleanup` pass.

**Local HEAD `d4c5576` matches `origin/main` exactly** — confirmed via `git ls-remote origin main` (`d4c55761a818c1d09286b19ac424950dfa4f54ff`) against `git rev-parse HEAD`, identical hash.

---

## 1. CONFIRMED COMMITTED AND PUSHED

- **`scout-global-persistent-v1` (`90bf890`)** — Scout made persistent across all pages instead of a tab. Ground-truth audit found 5 real render sites (not the 2 originally assumed) and a Territory-vs-business-scoped data-model conflict; both flagged and resolved before building.
- **`business-emoji-manual-picker-v1` (`1c48489`)** — AI-picked business emoji replaced with a manual `emoji-picker-react` picker, lazy-loaded (~75kB, code-split). `generateProfile()` no longer asks the model to pick an emoji at all — the field is out of `candidateValues`, so an existing value survives every future refresh untouched.
- **`business-intel-strategy-visual-redesign-v1` (`a6e5493`)** — typography/chips/panels/source-drawer/KPI-strip redesign of the Business Intel page. Follow-up: the KPI strip's `core_problem` text was reported cut off twice on real HomeLover data; a word-boundary truncation fix (`1ecd6c8`) wasn't enough, so truncation was removed entirely for that field (`dbe780f`).
- **`tier-badge-metal-colors-v1` (`ea0cb34`)** — Gold/Silver/Tin/Slag tier badges were all rendering the same green; real color drift found across multiple files (swapped colors in one, missing Tin/Slag in two others), consolidated into a single `TIER_COLOR` export in `constants/colors.js`.
- **`account-taxonomy-and-creation-upgrade-v1` (9 stages, `3a15eda`→`d5f73a9`)** — universal industry taxonomy, `relationship_type` field, legacy-fintech-scoring-path fix, stage-gating + Closed-Won auto-conversion, subvertical removal, Add Account modal redesign, reassay + add-note fix, Relationship Type as a top-level filter row.
- **`account-taxonomy-gaps-fix-v1` (3 stages, `0c02816` + `e4957e2`)** — a real follow-up SPEC triggered by Jack's own production click-through finding 3 gaps in the parent SPEC's own execution/verification (no relationship_type edit path existed; a `source`/`relationship_type` "Partner" naming collision; Stage 8 added a row but consolidated nothing). Fixed all 3: a real manual relationship_type editor, the naming-collision rename, and a genuine filter-bar reduction — 5 stacked rows → 2 always-visible rows + a collapsed tools drawer, all pills now sharing one `FilterPill` component (size/padding/radius/font identical, color is the only thing that varies by category).
- **Fresh repo-wide `/cleanup` pass, this session (`d4c5576`)** — full re-sweep (dead files, duplicate logic, unused exports/imports, scratch artifacts), scoped fresh rather than reusing the morning's prompt since a lot had shipped since. 3 confirmed-dead named imports removed (`FitSummary` in `AccountCard.js`, `SmartTaskPanel` in `HomePage.js`, `CARD` in `accountCard/actions/PrimaryAction.js`), each verified via grep to have zero references before removal. Build confirmed clean after.
- **For context, not from today:** `account-card-button-cleanup-v1` (`d035522`, 2026-08-17) — a smaller, already-shipped 3-fix SPEC (remove redundant "⬡ SF" button, rename the mislabeled "⎘ SFDC" button, fold `clientIds` into the pencil's edit form). Distinct from the newer `account-card-cleanup-v1` (Stages 1-6) referenced in NEXT ACTION below — different scope, different name, don't conflate them.

## 2. THE ONE REAL GAP CARRIED ACROSS NEARLY EVERYTHING TODAY

**Every SPEC above except the `/cleanup` import removals was verified harness-only, never a real production click-through.** There is still no invite/master code available locally to get past `ProspectorGate`, so verification this entire session relied on: (a) isolated component harnesses with mocked props/callbacks, driven by Playwright, screenshotted, then fully cleaned up before committing; (b) for schema-touching work, real bounded read-write-verify-revert round-trips directly against production Supabase via node scripts — explicitly not a UI click-through either.

This is disclosed in each individual commit/session already, but naming it once, plainly, here: **the single highest-value thing to do the next time Jack is in the live app is click through today's shipped surfaces for real** — Scout's persistence across pages, the manual emoji picker, the KPI strip's now-unwrapped `core_problem` text, tier badge colors on a real account with all 4 tiers present, the relationship_type editor, and especially the new 2-row-plus-drawer Accounts filter bar (real pill styling, real drawer open/close, real Owner/List dropdown behavior) — none of that has been seen by a real browser against real data yet.

## 3. LOGGED, NOT BUILT — NEEDS ITS OWN DEDICATED PASS

Two items surfaced by today's `/cleanup` re-sweep, explicitly deferred rather than squeezed into an unrelated commit:

- **`#39FF14` (the NEON terminal-green accent) is hardcoded locally in ~15 files** instead of importing `T.neon` from `src/constants/tokens.js` (`AdminPage.js`, `AssayBanner.js`, `BriefPanel.js`, `OnboardingPage.js`, `ConnectionDot.js`, `VeinMap.js`, `outbound.js`, `assignHelper.js`, `intent/IntentFeed.js`, `CalendarWidget.js`, `ProspectorGate.js`, `FilterPill.js`, `accountsToolsDrawer/ToolsDrawer.js`, and others). This is the app's base accent, not tier-specific — separate from the `TIER_COLOR` fix, which is holding up cleanly with no similar drift found. Broad blast radius (15 files) if touched.
- **`getBusinessesForUser(email)` (`db.js:837`) and `getBusinessesForMember(email)` (`db.js:869`) share verbatim duplicate logic** — `getBusinessesForMember`'s "owned" half is a copy-paste of the entirety of `getBusinessesForUser`, then unions in `business_members` joins on top. Real, distinct call sites (`App.js:1028` for Jack's own session, `MemberShell.js:84` for joined-member sessions), so not dead code, just duplicated — but this touches the primary auth/session-load flow for both session types, real risk if botched, needs its own dedicated pass, not a drive-by fix.
- Checked and ruled out during the same sweep, for the record: `getAccounts()` (global, owner_email-keyed) vs `getAccountsForBusiness()` (business_id-keyed) look like the same duplicate-logic pattern at a glance, but are genuinely different (different columns selected, different delete-scoping) and already carry explicit comments citing a real prior incident (`territory-business-scope-fix-v1`). Do not merge these.

Both are logged in memory (`project_cleanup_todo_queue`) for triage at the start of a future session.

## 4. FUTURE-PHASE, EXPLICITLY NOT BUILT

Named and deliberately deferred, not forgotten:

- **Combinatorial-generate workflow** — future-phase, not started.
- **Call Prep's "intelligent layer" visual treatment** — future-phase, not started.
- **"My Profile" per-person role/objective context** — future-phase, not started.

None of these have any code, SPEC text, or scaffolding in the repo as of this handoff — they're named here purely so a future session doesn't have to re-derive that they were considered and set aside on purpose.

## 5. NEXT ACTION

**`account-card-cleanup-v1` (Stages 1-6) is the next SPEC, but it currently exists only in the Claude.ai chat — not in this repo, not in memory.** Scope as described this session: resize the Generate button and give it an orange theme, fix broken Debrief/Intel toggles, fix Extract, remove the Timeline/Deal Summary/SFDC Note/Client ID buttons, relocate Re-assay, and group Website/LinkedIn/Email as editable fields. A prior, smaller, already-shipped SPEC shares a near-identical name (`account-card-button-cleanup-v1`, `d035522`, see §1) — confirm which one is meant before assuming continuity between them. **This session searched `specs/`, memory, and the full repo for `account-card-cleanup-v1` text and found nothing** — it needs to be pasted fresh into the next session before any Stage 1 work can start.
