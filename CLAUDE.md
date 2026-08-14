# Prospector — Claude Code Instructions

Prospector is a React SPA (Create React App) deployed on Render, built as a sales intelligence tool for account executive teams. The backend is serverless API routes under `/api/`, proxied through Vercel/Render. Supabase is used for persistence. There is no Express server.

---

## Slash commands

| Command | What it does |
|---|---|
| `/ship [msg]` | `npm run build` → `git add -A` → commit → `git push origin main` |
| `/deadcode ComponentName` | Scan component for dead code, list candidates, remove on approval |
| `/audit` | Security/quality audit |
| `/spec` | Generate an implementation spec |
| `/split` | Split a large component into smaller ones |
| `/panel` | Scaffold a new intel panel |
| `/wire` | Wire up a new API route end-to-end |
| `/cleanup` | Repo-wide dead-file/duplicate-logic/scratch-artifact hygiene pass — reports findings and waits for approval before removing anything. Opt-in only, run manually when Jack wants a pass — never runs automatically. |

Always run `/ship` to deploy. Never push without building first.

---

## Architecture rules

**AI calls — server only.** All Claude API calls go through `/proxy/anthropic/messages`. Never call `https://api.anthropic.com` directly from browser code.

**Model tiers — always specify explicitly.** Import from `src/config/models.js`:
- `MODELS.REASONING` — complex multi-step analysis (DealTimeline, ActionItems)
- `MODELS.STANDARD` — most panels, email generation, NS copy, anything user-facing
- `MODELS.FAST` — high-frequency or background tasks (scoring, quick classifications)

Always set `max_tokens` explicitly on every AI call. Never omit it.

**Shared logic belongs in `src/utils/`.** If two components need the same prompt-building or API-fetching logic, extract it to a util before the second caller is written. Don't duplicate prompts across components.

**State lives at the lowest owner.** Don't lift state until two components actually share it. Don't introduce context or global state for single-component concerns.

**localStorage keys** — all persistence keys are prefixed `prospector_`. When adding a new key, document it in a comment next to the first write. Never read a key without handling the case where it's absent or malformed (JSON.parse inside try/catch).

**Supabase merges, never replaces.** When loading from Supabase, merge into existing local state: `{ ...local, ...db }`. Never overwrite local data with a subset from the DB.

---

## Code style rules

**No comments unless the WHY is non-obvious.** Don't narrate what the code does. Don't reference the task, fix, or caller. The code and variable names explain the what; comments explain hidden constraints, subtle invariants, or workarounds for specific bugs.

**No premature abstractions.** Three similar lines is better than a helper function used twice. Don't design for hypothetical future callers.

**No defensive error handling for impossible cases.** Only validate at real system boundaries: user input, external APIs (SFDC, Gmail, Supabase), URL params. Trust internal calls.

**No backwards-compat cruft.** If something is unused, delete it completely. No `_unused` renames, no re-exports for removed types, no `// removed` comments.

**No feature flags or shimming.** Just change the code.

---

## React rules

**All hooks above all early returns — no exceptions.** React error #310 (rendered more hooks than previous render) is caused by a hook that appears after a conditional return. If a component has an early return, every `useState`, `useEffect`, `useCallback`, `useMemo`, `useRef` must come before it.

**No `useEffect` that references a variable declared after it.** TDZ crashes (`Cannot access 'X' before initialization`) happen when an effect closure captures a variable that isn't initialized on the render path that triggered the effect.

---

## Persistence layers

| What | Key / Table |
|---|---|
| Accounts + calls | `prospector_accounts` (localStorage) + `accounts` (Supabase) |
| Compliance steps | `prospector_compliance` (localStorage) + `plospect_compliance` (Supabase — table not yet renamed, needs a migration) |
| Pricing files | `prospector_pricing_files` (localStorage) |
| Gate unlock | `prospector_gate_unlocked` (localStorage) |
| Approval cache | `prospector_approved` (localStorage, `'1'` = approved) |
| Gmail tokens | `gmail_access_token`, `gmail_refresh_token`, `gmail_token_expiry`, `gmail_email` |
| SFDC tokens | `sfdc_access_token`, `sfdc_instance_url`, `sfdc_user_id`, `sfdc_user_name`, `sfdc_synced_at` |

---

## Deployment

- **Prod URL:** https://prospector.onrender.com
- **Repo:** github.com/jackcarlsig16-star/prospector (main branch auto-deploys on Render)
- Build command: `npm run build`
- Pre-commit hook runs `scripts/check-size.js` — fails if any source file is over the size limit
- API routes live in `/api/` — Render treats them as serverless functions

---

## Key files

| File | Role |
|---|---|
| `src/App.js` | Root: auth, routing, Supabase load, SFDC sync, all top-level state |
| `src/config/models.js` | Single source of truth for all model IDs |
| `src/utils/storage.js` | localStorage helpers, `STEP_STATUSES` definition |
| `src/utils/nsCopy.js` | Shared NS copy prompt builder + Gmail sent email fetcher |
| `src/utils/assay.js` | Client-side assay scoring logic |
| `api/assay.js` | Server-side assay endpoint |
| `api/sfdc/my-accounts.js` | SFDC opp + clientId sync (limit 500, paginated) |
| `api/sfdc/production-request.js` | SFDC compliance stage → canonical status mapping |
| `api/gmail/callback.js` | OAuth callback — stores access + refresh token |
| `src/components/AccountCardComms.js` | Email generator (post-call / reply / outreach) |
| `src/components/ProspectorGate.js` | Access gate + code verification |
| `src/components/AdminPage.js` | Admin: access log, SFDC tools, user management |

---

## SFDC sync notes

- `Production_Request_Compliance_Stage__c` must be `.toUpperCase()` before comparing to `"APPROVED"` — the raw SFDC value is mixed case. `Security_Diligence_SDR_Status__c` already does this; prod request does not yet (known bug, fix pending).
- SFDC opp query: `LIMIT 500` with pagination loop — do not reduce this limit.
- `syncSfdc` patches existing accounts by matching on `sfdcOppId`, `sfdcAccountId`, or name — it does not replace the full account array.
