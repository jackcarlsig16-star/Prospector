# Prospector — Verified State of the Union (2026-08-18)

Every claim below was checked directly in this session before writing — real `git ls-remote`, real Supabase queries (service-role), real `curl` against `https://prospector-chtj.onrender.com`, and real headless-browser screenshots taken **against the live production site itself**, not localhost. No optimism, no "should work" — only what's been personally confirmed in this session.

Session covered: `business-intel-smart-upload-v1` (content-type classification, 7 new distilled profile fields, field-level source traceability with diff-check-on-write, manual-edit protection scaffolding), a real production infinite-render-loop bug found and fixed, nav/sidebar contrast polish, an earth-tone swatch row, business social links, an AI-picked business emoji (plus a same-session bug fix to it), and a "just resynthesize now" profile-refresh trigger wired into two entry points.

---

## 1. CONFIRMED-LIVE

**Local HEAD `b489dc4` matches `origin/main` exactly** — confirmed via `git ls-remote origin main` (`b489dc49a04c3a516d1190d418b15dda386e04e5`) against `git rev-parse HEAD`, identical hash. Not inferred from "push succeeded" output alone.

**Full `business_profiles` schema confirmed live** — real `information_schema.columns` query, 33 columns present: all 7 new fields (`industry`, `core_problem`, `sub_issues`, `products`, `value_props`, `motto`, `strategic_philosophy`), `field_sources`, `field_conflicts`, `emoji`, all 7 `*_edited_manually` flags, plus `content_type` on `business_intel_entries` and `social_links` on `businesses`. This isn't "committed" — it's live, queried directly.

**Content-type classification, 7 new fields, field_sources traceability, diff-check-on-write** — confirmed live with real data across multiple businesses this session (Master Magnetics, HomeLover, Kopi Kita all carry real synthesized content, not placeholders). `field_sources` traceability specifically re-verified by hand: traced which of 11 fields cited a specific real intel entry ID and it matched the UI's "Derived 11 fields" badge exactly.

**Manual "↺ Refresh profile" button — live, tested twice for real, not just rendered.** `POST /api/businesses/:id/profile-refresh` triggered against production on two different genuinely-stale businesses:
- HomeLover (untouched since 04:58) → real resynthesis, `emoji: '🏠'`, `motto: 'AI-Powered Home Intelligence'`, confirmed in a real screenshot of the live site.
- Kopi Kita → real resynthesis, confirmed correct `emoji: '☕'` after the same-session prompt fix (see below), confirmed in a real screenshot.

**Social links — live, tested for real.** Real `PUT /api/businesses/:id/social-links` against production for Master Magnetics (real Instagram/LinkedIn URLs saved), confirmed via save→fetch round trip. Confirmed the auto-resync-on-save wiring works: save now synchronously calls `generateProfile()` before responding, closing the staleness gap that was flagged earlier in the session. Confirmed via direct execution of the real, exported `formatSocialLinksContext()` function against real live-saved data that the context string is built correctly and reaches the synthesis prompt — not inferred from the model's prose output, which turned out to be an unreliable signal (a bare URL with no other context legitimately may not get mentioned in a rich synthesis, and didn't, on the first test).

**AI-picked business emoji — live, and the same-session bug is fixed and re-verified.** Original instruction text literally said *"a coffee bean for a coffee brand"* as its own example — Kopi Kita got 🫘 as a direct, findable result of that specific wording, not a model reasoning failure. Fixed in `b489dc4`: rewrote to prioritize recognizable association over literal/technical match, using the exact failure case as the corrected example. Re-tested for real against production immediately after: Kopi Kita now gets ☕, confirmed via a real screenshot of the live site.

**Nav/sidebar contrast fix (`54f9eff`) — re-verified against the real production site this session, not just earlier local screenshots.** Took a fresh screenshot directly against `prospector-chtj.onrender.com`: the business-list highlight and nav-item active state both read as obvious at a glance (bold accent-tinted background + thick border + bright bold text vs. plain/dim inactive rows) — not something requiring close inspection.

**Unchanged from the prior handoff, still true, not re-touched this session:** account-card-full-redesign-v2, global-workspace-navigation-v1, outreach-intelligence-v1, assay-engine-generalization-v1.

## 2. BROKEN

**Nothing currently broken in production.** The two real bugs found this session were both found, fixed, and live-verified within the same session (see LANDMINES for full detail on each): the `generateProfile()` token-truncation bug and the App.js infinite-render-loop bug. Neither is open.

**One real, occasional robustness gap, not fixed, flagged not chased:** a `generateProfile()` call failed once mid-session with a genuine JSON *syntax* error (not truncation — a malformed value mid-response). Immediate retry with identical input succeeded cleanly. Not systematic (confirmed by the retry), no retry-on-malformed-JSON mechanism exists in the code today. Low priority, real, worth knowing about if it recurs.

## 3. IN-PROGRESS / uncommitted

**Nothing from this session is uncommitted.** Every real change was build-gated, committed, and pushed individually. `git status` shows only the same three pre-existing untracked files carried across multiple prior sessions, none touched this session:
- `handoffs/2026-08-14-state-of-the-union-v3.md` — draft from a prior session, never committed.
- `specs/business-intel-smart-upload-v1-test-plan.txt` — Jack's own test-plan document, saved this session at his request but deliberately left uncommitted (his call on when to commit it).
- `supabase/migrations/20260805_team_users_identity.sql` — real, unapplied, carried across many sessions now, explicitly blocked on Jack's review. **Confirmed again this session it has not moved** — briefly got swept into a commit by an incautious `git add -A` early in the session, caught and corrected in the very next commit (see LANDMINES). Still untracked, unapplied, exactly as before.

## 4. COMMITTED+PUSHED

Confirmed via `git ls-remote origin main` = `b489dc49a04c3a516d1190d418b15dda386e04e5`, matching `git rev-parse HEAD` exactly.

Commits this session (chronological, abbreviated):
```
4310e50  Fix 1: schema migration for business-intel-smart-upload-v1
b5eeca6  Untrack two files accidentally swept in by Fix 1's git add -A
670e9ce  Fix 2: content-type classification on company_intel intake
7cdd1b9  Fix 3: generateProfile() outputs the 7 new distilled fields
3f0b16f  Fix 4: field-level source traceability + diff-check-on-write
6a93907  Fix 5: generateAssayCriteria() reads the 7 new profile fields
8aa1c94  Fix 6: visibility - new fields, hover-to-source, conflict banner
a9b86ee  Add pasteable-content-format convention to CLAUDE.md
310c640  business-intel-smart-upload-v1 follow-up: overview page width + Add Intel position
ab0126f  Fix: generateProfile() truncating on real documents - raise max_tokens
d90bc9a  Fix: full-depth profile synthesis timing out at 90s cap
efddc51  Fix: bound raw_synthesis length, cap products - root cause of both truncations
54f9eff  Strengthen nav active-state visibility (nav-active-state-v1)
ef195ba  Add earth-tone row to the shared business/project color picker
4bd59de  Add business social links - storage, popover UI, and synthesis context
e157645  Export formatSocialLinksContext() for direct verification
f9dd8db  Add AI-picked business emoji
2f7d46d  Fix infinite re-render/fetch loop on business-detail pages
b4dcbbc  Add profile-refresh trigger - one function, two entry points
b489dc4  Fix emoji instruction: prioritize recognizable association over literal match   ← current HEAD, matches origin/main
```

## 5. LANDMINES

**New this session:**

1. **`git add -A` swept in unrelated pre-existing untracked files once (`4310e50`), caught and corrected immediately (`b5eeca6`).** Root cause: the `/spec` skill's literal instructions say `git add -A`. CLAUDE.md's own git safety guidance (prefer targeted `git add`) should take precedence over a generic skill's literal step when the working tree has known pre-existing untracked files — this repo always does (see IN-PROGRESS). Every commit after this one in the session used targeted `git add <files>` instead. Future sessions running `/spec` or any skill that defaults to `-A` should check `git status` first.

2. **Full-log resynthesis architecture is a real, now-current cost problem, not a hypothetical future one.** `generateProfile()` re-sends the *entire* `business_intel_entries` log every single call. Real measured growth this session: input tokens climbed 6,143 → 22,784 across roughly a dozen real pastes into Master Magnetics alone. Real user-facing latency hit 115+ seconds on a "simple txt file upload" because the small new content still drags the whole growing history along. **Delta-synthesis was designed in detail this session (three specific design questions answered, ~55-90% input-token savings estimated) but deliberately NOT built** — Jack's explicit call, to avoid building a second consumer of manual-edit protection before confirming the first path (Pass 3, see below) actually works. Confirmed again just now: no `applyDeltaSynthesis` or equivalent function exists anywhere in the codebase. Still purely a design, not code. The natural build entry point is `api/businesses/profile-refresh.js`, deliberately documented in its own comment as the swap point.

3. **Manual-edit protection (Fix 6) has never been exercised with real data — confirmed via direct query just now.** All 7 `*_edited_manually` flags are `false` and `field_conflicts` is `{}` (empty, not null — meaning `generateProfile()` has run and initialized it, but no conflict has ever actually occurred) across all 4 real businesses. The UI renders correctly (screenshotted this session), the endpoints exist and build clean, but the actual "edit a field → paste conflicting intel → see the banner, not a silent overwrite" flow has never run for real. This is Jack's own "Pass 3" from `specs/business-intel-smart-upload-v1-test-plan.txt` — explicitly deferred by him mid-session specifically so delta-synthesis wouldn't get built on top of an unverified foundation. **Still open. This is very likely the single most valuable thing to verify next** (see NEXT ACTION).

4. **`generateProfile()`'s token/timeout ceiling has been raised twice this session and is now empirically-grounded, not guessed.** `max_tokens` 4096 → 8192 → 12000 → 20000 (light: 2048), `timeoutMs` 90s → 150s → 180s. The actual root cause of the two real truncation failures was `raw_synthesis` having no length cap in the prompt at all — that's fixed (~300-500 words now enforced in the prompt itself) and is the real fix; the raised ceilings are headroom on top of that, not a substitute for it. If truncation ever recurs, check whether some *other* field has gone unbounded before just raising the ceiling a third time.

5. **`social_links`-save and the manual "Refresh profile" button now both call `generateProfile()` synchronously** — meaning both can legitimately take up to ~3 minutes on a dense business. Both got the same elapsed-counter + progress-bar treatment as Add Intel/Smart Intake for exactly this reason. If a future session adds *another* trigger point for `generateProfile()`, it needs the same loading-state treatment — a static "Saving…"/"Loading…" label is a real, previously-reported UX complaint ("I don't really know if anything's happening"), not a nice-to-have.

6. **Content-type classification's deterministic fallback (`detectContentType()`) deliberately does NOT attempt to classify "pricing"** — dropped entirely (not tightened) per Jack's explicit call, since it's a legacy category not currently needed and the old bare-`$`-figure check false-matched on nearly any real document. `classifyIntake()`'s model-driven path (Smart Intake) still offers "pricing" as an option in its own prompt — only the heuristic fallback (Add Intel, intake-confirm's ambiguous-then-confirmed path) drops it. Don't "fix" this asymmetry without re-reading why.

7. **A real, live production bug (infinite re-render/fetch loop) was found and fixed this session, unrelated to any single feature — worth knowing the shape of it.** `App.js` passed `BusinessDetailPage` an inline `onUpdated` closure recreated on every render; `BusinessDetailPage`'s own `load()` `useCallback` depended on it, so its `useEffect([load])` re-fired every App.js render, calling `onUpdated` → `setActiveBusiness` → another App.js render, forever, gated only by network round-trip time (~230ms observed, matching hundreds of requests/minute observed live). Fixed by memoizing the handler with `useCallback([])` in App.js. **Any future prop passed into a component whose own `useEffect` depends on that prop's identity needs to be checked for this exact pattern** — an inline arrow function passed as a prop is the recurring shape of this bug class.

**Carried forward, unchanged, still real (from the 2026-08-17 handoff chain, not touched this session):**

8. `accounts.project_id` exists in the schema but is never written by any application code.
9. `ClaimJumperPage.js`'s Generate Email payload mismatch — still broken, decision (fix vs. remove) still pending.
10. Peter's and Cyrus's join links — still not independently verified.
11. The "5 dead API files" removal — still not independently re-verified whether it was actually carried out.
12. **Scout audit (`scout-audit-prompt.txt`) and Projects audit (`projects-audit-prompt.txt`) — confirmed genuinely never run in this session.** Searched the full repo for both filenames (no match anywhere) and reviewed this session's actual conversation for any request to run either audit — neither was ever received here. If Jack sent these, it wasn't to this session; worth checking whether they went to a different conversation, or whether they were only intended to be sent and never actually dispatched. Not something this session lost track of — genuinely never arrived.

## 6. NEXT ACTION

**Run Pass 3 of `specs/business-intel-smart-upload-v1-test-plan.txt` for real** — manually edit one profile field, confirm the edited-state visual holds, paste a note that would plausibly regenerate that field differently, confirm the result is either the protected manual value or a real conflict banner, never a silent overwrite. This is the single open piece of the whole `business-intel-smart-upload-v1` SPEC, it's cheap to check (no code changes anticipated, purely verification), and it's the explicit, deliberate gate Jack put in front of delta-synthesis — which is designed, real infrastructure is waiting for it (`profile-refresh.js`'s documented swap point), and is worth building once this is confirmed clean. Compare that to the other open items (Scout/Projects audits need a human decision about where they were meant to go; the dead API files/ClaimJumper items are real but not blocking anything else) — this is the one actually gating further work.
