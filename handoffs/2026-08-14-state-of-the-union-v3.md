# Prospector — Verified State of the Union (v3)

**2026-08-14, new session, following on from the two same-day handoffs already in this directory.** Every claim below was checked directly in the last hour before writing this — real Supabase queries (service-role), real `curl` against `https://prospector-chtj.onrender.com`, real Playwright clicks against the live app, real `git`/`git ls-remote` state. No optimism, no "should work" — only what's been personally confirmed live in this session.

Session covered: `assay-engine-generalization-v1`, `outreach-intelligence-v1` (plus two live bugs found and fixed mid-verification), and two `/cleanup` passes (one applied, one pending approval).

---

## 1. Confirmed live and working right now

- **`assay-engine-generalization-v1`** — `api/assay.js` deleted, `clientAssay()` is the single source of truth. Cached `assay_criteria` (business-scoped, generate/regenerate/edit-manually) confirmed live for HumanKind via `curl`: real `fit_signals`/`disqualifiers`/`tier_guidance` present. Fintech-fallback preserved verbatim for context-free callers, confirmed via negative-control test. `/proxy/jina` now authenticates with `JINA_API_KEY` — confirmed via `curl`, `code=200`.
- **`outreach-intelligence-v1`** — all sections confirmed live:
  - **Voice profiles are now server-synced.** `voice_profiles` table confirmed live (8 columns), RLS policies confirmed present (were missing at first — found and fixed mid-session, see Landmines). Jack's real profile confirmed in the table via a real learn-from-paste UI flow, not a synthetic insert.
  - **General Outreach Rules** (business-scoped, paste-to-distill) confirmed via a real paste test on HumanKind — produced accurate, on-topic structured rules. Currently `null` for HumanKind (intentionally cleared after test — see below).
  - **Project Outreach Guidance** (lightweight, per-project) confirmed via RLS-respecting anon-key write test and a real UI save/persist check.
  - **Composition order** (voice → assay_criteria → outreach_rules → project guidance) confirmed via an unambiguous marker-phrase test — a fabricated "QUACK QUACK PARTNER UP" project prompt appeared verbatim in generated output only when `projectId` was passed, never in the baseline.
  - **Bulk generation** confirmed via a real run against a real (temporary) project list: pause/resume is airtight — exactly N API calls for N accounts across a pause+resume boundary, zero duplicates. Review-first UI confirmed, no auto-send.
- **`api/email.js` generalization** — hardcoded fintech `AVOID_ALWAYS`/`SOCIAL_PROOF` removed, `businessId`/`assay_criteria`/`outreach_rules`/project-guidance composition added, Jina auth fixed here too. Confirmed clean via live test against The Coconut Cult (real HumanKind account) — zero fintech language, output correctly grounded in real business-fit signals.
- **Account card redesign (`account-card-full-redesign-v2` + color-fix-and-guided-generate-v1) and global workspace nav (`global-workspace-navigation-v1`)** — re-verified live just now, not just assumed from earlier in the session: workspace nav renders, account card expands, Generate Outreach and Re-assay actions both present, zero console/page errors.
- **`/cleanup` pass #1** — removed 2 confirmed-dead files (`AccountCardExpandedPanels.js`, `intel/NextStepsPanel.js`, 119 lines), committed as `65a6797`, build verified clean before and after.

## 2. Two real bugs found and fixed mid-session (not caught by code review alone)

1. **`voice_profiles` had RLS enabled with zero policies** — silently blocked every browser write (`42501` on anon-key test). Fixed with a policy migration matching the app's standard anon-permissive posture on every other table. Confirmed fixed via a second anon-key write test.
2. **`customIntel` (the AE's global, fintech-flavored product docs) leaked into generated outreach for real, non-fintech businesses — twice.** First fix gated on `!assayCriteria`, which missed influencer accounts (assayCriteria is never fetched for them). Live bulk-generation testing against real HumanKind influencer accounts caught "Core Verify"/"ACH flow" pitches going to Chicago creators. Final fix gates on `!businessId` instead, confirmed correct for both business and influencer accounts via live re-test. A related, not-yet-triggered version of the same bug (hardcoded `"fintech"` default string in `api/email.js`'s no-scraped-content fallback) was also found, fixed, and verified with both a positive test (real business context → no fintech language) and a negative control (no business context → fintech fallback still fires correctly).

## 3. Correction to an earlier finding this session

**`EmailGenerator.js` is NOT dead.** An earlier audit fork this session claimed it was "orphaned, zero render sites" — that claim was wrong. It's rendered as `EmailSystemPage` in both `ToolsPage.js` and `BusinessGenerationTab.js`, confirmed via live click-through just now: the "Sequences" tab inside it (previously believed dead and left explicitly un-integrated in `outreach-intelligence-v1`'s SPEC) is real, clickable, and error-free on prod right now. **This may be worth revisiting** — the `outreach-intelligence-v1` SPEC's decision to treat Sequences as "leave dead" was made on a false premise. Not urgent, but flagging so it doesn't get relied on as settled.

## 4. Committed and pushed vs. pending

**Local HEAD matches `origin/main` exactly**, confirmed via `git ls-remote origin main` vs. `git rev-parse HEAD`: `65a6797c890e92c64dc4182ed839411ab9d1039e`.

**Commits this session** (chronological, oldest first):
```
0f6d605  account-card-unification-and-outreach-v1: unified AccountCard, Generate Outreach
42346a0  account-card-full-redesign-v2: rebuild the cockpit, keep the engine
c03f6b5  account-card-color-fix-and-guided-generate-v1 Part A: role colors + neon + activity fade fix
3b8e030  account-card-color-fix-and-guided-generate-v1 Part B: guided Generate Outreach
6aace42  global-workspace-navigation-v1: two-layer nav + workspace identity
1fd5cff  assay-engine-generalization-v1: cache-backed per-business assay criteria, generalized scoring prompt, fintech fallback preserved
5cd1e28  assay-engine-generalization-v1: stop leaking AE's global fintech intel into generalized scoring
d6ab291  Authenticate /proxy/jina with JINA_API_KEY (client-side Assay site-fetch path)
e0dfc8d  outreach-intelligence-v1: server-side voice profiles, business-level and project-level outreach rules, generalized composition, bulk generation
2c61705  outreach-intelligence-v1: stop leaking AE's global fintech intel into api/email.js generation
2151442  outreach-intelligence-v1: fix customIntel gate to key off businessId, not assayCriteria
ff534a2  outreach-intelligence-v1: gate api/email.js's fintech default on businessId, comment-flag Claim Jumper's dead payload
f69928f  Revert ClaimJumperPage.js comment — Claim Jumper flagged via memory for /cleanup instead
65a6797  cleanup: remove two confirmed-dead components   ← current HEAD, matches origin/main
```

**Pending, not yet committed (explicit approval requested, not given yet):**
- `/cleanup` pass #2 findings — 5 dead API handler files (`api/gmail/auth.js`, `api/gmail/callback.js`, `api/gmail/refresh.js`, `api/sfdc/auth.js`, `api/sfdc/callback.js`, 238 lines total), all confirmed superseded by inline implementations in `server.js`. **No commit hash exists for this yet — not done, waiting on your go-ahead.**

**Still uncommitted, local-only, unchanged from prior handoffs:**
- `supabase/migrations/20260805_team_users_identity.sql` — confirmed via `git status` just now, same file flagged uncommitted in the two prior same-day handoffs. Real, unstarted work (Step 1's duplicate-email check has never been run against live data).

**Resolved since the last handoff:** `scripts/live-audit.js` — flagged as the single most urgent uncommitted item in the prior handoff (v2) — is now committed (`3492c90`, confirmed via `git log`).

## 5. Landmines — status of each

**Still open:**
1. **`CLAUDE.md`'s prod URL is still wrong.** Line 83 still reads `https://prospector.onrender.com` — re-confirmed just now, that URL 404s. Real prod, confirmed repeatedly this session, is `https://prospector-chtj.onrender.com`. Flagged in two prior handoffs, still not fixed.
2. **`supabase/migrations/20260805_team_users_identity.sql` still not applied or committed** — unchanged, real pending work (see above).
3. **`getActiveIntel()`'s unconditional flow for Claim Jumper and Frontier stealth entries** — intentional, not a bug. Both call sites have zero `businessId`, so they always resolve to the legacy fintech prompt/customIntel path by design. Confirmed unchanged by this session's `businessId`-gating fixes (verified by construction: those callers never pass `businessId`, so the new gates are no-ops for them).
4. **`ClaimJumperPage.js`'s Generate Email payload mismatch — still broken, decision still pending.** Confirmed via git history this session: broken since the repo's very first commit, never a working integration. Live-reproduced: produces an LLM meta-refusal displayed as if it were a real email. Jack confirmed Claim Jumper is legacy; decision (fix the payload contract vs. remove the feature) explicitly deferred to a future `/cleanup` review — tracked in memory (`project_claimjumper_removal_candidate.md`) so it surfaces as its own labeled section next time, not mixed into standard dead-code findings. **Scope note that matters:** only the page/route itself is dead — the underlying pool infrastructure (`claimJumper` state, `prospector_claimjumper`, `claimAccount()`/`claimMultiple()`) is shared, active code also used by `HomePage`'s "Diamonds in the Rough," `AnalyticsPage`, `ToolsPage`, and badge tracking. Don't remove that layer.
5. **Peter's and Cyrus's join links — still not independently verified.** Checked `business_members` fresh just now: both rows are byte-identical to every prior check this session and the two before it (`peter@humankindcollective.app`, `created_at: 2026-08-13T23:42:28Z`; `c.radjoo@gmail.com` / Cyrus, `2026-08-13T23:49:32Z`). Zero new activity since the original question was raised. This needs a direct answer from you or them, not another database check — the data cannot distinguish a real click-through from a manual seed insert.

**New landmines found this session:**
6. **`accounts.project_id` exists in the schema but is never written by any application code.** Confirmed via full-repo grep. Real "account belongs to project" resolution goes through `projects.list_id → account_lists → accounts` instead. Don't query/filter on `accounts.project_id` expecting real data.
7. **Five more dead API files beyond the three Gmail ones flagged in the prior handoff**: `api/sfdc/auth.js` and `api/sfdc/callback.js` are in the exact same state (superseded by inline `server.js` implementations, zero references anywhere). Combined with the original 3 Gmail files, that's 5 files / 238 lines pending your removal approval (see §4).
8. **`EmailGenerator.js`'s "Sequences" tab is not actually dead** (see §3) — a live, working feature that an earlier audit this session incorrectly called orphaned. Low-severity as landmines go (nothing broke because of it), but worth knowing before anyone treats "Sequences is dead" as settled fact.

**Resolved since prior handoffs:**
- `scripts/live-audit.js` uncommitted — fixed (see §4).
- Three dead Gmail files unflagged — now formally identified and pending removal decision (broadened to 5 files, including SFDC).

## 6. Next action — top of queue

In rough priority order, based on what's cheapest/most load-bearing to close first:

1. **Approve or decline the 5-dead-API-file removal** (`api/gmail/auth.js`, `callback.js`, `refresh.js`, `api/sfdc/auth.js`, `callback.js`) — fully verified, zero-risk by the evidence gathered, just needs a yes/no given they're auth-adjacent files.
2. **Peter and Cyrus's join links** — needs a direct human answer, not another database check. Cheapest unresolved item on this whole list.
3. **Generate real `assay_criteria` (and optionally `outreach_rules`) for HomeLover and Master Magnetics** — confirmed live just now: both have a `business_profiles` row but neither has `assay_criteria` or `outreach_rules` generated yet. HumanKind is the only business with real criteria in place; the other two are still scoring/generating against the fintech fallback until this is done.
4. **`ClaimJumperPage.js` fix-vs-remove decision** — tracked in memory, ready for a `/cleanup` review whenever you want to make the call.
5. **`influencer-bio-url-context-v1`** — searched this session's memory, all three prior handoff files, and the full repo: **zero trace of this name anywhere.** This isn't a case of "started and forgotten" — there's no record of it existing at all in anything I have access to. If this is a real planned SPEC, I'll need you to describe it fresh; I have nothing to go on.
6. **`CLAUDE.md`'s stale prod URL** — small, cheap fix, flagged three sessions running now without being touched.
7. **`supabase/migrations/20260805_team_users_identity.sql`** — Step 1 (a pure `SELECT`, zero risk) has never been run to check if Step 2 is even safe.
