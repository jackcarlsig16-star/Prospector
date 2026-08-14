# Prospector — State of the Union
**2026-08-13, end of session.** Everything below was verified directly this session (real Supabase queries, real anon-key credential, real Playwright runs against `https://prospector-chtj.onrender.com`, or `git ls-remote`) — re-confirmed fresh in the last few minutes before writing this, not pulled from memory of earlier in the session.

---

## ✅ Confirmed live and working right now

- **`accounts` table is fully usable via the anon key** (the credential the browser actually uses) — real insert/select/delete cycle succeeded. Two separate real bugs were found and fixed this session:
  - A leftover `accounts.project_id NOT NULL` constraint from the older, unfinished `real-supabase-auth-v1` SPEC — dropped, confirmed via real insert.
  - Missing anon RLS policies on `accounts` (present on `projects`/`businesses`, never added here) — added, confirmed via a real anon-key insert/select/delete, not just a service-key check.
- **Track A — web_search fix**: `allowed_callers: ["direct"]` on `web_search_20260209`. Confirmed via a real full-depth research run completing in 74s (vs. the old 90s hang), with real web-search-derived content and a real `business_anthropic_usage` row logged.
- **navigation-restructure-v1**: persistent sidebar, Businesses list, Projects nested under a business. Verified live in a real browser.
- **business-workspace-v1**: Accounts/Search/Generation/Command-Center tools scoped per business. Verified with a real account created on HomeLover, a real persisted Supabase row, a real Anthropic-generated outreach email, and a real `no_fintech` disqualifier from `assay.js` on a live test account.
- **business-nav-architecture-v1**: sidebar swaps into a business's own nav on selection, lands on Command Center by default, disabled legacy tools are visibly non-interactive, exit-to-global works, and — after a real bug was found and fixed (below) — direct business-to-business switching works.
- **Command Center rebuild (Option 2)**: all six widgets (Scout, Today's Goals, Calendar, Brief, Deal Alerts, Diamonds) render inside a business. Confirmed via side-by-side screenshot comparison that Today's Goals/Calendar/Brief show **identical** data to the global HomePage (same `0/2, 0/3, 0/5, 0/3, 0/1` stats, same Calendar/Brief connect-prompts) — proving shared state, not a fake copy. Deal Alerts/Diamonds confirmed to remain genuinely business-scoped (different text/computation than the global versions). The "🌐 Shared across all businesses" label is present exactly 3 times, correctly.
- **`scripts/live-audit.js`** — `table`, `remote`, and `deploy` subcommands are built and were used successfully multiple times this session (including to confirm the deploys underlying every claim above). **Not yet committed** — see "In progress" below.
- Current deployed bundle (`main.348c76fb.js`) contains the string `"Shared across all businesses"`, confirming the live site genuinely matches the latest commit — not stale.

## 🔴 Still broken, with the exact current blocker

- **`project_members` table**: every query (even a real `select`, not just count) returns `PGRST205: Could not find the table 'public.project_members' in the schema cache`. This was flagged, "fixed" (per user report), and re-checked **three separate times** this session — still broken as of the final check just now. This blocks the "+ New Project" flow inside a business (part of navigation-restructure-v1's Projects nesting) — clicking it will fail. Root cause was never conclusively identified (unlike `accounts`, where the two real causes were found and fixed) — worth a from-scratch schema/RLS check next session, not another blind `NOTIFY pgrst, 'reload schema';`.
- **`live-audit.js`'s `rls` and `schema` subcommands**: depend on the RPC functions in `supabase/migrations/20260813_create_audit_rpcs.sql`. That migration was written but **never confirmed run** — no verification attempt was made this session. Untested, not committed.
- **`EmailGenerator.js`'s static template library**: confirmed via source reading — every one of 18 templates hardcodes fintech pitch language ("connect to bank data," "financial data infrastructure") regardless of business. Known limitation, explicitly deferred to `generalize-legacy-functions-v1`, not a bug to fix now.
- **`assay.js` scoring**: confirmed via a real live test — auto-disqualifies non-fintech businesses with reason code `no_fintech`. Same deferral as above.

## 🟡 In progress but unfinished

- **`scripts/live-audit.js`** (the toolkit itself) and **`supabase/migrations/20260813_create_audit_rpcs.sql`**: both written, both still untracked in git, never committed. `table`/`remote`/`deploy` work; `rls`/`schema` are unverified.
- Local `.env` was modified this session — added `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` so `live-audit.js table` and local Playwright testing could hit real Supabase data. **Not committed** (`.env` is gitignored, correctly) — a fresh clone or different machine won't have these and will need them re-added for local live-testing to work.

## 📦 Committed/pushed vs. local-only

**Pushed to `origin/main`, verified via `git ls-remote` (current HEAD = `e870066344ba689f106a53ee70e2494a413a9156`):**
```
e870066  Build out full business Command Center to match global HomePage (Option 2)
f7ad634  Fix stale in-flight fetch stomping activeBusiness on direct business switch
b7be869  Move business workspace navigation into the Sidebar (business-nav-architecture-v1)
eb8a722  Add accounts anon RLS migration (business-workspace-v1, part 3)
d2549e0  Scope Command Center per business (business-workspace-v1, part 2)
a233b3d  Scope accounts, search, and generation tools per business (business-workspace-v1, part 1)
99988ca  Restructure navigation: persistent sidebar, nest Projects under Businesses
0cbb8b3  Fix web_search hang by forcing direct calls instead of dynamic filtering
```

**Untracked / local-only (not committed):**
- `scripts/live-audit.js` — built, partially tested, not committed.
- `supabase/migrations/20260813_create_audit_rpcs.sql` — written, not run, not committed.
- `scripts/list-invite-candidates.js`, `supabase/migrations/20260805_add_peter_approved_users.sql`, `supabase/migrations/20260805_team_users_identity.sql` — **pre-existing, from an earlier unrelated `real-supabase-auth-v1` SPEC.** Deliberately untouched all session per standing instruction — not mine to commit, don't bundle them in accidentally next session either.

## ⚠️ Landmines / gotchas for next session

- **Real prod URL is `prospector-chtj.onrender.com`** — not `prospector.onrender.com` (stale, returns no-server routing).
- **`head:true` count checks are proven unreliable** — they returned no error for a table that doesn't exist at all. Always verify with a real `select` (or now, `scripts/live-audit.js table <name>`).
- **A PGRST205 error can have three different real causes**, not just schema-cache staleness: (1) genuine cache staleness (fixed with `NOTIFY pgrst, 'reload schema';`), (2) a NOT NULL constraint rejecting every insert silently, (3) missing RLS policies for the anon role. `accounts` turned out to be (2) and (3), not (1) — don't assume a `NOTIFY` will fix everything that looks like a schema-cache error. `project_members` is still unresolved and may be a different cause entirely.
- **The `real-supabase-auth-v1` migration chain added a `project_id` column (and eventually NOT NULL) to five tables**: `accounts`, `team_users`, `frontier`, `bdr_assignments`, `handoff_intel`. Only `accounts` was checked and fixed this session. **The other four were never checked** — if any of those save flows seem to silently fail, this is the first thing to check.
- **Local CRA dev server (`npm run dev`) has no backend** — any `/api/*` call 404s instantly instead of racing like it does against the real Render backend. A bug that only manifests under real network latency (like the business-switch race condition found this session) will **not** reproduce locally — go straight to live testing if something "works locally but user reports it broken."
- **Local dev needs `REACT_APP_SUPABASE_URL`/`REACT_APP_SUPABASE_ANON_KEY` in `.env`** to hit real Supabase data (added this session, not committed — see above).
- **Playwright + Chromium are installed locally but not in `package.json`** (`npm install --no-save playwright` + `npx playwright install chromium`) — a fresh environment will need to reinstall both for live browser verification.
- **Reliable recipe for scripted browser testing against this app**: seed `localStorage` with `prospector_user` (a full user object), `prospector_gate_unlocked` set to the literal string `"true"` (not `"1"`), and `prospector_prefs` with a `masterCode` already base64-set — otherwise a one-time "MASTER CODE" banner overlay blocks the whole page. All three are required together.
- **In CRA dev mode only**, the ESLint error overlay (`#webpack-dev-server-client-overlay`) can silently intercept Playwright's coordinate-based clicks. Use `.evaluate(el => el.click())` or remove the overlay element directly. Does not happen against the production build.
- **The dynamic AI generation path (`AccountCardComms`, "Outreach" mode) is not fintech-biased** — confirmed with two real Anthropic calls on non-Plaid test accounts, it asked for more context rather than hallucinating a Plaid pitch. This is better news than assumed for `generalize-legacy-functions-v1` — the real rework needed is in `EmailGenerator.js`'s static templates and `assay.js`'s scoring, not the dynamic generation prompt itself.

## ➡️ Single next action for next session

**Do a from-scratch schema/RLS audit of `project_members`** (real `select`, then check `information_schema`/`pg_policies` once the `rls`/`schema` `live-audit.js` commands are confirmed working — which itself requires running `supabase/migrations/20260813_create_audit_rpcs.sql` first). This has been reported "fixed" three times this session without ever actually being fixed — it needs a different diagnostic approach next time, not another `NOTIFY pgrst, 'reload schema'` guess. Once resolved, commit `live-audit.js` + its RPC migration, then proceed to `business-access-and-lists-v1`, which is otherwise unblocked.
