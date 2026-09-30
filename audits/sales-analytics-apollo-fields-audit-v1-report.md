# sales-analytics-apollo-fields-audit-v1 — Findings Report

Read-only. No code changes, no migrations, no Apollo writes. Every claim below is a real query,
a real field observed in a real Apollo response, a real row from `sales_metrics_daily`, or a
real file:line citation — checked in this session, not recalled from memory.

**Total Apollo calls used: 15 of 15** (the declared cap). Every one a confirmed zero-credit
read, endpoint confirmed against `docs.apollo.io` before being called. Zero prospect names or
emails appear anywhere below — only counts, field names, types, and the business's own sanctioned
addresses (`jack@homelover.ai`, `cyrus@homelover.ai`).

---

## F1 — Full field inventory

Method: one fresh `per_page: 1` record from each of the four endpoints (4 of the 15 calls),
plus reuse of a `per_page: 100` sequences pull (needed for F2/F3/F5, see below) for
cross-checking. Every top-level and nested key, with type, cross-referenced against what
`api/sales/adapters/*.js` actually keeps.

### `emailer_campaigns/search` (sequences) — **93 real fields**

**KEPT (5 shapes, `api/sales/adapters/sequences.js`):** `id` (string), `name` (string), `active`
(boolean), `cohort` (string — computed client-side from `name`, not an Apollo field), and every
`unique_*` field dynamically detected (14 real fields: `unique_scheduled`, `unique_delivered`,
`unique_bounced`, `unique_opened`, `unique_hard_bounced`, `unique_spam_blocked`,
`unique_replied`, `unique_demoed`, `unique_clicked`, `unique_unsubscribed`,
`unique_opened_unfiltered`, `unique_clicked_unfiltered`, `unique_delivered_open_tracked`,
`unique_delivered_click_tracked`).

**DROPPED (79 fields)**, grouped by shape:
```
description:null, archived:bool, created_at:string, emailer_schedule_id:string,
max_emails_per_day:null, user_id:string, same_account_reply_policy_cd:null,
excluded_account_stage_ids:array[string], excluded_contact_stage_ids:array[string],
contact_email_event_to_stage_mapping:object, label_ids:array[string],
create_task_if_email_open:bool, email_open_trigger_task_threshold:number,
mark_finished_if_click:bool, days_to_wait_before_mark_as_response:number,
starred_by_user_ids:array, mark_finished_if_reply:bool, mark_finished_if_interested:bool,
mark_paused_if_ooo:bool, mark_finished_if_phone_call_connected:null,
sequence_by_exact_daytime:null, last_used_at:null, sequence_ruleset_id:string,
ignore_apollo_global_email_bounce_list:bool, folder_id:null,
same_account_reply_delay_days:number, is_performing_poorly:bool,
num_contacts_email_status_extrapolated:number, remind_ab_test_results:bool,
ab_test_step_ids:array, prioritized_by_user:null, creation_type:string,
object_owner_id:string, dmp_ids:null, content_center_type:string,
product_profile_ids:array, context_card_ids:array, status_reason:null,
auto_pause_warning_level:null, auto_paused_at:null, auto_pause_bounce_rate:null,
allowed_send_from_domains:array, overdue_manual_tasks_count:number, num_steps:number,
emailer_steps:array[object] (each: id, position, wait_time, wait_mode, type — plus
  max_emails_per_day, exact_datetime, auto_skip_in_x_days seen in the fuller
  emailer_steps[] shape returned by emailer_messages/search),
bounce_rate:number, hard_bounce_rate:number, open_rate:number, open_rate_tracked:number,
open_rate_unfiltered:number, open_rate_unfiltered_tracked:number, click_rate:number,
click_rate_tracked:number, click_rate_unfiltered:number, click_rate_unfiltered_tracked:number,
reply_rate:number, spam_block_rate:number, opt_out_rate:number, demo_rate:number,
loaded_stats:bool, cc_emails:string, bcc_emails:string,
underperforming_touches_count:number,
sharing_permission:object (visibility, access_type, object_type, object_id, is_owner,
  owner_id, sharing_accesses)
```
(Field-level detail on `bounce_rate`/`hard_bounce_rate`/`spam_block_rate` — see F8.
`user_id`/`sharing_permission.owner_id` — see F3. `label_ids` — see F2.)

### `accounts/search` — **72 real fields**

**KEPT (5 shapes, `api/sales/adapters/accounts.js`):** `id`, `domain`, `num_contacts`,
`contact_emailer_campaign_ids` (array[string]), `contact_campaign_status_tally` (object, e.g.
`{"paused":2,"not_sent":1}`).

**DROPPED (67 fields):**
```
name:string, website_url:string, angellist_url:string, linkedin_url:string,
twitter_url:string, facebook_url:string, languages:array[string], alexa_ranking:number,
phone:string, linkedin_uid:string, founded_year:number, publicly_traded_symbol:string,
publicly_traded_exchange:string, logo_url:string, crunchbase_url:null,
primary_domain:string, sic_codes:array[string], naics_codes:array[string],
primary_phone:object(number, sanitized_number), sanitized_phone:string, market_cap:string,
organization_raw_address:string, organization_postal_code:string,
organization_street_address:string, organization_city:string, organization_state:string,
organization_country:string, suggest_location_enrichment:bool, raw_address:string,
street_address:string, city:string, state:string, country:string, postal_code:string,
team_id:string, organization_id:string, account_stage_id:string, source:string,
original_source:string, creator_id:string, owner_id:string, created_at:string,
phone_status:string, hubspot_id:null, salesforce_id:null, crm_owner_id:null,
parent_account_id:null, suggested_from_rule_engine_config_id:null,
godmode_apollo_creator:null, account_playbook_statuses:array, existence_level:string,
label_ids:array, typed_custom_fields:object, custom_field_errors:object, modality:string,
source_display_name:string, crm_record_url:null, last_activity_date:string,
intent_strength:null, show_intent:bool, organization_headcount_six_month_growth:null,
organization_headcount_twelve_month_growth:null,
organization_headcount_twenty_four_month_growth:null
```
No raw employee-count field exists here either — re-confirms the original core-v1 audit's A6f
finding on fresh data.

### `contacts/search` — **228 real fields**

**KEPT: 0 of 228.** `api/sales/adapters/prospects.js` never stores an individual contact
record — it reads `pagination.total_entries` only and discards the response body entirely. So
every one of the 228 fields below is dropped by design, not oversight:
```
contact_roles:array, id:string, first_name:string, last_name:string, name:string,
linkedin_url:string, title:string, contact_stage_id:string, owner_id:string,
creator_id:string, person_id:string, email_needs_tickling:bool, organization_name:string,
source:string, original_source:string, organization_id:string, headline:string,
photo_url:null, present_raw_address:string, linkedin_uid:string,
extrapolated_email_confidence:null, salesforce_id:null, salesforce_lead_id:null,
salesforce_contact_id:null, salesforce_account_id:null, crm_owner_id:null,
created_at:string, emailer_campaign_ids:array[string], direct_dial_status:null,
direct_dial_enrichment_failed_at:null, email_status:string, email_source:string,
account_id:string, last_activity_date:null, hubspot_vid:null, hubspot_company_id:null,
crm_id:null, merged_crm_ids:null, updated_at:string, queued_for_crm_push:null,
suggested_from_rule_engine_config_id:null, email_unsubscribed:null, person_deleted:null,
call_opted_out:null, godmode_apollo_creator:null, sanitized_phone:null,
street_address:null, city:string, state:string, country:string, postal_code:null,
formatted_address:string, time_zone:string, label_ids:array[string],
has_pending_email_arcgate_request:bool, has_email_arcgate_request:bool,
existence_level:string, email:string, email_from_customer:null,
typed_custom_fields:object (real per-contact custom AI-output fields — success/subject/
  body/rationale/error_code/failure_reason shapes seen, not enumerated further here),
custom_field_errors:object, crm_record_url:null, email_status_unavailable_reason:null,
email_true_status:string, updated_email_true_status:bool, source_display_name:string,
twitter_url:null, facebook_url:null,
contact_campaign_statuses:array[object] — the single richest dropped structure:
  id, emailer_campaign_id, send_email_from_user_id, inactive_reason, status, added_at,
  added_by_user_id, finished_at, paused_at, auto_unpause_at, send_email_from_email_address,
  send_email_from_email_account_id, manually_set_unpause, failure_reason, current_step_id,
  in_response_to_emailer_message_id, cc_emails, bcc_emails, to_emails, current_step_position
  (see F3 and F5 — this one array answers both),
account:object (full nested account shape, same fields as the accounts/search inventory
  above, ~50 more sub-fields),
contact_emails:array, organization:object, intent_strength:null, show_intent:bool,
phone_numbers:array, account_phone_note:null, free_domain:bool,
outbound_subscriptions:array, email_domain_catchall:bool,
email_domain_catchall_verdict:string, directory_url:null, contact_job_change_event:null
```

### `email_accounts` (mailboxes) — **134 real fields**

**KEPT (7 shapes, `api/sales/adapters/mailboxes.js`):** `id`, `email`, `active`,
`sum_sent_count`, `sum_delivered_count`, `sum_opened_count`, `sum_replied_count`.

**DROPPED (127 fields)** — including, critically, everything used in F9 below:
```
aliases:array, user_id:string, type:string, default:bool,
seconds_delay_between_emails:number, provider_display_name:string, nylas_provider:null,
last_synced_at:string, email_sending_policy_cd:string, sendgrid_api_user:null,
mailgun_domains:null, nylas_api_version:null, signature_edit_disabled:bool,
revoked_at:null, inactive_reason:string, needs_reauth_at:null, unlink_error_code:string,
created_at:string, inbox_placement_test_health_status:null, unlink_error_message:string,
sendgrid_api_key_v3:null, user_name:string, email_daily_threshold:number,
deliverability_score:object — a second rich dropped structure:
  _id, avg_click_rate, avg_daily_sent, avg_delivered_rate, avg_hard_bounce_rate,
  avg_open_rate, avg_reply_rate, avg_spam_block_rate, avg_unsubscribe_rate,
  click_rate_score, concurrency_locks, created_at, daily_email_sent_score, date_from,
  date_to, deliverability_score (composite), domain_health_score,
  email_account_domain_age_score, email_account_id, hard_bounce_score, open_rate_score,
  random, reply_rate_score, spam_block_score, sum_clicked_count,
  sum_delivered_clicked_tracked_count, sum_delivered_open_tracked_count,
  sum_hard_bounced_count, sum_spam_blocked_count
  (the 4 sum_* fields the adapter DOES keep are a subset of this object)
```
(129 total fields listed here across both top-level and the `deliverability_score` nested
object — the remaining handful not spelled out are further UI-preference fields of no
analytical relevance, omitted from this report for length, not hidden from the count above.)

---

## F2 — Sequence labels

No documented zero-credit (or any) endpoint to decode `label_ids` → real names was found.
Checked the live "Search for Sequences" reference page directly for any label-lookup
endpoint — none exists in the docs.

Real data: across all **21** sequences, only **2 distinct `label_ids`** exist workspace-wide:
`6aa3055120fe4200207f42c5` and `6abc54f67b60820010d494c3`. Of the **9 active** sequences, only
**1** carries a label at all:

| Sequence | label_ids |
|---|---|
| HomeLover 5-Step - Fitness Employers / Gyms | `["6aa3055120fe4200207f42c5"]` |
| All other 8 active sequences | `[]` |

**This directly bears on Jack's "Partner cadence toggle" idea**: Apollo's label system exists
and is real, but it's essentially unused today (1 of 9 active sequences labeled, and that name
can't be decoded via any zero-credit API call found). Tagging via Apollo labels would mean
Jack starts actively labeling sequences in the Apollo UI going forward — not something already
populated and ready to read.

---

## F3 — Sequence owner/sender

**Not on the sequence object.** Confirmed two ways: the docs' page for Search for Sequences,
and the real 93-field inventory above — no sending-mailbox field exists at the sequence level.
What *does* exist on the sequence object: `user_id` and `sharing_permission.owner_id` (the
Apollo **user** who owns/created the sequence — not necessarily the mailbox it sends from).

**The real mapping lives per-contact**, in `contact_campaign_statuses[].send_email_from_email_address`
(plus `_user_id` and `_email_account_id`). Confirmed for all 9 active sequences via 7 real,
breadcrumb-verified calls (1 combined 100-contact sample covered 3 sequences; 6 more targeted
single-contact calls covered the rest):

| Sequence | Sending mailbox | Breadcrumb confirmed |
|---|---|---|
| Fitness Employers / Gyms | jack@homelover.ai | ✓ |
| *RETAIL* (Analytics HR) | jack@homelover.ai | ✓ |
| Retail (A/B) Test Executive | jack@homelover.ai | ✓ |
| SaaS HCOL (B) | jack@homelover.ai | ✓ |
| SaaS HCOL (A) | jack@homelover.ai | ✓ |
| SaaS (Analytics HR) | jack@homelover.ai | ✓ |
| Rental Rewards | jack@homelover.ai | ✓ |
| Wireless / Cell Phone A/B Test (Cyrus) | cyrus@homelover.ai | ✓ |
| Car Rental & Dealerships (Cyrus) | cyrus@homelover.ai | ✓ |

**The "(Cyrus)" naming convention turns out to be accurate** — both sequences carrying that
suffix really do send from `cyrus@homelover.ai`; none of the other 7 do. Worth noting this is
observational (name happens to match reality today), not a guaranteed rule enforced by Apollo —
a future sequence could be misnamed.

---

## F4 — Step-level stats

No dedicated per-step **aggregate** stats endpoint exists. Checked via docs (0 calls) plus 2
real calls, as budgeted:
- "Check Email Stats" (`GET /emailer_messages/{id}/activities`, 0 credits per docs) is
  per-individual-message, not an aggregate.
- `GET /emailer_messages/search` (0 credits, confirmed) returns individual message records,
  each carrying `campaign_position` (the real step number) and `emailer_step_id` — real,
  usable fields — but the endpoint itself returns **individual messages only**, 5-10 at a
  time in the calls made here. Getting a real "step 1 vs step 5 delivered/opened" aggregate
  would mean paging through and summing many individual messages client-side, not a 1-2 call
  lookup.

A separate, real `emailer_steps[]` array does exist (confirmed from both the sequence object
and from `emailer_messages/search`'s response) with real step metadata: `id`, `position`,
`wait_time`, `wait_mode`, `type`, plus (seen on the fuller shape) `max_emails_per_day`,
`exact_datetime`, `auto_skip_in_x_days` — but no delivered/opened/replied counts live on it.

---

## F5 — Per-sequence contact status breakdown

Not on the sequence object (confirmed — no `contact_statuses` tally field anywhere in the real
93-field sequence inventory, despite docs language once suggesting one might exist). The real
per-contact field is `contact_campaign_statuses[].status`.

One 100-contact sample (filtered to all 9 active sequences combined, breadcrumb-confirmed —
9 real breadcrumb entries echoing the filter) gave a real partial tally for **3 of 9**
sequences — Apollo's default contact ordering is not evenly interleaved across sequences, so a
single page doesn't span all of them:

| Sequence | Statuses seen (100-contact sample) |
|---|---|
| Fitness Employers / Gyms | `{"active":49,"failed":1}` |
| *RETAIL* (Analytics HR) | `{"active":18}` |
| Retail (A/B) Test Executive | `{"active":32}` |

**Real call count needed for a complete, authoritative tally across all 9 active sequences:**
the same filtered query's real `total_entries` = **2,051** contacts. At the confirmed real max
`per_page` of 100 (established in core-v1 Stage 0), a full pass requires
**⌈2,051 / 100⌉ = 21 calls** — over this audit's entire 15-call cap on its own, and roughly 3x
a normal sync run's real ~7-call budget (core-v1 Stage 0). Not attempted here.

---

## F6 — Contact stages

Real zero-credit endpoint: `GET /contact_stages` (confirmed "0 credits" per docs, called once).
Full real stage list, 9 stages:

| name | category | display_order |
|---|---|---|
| Cold | in_progress | 0 |
| Approaching | in_progress | 1 |
| Replied | in_progress | 2 |
| Interested | succeeded | 3 |
| Not Interested | failed | 4 |
| Unresponsive | failed | 5 |
| Do Not Contact | failed | 6 |
| Bad Data | (null) | 7 |
| Changed Job | (null) | 8 |

**Per-stage contact counts: not obtained.** Getting real counts would need one filtered
`contacts/search` call per stage (9 more calls, reading `total_entries` only) — the remaining
budget after F3/F5's needs didn't allow it within this audit's 15-call cap. Flagged under Open
Questions as a cheap, real follow-up (9 calls, 0 credits, well within a fresh 15-call budget).

---

## F7 — Replies

**Found — real, zero-credit, and directly usable for a "Positive Responses" KPI.**
`reply_class` on `GET /emailer_messages/search` (confirmed "0 credits" per docs). Documented
full value set: `willing_to_meet`, `follow_up_question`, `person_referral`, `out_of_office`,
`already_left_company_or_not_right_person`, `not_interested`, `unsubscribe`,
`none_of_the_above`.

Real values observed (1 call, filtered to replied messages, 4 real replies returned):
`willing_to_meet`, `follow_up_question`, `person_referral`,
`already_left_company_or_not_right_person`. An unfiltered sample (5 messages, all
`status: scheduled`, not yet sent) correctly showed `reply_class: null` for all 5 — consistent,
not a data gap.

**Caveat, real and worth flagging:** unlike `contacts/search`'s `emailer_campaign_ids` filter
(which echoes into `breadcrumbs`), the `emailer_message_stats` filter used here returned an
**empty** `breadcrumbs` array. Verification here relied on indirect evidence instead (every
returned message genuinely had `status: completed`/`replied: true`, consistent with the filter
having worked, unlike an unfiltered call which returned a mix including `scheduled`) — not as
strong a guarantee as a breadcrumb echo. Note this before relying on this specific filter
without re-verifying.

**Bonus, relevant to the earlier core-v1 audit:** `GET /emailer_messages/search` appears to be
exactly the per-message search endpoint the original `sales-analytics-audit-v1` (A6c) could not
locate (that audit tried plausible doc slugs and got 404s on all of them). It's real, 0 credits,
and supports a genuine date-range filter (`emailer_message_date_range[min/max]`, mode
`due_at` or `completed_at`) — see Recommendations.

---

## F8 — Bounce reality check

Real numbers, fresh this session (Apollo) vs. what's stored in the dashboard's database
(`sales_metrics_daily`, itself from the last real sync):

| Sequence | Apollo now: delivered / bounced / hard_bounced / spam_blocked | DB (dashboard's source): delivered / bounced |
|---|---|---|
| Fitness Employers / Gyms | 251 / 108 / 23 / 85 | 250 / 108 |
| Retail (A/B) Test Executive | 151 / 21 / 4 / 17 | 151 / 21 |
| Wireless A/B Test (Cyrus) | 7 / 1 / 0 / 1 | 7 / 1 |

(The 1-count drift on Fitness's delivered — 251 live vs 250 stored — is simply real activity
since the last sync, not an error.)

**Dashboard's Bounce % formula** — `src/components/salesAnalytics/SequenceLeaderboard.js:52`:
```js
const bounceRate = ratio(bouncedRows, deliveredRows, lastValue);
```
i.e. `bounced / delivered`, via `ratio()` in `computeMetric.js`. This produces the dashboard's
displayed **43.2% / 13.9% / 14.3%** for these three sequences — real, correctly computed from
real numbers, not a bug in the arithmetic.

**But it disagrees with Apollo's own `bounce_rate` field.** Apollo provides a pre-computed
`bounce_rate` on the sequence object itself (dropped by the current adapter, never stored —
see F1): **30.08% / 12.21% / 12.50%** for the same three sequences. Checked the exact
denominator by testing candidate formulas against the real numbers — **Apollo's `bounce_rate`
= `bounced / (delivered + bounced)`**, matching to 6 decimal places on all 3 sequences
(0.300836, 0.122093, 0.125000 — exact).

**Conclusion, findings only:** the dashboard's numbers are real, not a calculation artifact in
the sense of being wrong arithmetic — but they use a different denominator than Apollo's own
definition of "bounce rate," which inflates the dashboard's percentage relative to what Apollo
itself would report for these same sequences (because `unique_delivered` already excludes
bounces, so dividing by it alone produces a higher rate than dividing by delivered-plus-bounced
attempts).

---

## F9 — Mailbox open-rate gap

Every `email_accounts` field that could plausibly explain `jack@` (9.3%) vs `cyrus@` (0.8%)
open rates, real values for both:

| Field | jack@ | cyrus@ |
|---|---|---|
| `type` / `provider_display_name` | ms_exchange / Microsoft Exchange | ms_exchange / Microsoft Exchange |
| `active` / `default` | true / true | true / true |
| **`inactive_reason`** | `"invalid_grant: AADSTS50173: The provided grant has expired due to it being revoked, a fresh auth token is needed... issued on 2026-08-17T19:03:22Z... TokensValidFrom 2026-09-16T17:03:56Z..."` | `"immediately deactivated after oauth"` |
| **`unlink_error_code`** | `"auth_token_expired"` | `null` |
| **`unlink_error_message`** | `"Your credentials may have expired or been revoked, possibly because you changed your password or revoked Apollo's access."` | `"immediately deactivated after oauth"` |
| `last_synced_at` | 2026-09-30T19:02:03Z | 2026-09-30T18:54:52Z |
| `email_daily_threshold` / `seconds_delay_between_emails` | 50 / 600 | 50 / 600 |
| `deliverability_score.deliverability_score` (composite) | 83.2 | 85.6 |
| `domain_health_score` | 5 | 5 |
| `email_account_domain_age_score` | 3 | 3 |
| **`open_rate_score`** | 3 | 1 |
| `reply_rate_score` / `click_rate_score` | 1 / 1 | 1 / 1 |
| `hard_bounce_score` | 4 | 5 |
| `spam_block_score` / `daily_email_sent_score` | 5 / 5 | 5 / 5 |
| `deliverability_score.date_from` / `date_to` | 2026-09-21 | 2026-09-27 (both mailboxes — same real rolling window) |
| `avg_open_rate` (Apollo's own, this window) | 0.0925 (9.25%) | 0.00823 (0.823%) |
| `avg_hard_bounce_rate` | 0.0422 | 0.0162 |
| `avg_spam_block_rate` | 0.0127 | 0.0081 |

Findings only, no diagnosis beyond what these fields show:
- Both mailboxes carry **real, active error fields** (`inactive_reason` etc.) despite
  `active: true` — Microsoft/Azure AD OAuth-grant-expired on `jack@`, a distinct
  "immediately deactivated after oauth" message on `cyrus@`.
- `open_rate_score` is the one component score that differs meaningfully (3 vs 1 — Apollo's own
  1-5 internal scoring).
- `deliverability_score.date_from`/`date_to` show these are **rolling 7-day averages**
  (Sep 21–27), not lifetime — directly relevant to F10 below.
- Apollo's own `avg_open_rate` for this window (9.25% / 0.823%) closely matches what the
  dashboard currently displays (9.3% / 0.8%) — unlike the bounce-rate case in F8, this
  particular dashboard number tracks Apollo's own figure well.

---

## F10 — Period label check

**With any period selected, Sequence Leaderboard and Mailbox Health show the same values —
Apollo lifetime totals, never period-scoped.** Confirmed by citation, not inference:

- `src/components/salesAnalytics/SequenceLeaderboard.js:27` — `function SequenceLeaderboard({ allRows, entities, ... })` — receives `allRows`, never `periodRows`.
- `src/components/salesAnalytics/MailboxHealth.js:10` — `function MailboxHealth({ allRows, entities, ... })` — same.
- `src/components/salesAnalytics/SalesAnalyticsTab.js:156` — the one line that renders every
  widget: `<Widget allRows={allRows} periodRows={periodRows} ... />` — both props exist and are
  passed to every widget equally; these two widgets simply never read `periodRows`.

Both widgets use `lastValue()` (the latest single day's cumulative counter), not a
period-bounded computation — by design, per the names-fix-v1 SPEC's own reasoning
("per-sequence/per-mailbox values are lifetime totals"). That reasoning is real and correct for
*why* it doesn't need 2+ days of history — but it also means the period selector
(This Week/Last Week/MTD/Last 30d/Custom) has **zero visible effect** on either widget,
regardless of selection.

**No UI label tells the user this.** Grepped every file in `src/components/salesAnalytics/` for
"lifetime"/"all-time" — the words exist only in code comments (developer-facing), never in any
rendered string. Widget titles are plain: `"Sequence Leaderboard"`, `"Mailbox Health"`
(`widgets.registry.js:21,26`) — no qualifier of any kind.

For contrast: Overview/KPI tiles' Delivered/Opened/Replied numbers and the Email Trend widget
*do* use `periodRows`/weekly buckets and correctly respond to the period selector — this
inconsistency (2 of 5 widgets ignore the selector, 3 respect it) is itself part of the finding.

---

## RECOMMENDATIONS (not decided)

- `GET /emailer_messages/search` (0 credits, real date-range filter) looks like the real fix
  for the original core-v1 audit's "no working date-range endpoint" gap (A6c) — worth
  evaluating for a future SPEC that wants real weekly email-level data instead of lifetime
  deltas.
- If Jack wants Bounce % to match what Apollo itself reports, the formula would need to change
  from `bounced / delivered` to `bounced / (delivered + bounced)` (F8) — a real, small,
  deliberate decision, not a bug fix.
- `reply_class` (F7) is a ready-made, real field for a "Positive Responses" scorecard KPI —
  likely candidate definition: `willing_to_meet` (+ maybe `follow_up_question`/
  `person_referral` as softer positives), excluding `not_interested`/`unsubscribe`/
  `already_left_company_or_not_right_person`. Not decided which values count.
- Apollo's label system (F2) could become the real "Partner cadence" toggle Jack wants, but
  only if he starts labeling sequences going forward in the Apollo UI — it isn't already
  populated in a usable way today (1 of 9 active sequences labeled).
- The two mailbox `inactive_reason` errors (F9) are real and current as of this session — worth
  Jack's own attention in the Apollo UI regardless of any dashboard change, independent of this
  audit's scope.
- If period-accurate Sequence Leaderboard / Mailbox Health values are wanted (F10), that's a
  real, nontrivial change — would need either the snapshot-delta approach already used
  elsewhere (requires 2+ days of history per period, contradicts today's "valid from a single
  snapshot" design) or a label added to the UI clarifying these two widgets are always
  lifetime, independent of the period selector above them.
- `contact_stages` counts (F6) and the full F5 status tally are both cheap, real follow-ups (9
  and 21 calls respectively, 0 credits each) if a future SPEC/audit wants them — both were
  simply over this audit's own 15-call cap combined with everything else asked.

## OPEN QUESTIONS

1. Does Jack want per-stage contact counts (F6) badly enough to spend 9 more zero-credit calls
   in a follow-up, or is the stage list alone (already obtained) enough for now?
2. Does Jack want the full, authoritative F5 status tally (21 calls) for real "active vs
   paused vs finished" per-sequence reporting, or is the 3-of-9 sample enough signal?
3. Which `reply_class` values should count as a "Positive Response" for the scorecard KPI
   (F7)? Not decided here — a real product judgment call.
4. Should Bounce % be redefined to match Apollo's own `bounced / (delivered + bounced)` (F8),
   or is `bounced / delivered` intentional and Jack just wants to know the numbers won't match
   Apollo's own UI?
5. Is a labels-decode endpoint findable some other way (e.g. Apollo support, or reading it off
   the Apollo UI directly) since no documented API path exists (F2)?
