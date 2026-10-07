# phase3-builds-audit-2026-10-07 — report

Read-only audit of sales-partners-workflow-v1 (Stages 1–4) and goals-surface-v1 REVISION 1 (Stages 2–5), plus a diagnosis of the 1.3% October open rate. No fixes made.

**Scope as run.** Temporary workspaces T1 and T2 with test partners, 4 temp users there, and 3 temp users in HomeLover (Owner, Member, Viewer) for the read-only checks. Everything was deleted afterward; I verified 0 leftover workspaces, members, partners or auth users. HomeLover partners and goal targets were identical before and after. **restored: yes.** 0 Apollo calls, 0 Anthropic calls, 0 writes to real rows.

**Totals.** Live probes 31/31 passed across two runs (the first hit its 4-minute cap during the Viewer screens, so I reran the Viewer screens on their own, 4/4). Unit suites 9/9 passed one at a time (50 tests). Screenshots are in the session scratchpad at `shots/p3/`.

---

## Part A — phase 3 builds

### Critical
None.

### High
None.

### Medium

**M1. The Goals tab takes about 3.8 s to show the goal cards. It loads the month's scorecard twice and fires about a dozen requests at once.**
- **Where:**
  - `goals/GoalHero.js` `load()` fetches the scorecard for every month in its 6 weeks (`goalsApi.scorecard` per month).
  - `goals/GoalsTab.js` `loadScorecard()` already fetches the current month.
  - The engagement route runs `huddleWeekCounts` 6 times, and each run re-reads every flag to-do (`api/sales/huddleWeek.js:22`).
- **Measured:**
  - Goals hero visible in 3.8 s, the Overview partner summary in 2.8–3.3 s, the Huddle in 1.3 s, for all three roles at both widths.
  - Server time is ~1.3 s for the two scorecards and ~0.6 s for 6 engagement weeks. The rest is browser and connection contention: on load Goals also fetches the report, KPI table, to-dos, companies (this week and all weeks), partners, cadences and members.
- **Failure scenario:** on a slow phone connection the top of Goals stays on "Loading goals…" for several seconds, which defeats the point of putting goals above the fold.
- **Suggested fix (FIX-A):**
  - Pass GoalsTab's already-loaded current-month scorecard into GoalHero, so the hero only fetches the earlier month.
  - Optionally add one `/goals/hero?week=` route that returns all 5 cards × 6 weeks in a single call, sharing one flag read across the 6 weeks.

### Low

**L1. Two members reordering the same group at once: one move can silently lose.**
- **Where:** `api/sales/partnerRank.js` (by design, last write wins) and `PartnersView.js` `rank()`.
- **Observed:**
  - Two simultaneous moves in an unordered group both returned 200, and no duplicate positions appeared (`A -1, B 0, Same 1, Same 2`).
  - Member 1 moved a row to position 2 and Member 2 moved another to position 3. The final order kept Member 2's intent; Member 1's row is not where they put it.
  - Neither person is told.
- **Scenario:** only plausible if Jack and Cyrus drag in the same category within the same second.
- **Suggested fix:** none needed now. If it ever bites, re-fetch partners after every reorder so the screen shows the real order.

**L2. Two dead exports in `palette.js`.**
- `PRIORITY_COLORS` (`palette.js:134`) lost its only user when the P1/P2/P3 card layout was removed in partners-workflow Stage 4.
- `openHealthColor` has no users anywhere; it predates this phase.
- **Fix (FIX-B):** delete both. Check them against the CLAUDE.md landmines list first; neither is on it.

**L3. Exports only used inside their own file.**
- `eventText` (PartnerDetails), `StageBar` (PartnerRow) and `NEXT_STEP` (partnerPipeline) are exported, but only their own file uses them.
- `weekTouches`, `PartnerSummary` and `InfraList` are exported for their unit tests, which is fine.
- **Fix:** drop the `export` on the first three when next touching those files. Not worth its own commit.

**L4. The API accepts a month goal for "Real replies + clicks" that nothing reads.**
- `PUT /goals/targets {period:'month', metric_key:'real_replies_clicks'}` returns 200, but the hero card only reads and writes the week goal.
- **Fix:** either refuse `period: month` for that key, or leave it. It's harmless.

### Checked and fine (no finding)

**Access**
- A Viewer is refused (403) on reorder, Set goal, headcount save and partner signals, and can read the engagement route.
- Scorecard `?owner=` set to a user from another workspace returns 400.
- Partner events `?goal_id=` for another workspace's partner returns 0 rows.
- Every sales route for a workspace you're not in returns 403 (tested on a temp workspace and on HomeLover).
- Engagement refuses 14 weeks, a non-Monday start, or from > to (400).
- Saving headcount for a company outside the workspace returns 404.
- Goals for non-Monday weeks and typed-in values for computed metrics are refused (400).
- The drill links' URL values (`?gview=`, `?owner=` slugs, partner filters) are client-side only; every server read re-checks the workspace.

**Integrity**
- Next after Resume works: Paused → Resume back to Replied → Next to Meeting → Undo returns to Replied.
- A second Resume click from an out-of-date screen is refused (409).
- Two partners with the same name both get positions on the first move.

**Numbers: last week (Sep 28) vs raw rows, Team and Jack**

| Card | API | Raw rows |
|---|---|---|
| Audience reached | Team 0, Jack 0 | sequenced rows: none of last week's 18 companies has a headcount yet |
| People in sequence | 2,051 | last synced `prospects_in_cadence` = 2,051 |
| Partners first-touched | 0 | 0 "1st email sent" events |
| Meetings set | null | nothing typed |
| Real replies + clicks | 2 + 4 | bot-filtered activity + reply rows: 2 + 4 |

- Overview stage counts sum to 75. "P1 untouched" is 4, matching the database.

**Leftovers**
- No code references the removed "Cards (old)" layout, the `columns`/`priority` modes, the "at a glance" card, or `focusStage`. The only mentions are comments explaining the fallback.

**UI smoke**
- Owner, Member and Viewer, each at 1440 and 390: all 4 Goals views with the hero, Partners Workflow and Board, Overview and the Huddle load.
- 0 console errors or warnings in the production build, 0 browser writes (a guard blocked any POST/PUT/PATCH during the smoke), no sideways scroll.
- The Viewer sees no Set goal, Next, ⋯ or Move controls.
- 10 sampled dotted-underline links all landed: an Overview stage, the Prospects tile, report "new companies sequenced", report "replies", report "flags handed off", KPI "Qualified opportunities", scorecard "Tier 1 touched", scorecard "Open rate", hero "Audience reached", Huddle strip "real clicks".
- **Not covered:** React dev-mode warnings. The smoke ran the production build, which strips them.

### FIX items for Jack to approve
- **FIX-A (M1):** hero reuses GoalsTab's scorecard; optional single `/goals/hero` route with one shared flag read. Target: hero under 1.5 s.
- **FIX-B (L2):** delete `PRIORITY_COLORS` and `openHealthColor`.
- L1, L3 and L4 need no fix now (recommendation).

---

## Part B — why does October's open rate read 1.3%?

### 1. How it's computed
- **Code:** `api/sales/goalsReportRoutes.js:60-70` (`openRate`) computes Σ`opened` ÷ Σ`delivered` from `sales_email_daily_counts` for the window, optionally narrowed to one owner's mailboxes.
- **The window:** for the month card it's the weeks whose Monday falls in the month (`weeksOfMonth`). For October that is only the week of Oct 5, and only Oct 5–6 had sends when this ran.
- **Where `opened` comes from:** Apollo's own per-message "opened" flag, fetched by the sync from Apollo's message search, one stat per delivery week (`api/sales/emailCounts.js:15-22, 50-93`). It is Apollo's bot-filtered count. Our own `isAutomated` filter is not applied to it.
- **Truncation:** each stat is capped at 10 pages × 100 messages per week. `sales_email_backfill_weeks.complete` is true for all 7 weeks, so nothing was truncated.

### 2. Numbers

**By delivery week (all mailboxes):**

| Week of | Delivered | Opened | Open rate | Hard bounce | Spam-blocked |
|---|---|---|---|---|---|
| Aug 24 | 25 | 17 | 68.0% | 3.8% | 0.0% |
| Aug 31 | 166 | 38 | 22.9% | 3.4% | **26.9%** |
| Sep 7 | 391 | 35 | 9.0% | 3.6% | 3.8% |
| Sep 14 | 445 | 40 | 9.0% | 1.3% | **13.6%** |
| Sep 21 | 470 | 25 | 5.3% | 1.9% | 1.0% |
| Sep 28 | 482 | 33 | 6.8% | 0.4% | 0.8% |
| Oct 5 (2 days) | 159 | 2 | **1.3%** | 1.8% | 0.6% |

**By mailbox:**

| Mailbox | Aug 24 – Sep 27 | Sep 28 – Oct 6 | Apollo deliverability score (Sep 28 – Oct 4) |
|---|---|---|---|
| jack@homelover.ai | 144 / 762 = **18.9%** | 33 / 331 = **10.0%** | 88 (open 12.9%, spam 0.4%, bounce 1.2%) |
| cyrus@homelover.ai | 11 / 735 = **1.5%** | 2 / 310 = **0.6%** | 85.6 (open 0.4%, spam 0.9%, bounce 0.9%) |

**By mailbox × sequence (all weeks):**
- Cyrus sends only the enterprise segments:
  - Car Rental: 890 delivered, 1.3% opened
  - Wireless: 87 + 47 delivered, ~1%
  - Hotel: 21 delivered, 0%
- Jack sends:
  - Fitness: 533 delivered, 21.4%
  - Retail: 296 + 106 delivered, 15.5% / 12.3%
  - SaaS: 110 + 25 delivered, 2.7% / 0%

**Bot filtering, with vs without** (Apollo's own sequence stats, latest snapshot, 10 active sequences):

| | Count | Rate (÷ 1,032 open-tracked deliveries) |
|---|---|---|
| Opens Apollo counts (bots filtered) | 128 | **12.4%** |
| All opens (unfiltered) | 469 | **45.4%** |

- Apollo throws out ~73% of opens as automated.
- Car Rental alone: 202 raw opens, 10 counted.
- Fitness: 167 raw opens, 86 counted.
- Open tracking is on for 1,032 of 1,044 deliveries, so tracking being off is **not** the cause.
- Our own extra filter (`isAutomated`) on stored activity hardly matters: last week it flagged 1 of 37 opens. This week so far 0 of 12.

### 3. Apollo vs us
- Apollo's sequence stats use the same filtered "opened": 12.3% opened ÷ delivered across active sequences, all time. Our weekly numbers, built from Apollo's message flags, agree in kind.
- Apollo's sequence-level "bounce" is 13.4% because it lumps hard bounces with spam blocks (118 spam-blocked). Our split puts recent hard bounces under 2%.
- No extra Apollo calls were made; everything above came from data the sync already stores.

### 4. Bounce and mailbox health
- The last two weeks look healthy: hard bounce 0.4–1.8%, spam-block 0.6–0.8%, deliverability scores 88 and 85.6.
- Spam-blocking was a real problem earlier: 26.9% the week of Aug 31 and 13.6% the week of Sep 14, mostly Jack's mailbox (144 of 156 spam blocks before Sep 28).
- **Worth a look:** Apollo's mailbox records carry OAuth error text in `inactive_reason` even though both show `active: true`:
  - Jack: "invalid_grant … the grant has expired due to it being revoked"
  - Cyrus: "immediately deactivated after oauth", plus `revoked_at` 2026-08-27
- These may be stale from an earlier disconnect, since both mailboxes synced today. Apollo's own mailbox page will say whether either needs reconnecting.

### 5. Verdict (recommendation)
**Mostly measurement and segment mix, not a deliverability failure.**
1. **October has two days of data.** "October" = the week of Oct 5, with 159 deliveries and 2 opens, read on Oct 6. Opens lag by days, so this number will rise.
2. **Apollo's bot filter removes ~3 in 4 opens** (45% raw vs 12% counted). It removes almost all of them in the enterprise segments (Car Rental 202 → 10), where corporate security scanners open every email.
3. **Cyrus's mailbox reads near zero (0.4–1.5%) every week**, but he only sends the enterprise segments (Car Rental, Wireless, Hotel). Mailbox and segment are confounded, so the data can't tell yet whether it's his mailbox or his audience. Bounce and spam rates for his mailbox are as low as Jack's, which points to the audience and the filter, not inbox placement.

**What would confirm it:**
- **(a)** Re-read October after Oct 12, once the week is complete.
- **(b)** Swap one segment: Cyrus sends a small Fitness or Retail batch, or Jack sends a Car Rental batch. If Cyrus's opens rise on Fitness, it's the audience; if they stay near 0, it's his mailbox.
- **(c)** In Apollo, compare unfiltered open rate by mailbox for the same sequence.
- **(d)** Check both mailboxes' connection status in Apollo, given the OAuth error text above.
- **Possible display fix (not a fix item yet):** show the open rate with a "bots filtered by Apollo" note and the unfiltered figure beside it, so 1–12% isn't read as "nobody opens".
