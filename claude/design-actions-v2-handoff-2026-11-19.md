# Design handoff — Actions v2: "Today" on one ranking (HomeLover) — REVISION 2
Date: 2026-11-19 · From: Design/IA chat · To: the planner
Design only. Nothing here is a spec. REV 2 replaces REV 1 whole.

**What changed in REV 2 (Jack, 2:39 PM):** the list has to help do the work, not only rank it. Every row now carries one Scout verb (Draft email, Draft reply, Prep call, Find people, Next steps) that opens a work panel under the row: suggested next steps, an editable draft, and a Claude prompt. Done moved to a check circle at the left to make room. New decisions D30–D43; D8-table, D12 and D29 rewritten; the rest is unchanged.

Mockups (repo, uncommitted), `specs/design/actions-v2/`:
- `ActionsToday.dc.html` (1440, content 1100) — the screen, REV 2 columns, ⋯ menu open
- `ActionsTodayDo.dc.html` (1440) — row 5 opened: the work panel, the five verbs, working and after states
- `ActionsTodayDoPhone.dc.html` (390) — the work sheet
- `ActionsTodayStates.dc.html` (1440) — Needs attention drawer, bulk date via Scout, in-place menus, done lines, empty states, viewer (REV 1 columns; the viewer table is still correct)
- `ActionsTodayPhone.dc.html` (390) — the list (REV 1 card; add the verb button per D42)
Canvas: HomeLover Sales IA, rows 23 and 24.

Read first: `audits/homelover-data-model-v1-report.txt` Part C and list (5); `claude/design-scout-v3-handoff-2026-11-10.md` (confirm card, done line, Copy for Claude pack, "Scout never sends"); `claude/design-top-targets-handoff-2026-11-13.md`; `claude/design-people-assign-handoff-2026-11-13.md`. Repo at 8be04c5: `goals/ActionsView.js`, `api/sales/todoWrite.js`, `goals/CompanyActions.js` + `companyPanelModel.js` playbookPrompt (the existing Draft-in-Claude path), `companyPanel.js` markContacted.

## The screen, top to bottom
1. Header: "Today" + the date · right: "Needs attention n" button · "+ To-do" (primary).
2. "This week's five" strip (collapsible).
3. One chip row + search.
4. Count line.
5. The ranked list: five groups, numbered rows, each with a Scout verb.
6. Footer: the ranking rule in one paragraph.

## Numbered decisions

### The ranked list
D1. **One list, five groups, in this order:** (1) Due and overdue · (2) Pinned or P1 company · (3) Visited this week · (4) Reply owed · (5) Everything else. Group headers are the kit's inset band rows: name · count · one-line reason.
D2. **A to-do appears once,** in the first group it fits. Inside a group: earliest due, then company score, then newest.
D3. **Rows are numbered 1…n across groups.** The number is the rank. The list is not sortable.
D4. **Group 1 shows due today plus the most recent overdue, then one line: "Show all n overdue · oldest is n d late".** 65 are overdue with a median of 15 days. How many show before the fold is the planner's number; the mockup shows three.
D5. **Group 5 "Everything else" is collapsed by default** (271 undated, 251 without a company).
D6. **Reply owed rows exist even when no to-do does** (4 of the 5 real replies have none). The row reads "Reply to <person>", origin glyph = reply, Due cell = "replied <date>".
D7. **Signals and flags are rows in this list.** Tidy suggestions are not (217 of 240 are "set a date"; D26 replaces them).
D8. **Waiting-on rows and commitments are not on this screen.** See question 2.

### The row (1100 px) — REV 2
| Column | Width | Content |
|---|---|---|
| # | 34 | rank |
| ✓ | 30 | check circle = Done |
| Task | flex (~230) | text, 500 weight, one line, ellipsis; click opens the existing detail |
| Company | 220 | link · pinned star · score pill ("P1 72"); visit count in group 3; "—" when unlinked |
| Person | 186 | name · heat pill ("Hot 48"); "—" when none |
| Owner | 80 | dot + first name; hollow dot + "—" when unassigned |
| Due | 104 | "Today" · "Fri Nov 20" · red "3 d late" · undated = dashed "Set date" link |
| From | 42 | origin glyph with title and aria-label |
| Scout can | 128 | the row's one verb button |
| ⋯ | 44 | menu |
D9. Rows are 42 px. Score and heat pills are the kit's outlined pills at 20 px.
D10. **Origin glyphs** (grey, never neon): phone = call notes · pen = typed · spark = Scout · pulse = signal · window = company window · reply arrow = reply owed. Fold the rest into three (loop = plan / carry-over / nudge, tray = import, gear = system / tidy).
D11. **Company and person cells are empty on most rows today** (76 of 342 resolve to a record; only flags carry a person). Show "—", keep the columns.

### Finishing and the ⋯ menu
D12. **Done is the check circle at the left of the row** (20 px, hairline; green with a tick on hover and focus; aria-label "Done: <task>"). Done line: green check · "Done: <task>." · Undo with seconds left.
D13. **⋯ menu, 220 px, one-click list:** Reassign · Snooze · Due · Add to this week's five · hairline · Open (names the company) · Drop (red).
D14. **Reassign, Snooze and Due swap the menu's rows in place** with a back row. Snooze offers Tomorrow · Monday · 1 week · Pick a date, each with its date.
D15. **Every write gets the done line with Undo 10 s.**
D16. **Viewer (Seif):** no check, no verb button, no ⋯, no strip controls, no "+ To-do".

### Chips
D17. **Mine (default) · Team | Overdue · Undated · Snoozed (n) | Source select.** The Kind select is removed.
D18. **Team includes unassigned** (118).
D19. Count line: "Showing 164 of 342 open · ranked for you, not sortable".

### "This week's five"
D20. **Recommendation: drop the Plan this week drawer and the Monday nudge; keep one strip of five slots.** Plan this week was saved twice, last on Oct 19. The list ranks; the strip is where a person overrules it. Add from any row's ⋯, remove from the slot, clears Monday. One 44 px line when collapsed or empty. Called "five", not "pin", because Pin means a pinned company. Removing it later costs nothing else.

### Removed
D21. The "Week of" card, Commitments + Focus 5, Pipeline moves, Track & improve, the Plan nudge, the Tidy band, the Kind select, the Priority column, the Why column.

### Needs attention
D22. **A right drawer (440 px) from the header button.** The count is the number of "Fix the list" items, never more than five, worst first.
D23. **Each item is one sentence + one button:** "4 replies have no to-do" → Add 4 to-dos · "118 to-dos have no owner" → Assign with Scout · "251 to-dos have no company … 26 name a company in their text" → Link 26 · "271 to-dos have no date" → Date with Scout.
D24. **"Data feeds" below:** Apollo sync · Site visitors · Call-note intake. A healthy feed never counts toward the number. A failed feed turns red and moves to the top.
D25. Every button in the drawer opens Scout's confirm card or runs a write with the done line.

### Undated and empty
D26. **Bulk "set a date" is Scout's batch confirm card:** Which · New date as chips · Left alone · first three texts + "and n more" · Confirm · Cancel · "One batch. Undo puts every date back."
D27. **One date for the whole batch.** Scout does not guess a date per to-do.
D28. **Empty states:** "Nothing due, nothing ranked. You have n undated to-dos in Everything else." + Date with Scout · "No to-dos match. Clear filters".

### Phone 390 (list)
D29. Stacked cards under group labels. Card: rank + task · company line · person line · owner · due · origin · then one button row: the verb (flex, 44 px, ombre outline) · Done (84 px) · ⋯ (44 px). ⋯ opens a bottom sheet. Rule footer is one sentence under the last card.

### NEW — Scout does the work (REV 2)
D30. **Every row has exactly one verb button in a "Scout can" column.** It is the generated look: Creamsicle outline and text, spark glyph; filled ombre when open. Neon stays reserved for Scout listening and thinking.
D31. **Five verbs, picked by rule from what the row already has. No model call to choose:**
- Draft reply — a reply is owed
- Draft email — the row has a person or a company
- Prep call — the task names a call or a meeting
- Find people — the company has no one on it
- Next steps — nothing is linked
The exact tests and their order are the planner's; the design needs one verb per row and never a blank cell.
D32. **Clicking the verb opens a work panel under that row,** full table width, inset ground, 3 px ombre left edge. One panel open at a time; opening another closes this one. Esc closes and returns focus to the verb button.
D33. **The panel has three panes, left to right:**
1. **Next steps · suggested** (300 px). Up to three numbered steps. Each = one bold sentence, one muted line saying what it is based on, one button. Drawn: "Send this email to Danilea Mayer" → Use draft · "Bring in Frank Wagner, Benefits Manager" → Draft for Frank · "Follow up Tue Nov 24 if no reply" → Add to-do.
2. **Draft** (flex). To (name · title, company — never an address) · Subject · editable body · Copy (primary) · Open as a mail draft · Shorter · Warmer · Try again. Top right: "Nothing is sent from Prospector".
3. **Take it to Claude** (300 px). Three prompt chips (Write a 3-touch sequence · Research the account · Prep me for a call), a mono preview of the prompt with the record's context packed in, Copy prompt + the real character count. Under it "What Scout read": the to-do, the record, n people, n visits, n emails, n call notes.
D34. **A step with nothing behind it is not shown.** The "based on" line is required. If Scout has no grounds for any step, the pane says "Nothing to suggest beyond the draft."
D35. **Step buttons act through what exists:** Use draft focuses the draft pane · Draft for <person> regenerates the draft for that person · Add to-do goes through the one to-do writer with origin scout and the done line.
D36. **Panel footer:** "Sent it yourself?" · Close · Done · **Done and mark <person> contacted** (primary; the existing Mark contacted write). Done line: "Done: <task>. <Person> marked contacted." with Undo.
D37. **After Copy,** the done line reads "Draft copied. Mark it done when it's sent." with a Done button in place of Undo. Copy never marks the to-do done by itself.
D38. **Working state:** the panel opens at once with "Reading <company>…" in the ombre label and three skeleton bars. Panes fill as they arrive. Failure: the pane says what failed and offers Try again; the Claude prompt pane still works because it needs no model call.
D39. **The Claude prompt is the Copy for Claude pack plus an ask.** Names, titles and companies only; the same hasPii check as Scout answers; a pack that trips is not copied and says so.
D40. **Verb per kind:** Prep call's middle pane is a brief (who is on it, last touch, three questions to ask, one risk) instead of a draft. Find people's middle pane is a list of people at the company not yet on a to-do, each with Add and Draft. Next steps has no middle pane; its left pane is wide. Only Draft email is drawn; the others reuse the frame.
D41. **Scout is the same engine.** Typing "draft the email for the Cloudflare one" or "what should I do next on #4" opens the same panel on that row. A Scout answer that lists to-dos shows the same verb button per row.
D42. **Phone:** the verb opens a full-height sheet titled with the task. Three tabs: Draft · Next steps · n · Claude. Draft tab: To, Subject, body at 15 px, tone chips, Copy and Open in Mail (48 px, side by side), then "Done and mark <person> contacted".
D43. **Nothing is generated until asked.** The list loads with verb labels only. The draft and steps are made when the verb is clicked. No dollar figure appears anywhere.

## Real vs placeholder
Real (from the audit and earlier handoffs): 342 open, 164 the owner's, 118 unassigned, 65 overdue, 271 undated, 251 with no company, 26 linkable by text, 4 replies with no to-do; company names, scores, bands and pins; people's names, titles and heat.
Placeholder: every task text in [brackets], every per-group count, visit counts, dates of opens and visits, the "based on" lines, the draft body (structure only, bracketed), the prompt preview and its character count, feed times, the strip's three slots, the "4" on Needs attention.

## Questions for the planner
1. D4: how many overdue rows show before the fold, and does very old overdue skip Today?
2. D8: waiting-on (13 open) and commitments (32, none since Oct 19) have no home here. Retire commitments for the five? Where does waiting-on go?
3. D21 removes Pipeline moves. Is the weekly funnel its replacement?
4. D10: fold eleven origins into nine glyphs / Source options?
5. Should bulk drop exist next to bulk date (339 of 342 never touched)? Not drawn.
6. D6: is a reply-owed row virtual, or does the system create the to-do?
7. D33/D43: is the panel one model call (steps + draft together) or two? The design works either way; D38 assumes panes can arrive separately.
8. D33 "Open as a mail draft": is there a path today that opens a draft without an address in Prospector's own UI (Outlook draft via the connected mailbox), or is Copy the only honest button? If there is none, drop the button.
9. D34: what counts as grounds for a step (a visit, an open, a reply, a call note, a stage)? The design needs the list so the "based on" line can be written from stored facts, not by the model.
10. D40: Find people — from Apollo's stored people only, or does it search? Searching costs an Apollo call; the design assumes stored only.

(Planner's answers to 1–10: inbox/2026-11-19-1500-actions-v2.txt, Design decision Q1–Q10.)
