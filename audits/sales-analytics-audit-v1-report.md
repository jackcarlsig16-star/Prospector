# sales-analytics-audit-v1 — Findings Report

Read-only audit. No code, migrations, or Supabase/Render/Apollo writes were made. Every
claim below is a real query, RPC call, or file:line citation run/checked in this session.
Scope, cost, and cap were declared before any live call (see A6).

---

## A1 — Tenancy, auth, RLS

**a. Tenant table.** `businesses` is the tenant table. PK is `id` (`uuid`, `NOT NULL`,
`default gen_random_uuid()`) — confirmed via `audit_table_schema('businesses')`; it is the FK
target of `business_members.business_id` (`-> businesses.id`), confirming it's the real PK,
though no direct `information_schema.table_constraints` PRIMARY KEY check was available
without a new RPC (out of scope for a read-only audit — see Open Questions).

Real query, `businesses` table, all 4 rows (id + name only):
```
bc69beab-effd-452d-9e81-fd652333bb95 | HomeLover
981b790c-a3b0-4265-b32e-1f701d5731ff | HumanKind
0e653c05-8492-496e-a3e2-37fdeffc10d1 | Kopi Kita
a73a493f-6db3-49e6-b962-d6fa29cf779e | Master Magnetics
```
HomeLover's id: `bc69beab-effd-452d-9e81-fd652333bb95`.

**b. User↔business mapping, and can anyone but Jack log in today?**

There is **no real authenticated-identity system**. Confirmed by grep: zero matches for
`supabase.auth.` or `auth.users` anywhere in `src/`, `api/`, or `server.js`. "Login" is two
separate, unauthenticated mechanisms:

1. **A single shared access-code gate**, app-wide, not per-business — `src/components/ProspectorGate.js:7-30`. `GATE_KEY = "prospector_gate_unlocked"` is a plain
   localStorage flag; once set `true`, the whole app unlocks for that browser. No password,
   no session token, no Supabase Auth call.
2. **An email-keyed "member" concept**, layered on top, via a `/join/:code` invite flow
   (`ProspectorGate.js:262-285`, sets `prospector_member`/`prospector_user_email` in
   localStorage) and the `business_members` table (schema: `id, business_id -> businesses.id,
   email, name, created_at`).

Which businesses a given email can see is computed **entirely client-side**, in
`src/utils/db.js`:
- `getBusinessesForUser(email)` (`db.js:976-990`) — owner path: `.eq('owner_email',
  email.toLowerCase())` on `businesses`.
- `getBusinessesForMember(email)` (`db.js:998-1020`) — union of owned businesses + businesses
  joined via `business_members.email`.

This is **application-level filtering, not database-enforced scoping** — see A1c/A1d.

Real data: `business_members` has exactly 2 rows today, one of which is already HomeLover-scoped:
```
business_id: bc69beab-...bb95 (HomeLover)  | name: Cyrus Radjoo   | email: [8-char local]@gmail.com
business_id: 981b790c-...31ff (HumanKind)  | name: Peter Norgaard | email: [5-char local]@humankindcollective.app
```
`approved_users` (the allowlist gating who can join at all) has 2 rows: one `role: Admin`
(`@gmail.com`), one `role: Member` (`@humankindcollective.app`). No row named "Seif" exists in
either table today. So: **yes, someone other than Jack can reach the member path today** — a
real row (Cyrus Radjoo) is already scoped to HomeLover specifically — but this has never been
exercised with a Supabase Auth session; it's an email string matched client-side against an
unauthenticated localStorage flag.

**c. RLS — for every public table.**

Enumerated all 26 tables via the project's OpenAPI schema (`GET /rest/v1/` with the service
key — standard PostgREST introspection, read-only). For each, ran a real row fetch (not
`head:true` — per the repo's own documented false-positive history) with the **service-role
key** (bypasses RLS) and the **anon key** (the same key shipped in the public JS bundle,
subject to RLS), plus `audit_table_policies()` (the existing `pg_policies` RPC,
`supabase/migrations/20260813_create_audit_rpcs.sql`). No RPC exists to read
`pg_class.relrowsecurity` directly without writing a new one, which this audit's read-only
scope forbids — the anon-vs-service comparison below is the empirical proxy used instead.

**Result: RLS effectively does not gate tenant access on any table that holds real
sales/account/business data.** 18 of 26 tables have an `anon` policy set with `qual: "true"` /
`with_check: "true"` on SELECT, INSERT, UPDATE, and DELETE — i.e. the public anon key can
read, write, and delete every row in every business's data, with zero tenant scoping. Verbatim
policies, `businesses` table (identical shape repeats on `accounts`, `business_members`,
`business_profiles`, `projects`, `campaigns`, `lists`, `prospects`, and 8 more):
```
anon_read_businesses    [SELECT]  roles: {anon}  USING: true
anon_write_businesses   [INSERT]  roles: {anon}  WITH CHECK: true
anon_update_businesses  [UPDATE]  roles: {anon}  USING: true  WITH CHECK: true
anon_delete_businesses  [DELETE]  roles: {anon}  USING: true
```
Confirmed live, not just in policy text: anon-key row count matched service-role row count
exactly on every one of these 18 tables (e.g. `businesses`: svc=4, anon=4; `accounts`: svc=129,
anon=129; `business_members`: svc=2, anon=2).

`team_users` (0 rows currently) has one policy, also fully open: `team_users_allow_all [ALL]
roles: {public} USING: true WITH CHECK: true`.

`approved_users` (2 rows) is partially better: `approved_users_read [SELECT] roles: {public}
USING: true` (still open read) but `approved_users_admin_write [ALL] roles: {public} USING:
(auth.role() = 'service_role'::text)` — write is actually locked to service role.

The one table that's genuinely locked down: **`access_log`** — zero policies, and real
evidence it's enforced, not just empty: service-role saw 378 real rows, anon-key saw 0. Since
RLS-disabled + zero policies would let the default table grant through (anon would see rows),
this 378-vs-0 gap is real proof RLS is *enabled* with no anon policy on this one table.

5 tables (`bdr_assignments`, `frontier`, `handoff_intel`, `sfdc_tokens`,
`zoom_webhook_events`) returned 0 rows for both service and anon keys — genuinely empty right
now, so whether RLS is blocking or the table is just unused can't be distinguished from this
evidence alone (flagged, not claimed either way).

This directly confirms and extends the prior `campaign-layer-v1` finding cited in this audit's
landmines (no permission gating on `projects`/`outreach_rules`) — it is not isolated to those
two tables, it is the default shape of this database.

**d. How the client scopes queries to "the current business" today.**

Plain `.eq('business_id', businessId)` / `.eq('owner_email', email)` filters, written by hand
into each query in `src/utils/db.js` — e.g. `fetchAccountsForBusiness()` (`db.js:278-296`,
`.eq('business_id', businessId)`), `getBusinessesForUser()`/`getBusinessesForMember()`
(`db.js:976-1020`, above). Nothing enforces this at the database layer — per A1c, the same
table is fully readable/writable without that filter by anyone holding the anon key (which is
not a secret; it ships in the client bundle by design).

**e. Name collisions / existing opportunity-pipeline-deal table.**

All 26 real public tables, confirmed via the OpenAPI schema dump:
```
access_log, account_business_details, account_influencer_details, account_lists, accounts,
approved_users, bdr_assignments, business_anthropic_usage, business_intel_entries,
business_members, business_profiles, businesses, campaigns, frontier, handoff_intel, lists,
member_list_permissions, outreach_doctrine, outreach_drafts, plospect_compliance, projects,
prospects, sfdc_tokens, team_users, voice_profiles, zoom_webhook_events
```
**No collision** with any of `sales_sync_runs`, `sales_raw_snapshots`, `sales_metrics_daily`,
`sales_metric_targets`, `sales_opportunities`, `sales_opportunity_events`,
`sales_weekly_reports` — none of those names exist today.

**No dedicated opportunity/pipeline/deal table exists.** The closest thing is a client-side-only
concept: `DEAL_STAGES` (`src/components/accountCard/business/BusinessStateControls.js:6-11` —
`Prospecting`, `Engaged`, `Needs Follow-up`, `Active Deal`, `Qualified`, …), which is a UI
constant applied to an account's stage, stored inside the `accounts` row's own data (not a
separate table, not synced from SFDC or Apollo). `campaigns` exists but is an outreach-pitch
concept nested under `projects` (per its own code comment at `db.js:900-906`), not a sales
deal/opportunity.

---

## A2 — Command Center structure

**a. Where it renders, how tabs are defined, how a tab is added.**

There isn't one Command Center — there are three separate components sharing the name:
- **Per-business** (most likely the one the SPEC means): `BusinessCommandCenterTab.js`,
  rendered inside `BusinessDetailPage.js:779` — `{view === 'command-center' && (<>...
  <BusinessCommandCenterTab .../> </>)}`.
- **Manager's team-wide dashboard**: `ManagerCommandCenter.js`.
- **BDR's dashboard**: `BdrCommandCenter.js`, rendered inside `HomePage.js`.

Tabs for the per-business one are defined in a single flat array,
`src/constants/businessNav.js:10-16` (`BUSINESS_NAV`), consumed by both `Sidebar.js:82` (owner
session) and `MemberShell.js:44` (joined-member session) — the file's own header comment notes
this was deduplicated from two copies in `global-workspace-navigation-v1`. Adding a tab means
adding one object to that array (`{ id, ic, lb }`, optionally `ownerOnly: true`); both nav
renderers pick it up automatically. The tab's actual view is wired by adding a matching `view
=== 'your-id'` branch in `BusinessDetailPage.js` (same pattern as the existing
`command-center`/`accounts`/`projects`/`members`/`overview` branches, `BusinessDetailPage.js:779-790`).

**b. Can tabs be shown per business today (e.g. HomeLover only)?**

No. `BUSINESS_NAV` is one shared array for every business; the only existing conditional is
`ownerOnly` (gates the "Members" tab by **role**, not by which business is active) —
`Sidebar.js:82`: `BUSINESS_NAV.filter(n=>!n.ownerOnly || (activeBusiness.owner_email||"")...)`.
Nothing today filters a nav entry by `business.id` or `business.name`. Showing a tab for
HomeLover only would need new logic — none of that logic exists yet.

**c. Route/URL pattern.**

There is none. Confirmed by grep: zero matches for `react-router`, `BrowserRouter`,
`<Route`, `useParams`, or `pushState` anywhere in `src/`. Navigation is plain in-memory React
state in `App.js` — `page` (top-level: `"business-detail"`, etc.) and `businessPage` (the
per-business sub-tab, passed to `BusinessDetailPage` as `view` —
`App.js:1419`). The browser URL never changes; a refresh returns to whatever the app's default
landing state is, not back to the tab/business the user was on.

---

## A3 — Server-side execution, secrets, scheduling

**a. Supabase Edge Functions.** Not in use. `supabase/` contains only a `migrations/` directory
(53 files) — no `functions/` directory, no `config.toml` anywhere in the repo. The Supabase CLI
is not installed (`supabase --version` → `command not found`), so there's no linked project ref
to check either. All server-side execution today is the one persistent `server.js` Express
process (per CLAUDE.md, confirmed by `render.yaml`'s `startCommand: npm start` → `node
server.js`).

**b. Server-side secrets — env var names only (service.js + api/*, no values):**
```
server.js:  ANTHROPIC_API_KEY, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI,
            JINA_API_KEY, PORT, SFDC_CLIENT_ID, SFDC_CLIENT_SECRET, SFDC_REDIRECT_URI,
            SLACK_WEBHOOK_URL, SUPABASE_SERVICE_KEY, SUPABASE_URL
api/*:      ANTHROPIC_API_KEY, COMPANY_DOMAIN, DATABRICKS_CALLS_TABLE, DATABRICKS_HOST,
            DATABRICKS_PATH, DATABRICKS_TOKEN, GLEAN_API_TOKEN, GLEAN_BASE_URL,
            GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, HUNTER_API_KEY, JINA_API_KEY, SF_CLI_MODE,
            SF_ORG, SUPABASE_SERVICE_KEY, SUPABASE_URL, ZOOM_WEBHOOK_SECRET_TOKEN
```
No `APOLLO_API_KEY` is read anywhere in the current codebase. Locally these live in a
gitignored `.env` (only 4 of the above are actually set locally: `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` — confirmed by
byte-length check, values never printed). In production these would come from Render's env var
dashboard, per CLAUDE.md ("Jack also sets Render env vars himself") — that dashboard state is
not visible from this repo or from any tool available in this session (no Render CLI, no
Render API token present).

**c. `.env` gitignored? Secrets in git history?**

Yes, gitignored — `.gitignore:16-20`:
```
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
```
Ran `git log --all -p -S"<pattern>"` for five likely key-shape patterns (`sk-ant-`,
`SUPABASE_SERVICE_KEY=`, `ANTHROPIC_API_KEY=`, a Supabase JWT prefix, `APOLLO_API_KEY`) across
the entire history. **None found in any commit.** (Report is yes/no + pattern only, per the
audit's own rule — no values or file diffs reproduced here.)

**d. Scheduling.**

- **`pg_cron`/`pg_net` availability: could not verify.** Both `pg_available_extensions` and
  `pg_extension` are catalog views, not `public`-schema tables — PostgREST doesn't expose them,
  and no RPC wrapping them exists (only the two schema/policy RPCs from
  `20260813_create_audit_rpcs.sql`). This session has no raw Postgres connection either: no
  `psql`, no `pg` npm package installed, no `DATABASE_URL` anywhere in the repo or `.env`.
  Writing a new introspection RPC would answer this directly but is a schema change, out of
  scope for a read-only audit — flagged under Open Questions instead.
- **An existing in-process scheduler already runs today**: `node-cron` (`server.js:5`,
  already a `package.json` dependency) — `server.js:506`, `cron.schedule('0 */6 * * *', ...)`
  runs `syncAllCompliance()` (SFDC compliance) every 6 hours, inside the same persistent Express
  process. No Render Cron Job service is defined in `render.yaml` (only one `type: web`
  service exists in the whole file), and no GitHub Actions exist — `.github/workflows/` doesn't
  exist in the repo.
- **Render service type/plan, as visible from the repo:** `render.yaml` defines exactly one
  service — `type: web`, `runtime: node`, `buildCommand: npm install && npm run build`,
  `startCommand: npm start`. No plan/tier field is present in the file (Render plan tier is an
  account/dashboard-level setting, not expressed in `render.yaml`) — not visible from this
  repo.

**e. Supabase Vault.** Could not verify — same limitation as pg_cron/pg_net: `pg_extension` is
not queryable without raw SQL or a new RPC, neither available under this audit's read-only
scope.

**f. Aug 23 upgrade-or-restrict status.** Not visible from the repo or from any tool in this
session — that's Supabase account/billing-dashboard state, not something the REST API or this
repo exposes. What I *can* say: every live query this session (26-table sweep, 4 schema/RPC
calls) returned normal `200`s with real data — no restricted-mode error, rate-limit block, or
degraded response was encountered. That's weak positive evidence at best, not confirmation.
Flagged for Jack under Open Questions, as the AUDIT file already anticipated.

---

## A4 — Frontend conventions

**a. TS or JS? Feature folders?** Plain JS — `find src -name "*.ts" -o -name "*.tsx"` returns 0
files. No `src/features/` directory exists. Real layout:
```
src/
  App.js, App.css, index.js, index.css, reportWebVitals.js, setupProxy.js, setupTests.js
  components/        — flat, ~150+ files, with topic subfolders:
    accountCard/, intel/, debrief/, ledger/, calendar/, admin/, shared/, intent/,
    frontier/, pricing/, accountsToolsDrawer/
  constants/         — colors.js, tokens.js, businessNav.js, industries.js, products/, ...
  utils/             — db.js, csv.js, storage.js, staleness.js, normAccount.js, ...
  config/            — models.js (AI model tiers)
```
Pages live as flat files directly under `src/components/` (e.g. `AnalyticsPage.js`,
`BusinessDetailPage.js`, `AccountsPage.js`), not in a separate `pages/` directory.

**b. Charting library.** None installed — not in `package.json` dependencies, and grep for
`chart.js|recharts|d3|victory-chart` across `src/` only matched unrelated hex-color/comment
text (e.g. `#22D3EE` accent colors), not a real library. `AnalyticsPage.js` (664 lines, an
existing analytics dashboard — see A4e) computes its own stats by hand
(e.g. a `momentum` score at `AnalyticsPage.js:324`) and renders them without any chart library.

**c. PDF/print/zip.** No `jspdf`/`html2canvas`/`react-to-print`/`jszip` in `package.json`. One
real precedent exists, but it's a **runtime CDN script-tag load**, not an npm dependency:
`src/components/PricingPage.js:765-769` dynamically injects
`https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js` and then calls
`window.html2canvas(...)` (`PricingPage.js:756`) to rasterize a DOM node for export. No print
CSS (`@media print`) found.

**d. CSV import/export.** A real shared utility exists: `src/utils/csv.js` —
`parseCsvLine()`/`parseCsv()`, hand-rolled (not `papaparse`, which isn't a dependency). Its own
header comment says it was extracted from `UploadsPage.js`'s inline implementation specifically
so `csv-account-import-v1` wouldn't duplicate a second parser. Used by
`src/components/CsvImportModal.js` (imports `parseCsv` at line 3). **Import only — no CSV
export/stringify function exists** in `csv.js` or elsewhere searched.

**e. Design language.** Hand-rolled inline-style system, not a UI kit (no MUI/Chakra/Tailwind in
`package.json`). Two shared token files: `src/constants/colors.js` (33 lines — `C`, `mono`,
`TS`, `TIER_COLOR` exports) and `src/constants/tokens.js` (44 lines — `T`, the newer
semantic-role token set: `T.orange`/generate-accent, `T.cyan`/advanced-accent, red for Project,
per this session's own memory of the "Creamsicle OS" convention). Most recent, deliberately
polished exemplar: the `business-intel-strategy-visual-redesign-v1` pass (commit `a6e5493`,
2026-08-18) — `src/components/BusinessIntelKpiStrip.js` (new, 51 lines, a KPI summary-strip
pattern) and `src/components/ProfileFieldBlock.js` (bordered-panel field rendering,
chip lists for array fields). Both are good models to mirror for a new analytics surface —
closer in shape to "dashboard tiles" than most of the app's older screens.

**f. Date/timezone.** No date library — no `moment`/`dayjs`/`date-fns`/`luxon` in
`package.json` or in real usage (grep hits on those words were false positives — unrelated
prose like "at the moment of the API call"). Dates are handled with plain native `Date` and
`.toLocaleDateString()` (e.g. `App.js:553`, `db.js:574`) — no explicit timezone anywhere;
`America/Los_Angeles` does not appear once in the codebase. Timestamps are implicitly
browser/server local time.

---

## A5 — Build and deploy path

**a. Push → Render.** `render.yaml` defines one `type: web` service with `buildCommand: npm
install && npm run build` / `startCommand: npm start`; the repo↔Render connection itself
(which branch triggers a deploy, whether auto-deploy is on) is dashboard-level config, not
present in `render.yaml` — CLAUDE.md states main auto-deploys, consistent with what's visible,
but not independently re-confirmable from the repo alone. To confirm a deploy actually landed:
`scripts/live-audit.js deploy [baselineHash]` fetches the live site's `main.*.js` bundle-hash
reference and compares it to a given baseline — real content signal, not a "push succeeded" /
HTTP-200 assumption (the audit's own landmine about the `app.get('*')` catch-all returning 200
for anything applies here: a 200 alone proves nothing).

**b. Lint/build gates.** `npm run build` is `DISABLE_ESLINT_PLUGIN=true react-scripts build` —
**ESLint is explicitly disabled during the production build**, so there is no lint gate on
build today. The one real gate is a pre-commit hook: Husky (`.husky/pre-commit` → `npm run
precommit` → `node scripts/check-size.js`), which fails the commit if any non-exempt source
file exceeds 3000 lines (warns at 1500) — a size gate, not a lint or type gate.

---

## A6 — Apollo API

`APOLLO_API_KEY` was added to `.env` mid-audit (Jack's own terminal, never typed into this
session). Ran live, read-only calls under the declared cap: **18 of 40 calls used**,
`per_page` never exceeded 5, every endpoint confirmed against real Apollo docs
(`docs.apollo.io/reference/*.md`) before being called, no 401/403 encountered at any point. No
enrichment/people-match/prospecting/credit-consuming endpoint was ever called — Organization
Search (the one confirmed-credit-consuming candidate, 1 credit/page) was identified via docs
only and never invoked.

**a. Auth.** `GET /users/api_profile` → `200`. Confirms the key resolves to Jack's own
HomeLover workspace identity (name/email not reproduced here — redacted per this report's own
rule, see below). **This is a real master key, confirmed directly**: Apollo's own docs name
`GET /users/search` ("list users") as the one endpoint only a true master key can reach —
called it, got `200`, `total_entries: 3`. No 401/403 was hit on any of the 18 calls, including
two endpoints docs mark master-key-only (`email_accounts`, `emailer_campaigns/search`) — both
succeeded.

**b. Sequences.** Real endpoint: `POST /emailer_campaigns/search` (0 credits per docs).
**21 total sequences, 9 active, 0 archived.** `active` (boolean) is the active/paused field.
Per-sequence stats are real response fields, not derived: `unique_scheduled/delivered/opened
/clicked/replied/bounced/hard_bounced/spam_blocked/unsubscribed` plus rate fields
(`open_rate`/`click_rate`/`reply_rate`/`bounce_rate`). One real data-quality wrinkle: all 9
active sequences show `loaded_stats: true`, but one of them returned the **literal string**
`"loading"` for `unique_opened` instead of a number — flagged and excluded from sums below, not
coerced. No active-*contact*-count field exists on the sequence object itself (no
`contact_statuses` tally, despite docs suggesting one) — but a better source for that exists at
the account level, see (f).

**c. Sent emails.** No dedicated emailer-messages search/list endpoint could be located —
tried plausible doc slugs (`search-for-emailer-messages`, `emailer-messages-search`,
`list-emailer-messages`), all `404`. The real date-range-capable path is `POST
/reports/sync_report` (0 credits per docs, supports `metrics`/`group_by`/`filters`/
`date_ranges`) — confirmed to exist, but **its exact required request body could not be
reverse-engineered**: two live attempts with reasonable payload guesses both returned `400`
with an identical generic "X is required" error listing every field. Not pursued past 2
attempts to avoid speculative-call sprawl. So: a date-range-filterable path is documented to
exist, but wasn't gotten working live in this session — the only confirmed-working numeric
source is the per-sequence **lifetime-cumulative** stats from (b), which have no date-range
control at all.

**d. Mailboxes.** Real endpoint: `GET /email_accounts` (0 credits per docs, master-key gated
— worked). **Exactly 2 mailboxes connected, both on the `@homelover.ai` domain, both
`active: true` and (unusually) both `default: true` simultaneously.** Checked both addresses
programmatically against `partners@homelover.ai` and `benefits@homelover.ai` — **neither
matches either one.** Those two specific addresses are not configured as connected Apollo
sending mailboxes today (redacted; not reproduced here, per this report's own email-redaction
rule — see A1b for the same treatment). Per-mailbox volume **is** attributable:
`deliverability_score.{sum_sent_count,sum_delivered_count,sum_opened_count,sum_replied_count,
avg_open_rate,avg_reply_rate}` is present per mailbox, confirmed with real numbers (both
mailboxes: sent 237/247, delivered 227/243, opened 19/2, replied 0/0).

**e. Contacts in sequences.** `contact_campaign_statuses[].status` (real values seen:
`active`/`paused`/`finished`/`failed`) is the per-sequence-assignment status field — confirmed
against a real live contact record. `contact_stage_id` is the contact's overall stage, returned
as an opaque ID; no stage-name lookup endpoint was pursued within budget, so the real stage
*names* list is not resolved here (flagged, not guessed). One real, useful finding not in any
doc: `POST /contacts/search` honors an **undocumented-but-working** `emailer_campaign_ids`
filter param — confirmed via the response's own `breadcrumbs` echoing the filter back
correctly (tested on both one sequence and all 9 active sequences combined).

**f. Accounts.** **No raw employee-count field exists anywhere in the 0-credit endpoint
surface** — not on `accounts/search`, not on the `account`/`organization` objects embedded in
`contacts/search`. The only headcount-shaped fields found are
`organization_headcount_six_month_growth` / `twelve_month_growth` / `twenty_four_month_growth`
— **percentage growth, not a raw count**. The only real employee-*count* field found anywhere
is `organization_num_employees_ranges[]`, and it lives on Organization Search
(`POST /mixed_companies/search`) — confirmed via docs to cost **1 credit per page**, so it was
never called (forbidden by this audit's cap). Accounts genuinely **can** be joined to
contacts active in a sequence, and better than the brief anticipated: every `accounts/search`
record carries `num_contacts`, `contact_emailer_campaign_ids`, and
**`contact_campaign_status_tally`** — a real per-account breakdown by status, e.g. one real
account returned `{"paused":181,"not_sent":1}`. No separate join call is needed for this.

**g. Opportunities/deals.** Real endpoint: `GET /opportunities/search` (0 credits). Live
call: `total_entries: 0`. **HomeLover's Apollo workspace has zero deals.** Zero is the real
answer, not an error. No stage names are observable (no records to read `stage_name` from);
a separate stage-list lookup wasn't pursued to conserve budget given there's nothing to name
yet.

**h. Meetings.** Real endpoint: `POST /api/v1/tasks/search` (0 credits). Live call:
`total_entries: 0` — zero tasks of any kind exist in this workspace. Independently, per docs,
Apollo's task-type schema itself has no meeting-booked/meeting-held type at all (only
`contact_call`, `outreach_manual_email`, `linkedin_step_connect`, and action-item types) —
**"none found" is confirmed two ways: by data and by schema**, not just by absence of a
documented field.

**i. Rate limits.** Real response headers, captured from a live `accounts/search` call:
```
x-rate-limit-minute: 200     x-minute-usage: 1     x-minute-requests-left: 199
x-rate-limit-hourly: 400     x-hourly-usage: 1      x-hourly-requests-left: 399
x-rate-limit-24-hour: 2000   x-24-hour-usage: 1     x-24-hour-requests-left: 1999
```

**j. Cohorts.** Confirmed via real sequence names — cohorts are embedded as free-text
substrings in sequence *names*, not a separate label, list, or account field. Real sequence
names directly matching Jack's 6 named cohorts: `*RETAIL*` / `Retail (A/B) Test Executive` /
`Retail (A)` (Retail), `3-Step Hospitality (Hotels/Motels)` (Hospitality), `4-Step - SaaS
HCOL (A/B)` / `3-Step - SaaS` (SaaS), `5-Step Car Rental & Dealerships` (Car Rental), `5-Step -
Fitness Employers / Gyms` (Fitness & Gyms), `5-Step Wireless / Cell Phone Companies` (Wireless
& Cell Phones). Sequences also exist for concepts outside Jack's 6 named cohorts — `Tier 1
Partners`, `Warm Referral Cadence`, `Rental Rewards`, `HR & Benefits Buyers Outreach`, and
`Wealth Management / Financial Advisors` (this last one not among the 6). A separate
`label_ids` array also exists per sequence (a secondary tagging mechanism) but wasn't decoded
to real label names within this audit's budget.

## A7 — Baseline cross-check vs Jack's hand-reported numbers

Computed directly from the A6 data above — nothing here was tuned to land near Jack's numbers.

**a. Active sequences: 9 real** (21 total, 0 archived) **vs Jack's reported 8.** Close but not
exact. Possible explanations not resolved here: Jack may be counting by a different definition
(e.g. excluding one of the 2 "(Cyrus)"-suffixed active sequences as a duplicate/test, or
counting cohorts rather than raw sequence rows) — flagged, not guessed at.

**b. Active prospects in sequences: 2,051 vs Jack's ~2,000.** Close match — computed via the
real `emailer_campaign_ids` filter on `contacts/search`, combining all 9 active sequence IDs,
reading `pagination.total_entries` directly (no need to page through all 2,051 records).
**Caveat, stated plainly:** this is "contacts assigned to ≥1 active sequence," not strictly
"contacts with `contact_campaign_statuses.status === 'active'`" — a contact could be assigned
to an active sequence but individually paused/finished. Getting the exact status-filtered
count would mean enumerating up to 2,051 records at `per_page ≤ 5` (≈411 calls) — over 10x the
declared cap, so not attempted.

**c. Distinct companies with ≥1 active contact vs 171: not computable within the cap.**
Tried filtering `accounts/search` by `contact_emailer_campaign_ids` (the account-side mirror of
the working contacts-side filter) — **confirmed silently ignored**: `total_entries` came back
identical to the unfiltered total (314) and `breadcrumbs` was empty (vs. 9 real breadcrumb
entries on the working contacts-side filter). Getting the real distinct-company count would
require reading `contact_campaign_status_tally` off all 314 accounts at `per_page ≤ 5`
(63 calls) or enumerating all 2,051 filtered contacts' `account_id`s (≈411 calls) — both over
budget. Real total CRM accounts confirmed: **314**. Worth flagging separately: Jack's own
figure was phrased "171/200" — a ratio against an apparent target/pool of 200, not against
314 total accounts — so even a computed 314-based figure likely wouldn't be measuring the same
thing he was.

**d. Sum of employee counts vs 3.08M: not computable — the field itself is missing.** Per
A6f, no raw employee-count field exists on any 0-credit endpoint; only percentage-growth
fields do. This directly tests (and fails) the SPEC's proposed `audience_in_cadence`
definition — not a "couldn't get to it," but "the input field the definition depends on isn't
available without spending credits on Organization Search."

**e. Delivered/opened/clicked for a date range.** The only confirmed-working numbers are the
per-sequence **lifetime-cumulative** stats from A6b — `POST /emailer_campaigns/search` has no
date-range parameter at all, so these are not scoped to any particular window:
```
9 active sequences:   delivered 853   opened 106*  clicked 29   replied 4   bounced 152
all 21 sequences:     delivered 1010  opened 120*  clicked 40   replied 4   bounced 196
  * one sequence returned the literal string "loading" for unique_opened in both sets —
    excluded from the sum, not coerced to 0.
Jack's reported:       delivered 1,309  opened 129 (9.8%)  clicked 39 (2.9%)
```
Every real number here is lower than Jack's — consistent with these being a narrower or
differently-defined window than whatever produced his figures, not evidence his numbers are
wrong. **Which date range he used remains a genuine open question** (see below) — not guessed
at, per the audit's own instruction. The one endpoint that could answer this properly
(`POST /reports/sync_report`, date-range-capable per docs) was attempted twice and returned
`400` both times on the request shape — see A6c.

---

## RECOMMENDATIONS (not decided)

- Do not build `sales-analytics-v1` on the SPEC's assumed architecture (Edge Functions,
  `tenants` table, TypeScript `src/features/`) — none of that exists. The real shape is: plain
  JS, flat `src/components/`, direct client→Supabase writes for simple fields
  (`createProject()`-style), server routes only for AI/secret-needing calls, one persistent
  Express process with `node-cron` already available for scheduling.
- Any new `sales_*` tables should get real RLS policies scoped to `business_id` from the start
  — not the `qual: "true"` pattern that's the de facto default on 18 of the 26 existing tables.
  This is a pre-existing, unrelated-to-this-SPEC gap worth its own conversation, not something
  to inherit by copying an existing table's policy shape.
- If HomeLover-only tab visibility is wanted, `BUSINESS_NAV` needs a new filter dimension (by
  `business.id`/`business.name`), not reuse of the existing `ownerOnly` (role-based) flag — that
  flag answers a different question.
- `node-cron` (already a dependency, already running a 6-hour job in `server.js`) is a viable
  scheduling mechanism for a first version if `pg_cron` availability can't be confirmed soon —
  avoids being blocked on the unresolved pg_cron/Vault/Aug-23-plan questions below.
- `html2canvas`'s existing CDN-script-tag pattern (`PricingPage.js`) could be reused for any
  chart/report image export, but it's a runtime network dependency (not bundled), worth
  weighing against installing a real npm PDF/export library instead.
- `src/utils/csv.js` has no export/stringify counterpart to its import parser — would need to
  be added if the SPEC wants CSV export, not assumed to already exist.
- The SPEC's proposed `audience_in_cadence` = sum of employee counts cannot be built as
  specified — the only employee-count field found anywhere requires paid Organization Search
  calls (1 credit/page). Either redefine the metric off a field that's actually free (e.g.
  `num_contacts` per account, which is real and already present on every `accounts/search`
  row), or accept that this one metric needs a credit budget the rest of the sync doesn't.
- `contact_campaign_status_tally` (real, already present on every `accounts/search` record) is
  a better foundation for "companies in cadence"-style metrics than joining contacts and
  accounts manually — it gives a per-account, per-status count directly, no extra calls.
- The real, working `emailer_campaign_ids` filter on `contacts/search` (undocumented but
  confirmed live) is the right mechanism for "prospects in cadence" sync logic — cheap
  (`pagination.total_entries` alone answers it), doesn't require paging every contact.
- Don't build sync logic around `POST /reports/sync_report` yet — it's the only endpoint that
  offers real date-range-filtered delivered/opened/clicked, but its required request shape
  wasn't successfully reverse-engineered this session (2 attempts, both `400`). Get a working
  example from Apollo support or a fuller doc pass before depending on it.

## OPEN QUESTIONS

1. **(from the AUDIT brief)** Does Seif need to log into Prospector, or is a PDF/CSV export
   enough? No row for "Seif" exists in `business_members` or `approved_users` today — whatever
   the answer, that person doesn't have access yet under either mechanism. This also decides
   whether v1 needs the member-invite flow exercised for HomeLover specifically (it hasn't been
   — the one real HomeLover member row is Cyrus Radjoo, not Seif).
2. **(from the AUDIT brief) For the 1,309 / 129 / 39 figures: which date range and which
   sequences?** Still genuinely open — not guessed at. What's now confirmed: the real
   lifetime-cumulative numbers (A7e) are all lower than Jack's figures, and the one endpoint
   that could answer this with a real date range (`reports/sync_report`) didn't return a
   working response this session. Whoever tries next should start from a *working* example
   request for that endpoint (Apollo support, or their own Apollo UI's network tab) rather than
   guessing the body shape again.
2b. **What does Jack's "171/200 companies in cadence" and "8 total cadences" actually count
   against?** Real data this session: 314 total CRM accounts (not 200), 9 active sequences (not
   8, 21 total). Neither of Jack's two denominators matches anything directly observed —
   worth asking what "200" and "8" refer to before designing the metric definitions around them.
3. **pg_cron, pg_net, and Supabase Vault availability is unknown** — no raw SQL path exists in
   this session's tooling (no `psql`, no `pg` package, no `DATABASE_URL`, and the only two
   existing introspection RPCs don't cover extensions). Someone with Supabase Dashboard access
   needs to check Database → Extensions directly, or a new read-only RPC needs to be written
   (a real schema change — out of scope here) before scheduling design can commit to pg_cron.
4. **Aug 23 Supabase upgrade-or-restrict status is unconfirmed.** No restriction was observed
   in ~30 real queries this session, but that's not the same as confirming the deadline was
   resolved — that's dashboard/billing state, not visible from the repo or this session's
   tools.
5. **Render's actual production env vars, plan tier, and auto-deploy setting are not visible**
   from this repo — `render.yaml` only shows service type/build/start commands; the rest is
   dashboard-only state this session had no credentials to check.
6. **Whether `id` is a true declared PRIMARY KEY on `businesses`** (vs. just a `NOT NULL
   uuid` with a default that happens to be used as an FK target) was not directly confirmed —
   the existing schema-introspection RPC doesn't surface constraint types, and adding one is a
   schema change outside this audit's scope.
