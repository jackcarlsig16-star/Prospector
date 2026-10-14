# master-pipeline-import-audit-v1 — report

Run 2026-10-14. READ-ONLY: SELECTs on HomeLover (`bc69beab…`) only — 9 reads, ~3.5 s, 0 writes,
0 Apollo / 0 Claude / 0 syncs. No email or phone column was selected. restored: n/a.

**Input:** `inbox/2026-10-14-1030-master-pipeline-sanitized.csv`. I re-checked the planning chat's counts and every one
matched: 275 rows, 32 columns, 275 unique Record IDs. One row has a blank Owner Team (HLU-0226). "Next Step Due" is
filled on 1 row (HLU-0001, 2026-10-15).
PII scan: 0 "@" in the file and 0 phone-number patterns in any cell.

**REV2 status: pending.** On HomeLover, `sales_goals.owner_team`, `sales_sequenced_accounts.owner_team` and
`partner_contacts.role_in_notes` don't exist, and the `sales_targets` table doesn't exist. The repo has no REV2
migration file either.

**Ground-truth corrections (details in the answers below):**
- **Apollo moves are not dry-run only.** The daily step auto-applies every Apollo proposal: `sequence_added_at` → Sent
  and a stored reply → Replied. Only partners whose sequenced contacts are all paused are held.
- **An employer-level stage table exists.** `sales_opportunities` (sales-pipeline-v1) has a stage, an owner, a next
  action with a date, and a CSV import. It holds 1 test row on HomeLover.
- **Employers do have a people table.** It's `sales_prospect_state`, but it only holds Apollo contacts.

## Q1 — Unit
- **Partner → partner row:** `sales_goals` with goal_type `'partnership'`
  (`20261005_sales_goals_v1_rev3.sql:15`). HomeLover has 76 active partners, 0 archived, and 0 goal_type `'company'` rows.
- **Employer → nowhere you can write today.**
  - `sales_sequenced_accounts` (`20261006_sales_goals_v1_rev4_stage3.sql:155-167`) has 193 rows. Only the Apollo sync
    writes it (`api/sales/sequencedAccounts.js:48,61`), and its key is the Apollo `account_id`. A file can't create
    rows there.
  - `sales_opportunities` (`20261001_sales_pipeline_v1.sql:25-51`, `org_type` employer|membership|channel_partner)
    can take a file: `POST /opportunities/import` (`server.js:515`), which upserts by organization name
    (`api/sales/pipelineRoutes.js:186-190`). HomeLover holds 1 row ("test"). Nothing in Goals/Partners/Huddle reads
    it as the employer record.
  - REV2's `sales_targets` (employer kind) is still pending.
- **Association (15):** nearest is a partner with category `12. Membership Orgs & Unions`, or an opportunity with
  `org_type='membership'`.
- **Health plan (2), Other (1):** no home.
- **What gets tracked, by track:**
  - Partners are tracked as accounts. People hang off them in `partner_contacts`
    (`20261007_partner_360_v1_stage1.sql:15-30`, 56 rows).
  - Employers are tracked as people. `sales_prospect_state` holds 134 rows keyed on the Apollo `contact_id`
    (`20261001_sales_hot_prospects_v1.sql:66-85`), and its account name is just a `company` text field.
- **Shape:** one row per account, plus a separate contacts file keyed on Record ID. Every table that can take a person
  is per-account (`partner_contacts.goal_id`) or Apollo-keyed. 22 sheet rows put two or more people in one
  Primary Contact cell, and those cells would need splitting.

## Q2 — Field map
| Sheet column | Prospector |
|---|---|
| Record ID | **Missing.** No external-key column on `sales_goals` (rev3:11-29 plus later adds), `sales_opportunities` or `partner_contacts`. `sales_sequenced_accounts.account_id` and `partner_contacts.apollo_contact_id` are Apollo ids only. |
| Account | `sales_goals.name` (rev3:16) / `sales_opportunities.organization` (pipeline_v1:28) |
| Account Type | `sales_goals.goal_type` covers partnership only in practice; `sales_opportunities.org_type` (pipeline_v1:30). Health plan / Other: missing. |
| Segment (66 values) | **Missing.** `category` is the partner list below, not an industry. Nearest free-text column is `partner_role` (pipeline_stage1:14); for employers, `sales_opportunities.cohort` (pipeline_v1:29). |
| Priority Tier | `sales_goals.tier`; allowed values `'1','2','3','4','active'` (`pipeline_stage1:25-27`, `src/constants/partnerPipeline.js:18`). See the tier section below. |
| Funnel Stage | `sales_goals.pipeline_status` (`pipeline_stage1:28-32`). See the stage mapping table below. |
| Partner Path (7 values) | **Missing.** It describes a route, not a category, so nothing matches it. Nearest free text: `partner_role` or `sequence_to_use` (pipeline_stage1:14,19). |
| Owner Team | **Added by REV2 (pending):** `owner_team` homelover\|upside\|both. |
| Owner | `owner_user_id` → profiles (rev3:18). "Brad Cillian" isn't a user, so this stays null or keeps today's owner. "Jack" → his user id. See the owner section below. |
| Co-owner Team | **REV2 (pending):** `co_owner_name` holds a person's name, not a team. The sheet always says "the other team", so the column adds nothing beyond Owner Team. |
| Next Step | `sales_goals.next_step` (pipeline_stage1:19). 75 of 76 partners already have one. |
| Next Step Due | **Missing on the account.** Nearest: a linked to-do's `sales_week_goals.due_date` (`20261007_task_drawer_v1_stage1.sql:15`); for employers, `sales_opportunities.next_action_date` (pipeline_v1:39). |
| Last Touch Date / By | `last_touch_at` (pipeline_stage1:22), plus `sales_partner_events` touch rows (`20261007_partner_touch_log_v1.sql`; 44 events, 24 touches). Written by `applyPartnerSignal` (`api/sales/partnerSignals.js:76-78`). These must stay blank in the file. |
| Primary Contact / Title | `partner_contacts.name` / `.title` (partner_360_stage1:20-21), partners only. Allowed sources: `apollo\|manual\|outlook` (:24). |
| Primary Email Domain | `partner_domains.domain` (`20261007_partner_360_v1_stage2.sql:17-26`), partners only. A domain isn't contact data. HomeLover has 22 domain rows; `company_domain` is filled on 0 partners. |
| Email Status | **Must NOT be stored.** It describes contact addresses (see Q6). |
| Has Phone | **Must NOT be stored** (see Q6). |
| Contacts Emailed (#) | **Missing.** For partners, it can be counted from `partner_contacts` / touch events instead. |
| Contacts Emailed Domains | Candidate for `partner_domains`, but only as `confirmed=false`. Outlook matching ignores unconfirmed domains (`api/sales/partnerOutlookTouches.js:38-41`). |
| Route In, Broker on Account, Brad Reached Out, HomeLover Outreach, Both Teams Touched, On Brad Target List, Original Priority, Source, Confirmed with Brad | **Missing** as columns. `Both Teams Touched` relates to REV2's `no_double_touch`, but it's a different fact. |
| Flags | Nearest: `do_not_say` / `watch_outs` (pipeline_stage1:20, rev4_stage3:55) |
| Notes | `sales_goals.notes` (rev3:23) |

**Stage mapping** (sheet's 9 values → `pipeline_status`'s 10):

| Sheet Funnel Stage | pipeline_status | Rows |
|---|---|---|
| 1 Not contacted | not_started | 109 |
| 2 Contacted | first_email_sent (in_sequence if in an Apollo sequence) | 85 |
| 3 Engaged | replied, closest match. "Engaged" is wider than a reply, so this is **no exact match**. | 4 |
| 4 Meeting scheduled | meeting_set | 2 |
| 5 Meeting held | **no match.** Stays meeting_set; `meeting_status` is free text (rev4_stage3:51). | 0 |
| 6 Pilot / proposal | proposal_pilot | 0 |
| 7 Live | live | 0 |
| 8 Nurture | **no match** | 38 |
| 9 Hold / disqualified | paused, closest match. Partners have no lost/disqualified status. **No exact match.** | 37 |

Unused by the sheet: researching, first_email_drafted.
`sales_opportunities.stage` (`target…launched, lost`, pipeline_v1:32-34) fits the employer side more naturally: Engaged →
responded, Hold/disqualified → lost. Nurture has no match there either.

**Tier:** HomeLover's partner tiers today are 1: 22 · 2: 24 · 3: 13 · 4: 9 · active: 7 · null: 1. The sheet's
"1 - Priority … 4 - Hold" maps by its number prefix. Of the 24 partners matched in Q3, 11 have a different tier
in Prospector:

| Partner | Prospector tier | Sheet tier |
|---|---|---|
| Aon, Mercer, WTW | 2 | 1 |
| OneDigital | active | 1 |
| Access Development, EBG, Insperity, Piñata, Stake, TriNet | 1 | 2 |
| Alliant | null | 1 |

**Category:** free text, not an enum (`api/sales/goalsRoutes.js:38`). The real list has 14 values, each with a number
prefix (`src/components/salesAnalytics/goals/partners/partnerTypes.js:5-14`):

| Category | Partners |
|---|---|
| 1. Current Partners (active) | 7 |
| 2. Perk Marketplaces & Benefit Platforms | 6 |
| 3. PEOs | 5 |
| 4. Mid-Market Benefits Brokers | 7 |
| 5. Rental Rewards & Renter Platforms | 13 |
| 6. Enterprise Benefits Consultants | 4 |
| 7. HR / Payroll / HRIS Marketplaces | 5 |
| 8. Benefits Admin & Enrollment | 4 |
| 9. Financial Wellness & EWA | 4 |
| 10. HR Research & Thought Leadership | 5 |
| 11. CPA, Tax & Law Firms | 4 |
| 12. Membership Orgs & Unions | 3 |
| 13. Public Sector & HFAs | 4 |
| 14. Co-opetition & Housing Counseling | 4 |
| (none) | 1 |

Neither Partner Path nor Segment maps onto it.

**Owner:** HomeLover partners today are owned by Cyrus (39), Jack (36) and nobody (1). Of the 24 matched partners:
- **9 are Upside-owned in the sheet:** Aon, Alliant, Gallagher, HUB, Lockton, Mercer, WTW, Marsh McLennan Agency, NFP.
  Prospector has them on Jack (Aon, Mercer, WTW), Cyrus (Gallagher, HUB, Lockton, MMA, NFP) or unassigned (Alliant).
- **4 disagree on a HomeLover owner:** the sheet says Jack, Prospector says Cyrus — Justworks, Insperity, TriNet, ADP.

## Q3 — Matching
Names were compared with the `normName` rule from `scripts/import-partners-sheet.js:44-50` (exact match, then whole-word
partial match), plus confirmed `partner_domains` and `company_domain`. Sequenced accounts and prospect companies were
compared by name.

**Results for the 275 sheet rows:**
- **24 → an existing partner:**
  - 21 exact name matches.
  - 2 partial name matches: Invest with Roots → Roots, Bilt Rewards → Bilt.
  - 1 domain match: ADP → ADP TotalSource. The sheet calls it an Employer; Prospector has it as a partner.
- **15 → a sequenced account:**
  - 10 exact name matches: Solidcore, 24 Hour Fitness, Hilton, Hyatt, Marriott International, Netskope, AutoNation,
    Macy's, Nike, Target.
  - 5 partial name matches: Choice Hotels, Cox Communications California, Enterprise Rent-A-Car, Verizon Wireless,
    and **Hilton Grand Vacations → Hilton, which is a false positive**. It's a different company.
- **236 → nothing:** 188 Employer, 30 Partner, 15 Association, 2 Health plan, 1 Other.
- 4 sheet names also match a `sales_prospect_state.company`.

**Duplicates inside the sheet:** 0, by both Record ID and normalized name.

**Sheet Partners missing from Prospector (30):** Brown & Brown (sheet: Meeting scheduled, Priority), 32BJ Benefit Funds,
Deloitte, Voluntary Advantage, Burnham Benefits, EPIC Insurance Brokers, Fairmount Benefits, GCG Financial,
Hays Companies, Infiniti HR, Maniaci Insurance Services, Archetype Growth, BevCap Management,
Conner Strong & Buckelew, Howden, IMA Financial Group, AutoPayChecks Clients, Brystra, CPI HR, McGrath Affinity,
Member Savings Program, Merrimack, United Workers Wellness, Affinity Travel Benefits, Buyer's Edge Platform,
Capital Group Financial, Lenser & Co, Life Expert How, MyPlanAdvocate, Comfort Insurance Services.

**Prospector partners missing from the sheet (52):** ADP Marketplace, AFT, Action Property Management, Alera Group, Alight,
Benevate, Brightside, Businessolver, CalHFA / California HCD, DailyPay, Domuso, Equifax, Financial Finesse,
Florida Housing Finance Corp., Framework, Gravy, Gusto, HoganTaylor, IHDA, Incentco, Iron Mountain, KPM CPAs,
Lender Homepage, LCW, Local Housing Solutions, Mauldin & Jenkins, NCSHA, NEA Member Benefits, NAR, NHC, Nayya,
NeighborWorks America, Norton / Gen Digital, Oro Impact, Payactiv, Paylocity, Perks at Work, RPM Resident Benefits
Package, RentPlus, Rippling App Shop, SHRM, Segal, Self Financial, Sequoia, Sylvia, Tenvera, USI, Union Plus,
Upside, Workday Marketplace, WorldatWork, bswift.

**Where the sheet would move a partner BACKWARDS (5):**

| Partner | Prospector now | Sheet says |
|---|---|---|
| OneDigital | meeting_set | 3 Engaged (replied) |
| Gallagher | replied | 2 Contacted (first_email_sent) |
| Access Development | first_email_sent | 1 Not contacted |
| EBG | first_email_drafted | 1 Not contacted |
| Insperity | researching | 1 Not contacted |

None of the matched partners is at Nurture or Hold in the sheet, and none is paused in Prospector, so no
pause/unpause conflicts.

## Q4 — Automation
**Partners, Outlook.** The daily step `runDailyOutlookMoves` (`api/sales/partnerOutlookTouches.js:299-308`) runs on
every real Graph sync (`api/microsoft/graphSync.js:210`):
- It records touches (`recordOutlookTouches`, :305).
- It auto-applies Sent (:126) and in-thread Replied (:137, `auto: inThread`).
- It holds cold replies and calendar meetings for an OK (:24, :137, :152).
- A touch or a move into a contact stage stamps `last_touch_at` (`partnerSignals.js:76-78, 96`).

**Partners, Apollo.** `runDailyApolloMoves` (`api/sales/partnerApolloTouches.js:155-160`, called from
`api/sales/sync.js:270`) auto-applies everything the dry run proposes: `sequence_added_at` → Sent, a stored reply →
Replied (:1-6). It holds only partners whose contacts are all paused (:20).
**This corrects the ground truth.** Sent from Apollo is applied automatically, not just proposed.

**Employers.** Nothing moves an account stage, because employers have none.
- A reply lands on `sales_email_messages.replied` / `reply_class` through the Apollo sync. It drives the per-contact
  next best action (`api/sales/nextBestAction.js:12-19`: book_meeting, reply_today).
- `sales_prospect_state.status` (new…booked) is set by hand in the Huddle. The sync never touches it
  (`api/sales/activitySync.js:229-231`).
- A calendar invite writes nothing for employers. `outlookMeetings.js:5-14` only counts meetings, and only for
  partner domains.
- `sales_opportunities.stage` changes only by hand or through its CSV import.

**The gap:** "reply → Engaged, invite → Meeting scheduled" for employers needs an account-level stage on whatever
becomes the employer record, plus a rule that rolls a contact's reply or meeting up to its account. That's the overlap
between **employer-records-v1** (needs an AUDIT first) and **sales-funnel-v1** (inbox, not built; its funnel unit is
COMPANY, `inbox/2026-10-07-1310-sales-funnel-v1.txt:25-26`). It also overlaps the dormant `sales_opportunities`.

## Q5 — Upside / Brad side
- **(a) Intake paste (REV2, pending).** REV2 writes partner touches, people, intel and ownership. Employers get only
  ownership and tasks; their touches stay with the note (REV2 Status §). Brad's updates would land in
  `sales_call_notes`, `sales_partner_events`, `partner_contacts` and the new owner columns.
- **(b) Manual Log touch + bulk catch-up.** Exists for partners only, through `applyPartnerSignal` `touch`
  (`partnerSignals.js:22-27, 55-82`; touch source `manual|outlook|apollo` in `20261007_partner_touch_log_v1.sql`).
  "By Brad" can only go in `contact_names` or the note: `by_user` points at profiles, and Brad isn't one.
- **(c) Repeat file import keyed on Record ID.** Doesn't exist. There's no external-key column (Q2).
  - Precedents: `scripts/import-partners-sheet.js`, which matches by name, only fills empty fields, writes no
    events, and is idempotent (:8-21). It did set `last_touch_at` from the sheet with no event (:133).
  - The `sales_opportunities` CSV import upserts by organization (`pipelineRoutes.js:186-190`).
  - It would touch `sales_goals` plus whatever employer record is chosen.
- **(d) Brad as a Prospector user.** He'd get a profile and a `business_members` row, so he could be an
  `owner_user_id`. The Huddle owner enum is still `jack|cyrus|unassigned` (`20261001_sales_hot_prospects_v1.sql:74`;
  CLAUDE.md "Known gap M5"). REV2 marks this out of scope.
- *Recommendation (marked as such):* (a) for activity, plus a one-time (c)-style fill of ownership and tier for
  existing partners. Adding (d) is a product decision for Jack.

## Q6 — Must not import
- **Contact emails, anywhere:** they come from Apollo or Outlook only. `partner_contacts.email` is DB-only
  (`specs/partner-360-v1.txt:52`), and inbox spreadsheets with emails are never copied into the repo
  (CLAUDE.md "inbox/*.xlsx").
- **Phone numbers, and "Has Phone":** "Never reveal or store phone numbers" (CLAUDE.md "Apollo is read-only" line).
  `sales_prospect_state.phone` stays null (`20261001_sales_hot_prospects_v1.sql:72`). Has Phone isn't a number, but it
  describes contact data that can't be stored, so I'd leave it out. If you want it, that's your call.
- **Email Status:** it describes addresses, and 4 rows say "Personal address".
- **Last Touch Date / By:** these must come from events through `applyPartnerSignal` (CLAUDE.md "Partners: stage
  changes ONLY via applyPartnerSignal"). A file shouldn't set them.
- **Any Funnel Stage behind Prospector's current stage:** the 5 rows in Q3. Prospector never moves a stage backwards.
- **Anything that writes to Apollo:** Apollo is read-only.

## Shape Prospector wants
- **Two files**, both CSV, UTF-8, with headers exactly as below.
- **accounts.csv**, one row per account:
  - `record_id`: HLU-0001…, stable forever.
  - `name`
  - `kind`: `partner` | `employer` | `association` | `health_plan` | `other`
  - `category`: partners only, one of the 14 values exactly as listed in Q2, or blank.
  - `tier`: `1` | `2` | `3` | `4`
  - `stage`: partners only; one of `not_started`, `researching`, `first_email_drafted`, `first_email_sent`,
    `in_sequence`, `replied`, `meeting_set`, `proposal_pilot`, `live`, `paused`. Leave it blank for "Nurture"
    (no match), and for employers until employer-records-v1 decides their stage list.
  - `owner_team`: `homelover` | `upside` | `both`
  - `owner_name`: a Prospector member's first name (`Jack` / `Cyrus`), or blank when the owner isn't a member.
  - `co_owner_name`: a person's name, not a team.
  - `next_step`: text.
  - `next_step_due`: `YYYY-MM-DD` or blank.
  - `company_domain`: a single company domain, or blank. Never a consumer mail domain.
  - `segment`, `partner_path`, `route_in`, `broker_on_account`, `source`: text for now, with no home yet (Q2).
  - `flags`, `notes`: text, with no email addresses or phone numbers in them.
- **contacts.csv**, one row per person, no emails, no phones:
  - `record_id`: the account's key.
  - `name`: one person per row. Split the 22 multi-person cells.
  - `title`
  - `role`: `champion` | `blocker` | `referrer` | `counterpart` | `other` | blank. This is REV2's `role_in_notes`, pending.
- **Must be blank or absent:** `last_touch_date`, `last_touch_by`, `email_status`, `has_phone`, any email or phone.
- **Dates** are `YYYY-MM-DD`. Booleans are `yes` / blank.

## Open questions for Jack
1. **Employer home:** where should an employer that isn't in Apollo live? Options: REV2 `sales_targets`, the dormant
   `sales_opportunities`, or wait for employer-records-v1.
2. **Backwards rows:** for the 5 rows that disagree with the sheet (OneDigital, Gallagher, Access Development, EBG,
   Insperity), does Prospector win? Its stages came from real events.
3. **Owners:** for the 9 Upside-owned partners, should `owner_user_id` stay Jack/Cyrus (the internal contact) with
   `owner_team='upside'`, or be cleared? And who's right on Justworks, Insperity, TriNet and ADP?
4. **New partners:** should the 30 sheet Partners missing from Prospector become partners, or REV2 targets?
   Brown & Brown has a meeting on 2026-10-15.
5. **Nurture (38 rows):** paused, or a new status?
