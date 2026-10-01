# prospector-full-audit-v1 — Report

Run 2026-10-01 by Claude Code against `main` @ 17a38b0. Read-only: no code changes, no migrations, no DB writes, **0 Apollo calls**.
Live reads used: ~126 count/policy requests (42 tables × 3, head-only counts, 111 s), 3 schema RPCs, 1 HomeLover accounts read + 1 stored Apollo snapshot read (A10), 3 access_log counts, 11 local timed GETs, and 2 unauthenticated probes of prod (one `POST /proxy/anthropic/messages` with an empty body — rejected by Anthropic, 0 tokens; one `GET /api/access-log` — only the entry count and field names were printed). No secrets are printed anywhere in this report.

Severity: **P0** security / data loss / prod breakage now · **P1** real bug or significant risk · **P2** debt that will hurt soon · **P3** cleanup. Every recommendation is **NOT DECIDED**.

---

## 1. Executive summary (for Jack)

1. **Anyone on the internet can spend your Anthropic credit.** The AI proxy has no login check; I confirmed it forwards an anonymous request to Anthropic with your key. This is the most urgent item.
2. **Anyone with the public browser key can read, change, or delete 18 database tables** — accounts, businesses, projects, prospects, outreach doctrine, members. That key ships inside the website's JavaScript. Sales Analytics tables are *not* affected (they're locked down correctly).
3. **The access log is public**: one URL returns the last 50 login attempts with IP addresses and partial codes.
4. **There is no real login.** "Who you are" and "are you an Admin" are just values saved in your browser; anyone can edit them. The Admin portal is protected by the browser, not the server.
5. **The team list has never saved to the database since Aug 5.** `team_users` has 0 rows because a migration made `project_id` required; every save fails silently. That's why the Users tab shows seed data ("Casey") and why each browser sees a different team.
6. **Users tab bugs explained**: you appear twice because the "YOU" card and the team list both render you; the second "Admin" badge is actually the make-admin toggle button; "Import team (4)" imports four fake `@example.com` sample users; "Calrson" is a typo in your saved profile data, not in code.
7. **Admin has 14 tabs (not 13), and 3 of them are blank** — Territories, Nuggets and Removed have a tab button but no page behind it.
8. **The left menu is built from two lists that overlap** (global tools + per-business nav), which is why businesses appear twice and global tools reappear as disabled items. A cleaner structure is proposed in section 4.
9. **No tests, no CI, no error tracking.** The only automated check is a file-size gate. 205 empty `catch {}` blocks in the frontend hide failures from users.
10. **Accounts ↔ Apollo**: only 7 of 65 HomeLover accounts match an Apollo account by domain today; the domain lives in an untyped JSON field (`data.web`) and no Apollo id is stored.

---

## 2. Top 15 findings

| ID | Sev | Area | Finding | Evidence | Recommendation (NOT DECIDED) |
|---|---|---|---|---|---|
| F1 | P0 | Security | `/proxy/anthropic/messages` is unauthenticated and forwards any body (any model, any size, streaming) with the server's `ANTHROPIC_API_KEY`. | `server.js:30-77`; live probe → HTTP 400 *from Anthropic* (`"model: Field required"`), i.e. the request reached Anthropic. | Gate the proxy (session check / same-origin + shared secret), allowlist models, cap `max_tokens`. Interim: rate-limit by IP. |
| F2 | P0 | Data | 18 tables grant `anon` full SELECT/INSERT/UPDATE/DELETE with `USING true`; the anon key is public in the bundle. Includes `accounts`(129 rows), `businesses`(4), `projects`(8), `business_members`(2), `outreach_doctrine`(7), `prospects`(14). | A5 table below (policy dump via `audit_table_policies`); anon head-count succeeded on each. | Move writes server-side (service key) and drop anon write policies; scope reads per tenant once real auth exists (feeds prospector-auth-v1). |
| F3 | P0 | Security | `GET /api/access-log` is public: returns 50 rows with `ip_address`, `user_agent`, `code_partial`. `POST` is also open (anyone can inject entries). | `api/access-log.js:15-40`, wired `server.js:387-388`; live probe → 200, 50 entries. | Require admin auth on GET; validate/rate-limit POST. |
| F4 | P1 | Identity | No server-verified identity anywhere. User, role and Admin status come from `localStorage.prospector_user`; Admin page gate is `isAdmin(user)` client-side. | `src/App.js:103`, `src/App.js:1417`, `src/constants/appConfig.js:54` | prospector-auth-v1 (Supabase Auth or similar) — server-checked sessions and roles. |
| F5 | P1 | Data | `team_users` has 0 rows: `team_users.project_id` is NOT NULL (set by 20260805_enforce…, never relaxed for this table), and `saveTeamUsers` never sends `project_id`, so every upsert fails and is swallowed by `console.warn`. Also the root cause of the "team_users onboarding 400s". | `supabase/migrations/20260805_enforce_project_id_not_null.sql` (team_users line); `20260814_drop_stale_project_id_not_null.sql` covers only frontier/bdr_assignments/handoff_intel; `src/utils/db.js:42-70`; live schema shows `project_id!`. | Drop the NOT NULL on team_users (same reasoning as the 08-14 migration). |
| F6 | P1 | Data | `saveTeamUsers` *replaces* instead of merging: an empty list deletes every row; otherwise deletes all rows not in the caller's list. Violates the "Supabase merges, never replaces" rule; with `team_users` policy `ALL public true`, any browser can wipe the table. | `src/utils/db.js:47-49`, `src/utils/db.js:64-66`; policy dump: `team_users ALL:{public}:true` | Upsert-only from client; deletions as explicit single-row admin actions server-side. |
| F7 | P1 | Security | OAuth tokens (Gmail access + **refresh** token, SFDC token) are passed back in the redirect query string, so they land in Render request logs and browser history before the client scrubs them. | `server.js:222-228` (Gmail), `server.js:318-319` (SFDC); scrub at `src/App.js:267-270` | Store tokens server-side (sfdc_tokens already exists) or return via a one-time code / fragment. |
| F8 | P1 | Admin | 3 of 14 Admin tabs render nothing: Territories, Nuggets, Removed have tab buttons but no `tab===` render branch. Territory state/handlers still exist (dead). | Tab list `src/components/AdminPage.js:770-789`; render branches exist only for users/orgchart/permissions/apikeys/pricing/access/accesslog/zoomevents/doctrine/onboarding/settings (`:820-1233`); territory state `:568-572` | Remove or rebuild (see C2). |
| F9 | P1 | Data | `approved_users` is readable by anon (policy `SELECT public true`, 2 rows of approvals/emails). | A5 policy dump | Fold into auth work; revoke anon read. |
| F10 | P1 | Ops | 2 untracked migrations: `20260820_influencer_scrape_flag` **is applied** in prod but its code (uncommitted diffs in `api/businesses/shared.js`, `CreatorFitRelationship.js`) has never shipped; `20260805_team_users_identity` is **not applied** (no `supabase_auth_id`) and does not fix F5. | A6; live `audit_table_schema` on both tables; `git diff --stat` (81+/9−) | Jack decides: ship the influencer work or revert the columns; keep 20260805 for the auth spec. |
| F11 | P2 | Quality | Zero automated tests; no CI. Only gate is pre-commit `check-size.js`. `@testing-library/*` installed but unused. | `find src api -name '*.test.*'` → none; `.husky/pre-commit` → `npm run precommit`; no `.github/` | Code-health spec: tests for pure logic first (heatScore, nextBestAction, insightRules, csv, emailCounts). |
| F12 | P2 | Quality | 205 empty `catch {}` blocks in `src/`; 43 `console.warn`-only catches in `db.js` — Supabase failures are invisible to the user (F5 went unnoticed for ~2 months this way). No error tracking. | `grep -rnoE 'catch *(\(…\))? *\{ *\}' src` → 205; `grep -c "console.warn('\[db\]" src/utils/db.js` → 43 | Surface DB save failures; add lightweight error reporting. |
| F13 | P2 | Nav | Menu built from two overlapping sources: global `NAV` (10 items, 1 permanently disabled) and `BUSINESS_NAV` (6). Business mode re-lists businesses under "Other Workspaces" and re-shows 7 global tools disabled under "Not Yet Available". | `src/constants/appConfig.js:14-25`, `src/constants/businessNav.js:14-21`, `src/components/Sidebar.js:20,88,99,112` | prospector-nav-admin-cleanup-v1 (section 4). |
| F14 | P2 | Perf | Main bundle 2.05 MB raw / 531 KB gzip in one chunk; reads that will hit PostgREST's 1,000-row cap silently: `sales_metrics_daily` already at 850 rows with no truncation warning on `/metrics`. | `build/static/js/main.*.js`; `api/sales/routes.js:55-57`; A5 row count | Code-split by route; add the same 1000-row warning `/huddle` has, then paginate. |
| F15 | P2 | Deps | `pptxgenjs` (0 imports, **high** advisory) and `@dnd-kit/sortable`, `@dnd-kit/utilities` unused. `npm audit --omit=dev`: 50 (2 critical, 26 high) — the 2 criticals (`shell-quote`, `websocket-driver`) come via `react-scripts`' dev server chain, not the prod server. | A3 import scan; `npm audit --omit=dev` | Remove unused deps; plan CRA → Vite migration separately. |

---

## 3. Parts A–D

### Part A — Inventory

**A1 Repo map.** CRA SPA (`src/`, entry `src/index.js` → `src/App.js`); Express server `server.js` (718 lines) serves `build/` and every API route; `api/` = 92 ESM handler files wired by hand (`esHandler` string paths, `server.js:377`; landmine noted in CLAUDE.md). No client router: pages are `page` state in `App.js` (`App.js:1405-1420`) and `view`/`businessPage` state inside `BusinessDetailPage.js`. Deploy: `render.yaml` → `npm install && npm run build`, `npm start` (`node --dns-result-order=ipv4first server.js`). Also present: a second `migrations/` folder at the repo root (1 file, `001_approved_users.sql`) separate from `supabase/migrations/`, plus `pricing-tool.html`, `mockups/`, `handoffs/`.

| Area | Files | Lines |
|---|---|---|
| `src/` (frontend) | 246 | 55,978 |
| `api/` | 92 | 9,101 |
| `server.js` | 1 | 718 |
| `supabase/migrations/` | 58 | 2,336 |
| `scripts/` | 11 | 1,130 |

**A2 Largest files.** Warn gate 1,500 / block 3,000 (`scripts/check-size.js:6-7`). **None over 1,500, but `AdminPage.js` is at 1,499** — one line from the warn gate. 15 files over 800:

| Lines | File |
|---|---|
| 1499 | src/components/AdminPage.js |
| 1431 | src/App.js |
| 1385 | src/components/PricingPage.js |
| 1269 | api/businesses/shared.js |
| 1200 | src/utils/db.js |
| 1174 | src/components/LedgerPage.js |
| 1089 | src/components/CalendarWidget.js |
| 1035 | src/components/AccountsPage.js |
| 1026 | src/components/BusinessDetailPage.js |
| 996 | src/components/pricing/ProposalBuilderModal.js |
| 978 | src/components/FrontierPage.js |
| 977 | src/components/IntelligencePage.js |
| 929 | src/components/ProductionRequestsPage.js |
| 900 | src/components/TaskPanel.js |
| 863 | src/components/DealExportModal.js |

Next 10 (≤800): ROIPage 770, ActionItemsTab 762, HomePage 751, CallPrepModal 732, server.js 718, DailyDigest 709, pricing/CalcTab 698, ClaimJumperPage 675, HandoffsPage 667, AnalyticsPage 664.

**A3 Dependencies.** Imported: `@supabase/supabase-js`, `express`, `node-cron`, `dotenv`, `react`, `react-dom`, `react-markdown`+`remark-gfm` (Scout), `emoji-picker-react`, `@dnd-kit/core` (LedgerPage, OrgChart), `web-vitals`. **Unused:** `pptxgenjs`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, all four `@testing-library/*`. No duplicate libraries for the same job (no chart lib — charts are hand-rolled SVG; no date lib). `npm audit --omit=dev`: 12 low / 10 moderate / 26 high / 2 critical; direct deps flagged high: `pptxgenjs` (fix 4.0.0), `react-scripts` (no non-breaking fix).

**A4 Routes.**
*Frontend* (no URLs; state-driven): global pages `home, accounts, claimjumper, uploads, analytics, intelligence, outbound, team, ideas, ledger, tools, admin, handoffs` (`App.js:1405-1420`). Hidden-but-routable (no menu entry): `claimjumper`, `uploads`, `analytics` (`appConfig.js:47-50`), reachable via the Tool Chest/Intelligence sub-menus (`Sidebar.js:143-172`). Business pages: `command-center, overview, accounts, projects, members, sales-analytics` (`businessNav.js:15-20`); `calendar` is permanently disabled.
*Backend* (~95 routes, `server.js:30-659`). Gate summary:

| Gate | Routes |
|---|---|
| Tenant allowlist (`SALES_ANALYTICS_BUSINESS_IDS`) | all 26 `/api/sales/:businessId/*` (`api/sales/{routes,huddleRoutes,trendRoutes,pipelineRoutes}.js` `checkAllowlist`) |
| Signature check | `POST /api/zoom/webhook` (`api/zoom/webhook.js:18-40`) |
| Bearer token from the *caller* (user's own Google token, passed through) | `/proxy/gmail/*`, `/proxy/gcal/events` (`server.js:106-169`) |
| OAuth flow | `/api/gmail/{auth,callback,refresh}`, `/api/sfdc/{auth,callback}` |
| **NONE** | everything else — incl. `/proxy/anthropic/messages`, `/proxy/jina`, `/api/access-log` (GET+POST), `/api/email`, `/api/businesses/*` (≈25 routes, incl. writes), `/api/projects/*`, `/api/campaigns/*`, `/api/zoom/events*`, `/api/notify-pending` (posts to Slack), `/api/notify-approved`, `/api/sfdc/sync-now`, `/api/hunter/*`, `/api/databricks/*`, `/api/handoff` (CORS `*`, `server.js:400-409`) |

Basic Auth: none on `main` (parked on branch `prospector-basic-auth-v1`, 55f8056).

**A5 Database** (42 tables in the PostgREST schema; live counts 2026-10-01).

| Table | Rows | Anon access | Policies | Code refs |
|---|---|---|---|---|
| accounts | 129 | **R/W/D** | anon ALL `true` | 35 (`src/utils/db.js`, `api/businesses/*`) |
| account_business_details | 48 | **R/W/D** | anon ALL `true` | 7 |
| account_influencer_details | 26 | **R/W/D** | anon ALL `true` | 7 |
| account_lists | 104 | **R/W/D** | anon ALL `true` | 10 |
| lists | 12 | **R/W/D** | anon ALL `true` | 9 |
| member_list_permissions | 4 | **R/W/D** | anon ALL `true` | 4 |
| businesses | 4 | **R/W/D** | anon ALL `true` | 27 |
| business_profiles | 4 | **R/W/D** | anon ALL `true` | 25 |
| business_members | 2 | **R/W/D** | anon ALL `true` | 3 |
| business_intel_entries | 52 | **R/W/D** | anon ALL `true` | 10 |
| business_anthropic_usage | 160 | R + insert | anon SELECT/INSERT | 1 |
| projects | 8 | **R/W/D** | anon ALL `true` | 23 |
| campaigns | 3 | **R/W/D** | anon ALL `true` | 8 |
| outreach_doctrine | 7 | **R/W/D** | anon ALL `true` | 9 |
| voice_profiles | 1 | **R/W/D** | anon ALL `true` | 3 |
| plospect_compliance | 0 | **R/W/D** | anon ALL `true` | 4 |
| prospects | 14 | **R/W/D** | anon ALL `true` | **0 — unreferenced** |
| outreach_drafts | 0 | **R/W/D** | anon ALL `true` | **0 — unreferenced** |
| approved_users | 2 | **R** | public SELECT `true`; ALL for service_role | 2 |
| team_users | 0 | R/W/D (0 rows) | **public ALL `true`** | 10 |
| access_log | 582 | none (RLS, no policy) | none | 2 (server only) |
| bdr_assignments, frontier, handoff_intel | 0 each | none | none | 3–4 each (client writes silently fail — RLS on, no policy) |
| sfdc_tokens | 0 | none | none | 3 |
| zoom_webhook_events | 0 | none | none | 9 |
| sales_* (17 tables) | 0–850 | none | none (server-only, correct) | sales routes |

sales_* row counts: metrics_daily 850, email_daily_counts 263, email_activity 178, email_messages 133, prospect_state 112, raw_snapshots 61, prospect_events 17, sync_runs 16, sequence_tags 9, email_backfill_weeks 6, huddles 3, events 1, opportunities 1, opportunity_events 1, collateral 0, insight_dismissals 0.
B5 anon-exposure categories (no data shown): account/company intel and scores; business profiles and strategy; member/permission lists; outreach rules and voice samples; AI usage logs; prospect contact rows (`prospects`, 14 rows, name/email-type CRM fields per `20260805_prospects_crm_fields.sql`).

**A6 Migrations.** 58 files in `supabase/migrations/`, applied by hand in the SQL editor (no migration tracking table). Spot-checked live:
- `20260820_influencer_scrape_flag.sql` — **APPLIED** (`scraped_email/company/url/at` exist on `account_influencer_details`). Code that uses it is uncommitted (A9).
- `20260805_team_users_identity.sql` — **NOT APPLIED** (no `supabase_auth_id`; no `team_users_email_key`). It would add a nullable `supabase_auth_id` FK to `auth.users` and a UNIQUE(email). It does **not** touch `project_id`, so it doesn't fix F5.
- `20260805_enforce_project_id_not_null.sql` — applied for `team_users` (live `project_id` NOT NULL); `20260814_drop_stale_project_id_not_null.sql` reversed it only for frontier/bdr_assignments/handoff_intel.
- Full drift check of all 58 files: **UNKNOWN** (no applied-migrations ledger; would need a per-file schema diff — out of this audit's budget).

**A7 Integrations.**

| Integration | Status | Secrets referenced (names only) | Failure handling |
|---|---|---|---|
| Anthropic proxy | Live, **unauthenticated** (F1) | `ANTHROPIC_API_KEY` (15 refs) | Pass-through status; 55 s timeout → 504 |
| Apollo (Sales Analytics) | Live | `APOLLO_API_KEY` | Sync runs recorded in `sales_sync_runs`; manual "Sync now" |
| Gmail OAuth + proxies | Live | `GMAIL_CLIENT_ID/SECRET`, `GMAIL_REDIRECT_URI` | Errors → `/?gmail_error=`; tokens in URL (F7) |
| SFDC OAuth + sync | Partial (`sfdc_tokens` 0 rows; cron uses stored token, else skips) | `SFDC_CLIENT_ID/SECRET`, `SFDC_REDIRECT_URI`, `SF_ORG`, `SF_CLI_MODE` | Cron logs + skips (`api/sfdc/sync-compliance.js:43-52`) |
| Zoom webhook | Wired, **not configured** locally ("NOT configured — missing ZOOM_*" at boot); `zoom_webhook_events` 0 rows | `ZOOM_ACCOUNT_ID/CLIENT_ID/CLIENT_SECRET/WEBHOOK_SECRET_TOKEN` | Signature-verified |
| Resend | **Dead** — only TODO comments | none | `api/notify-approved.js:7,16` |
| Google Calendar | Partial — read-only `/proxy/gcal/events` with the user's Gmail token; `CalendarWidget` used on 3 pages; the global "Calendar" nav item is disabled | (uses Gmail token) | Pass-through |
| Jina reader | Live, unauthenticated open fetch proxy | `JINA_API_KEY` | 12 s timeout |
| Hunter, Glean, Databricks/Gong | Wired, open routes; live status UNKNOWN (no env locally) | `HUNTER_API_KEY`, `GLEAN_*`, `DATABRICKS_*` | per-handler |
| Slack (access requests) | Live if `SLACK_WEBHOOK_URL` set | `SLACK_WEBHOOK_URL` | warn-only |

**A8 Scheduled jobs** (only fire while the Render Free instance is awake):
1. `0 */6 * * *` — SFDC compliance sync (`server.js:671-681`).
2. Daily 06:00 America/Los_Angeles — Sales Analytics Apollo sync per allowlisted business (`server.js:687-714`). "Daily sync missed" alert is off (`src/components/salesAnalytics/alertRules.js:18`).

**A9 Uncommitted / stale work** (pre-dates this session):

| File | Diff | Read |
|---|---|---|
| `api/businesses/shared.js` | +66: influencer bio-URL scrape (`SCRAPE_EXCLUDED_HOSTS`, `BIO_URL_PATTERN`) + `detected_company` prompt field | Looks finished (influencer-scrape-flag-v1); DB already migrated |
| `src/components/accountCard/influencer/CreatorFitRelationship.js` | shows scraped email/company pills; `id` on bio textarea | Finished, same feature |
| `src/components/AccountCard.js`, `accountCard/actions/PrimaryAction.js` | "Assess this creator first" CTA becomes clickable (`muted`) and scrolls to the bio box | Finished (influencer-assess-cta-dead-end-fix-v1) |
| `supabase/migrations/20260820_influencer_scrape_flag.sql` | untracked | Applied in prod (A6) |
| `supabase/migrations/20260805_team_users_identity.sql` | untracked | Not applied; prep for auth |
| `.s1.cjs` | 20-line ad-hoc Supabase script (2026-08-25) | Scratch — abandoned |
| `Claude outputs/sales-analytics-design-v1.txt` | spec copy | Reference, stale |
| `specs/design/sales-analytics-mockup.html` | the visual reference the build queue points at | Should be tracked |
| `specs/business-intel-smart-upload-v1-test-plan.txt`, 2 `audits/*-findings.txt` (Aug 17–20) | docs | Finished docs never committed |

**A10 Accounts module.** Tables: `accounts` (129; columns `id, owner_email, data jsonb, updated_at, project_id, business_id, last_touched_by, last_touched_at, account_kind, relationship_type`), `account_business_details` (score/tier/business_model/fit_*/disqualifier), `account_influencer_details`, `account_lists` + `lists` + `member_list_permissions`. Almost everything lives in `accounts.data` jsonb — HomeLover's 66 accounts carry keys incl. `web, name, vert, stage, tier, score, sigs, pf, bm, linkedin, sfdc, listIds` plus 22 accounts with full assay intel (`businessModel, productFit, signalBreakdown, …`) and legacy fintech fields (`bankConnectSignal` on 20). Intel/assay: `api/assay.js`, `src/utils/assay.js`, `api/businesses/shared.js` (assay criteria). Outreach drafting: `api/email.js` (single engine), `voice_profiles`, project/campaign `outreach-examples*` routes (`server.js:447-452`), `outreach_doctrine` (platform rules). SFDC links: `data.sfdc` (61 of 66), `api/sfdc/*`.
**Join keys to Apollo:** domain (`accounts.data.web` → hostname; Apollo `accounts` snapshot `domain`), company name, or an Apollo `account_id/organization_id` (**not stored anywhere on Prospector accounts**). **HomeLover match count by domain: 7 of 65 accounts with a domain** (Apollo snapshot: 315 accounts / 310 distinct domains). Name match vs huddle prospect companies: 1.

### Part B — Identity, users and roles

**B1 Where "who is the user" is decided.**

| Source | Where | Trust |
|---|---|---|
| Gate unlock | `localStorage.prospector_gate_unlocked === "true"` (`ProspectorGate.js:11-20`) | Client-only; settable in devtools |
| Master code | `prospector_prefs.masterCode` = `btoa(code)` (`src/utils/invites.js:96-106`) | Client-only; base64, not a hash |
| Legacy invite codes | `REACT_APP_INVITE_CODES` (`ProspectorGate.js:15-17`) | Any value is compiled into the public bundle by design of CRA. Whether it's set on Render: **UNKNOWN** (not found by static scan of the minified live bundle; not in local `.env`) |
| Current user (name/email/role) | `localStorage.prospector_user` (`App.js:103`), role forced to Owner only for `OWNER_EMAILS = ["aowner@example.com"]` (`appConfig.js:70`) — a placeholder, so **no real owner exists** | Client-only |
| Member session | `localStorage.prospector_member` (`App.js:107`, `ProspectorGate.js:359`) | Client-only |
| Team list | `team_users` (0 rows, F5) → falls back to `localStorage.prospector_team_users` → `SEED_TEAM_USERS` (`App.js:662`) | Client-only, per-browser |
| "Who changed it" (Sales Analytics) | `currentUserLabel()` reads `prospector_user`/`prospector_member` (`src/components/salesAnalytics/huddleApi.js:13-22`) | Self-reported, sent in body |
| Bottom-left user card ("Admin · PROSPECTOR") | `activeUser.role` + `company` from the same localStorage user (`Sidebar.js`) | Client-only |
| Approval | `team_users.status` (`db.js:687-697`) + `prospector_approved` cache | Reads a table nobody can write (F5) |

**B2 Role model.** Roles are strings: `AE, BDR, Manager, Admin, Owner` (`appConfig.js:28-50`). `isAdmin = role in {Admin, Owner}` (`appConfig.js:54`). Differences are UI-only: `ROLE_PERMS` booleans (`canAdmin`, `canClaim`, …) and `NAV_ROLES` per page. Business ownership = `businesses.owner_email === user.email` (`Sidebar.js:82`). **Enforcement: client UI only** — no server route checks a role. The only server-side gate on user data is the Sales Analytics tenant allowlist.

**B3 Users tab bugs.**
- *Jack twice*: the "YOU" card renders `currentUser` unconditionally (`AdminPage.js:836-845`, with a hardcoded "owner" label at `:845`), and the TEAM list renders all `users` without excluding the current user (`:848-852`).
- *Two Admin badges*: one is the role chip (`{u.role}`), the other is the make-admin **toggle button**, labelled "⚙ Admin" when the role is Admin (`AdminPage.js:874-880`).
- *Casey*: `SEED_TEAM_USERS` (`appConfig.js:63-65`) is the fallback when no team list exists; since `team_users` can't be written (F5), the seed survives in localStorage.
- *Import team (4)*: imports `SMB_TEAM` — four hardcoded sample users (`srivera@`, `aowner@`, `jlee@`, `tkim@example.com`) (`appConfig.js:56-61`, passed at `App.js:1417`, handler `AdminPage.js:719-729`).
- *"Calrson"*: not present anywhere in code → it's in your saved `prospector_user`/team data (typed at onboarding). Exact origin UNKNOWN.

**B4 team_users onboarding 400s.** Root cause = F5: `team_users.project_id` NOT NULL (from `20260805_enforce_project_id_not_null.sql`) and neither `saveTeamUsers` (`db.js:50-58`) nor `registerUser` (`db.js:699+`) send a `project_id` → "null value in column project_id violates not-null constraint". The 2026-08-14 fix migration covered three other tables only. `20260805_team_users_identity.sql` does **not** address it.

**B5 Tenancy.** A business is selected client-side (sidebar → `activeBusiness`, `BusinessDetailPage` `business.id`); there are no URL params. Server-side tenant scoping exists **only** for `/api/sales/*` (allowlist env var). The Sales Analytics nav item additionally hardcodes HomeLover's id client-side (`businessNav.js:20`) — a second copy of the allowlist. Every other business endpoint (`/api/businesses/:id/*`) takes the id from the URL with no ownership check, and the 18 anon-writable tables (A5) let any client read/write any tenant's rows directly. Leak risk: **yes**, by design today.

**B6 What real login would touch** (no design): `ProspectorGate.js` (gate, codes, master code), `src/utils/invites.js`, `App.js` user/member state + onboarding + `isAdmin` gating, `MemberShell.js`, `Sidebar.js` user card, `AdminPage.js` (Users, Permissions, Invites, Onboarding, Access Log tabs), `admin/AdminInvites.js`, `src/utils/db.js` (team_users, approvals, `getUserApprovalStatus`, `registerUser`), `api/access-log.js`, `api/notify-pending` (`server.js:625`), `api/notify-approved.js`, `api/businesses/join.js` (join codes), `business_members`/`member_list_permissions`, every `/api/*` route listed as NONE in A4, `/proxy/anthropic`, and the RLS policies on the 18 tables. `huddleApi.currentUserLabel()` and every `updated_by`/`changed_by` field would switch to the real identity.

### Part C — Navigation and Admin IA

**C1 Left menu.** Visit counts: **UNKNOWN for every item** — there is no page-view tracking. `access_log` only records gate events (`success`/`session`/`attempt`; last 30 days: 2 / 101 / 102). Note: the POST is open and coerces unknown events to `attempt` (`api/access-log.js:21`), so even those counts can't be trusted.

| Mode | Label | Route (state) | Component | State |
|---|---|---|---|---|
| Global | Businesses list (Kopi Kita, HumanKind, HomeLover, Master Magnetics) | `activeBusiness` | `Sidebar.js` → `BusinessDetailPage` | live |
| Global | Portfolio | `home` | `HomePage` | live |
| Global | Accounts (+ Territory, Prod. Requests) | `accounts` | `AccountsPage`, `ProductionRequestsPage` | live |
| Global | Ledger | `ledger` | `LedgerPage` | live (AE/Mgr/Admin) |
| Global | Outbound | `outbound` | Outbound page | live |
| Global | Ideas | `ideas` | Ideas page | live |
| Global | Handoffs | `handoffs` | `HandoffsPage` | live (AE/Mgr/Admin) |
| Global | Intelligence (+ Analytics, Profile, "<company> Knowledge") | `intelligence` | `IntelligencePage`, `AnalyticsPage` | live |
| Global | Tool Chest (+ Deal Workspace, Account Lookalike, Email Generator) | `tools` | tools | live |
| Global | Calendar | — | — | **disabled** (`appConfig.js:23`) |
| Global | Admin | `admin` | `AdminPage` | live (Admin/Owner) |
| Hidden | claimjumper, uploads | routable, no menu item | `ClaimJumperPage`, `UploadsPage` | legacy (ClaimJumper = known removal candidate) |
| Business | Command Center | `command-center` | `BusinessCommandCenterTab` | live |
| Business | Business Intel & Strategy | `overview` | business overview | live |
| Business | Accounts | `accounts` | `BusinessAccountsTab` | live |
| Business | Projects | `projects` | projects | live |
| Business | Members | `members` | `MembersPermissionsTab` | live (owner only) |
| Business | Sales Analytics (Overview / Daily Huddle) | `sales-analytics` | `SalesAnalyticsTab` | live (HomeLover id hardcoded) |
| Business | "Other Workspaces" | — | re-lists businesses | **duplicate** (`Sidebar.js:88`) |
| Business | "Not Yet Available" (7 items) | — | `DISABLED_BUSINESS_NAV` = global NAV minus home/accounts/admin | **disabled duplicates** (`Sidebar.js:20,99`) |

**C2 Admin tabs — 14, not 13** ("Onboarding" was missed in the screenshot list). The "DATA overlaps Users underline" glitch: likely cause (inferred from code, not reproduced) — the tab-group row is `flexWrap:"wrap"` (`AdminPage.js:798`), so at narrower widths the DATA group wraps onto a second line, where its label sits on top of the TEAM row's underline. Visit counts: UNKNOWN (no tracking).

| Group | Tab | What / data source | Works? | Last change | Suggestion |
|---|---|---|---|---|---|
| TEAM | Users | team list; `team_users` (0 rows) → localStorage | Partially — never persists (F5), duplicate self (B3) | 00f0305 (2026-08-18, file) | keep → **Account & Users** |
| TEAM | Org Chart | `admin/AdminOrgChart.js`, team list | Renders; data client-only | c47d490 (2026-08-05) | merge into Users |
| TEAM | Permissions | `ROLE_PERMS`/`rolePerms` (client) | Renders; enforces nothing server-side | — | merge into Users (roles) |
| TEAM | Territories | localStorage `prospector_territories` | **Blank** (no render branch) | — | remove |
| PLATFORM | API Keys | client-stored keys + SFDC tools | Renders | — | → Integrations |
| PLATFORM | Pricing | pricing files (localStorage) | Renders | — | → Billing/Pricing |
| PLATFORM | Invites | `admin/AdminInvites.js`, `invites.js` | Renders | c47d490 | → Account & Users |
| PLATFORM | Access Log | `/api/access-log` | Works (public endpoint, F3) | — | → System logs |
| PLATFORM | Zoom Events | `zoom_webhook_events` (0 rows) | Works, empty | d4ac17e (2026-08-13) | → Integrations |
| PLATFORM | Outreach Intelligence | `outreach_doctrine` | Works | 00f0305 (2026-08-18) | move out of Admin → per-workspace/Data |
| PLATFORM | Onboarding | pending approvals | Renders; approvals can't persist (F5) | — | → Account & Users |
| DATA | Nuggets | nuggets (localStorage) | **Blank** | — | remove or move to profile |
| DATA | Removed | removed-accounts blocklist | **Blank** | — | rebuild as "Data → Restore" or remove |
| DATA | Settings | prefs | Renders | — | → System |

**C3 Global header.** The header is `PersistentScout` → `ScoutCommandBar` (`App.js:1366`, `MemberShell.js:112`). "Active/Qualified" vs "Full territory" is a scope toggle (`ScoutCommandBar.js:296-297`): narrow = accounts whose stage is in the active layers (`src/utils/scoutLayers.js:15-18`), full = all. "N deals in scope" = that filtered count (`ScoutCommandBar.js:176-179, 313`). It differs by page because the account set differs: on global pages it's your personal territory (`accounts` in localStorage → 0 for you), on a business page it's that business's Supabase accounts (65 for HomeLover) (`PersistentScout.js:12-17`). It knows nothing about Apollo/Sales Analytics data, so on Sales Analytics it's unrelated to what's on screen.

**C4 Floating widgets.**
- 🐞 **Bug reporter** (bottom-right, `BugReporter.js:22`, mounted `App.js:1429`): saves reports to `localStorage.prospector_bug_reports` and **nothing ever reads them** — reports go nowhere. Not production-ready.
- ☕ **Daily Digest** (bottom-right above the bug, `DailyDigest.js:369-401`, mounted `App.js:1428`): AI morning brief from accounts/tasks/Gmail threads. Real feature; placement is the question.
- **Yellow asterisk (top-right)**: **not found in app code** — no fixed top-right element matches, and it doesn't appear in a clean Playwright session. Most likely a browser extension in Jack's Chrome. UNKNOWN.

### Part D — Code health and reliability

**D1 Duplicated logic.**
- `laDateString` ×2: `api/sales/laDate.js:6` and `src/components/salesAnalytics/periods.js:11`.
- `checkAllowlist` + `getSupabase` copied in 4 sales route files (`api/sales/{routes,huddleRoutes,trendRoutes,pipelineRoutes}.js`); `createClient(SUPABASE_URL, SERVICE_KEY)` constructed in 7 api files.
- Fetch wrappers: `salesApi.js`, `huddleApi.js`, `pipelineApi.js` each wrap `fetch` + error shaping separately.
- Tenant allowlist: env var server-side + hardcoded id in `businessNav.js:20`.
- Theme tokens: `src/constants/colors.js` (`C`, 138 importers), `src/constants/tokens.js`, `src/components/salesAnalytics/theme.js` (`SA`, 20 importers), `HOLO` in `VeinMap.js`.
- Week math lives once on the server (`api/sales/emailCounts.js:38`), reused by `insightRules.js` — good; `insightRules.js:189` recomputes day-of-week inline.
- CSV: shared `src/utils/csv.js` (`toCsv`/`parseCsv`) — good; `UploadsPage.js` still has its own legacy parser (noted in `csv.js` header).

**D2 Dead code** (landmines in CLAUDE.md respected: `db.js:583-603` subscriptions and `api/zoom/client.js:6` are intentional, not listed).
- `src/components/AccountCardPricingSummary.js` — no importers.
- Admin territory state/handlers (`AdminPage.js:568-572`) behind a tab that never renders.
- `BugReporter` sink (localStorage, never read).
- Tables `prospects` (14 rows) and `outreach_drafts` (0) — no code references (the `prospects` string in `api/sales/adapters/prospects.js:3` is an adapter name, not this table).
- `ClaimJumperPage.js` — known removal candidate (memory), still routed.
- Flags permanently set: `OUTREACH_MATRIX_ENABLED = true` (`BusinessAccountsTab.js:23`); `STALE_SYNC_ALERT_ENABLED = false` (`alertRules.js:18`, deliberate per Jack).
- Unused deps (A3). Legacy fintech fields in account data (`bankConnectSignal` on 20 HomeLover accounts).

**D3 Error handling.** API: every `esHandler`/`salesModuleRoute` call is wrapped in try/catch → 500 JSON (`server.js:377-385, 600-609`), so routes don't crash the process. Frontend: 205 empty `catch {}` blocks; `db.js` has 43 `console.warn`-only catches — saves fail with no UI signal (F5 is the proof). No React error boundary (`grep ErrorBoundary|componentDidCatch` → none), so one render error blanks the app.

**D4 Performance** (local server → live Supabase, single run each):

| Route | Time | Payload |
|---|---|---|
| insights | 1.29 s | 6 KB |
| runs?limit=10 | 1.22 s | 7 KB |
| entities | 1.02 s | 7 KB |
| huddle | 1.01 s | 129 KB |
| email-counts | 0.86 s | 7 KB |
| metrics (2-month window) | 0.78 s | **287 KB** |
| cohort-breakdown | 0.63 s | <1 KB |
| collateral | 0.53 s | <1 KB |
| opportunities | 0.50 s | <1 KB |
| events | 0.33 s | <1 KB |

(Prod adds Render latency: insights was ~2.7 s measured on prod in REV2.) N+1: none found in sales routes (all `Promise.all` batch reads). Unbounded selects: `/huddle` reads full `sales_email_messages`/`sales_email_activity`/`sales_prospect_state` per request but warns at 1,000 rows; `/metrics` has no warning and the table is at 850 (F14). Bundle: `main.js` 2.05 MB raw / 531 KB gzip, plus 14 small chunks.

**D5 Testing.** No test files. No CI (`.github/` absent). Husky pre-commit runs only `check-size.js`. Biggest untested risks: heat score + Next Best Action rules, insight rules R1–R10, CSV export quoting, Apollo sync idempotency, `saveTeamUsers`/account merge logic, assay scoring.

**D6 Consistency.** Three styling systems: global CSS (`src/index.css`, 36 lines; **body font is monospace** — `'SF Mono', ui-monospace…` at `index.css:17-19`, with 4 Google Font imports), the legacy `C`/`mono` HUD tokens (`constants/colors.js`, 138 importers), and Sales Analytics' `SA` tokens + Geist (20 importers). 161 component files use inline styles; 115 `className=` uses total. Everything outside `src/components/salesAnalytics/` still uses the old HUD look.

**D7 Logging and observability.** 28 `console.log` in `api/`+`server.js`, 7 in `src/`. No logs print secret *values* found by grep (token counts only, e.g. `shared.js:648`). Risks: `[anthropic-proxy] error body` logs Anthropic's full error body (`server.js:49`); OAuth tokens reach Render request logs via the redirect URL (F7); `/api/notify-pending` logs name/email of every access request (`server.js:628`). No error tracking (no Sentry or similar).

---

## 4. Proposed nav + admin IA (C5) — NOT DECIDED

```
LEFT MENU (one structure, workspace-first)
├─ Workspace switcher (dropdown at top: Kopi Kita · HumanKind · HomeLover · Master Magnetics · + New)
├─ <Active workspace>
│  ├─ Command Center
│  │   ├─ Overview          (today's Command Center)
│  │   ├─ Sales Analytics   (HomeLover only — was its own menu item)
│  │   └─ Daily Huddle      (was a tab inside Sales Analytics)
│  ├─ Accounts
│  ├─ Projects
│  ├─ Intel & Strategy
│  └─ Members              (owner only)
├─ My Tools (only items that actually work cross-workspace)
│  ├─ Portfolio · Ledger · Outbound · Handoffs · Tool Chest
│  └─ (no disabled items; Calendar hidden until it exists)
└─ Admin (Admin/Owner only, bottom)

ADMIN PORTAL
├─ Account & Users      Users (roles inline) · Invites · Onboarding/approvals · Org chart
├─ Workspaces           Businesses · ownership · members · join codes
├─ Integrations & Keys  API keys · SFDC · Gmail · Zoom events · Apollo status
├─ Data                 Outreach doctrine · Restore removed accounts · Nuggets (if kept)
├─ Billing / Pricing    Pricing files
└─ System               Access log · Settings · Sync runs
```

Rationale: (1) one place to pick a workspace instead of two business lists; (2) disabled "Not Yet Available" items are removed rather than shown — they're roadmap, not navigation; (3) Sales Analytics and the Huddle were always meant to live under Command Center, so they move there as sub-pages; (4) Admin is regrouped around who-can-do-what (Account & Users) because that's exactly what prospector-auth-v1 will rebuild; (5) blank tabs (Territories, Nuggets, Removed) are either removed or rebuilt under Data; (6) Outreach Intelligence is a content tool, not admin, so it moves to Data now and maybe to a workspace page later; (7) the Scout bar should either scope to the active page's data or hide on pages it can't search (Sales Analytics).

---

## 5. Suggested follow-on SPECs (order)

1. **prospector-security-hotfix-v1** — gate `/proxy/anthropic` + `/proxy/jina`, lock `GET /api/access-log`, move OAuth tokens out of redirect URLs (F1, F3, F7). Small, urgent, independent of auth.
2. **prospector-auth-v1** — real logins/sessions, server-checked roles, user/role manager; replaces the parked Basic Auth branch; applies 20260805_team_users_identity (F4, F9, B6).
3. **prospector-rls-lockdown-v1** — drop anon write policies on the 18 tables, move writes server-side, tenant-scoped reads (F2). Depends on 2 for per-user scoping.
4. **prospector-team-users-fix-v1** — drop `team_users.project_id` NOT NULL, make `saveTeamUsers` upsert-only, dedupe self in Users tab, remove seed/sample users (F5, F6, B3).
5. **prospector-nav-admin-cleanup-v1** — section 4 IA, remove blank tabs, fix the DATA label overlap (F8, F13, C4).
6. **prospector-code-health-v1a (tests + errors)** — unit tests for pure logic, React error boundary, surface DB save failures (F11, F12).
7. **prospector-code-health-v1b (deps + perf)** — remove unused deps, row-limit warnings/pagination for metrics, route-level code splitting (F14, F15).
8. **prospector-code-health-v1c (dedupe + dead code)** — shared sales route helpers + fetch wrapper, single theme, remove dead files/tables after Jack's call (D1, D2).
9. **prospector-uncommitted-work-v1** — decide and ship/revert the influencer scrape + assess-CTA diffs and commit or delete the untracked docs (F10, A9).

## 6. Open questions for Jack

1. F1/F3 are live exposures. Do you want the security hotfix (spec 1) jumped ahead of hot-prospects 4c?
2. The uncommitted influencer scrape + assess-CTA work (A9): ship it, or revert the 4 applied DB columns?
3. Do you recognise the yellow asterisk at top right? It isn't in the app code — is it a Chrome extension?
4. Should the 🐞 bug reporter send reports somewhere real (Slack/Supabase), or be removed?
5. Tables `prospects` (14 rows) and `outreach_drafts` (0) have no code references — archive and drop?
6. Is `REACT_APP_INVITE_CODES` set on Render? If yes, those codes are public in the bundle.
7. Do you want page-view tracking (counts only) so the next nav/admin decisions have real usage data?
