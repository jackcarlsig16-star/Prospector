# Prospector — State of the Union

**2026-08-14, end of session.** Everything below was checked directly in the last few minutes before writing this — real Supabase queries (service-role), real `curl` calls against `https://prospector-chtj.onrender.com`, real `git rev-parse`/`git ls-remote`. Nothing here is carried forward from memory of earlier in the session without a fresh re-check.

---

## ✅ Confirmed live and working right now

- **`classifyIntake()` / Smart Intake, end to end** — POSTed to `/api/businesses/981b790c.../intake` moments ago with a fresh test string: **200 OK**, filed cleanly as `company_intel`, no 500. The `adaptive-thinking-on-FAST-tier` bug is fixed and has stayed fixed (verified fresh just now, not just earlier today). Also verified today, separately, across the full `smart-intake-classification-confirm-v1` SPEC: Instagram-profile-block detection → `influencer` classification → confirm UI → real influencer account creation; `new_account`/`ambiguous` cases correctly hold for confirm instead of auto-filing; Discard writes nothing (confirmed via follow-up query).
- **`influencer-card-v2`** — fit scoring against a business's real profile, relationship tracking, the new `InfluencerCard.js` compact/detail views. Verified live with two real businesses: the **same** test influencer bio scored **89/100** for HumanKind (Chicago community-wellness) and **22/100** for Master Magnetics (industrial B2B magnets), with rationale text that concretely referenced each business's real context — including content that could only have come from Master Magnetics' `raw_synthesis` fallback (its structured `vision`/`positioning`/`icp` fields are empty), confirming that fallback path actually fires. Stage-change activity logging confirmed: `relationship_stage` change → real `recordAccountActivity()` entry + `last_touched_by`/`last_touched_at` update, verified via direct query.
- **`territory-business-scope-fix-v1`** — `getAccounts()`/`saveAccountsToDb()` now scope on `business_id IS NULL`. Verified live: the fixed read query returns 0 rows for `jackcarlsig16@gmail.com` (correct — no genuine legacy-only data exists in this DB right now); a simulated Territory autosave (both the empty-array full-delete branch and the delete-not-in-set branch) leaves the two real business-scoped accounts (The Coconut Cult, `@aldknudsen43`) completely untouched; business-scoped reads (`getAccountsForBusiness`, never part of the bug) still return both correctly.
- **Schema audit tooling** (`scripts/live-audit.js` + `supabase/migrations/20260813_create_audit_rpcs.sql`) — the migration is confirmed live in Supabase; both the `schema` and `rls` subcommands work end to end, tested moments ago against `accounts`. This was listed as unverified in the 2026-08-13 handoff — it's real now. **Still not committed to git** (see below).
- All Phase-1 schema work from both `influencer-card-v2` and `smart-intake-classification-confirm-v1` is live: `accounts.account_kind` and `account_influencer_details.relationship_stage`/`priority` are real CHECK-constrained enums now (confirmed by attempting invalid writes and getting real constraint-violation errors back, not just trusting the migration ran).
- **Local HEAD matches `origin/main` exactly**: `6a839666337487b89a38f3a4191fee9a5c76a528`.

## 🔴 Still broken, with the exact current blocker

- **HumanKind site research is still broken. No JINA_API_KEY fix ever shipped.** Checked directly: `JINA_API_KEY` does not exist anywhere in the codebase (`grep -rn "JINA_API_KEY"` across `api/` and `src/` returns nothing) and is not set in the local `.env`. Every `r.jina.ai` call in this app (`api/personas.js`, `api/stealth.js`, `api/email.js`, `api/assay.js`, `src/utils/assay.js`, `IntelligencePage.js`) is still fully unauthenticated. The real Jina API key Jack supplied mid-session was used **only** for a one-off manual `curl` test during the influencer-accounts-v1 investigation (to confirm Instagram fetching stays blocked even with auth) — it was never wired into the app's actual fetch calls. HumanKind's own site (`humankindcollective.app`) is also a JS-rendered SPA with only ~49 characters of extractable static content, independent of the Jina auth question. The most recent real `research_site` attempt for HumanKind (`2026-08-13T18:50:32Z`) still reads **"Site unreachable after multiple fetch attempts"** — no successful retry exists after that, checked just now. **If you believed this was fixed, it was not — this is an unambiguous no.**
- **`project_members` table**: still completely broken, checked fresh moments ago — `PGRST205: Could not find the table 'public.project_members' in the schema cache`, identical to the 2026-08-13 handoff. Per your explicit instruction this session ("Stop working on project_members entirely... Abandon it, even mid-fix"), this was deliberately left unfixed, not missed. Still blocks the "+ New Project" flow. Needs a from-scratch diagnostic next time, not another blind `NOTIFY pgrst, 'reload schema'`.
- **`EmailGenerator.js`'s static templates** and **`assay.js`'s scoring**: unchanged, still fintech-biased, still deferred to `generalize-legacy-functions-v1` (not touched this session).

## 🟡 In progress but unfinished

- Nothing is mid-implementation. All three SPECs run this session (`smart-intake-classification-confirm-v1`, `influencer-card-v2`, `territory-business-scope-fix-v1`) reached their own Phase 4/5 verification and were committed.
- Two real, cheap follow-ups were flagged during this session but deliberately **not** done (out of scope for the SPEC that surfaced them), noted for whenever those files are next touched:
  - `InfluencerCard.js`'s new `AccountActivityTimeline.js` component is a genuinely reusable primitive — the business-account detail view (`AccountCard.js`) still uses its old fintech "Timeline" concept (never actually a real component) and could swap to the same one.
  - `BUSINESS_NAV` duplication between `Sidebar.js`/`MemberShell.js`, flagged in an earlier session, still unresolved (pre-existing follow-up, not new).

## 📦 Committed and pushed vs. local-only

**Committed and pushed** (all confirmed on `origin/main` at `6a83966`):
- `smart-intake-classification-confirm-v1` (`f690267`, `d3e4ed5`)
- `influencer-card-v2` (`229b0de`, `5892ab7` max_tokens fix)
- `territory-business-scope-fix-v1` (`6a83966`)
- The `20260814_influencer_card_v2.sql` migration is committed (unlike the three below).

**Never committed, local-only** (checked via `git log --all -- <path>`, zero commit history for every one of these):
- `supabase/migrations/20260805_add_peter_approved_users.sql`
- `supabase/migrations/20260805_team_users_identity.sql`
- `supabase/migrations/20260813_create_audit_rpcs.sql` — **live and load-bearing in production right now**, actively used every session, but the file itself only exists on this machine.
- `scripts/live-audit.js` — same situation, functional and in active use, never committed.
- `scripts/list-invite-candidates.js` — untested this session, never committed.
- `handoffs/` directory itself, including this file and the 2026-08-13 one.

None of this is gitignored — I checked `.gitignore` directly. These are just genuinely uncommitted. A fresh clone or different machine loses all of them.

## ⚠️ Landmines and gotchas for next session

1. **Jina/Instagram/site-fetch is a dead end, don't retry it.** Confirmed structurally blocked multiple times this session and last, with and without a real API key, for Instagram specifically and now independently re-confirmed for HumanKind's own site. Any future "why isn't research working" report on this business should assume this cause first.
2. **Peter's and Cyrus's `business_members` rows cannot be verified as real join-link completions from the data alone** — see dedicated section below. Don't assume `business-lists-and-permissions-v1` is end-to-end human-verified just because the rows look right.
3. **`saveAccountsToDb()`'s delete-not-in-set pattern was a real, live data-loss risk until this session**, not scoped to `business_id` for months. It's fixed now, but if any other table shares a similar dual-key shape (`owner_email` + some other scope column) with a delete-not-in-set write path, it's worth checking for the same class of bug — this wasn't audited beyond `accounts`.
4. **The influencer fit-assessment prompt needed `max_tokens` raised from 800 to 2048** after adding `fit_score`/`fit_signals`/`fit_rationale` — it silently failed in production (not a slow degrade, a hard error) before the fix. Any future expansion of AI-call output shape in this codebase should treat token headroom as something to re-check, not assume.
5. **`accounts.account_kind` and `account_influencer_details.relationship_stage`/`priority` are now real CHECK constraints.** Code that writes these values (if extended later) must use the exact enum strings or the write will hard-fail with a constraint violation — this is new as of this session, previous code never had to think about it.
6. **Territory (`page==="accounts"`, `accountsSubPage==="territory"`) will now load and show zero accounts for `jackcarlsig16@gmail.com`.** This is correct per this session's fix, not a bug — there is currently no genuine non-business-scoped account data in this DB under that email. If someone opens Territory and reports "my accounts are gone," check whether they mean the business-scoped ones (which never belonged there) before assuming a regression.

## Peter's and Cyrus's join links — NOT independently verified

Directly answering this: **I cannot confirm Peter or Cyrus personally clicked and completed a real join link.** Both `business_members` rows exist with plausible real-looking data (`Peter Norgaard` / `peter@humankindcollective.app` on HumanKind, `Cyrus Radjoo` / `c.radjoo@gmail.com` on HomeLover, timestamped `2026-08-13T23:42` and `23:49`), which is the same shape a real join produces — but it's also exactly what a direct SQL/script insert during setup would look like, and I have no session log or distinguishing signal to tell those apart. My own Playwright testing this session used different, fake test emails (`playwright-tester@example.com`, `intake-confirm-tester@example.com`, etc.) specifically to avoid touching real member rows — none of my test runs created or touched Peter's or Cyrus's actual rows. **This needs to be answered by you directly, not inferred from the database.**

## Single next action for next session

**Before starting any new feature work: have Peter and Cyrus actually click their real join links (or confirm with them directly that they already have) and watch it work.** This is the one open item from earlier session work that's presented as "done" but isn't independently verified end-to-end with real people — and it's cheap to close. Separately, and lower-priority: decide whether HumanKind's site research should formally move to manual-paste-only (matching what was decided for influencer bios) given the Jina/JS-rendered-SPA dead end is now confirmed twice, or whether it's worth a real headless-browser-based fetch investment later — that's a product decision, not a bug fix, and doesn't need to happen before the join-link check.
