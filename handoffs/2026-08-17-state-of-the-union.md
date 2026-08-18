# Prospector — Verified State of the Union (2026-08-17)

Every claim below was checked directly in this session before writing — real Supabase queries (service-role), real `curl` against `https://prospector-chtj.onrender.com`, real `git ls-remote`, a real Node execution of the actual `buildIntelExport` source against a live production account row. No optimism, no "should work" — only what's been personally confirmed in this session.

Session covered: a live-testing incident triage (HomeLover's dropped bulk Assay run), `assay-safety-and-intel-visibility-v1`, `surface-existing-intel-v1`, `account-card-button-cleanup-v1`, and a real diagnosis of the account card's Extract/Timeline/Deal Summary buttons.

---

## 1. CONFIRMED-LIVE

**Local HEAD `d035522` matches `origin/main` exactly** — confirmed via `git ls-remote origin main` (`d035522c62362064e4cde0c49e026db80364c6fc`) against `git rev-parse HEAD`, not just "push succeeded."

**The live bundle actually contains this session's code**, verified by both hash and content, not assumption:
- Live bundle right now: `main.6ebf73af.js` (fetched fresh via `curl` against prod, re-verified this session, not reused from earlier in the conversation).
- Content-grepped the real downloaded bundle for markers unique to each shipped SPEC: `"SFDC Note"` (1 match — button-cleanup-v1), `"Client ID(s), comma-separated"` (1 match — button-cleanup-v1), `"Signal Breakdown"` (1 match — surface-existing-intel-v1), `"Full Intel"` (1 match — assay-safety-and-intel-visibility-v1). All present, all exactly once.

**Shipped and verified this session, in order:**
1. **`assay-safety-and-intel-visibility-v1`** (commits `9dfdc5a`, `e1ab47e`, `66f576e`, `9810d71`) — re-assay now does a real, awaited single-row `.update().eq('id',...)` write (`updateAccountRow` in `utils/db.js`) instead of relying solely on the generic full-array autosave; both persistence writes (`updateAccountRow`, `upsertAccountBusinessDetails`) are awaited with real failure alerts instead of `.catch(()=>{})`; the 160-char truncation on Business Model/Product Fit in `IntelligenceSummary` is gone; a raw, toggle-gated "Full Intel" JSON panel now shows real `account_business_details` content on business accounts.
2. **`surface-existing-intel-v1`** (commits `51c5fb0`, `1c1044f`) — Key Signals, Traction Signals, Signal Breakdown (with its 4 sub-arrays via a small file-local, non-exported `SignalSubGroup` helper), and Disqualifier now render as real pills/labels in `IntelligenceSummary`, reusing the app's existing inline pill styling verbatim. A raw numeric Score badge now renders in `AccountHeader` alongside the existing tier badge (previously genuinely absent from the card — confirmed via a pre-fix grep, zero prior references).
3. **`account-card-button-cleanup-v1`** (commit `d035522`) — the invalid-state "⬡ SF" edit-trigger is removed (confirmed redundant with the ✏ pencil); the real "⬡ Salesforce" link is **kept** when `acc.sfdc` is valid (narrower than the SPEC's literal "remove ⬡ SF" wording — flagged to Jack mid-session, not walked back either way, see Landmines); "⎘ SFDC" is renamed to "⎘ SFDC Note" (label-only, same handler); `clientIds` is folded into the pencil's existing edit form as a fourth field, saved via the same `onUpdate` call — the dedicated Client ID button is intentionally still present, not yet removed (deferred by design, see Landmines).

**HomeLover's real, business-specific `assay_criteria` is live and unchanged since generation** — re-confirmed via a fresh query just now: `assay_criteria_updated_at: 2026-08-17T20:27:01.005Z`, not null, not reverted.

**The 25 `TEST-bulk-*` HomeLover accounts (and their cascade-deleted `account_business_details` rows) are still fully cleaned up** — re-confirmed just now: 0 remaining.

**Unchanged from the prior handoff, still true:** account-card-full-redesign-v2, global-workspace-navigation-v1, outreach-intelligence-v1, assay-engine-generalization-v1 — not touched this session, no reason to believe regressed.

## 2. BROKEN

**Confirmed still open — "Nudge PR" / "Nudge Sec Q" always claim success, even on failure.** Diagnosed this session while investigating the Extract panel, re-verified in the current source just now (`grep` on `AccountCardExtract.js`, not memory): `setNudged("nudgePr")` fires unconditionally at line 155, *before* the `if (!res.sent)` check at line 158. `sendNudgeEmail()` tries a real Gmail draft creation and silently falls back to a clipboard copy on failure/no-token — that fallback is reasonable, but the button always displays "✓ Sent" regardless of which actually happened, or whether the clipboard copy itself even succeeded (also wrapped in a swallowed `.catch`). **Not fixed this session — diagnosis only, per the user's explicit "report only" framing at the time.**

**Not confirmed broken, but a real, unaddressed risk** in the same Extract panel: `sfdc`, `handleCustomerEmail`, and `handleSlackBrief` handlers all catch LLM-call errors with `console.error` only — no visible error state. A failed API call just silently resets the button with zero explanation.

**"⎘ Copy Intel" (Extract's flagship action) is confirmed NOT broken** — actually executed the real `buildIntelExport()` source (extracted with its full real dependency closure: `radarScoring.js`, `callContext.js`, `models.js` — no other deps) against RentTrack's live production row in a real Node sandbox. Zero errors, clean 1,693-character output. If it "feels" broken to Jack, the most likely cause isn't the code — it's that **0 of 16 real business accounts in the DB have any `calls`, `medpicc`, or `personas` data**, so Extract's richest sections render empty for every real account that currently exists, and a successful copy gives only a small "✓ Copied" label change with no other confirmation.

**Timeline and Deal Summary are not broken, just unpopulated.** Both are real, working, zero-LLM-cost-on-open components; confirmed via direct query that 0 of 16 real business accounts have `dealTimeline` or any pricing/ACV data, so both render empty/prompt-to-generate for every real account today.

## 3. IN-PROGRESS / uncommitted

**Nothing from this session is uncommitted.** Every diff made this session was build-gated and committed; `git status` shows only two untracked files, both pre-existing from before this session and untouched by me:
- `handoffs/2026-08-14-state-of-the-union-v3.md` — a draft from a prior session, never committed. Still sitting there.
- `supabase/migrations/20260805_team_users_identity.sql` — real, unstarted work carried across at least four sessions now (three prior handoffs plus this one). Step 1 (a pure `SELECT`, zero risk) has still never been run against live data to check if Step 2 is even safe.

## 4. COMMITTED+PUSHED

Confirmed via `git ls-remote origin main` = `d035522c62362064e4cde0c49e026db80364c6fc`, matching `git rev-parse HEAD` exactly. Not inferred from "push succeeded" output alone.

Commits this session (chronological):
```
9dfdc5a  Fix 2: give re-assay a real, awaited single-row Supabase write
e1ab47e  Fix 3: await the account-details dual-write, surface failures visibly
66f576e  Fix 4: remove 160-char truncation on Business Model / Product Fit
9810d71  Fix 5: bare raw Full Intel panel showing account_business_details
51c5fb0  Fix 1-3,5: surface Key Signals, Traction Signals, Signal Breakdown, Disqualifier
1c1044f  Fix 4: render raw score badge in AccountHeader, unconditional like tier
d035522  account-card-button-cleanup-v1: remove redundant SF edit button, rename SFDC note button, fold clientIds into pencil form   ← current HEAD, matches origin/main
```

## 5. LANDMINES

**New this session:**
1. **Nudge PR/Sec Q false "✓ Sent" — real, live, user-facing bug, not yet fixed.** See §2. Cheap to fix now that it's fully diagnosed (one-line move of `setNudged(...)` after the `res.sent` check, mirrored on both handlers).
2. **Fix 1's SF-button scope was interpreted narrower than the SPEC's literal wording**, and Jack never explicitly confirmed which was intended. I removed only the invalid-state edit-trigger; the valid-state real Salesforce link is still there. A future session should not assume the SPEC's literal "remove ⬡ SF entirely" was fully executed — it wasn't, on purpose, flagged at the time, unconfirmed either way since.
3. **Client ID button is deliberately still present**, not forgotten — `account-card-button-cleanup-v1` explicitly deferred its removal until the pencil-form `clientIds` field is confirmed working live (Jack's own browser check, not independently verified by me — no browser tool access this session). Don't remove the Client ID button in a future pass without first confirming that field actually saves correctly.
4. **`saveAccountsToDb`'s generic full-array autosave is deliberately left un-narrowed**, even after Part 1's audit found it currently touches every account in a business on any single edit (confirmed live: 27 HumanKind accounts sharing one exact-millisecond `updated_at`). This is Jack's explicit, informed call (the "additive, not replace" decision on the Fix 2 FLAG this session) — not an oversight. A future session seeing this pattern should read `specs/assay-safety-and-intel-visibility-v1.md` and commit `9dfdc5a`'s message before "fixing" it again.
5. **All three new SPEC files now live in `/specs/`** (`assay-safety-and-intel-visibility-v1.md`, `surface-existing-intel-v1.md`, `account-card-button-cleanup-v1.md`) — this is a new convention introduced this session (no `/specs/` directory existed before). Future sessions running `/spec` should check there first before assuming a SPEC is undocumented.

**Carried forward, unchanged, still real (from the 2026-08-14-v3 handoff, not touched this session):**
6. `accounts.project_id` exists in the schema but is never written by any application code — don't query/filter on it expecting real data.
7. `ClaimJumperPage.js`'s Generate Email payload mismatch — still broken, decision (fix vs. remove) still pending, tracked in memory.
8. Peter's and Cyrus's join links — still not independently verified; needs a direct human answer, not another database check.
9. Master Magnetics — still scoring against the fintech fallback; no real `assay_criteria` generated for it yet (HomeLover's is now done; Master Magnetics is the one remaining business on the fallback).
10. The "5 dead API files" removal (Gmail/SFDC auth/callback) — Jack said this session it was "decided days ago," but I did not independently re-verify this session whether that decision was execute-or-keep, nor whether it was actually carried out. Worth a real check next time it's relevant, not assumed settled purely from the one-line mention.

**Resolved since the last handoff:**
- `CLAUDE.md`'s stale prod URL — flagged three sessions running in the prior handoff chain; confirmed already correct in the current `CLAUDE.md` at the start of this session. Resolved, no longer a landmine.

## 6. NEXT ACTION

**Fix the Nudge PR/Sec Q false-success bug.** It's fully diagnosed (exact lines identified, exact fix is a one-line reorder of `setNudged(...)` after the `res.sent` check, mirrored on both handlers), cheap, low-risk, and it's a real trust problem in a feature area Jack actively uses — an AE could believe they successfully nudged a prospect about a stuck compliance step when nothing was actually sent. Compare that to the other open items (Peter/Cyrus needs a human answer not code; Master Magnetics/team_users_identity are real but not user-trust-eroding in the same way) — this is the highest-value, lowest-cost fix sitting on the table right now.
