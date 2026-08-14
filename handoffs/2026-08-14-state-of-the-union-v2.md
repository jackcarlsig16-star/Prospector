# Prospector — Verified State of the Union (v2)

**2026-08-14, later same session as the first handoff.** Every claim below was checked directly in the last few minutes before writing this — real Supabase queries (service-role), real Render API calls, real `curl` against `https://prospector-chtj.onrender.com`, real `git` state. No optimism, no "should work" — only what's been personally confirmed live.

---

## 1. ✅ Confirmed live and working right now

- **`external-api-foundation-v1`** — `callExternalApi` (retry-with-backoff on 5xx/network errors only, never 4xx), the integration registry, `checkCredentials()` startup check, and the generic webhook primitive. All verified this session with mocked-but-real code paths (not assumptions) and confirmed zero regression on the 8 pre-existing integrations (diffed `server.js`, only additive changes).
- **`call-log-v1`** — ingestion endpoint, participant-domain account matching, manual entry UI, Call Log view, manual reassignment. Verified live and repeatedly against real HumanKind and HomeLover data: auto-match via domain, unmatched-queue fallthrough, manual reassignment persisting, `recordAccountActivity()` firing correctly (confirmed via direct reads of `accounts.data.handoffNotes`). A real browser test (Playwright, not simulated) caught a genuine `call_date` timezone bug — fixed, rebuilt, re-verified live.
- **`zoom-business-attribution-and-reconciliation-v1`** — raw-event log (`zoom_webhook_events`, 13 columns, confirmed live), Tier 1/Tier 2 domain-matching logic (verified against real Supabase data: `peter@humankindcollective.app` → HumanKind via Tier 1; `evangeline@thecoconutcult.com` → HumanKind + The Coconut Cult via Tier 2, both in one step), transcript download/VTT-parsing (verified against a real WebVTT-format sample), and the Admin → Zoom Events reconciliation view. Deployed live at `d4ac17e`, confirmed via fresh Render deploy log.
- **Manual call-log path re-verified post-refactor**, live on prod, just now: `POST /api/businesses/{HomeLover}/call-log` → `200`, correct entry shape, test data cleaned up immediately after.
- **Google OAuth (Gmail/Calendar/Slides) is now correctly *configured*** — this changed since the last audit. `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REDIRECT_URI` are all now set on Render (they weren't a few messages ago). `GMAIL_REDIRECT_URI` is correctly set to `https://prospector-chtj.onrender.com/api/gmail/callback` — the right domain. Hit `/api/gmail/auth` live just now: it 302-redirects to a real, correctly-formed `accounts.google.com` consent URL with the right `client_id`, `redirect_uri`, and all three scopes (`gmail.modify`, `calendar.readonly`, `presentations`).
  - **What I did NOT and cannot verify: whether the OAuth flow was actually completed in a browser.** Tokens land in client-side `localStorage` only — there is no server-side trace of a successful callback (checked: the callback route doesn't log or persist anything server-side). I confirmed the flow is correctly wired up to reach Google's real consent screen. I have zero evidence either way on whether Jack (or anyone) has actually clicked through it. **Direct answer to the specific question asked: not confirmed complete.**
- **Peter's `approved_users` row is genuinely live** (`peter@humankindcollective.app`, `created_at: 2026-08-05T19:24:03Z`) — the `20260805_add_peter_approved_users.sql` migration's own claim of having been applied is independently confirmed true via a fresh query.

## 2. 🔴 Still broken, with the exact current blocker

- **Zoom live participant-matching is blocked on Zoom's account plan, not code.** Confirmed live with real credentials against a real meeting ID (`89857179661`): `GET /report/meetings/{id}/participants` → `400 {"code":200,"message":"Only available for Paid or ZMP account"}`. Both required OAuth scopes are genuinely granted (confirmed on a fresh token). This is a Zoom billing-tier gate, not a scope or code problem. Per your instruction, no further action needed until the HomeLover Zoom account upgrades — the code activates automatically, no changes required.
- **`team_users_identity.sql` migration is NOT applied.** Checked live: `team_users` has 10 columns, no `supabase_auth_id`. The file's own header says Step 1 (a duplicate-email check) must return zero rows before Step 2 (the actual `ALTER TABLE`) is safe to run — neither step has been run against the live DB. This is a real, unstarted piece of work, not finished and not abandoned — just never begun.
- **`CLAUDE.md`'s stale prod URL is still wrong.** Checked directly, line 83 still reads `https://prospector.onrender.com`. The real service, confirmed twice this session via Render's own API, is `https://prospector-chtj.onrender.com`. **Not fixed yet** — flagged in conversation, no edit made to the file.
- **The three dead Gmail files are still unflagged in the codebase itself.** `api/gmail/auth.js`, `api/gmail/callback.js`, `api/gmail/refresh.js` are confirmed unreferenced anywhere (real routes live inline in `server.js`), and `src/setupProxy.js` carries a third, scope-divergent copy for local dev only. Checked directly: no comment, marker, or note exists in any of these files, or in `CLAUDE.md`, warning that the first three are dead. Someone could still edit `api/gmail/auth.js` believing it's live and be confused when nothing changes in production.
- **HumanKind site research** — not re-checked this specific pass (already fixed and verified earlier this session via the Jina auth wiring); no new information since, not re-verified in this report to avoid re-treading already-confirmed ground.

## 3. 🟡 In progress but unfinished

- Nothing is silently half-built. Everything started this session (`external-api-foundation-v1`, `call-log-v1`, `zoom-business-attribution-and-reconciliation-v1`) reached a real, verified stopping point and was committed.
- The Zoom attribution/reconciliation system is **feature-complete but functionally idle** until the HomeLover Zoom account goes paid — this is an intentional, agreed-upon pause, not an unfinished build.

## 4. 📦 Committed and pushed vs. local-only

**Local HEAD matches `origin/main` exactly:** `d4ac17e4333293b7c4ba6245975a785a02de37df` — confirmed via direct `git rev-parse` on both.

**Committed and pushed this session:**
- `7b341f6` — Jina auth fix
- `675884f` — `external-api-foundation-v1`
- `938408e` — `call-log-v1`
- `6222110` — call_date timezone fix
- `d4ac17e` — `zoom-business-attribution-and-reconciliation-v1`

**Still uncommitted, local-only** (confirmed via `git status`, unchanged from the first handoff except one resolved):
- `supabase/migrations/20260805_add_peter_approved_users.sql` — **applied live, but the file itself still isn't committed.** Low risk (it's a no-op if re-run, `ON CONFLICT DO NOTHING`), but still only exists on this machine.
- `supabase/migrations/20260805_team_users_identity.sql` — **not applied, not committed.** Real pending work.
- `supabase/migrations/20260813_create_audit_rpcs.sql` — live and load-bearing (every `live-audit.js` call this session depended on it), still never committed.
- `scripts/live-audit.js` — used constantly this entire session for every live-verification claim in this report, still never committed. This is the single highest-risk uncommitted file given how central it's become to this project's actual verification workflow.
- `scripts/list-invite-candidates.js` — untested, uncommitted, unchanged from the first handoff.
- `handoffs/` directory itself, including both this file and the prior one.

## 5. ⚠️ Landmines and gotchas for next session

1. **`CLAUDE.md`'s prod URL is wrong** (`prospector.onrender.com` vs. the real `prospector-chtj.onrender.com`). Anyone trusting that doc for a Google/Zoom/anything redirect-URI setup will get a mismatch error. Fix this file directly next time it's touched.
2. **Three copies of the Gmail/Calendar OAuth flow exist, two of them dead or dev-only, all using the same env var names but different scope strings.** `server.js` (live) requests `gmail.modify` + `calendar.readonly` + `presentations`. The dead `api/gmail/*.js` files and `setupProxy.js` (local dev) both request only `gmail.readonly` + `calendar.readonly` — missing `presentations`, and read-only instead of read-write on Gmail. If local dev behavior ever looks different from prod, this drift is why.
3. **`scripts/live-audit.js` is this project's actual verification backbone now** and has zero commit history. A fresh clone or lost machine loses the tool every real claim in this session was checked against. Commit it before anything else risky happens.
4. **Zoom's OAuth token grants both needed scopes correctly** (`cloud_recording:read:recording:admin`, `report:read:list_meeting_participants:admin`) but a *third*, different scope (`cloud_recording:read:list_recording_files:admin`) is needed for the recording-*details* REST endpoint specifically — not currently granted, and not needed for production (the real webhook payload carries `recording_files` directly), but it blocks any future attempt to backfill-test against a past meeting via REST the way this session tried to. Worth knowing if that comes up again.
5. **`fileCallLog()` in `api/businesses/call-log.js` is now the single source of truth for filing a call** — both the manual UI and the Zoom pipeline call it. Any future third caller (a hypothetical Google Meet integration) should call this function too, not reimplement filing.
6. **The reconciliation view's manual "Assign & File" only works for events that haven't been filed yet** (`call_log_entry_id IS NULL`). Reassigning an *already-filed* Zoom-sourced call to a different account still has to happen from the business's own Call Log view (`call-log-reassign.js`), not from Admin → Zoom Events. This was a deliberate scope decision, not an oversight — but it's easy to forget which UI does which job.

## 6. Peter's and Cyrus's join links — still not independently verified

Checked `business_members` fresh, just now: both rows are **byte-identical to the very first check this session** — same `created_at` timestamps (`2026-08-13T23:42:28Z` for Peter, `2026-08-13T23:49:32Z` for Cyrus), no new activity. **Nothing has changed since the original open question was raised.** There is no evidence in this session — from me, from Jack, or from the data — that either join link has actually been clicked and completed by a real person. This remains exactly as uncertain as it was at the start of the session.

## Single next action for next session

**Commit `scripts/live-audit.js`.** It's the tool this entire session's verification discipline depends on, it has zero git history, and every other item on this list is lower-stakes than losing it. After that: either run `team_users_identity.sql`'s Step 1 duplicate-check (a pure `SELECT`, zero risk) to see if Step 2 is even safe to attempt, or fix `CLAUDE.md`'s stale URL — both are small, cheap, and currently just sitting there.
