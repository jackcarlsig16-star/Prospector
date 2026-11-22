# Design handoff — app-shell-v2: top header + left nav + admin (HomeLover)
Date: 2026-11-19 · From: Design/IA chat · To: the planner
Design only. Nothing here is a spec.

Mockups (repo), `specs/design/app-shell/`:
- `Shell.dc.html` (1440) — the shell with Today under it, account menu open
- `ShellSearch.dc.html` (1440) — the one field open with grouped results, plus five states
- `ShellAdmin.dc.html` (1440) — Settings with the Admin group (Connections open), the rail, the viewer, the Marketing body
- `ShellPhone.dc.html` (390) — top bar + bottom tabs, full-screen search, the More sheet
Canvas: HomeLover Sales IA, row 25.

Read before drawing: `claude/design-left-nav-handoff-2026-11-06.md`, `claude/design-scout-v3-handoff-2026-11-10.md`, `claude/design-actions-v2-handoff-2026-11-19.md` (REV 2). Repo at f51f9f6: `src/components/Sidebar.js` (178 px, native workspace `<select>`, mono HUD look, Admin and Help rows), `salesAnalytics/salesNav.js` (TABS: Dashboard · Pipeline · Actions · Settings and their sub-views), `components/scout/`, `components/admin/WorkspaceFeatures.js`.

**The Nov 6 left nav is absorbed, not superseded.** It was never built (the repo still has the `<select>`). Its look carries over unchanged: 232 / 60 widths, the workspace card, the 3 px hue bar and hue icon on the active item, no neon, workspace colour from the `businesses` row. What changes is the item list (D9) and where the user card goes (D7). Build from this doc; the Nov 6 doc stays as the source for the switcher list's details.

## Numbered decisions

### Frame
D1. **Two pieces: a full-height left nav (232 px) and a 56 px header to its right.** The nav's top block is the same 56 px, so the workspace card and the header read as one top bar.
D2. **The header's bottom border is 2 px in the workspace colour** (#E2418A for HomeLover), the same hue as the active nav bar and the workspace avatar. That is the only colour in the shell besides the accent on "+ To-do" and neon on a focused field.
D3. **Header, left to right:** the one field (flex, max 620) · space · Needs attention n · + To-do (primary) · account avatar.
D4. **The workspace name lives once, in the nav's top card** (avatar H · "HomeLover" · role · up-down caret). It is not repeated in the header. On the phone, where there is no nav, the top bar carries it.
D5. **Nothing in the header or the nav names another workspace.** Other workspaces appear only inside the switcher list after it is opened (Nov 6 design), and only those the member belongs to.
D6. **"Needs attention" and "+ To-do" move from the Today page to the header** and exist once. Today keeps its title, strip, chips and list. This changes actions-v2 D-header; the drawer and the to-do form are unchanged.
D7. **The account avatar is in the header, top right** (32 px, member colour, initials). Its menu: name + role · Voice profile · Daily digest · Week ahead · Report a bug · Keyboard shortcuts · Sign out. The nav's old Help row and bottom user card are gone; their contents are this menu.
D8. **The wordmark is small and at the bottom of the nav** ("PROSPECTOR", mono 11 px, faint) next to the collapse control. The workspace is the brand of the screen, not the platform.

### Left nav
D9. **Items:** Home · Today (badge = your open count) · Pipeline · Dashboard · Scout · group label "Grow": Marketing (tag "Soon") · Ideas · then, pinned to the bottom: Settings.
D10. **The nav holds sections only.** Sub-views stay as the kit's underline tabs on the page (Pipeline: Companies · People · Top targets · Map; Dashboard: Email · Scorecard · Site · Explorer). The nav never expands into a tree.
D11. **This flattens "Sales & Marketing" away.** Today, Pipeline and Dashboard were tabs inside it; they are now top-level nav items. The page-level tab strip (Dashboard · Pipeline · Actions · Settings) is removed.
D12. **Active item:** surface fill, text colour, icon and 3 px left bar in the workspace hue, `aria-current="page"`. Hover: surface fill. 36 px rows, 16 px stroke icons, Geist 13.5 / 500.
D13. **Rail (60 px):** workspace avatar on top, icons with tooltips, same active bar. The choice is remembered per user. Collapse control is the chevron at the bottom right of the nav.
D14. **Marketing is a real route** with a centred card: megaphone in the workspace hue · "Marketing" · "Coming soon. Campaigns, content and site work for HomeLover will live here."
D15. **Scout as a nav item opens the Scout page** (the full conversation and its history). The header field is the quick way in; the page is where a long thread lives.

### The one field (recommendation: one, as Jack said)
D16. **One field does search and Scout.** Placeholder: "Search companies, people and to-dos, or ask Scout". Scout's star sits at its left, grey at rest.
D17. **Focused = Scout is listening:** neon border, soft neon glow, neon star and caret. This is the only neon in the shell. The right-hand hint flips from ⌘K to Esc.
D18. **Typing shows a panel under the field (620 px), grouped Companies · People · To-dos,** each with a count, at most three rows per group, matched letters underlined in the accent.
- Company row: building glyph · name · type and stage · score pill · owner dot.
- Person row: person glyph · name · title and company · heat pill.
- To-do row: check glyph · text · company and owner · due.
D19. **The last row is always "Ask Scout “<what you typed>”"** with ⌘↵. So "met" opens MetLife on ↵ and still offers Scout.
D20. **When the text is a question, Ask Scout becomes the first and default row** (neon wash), so ↵ asks. The test for "a question" is the planner's; the design suggests: a question word, a verb Scout acts on, a "?", or five or more words. Records it mentions are listed under it.
D21. **A short answer shows in the same panel:** "Scout" label · one or two sentences · Open <record> · Keep asking in Scout · footer "Read: companies · to-dos". Lists, confirm cards and follow-ups open the Scout page with the thread carried over.
D22. **Focused with nothing typed:** Recent (three records or asks) and "Try asking" (three example chips).
D23. **No match:** one line ("No company, person or to-do matches “…”.") then Ask Scout as the only row.
D24. **Keyboard:** `/` focuses the field when no input has focus · ⌘K (Ctrl K) focuses it from anywhere, including inside an input · ↑↓ move through all rows across groups · Tab jumps to the next group · ↵ opens the lit row · ⌘↵ always asks Scout · Esc clears, then closes and returns focus to where it was. The footer of the panel shows these.
D25. **ARIA:** the field is a combobox with a listbox; groups are labelled; the lit row is `aria-selected`; the result count is announced politely.
D26. **Search results name no addresses or phone numbers.** Names, titles, companies only.

### Settings and Admin (recommendation: Admin is a group inside Settings)
D27. **One "Settings" nav item. No Admin rail, no Admin nav row.** Five owner pages don't earn a second rail, and a separate item would show an empty door to everyone else.
D28. **Settings has a 200 px sub-list in two groups:** WORKSPACE (Team emails · Voice profile; everyone reads, the owner edits) and ADMIN with an "Owner" tag (Team · Connections · Switches · Recompute · Send logs).
D29. **The Admin group is absent, not disabled, for anyone who isn't the owner.**
D30. **Connections is a list of cards,** one per feed: name · what it brings in · status dot + who connected it (first names) and when it last ran · one button (Manage, Sync now, Pull now, Connect). Drawn: Microsoft · Fathom · Apollo · Site visitors · one not-connected example. No address or key is ever shown.
D31. **A failed feed turns its dot red here and raises "Needs attention" in the header** (same rule as actions-v2 D24).

### Viewer (Seif)
D32. No "+ To-do" in the header. No Admin group in Settings. Search works; Scout commands that write answer with the can't-do state. Role under the workspace name reads "Viewer".

### Phone 390 (recommendation: bottom tabs, not a drawer)
D33. **Top bar (52 px):** workspace avatar + name · Needs attention (bell + count) · + (40 px, primary). Same 2 px hue line.
D34. **Bottom tab bar (64 px), five slots:** Today · Pipeline · the Scout button · Dashboard · More. The four you use daily are one thumb-tap away; a drawer would hide all of them.
D35. **The centre slot is the one field:** a raised 52 px button with the neon star. It opens search full screen with the keyboard up, the same groups (48 px rows) and Ask Scout last. Cancel closes.
D36. **More is a bottom sheet:** workspace card (opens the switcher sheet) · Home · Scout (conversations) · Marketing · Ideas · Settings · account row (Voice profile, Help, Sign out).
D37. All targets are 44 px or larger. The active tab's icon takes the workspace hue; labels are 10.5 px.

## Real vs placeholder
Real: the workspace name and colour, members' names, colours and roles, the nav widths and active treatment (Nov 6), the Today counts (164 / 342 / 65 / 271), company names with their bands and scores, MetLife's type, stage and owner, Danilea Mayer's title and company, the Help items (from Sidebar.js), the Outlook, Fathom, Apollo and site-visitor feeds by name.
Placeholder (bracketed in the mockups): every to-do text, the second company and both people in the "met" results, the Scout answer's second sentence, connection statuses and times, who connected Microsoft, the Recent list, the "4" on Needs attention, the Today badge using the open count.

## Questions for the planner
1. Ideas: keep, or drop?  2. Accounts, Projects, Business Intel, Tools — retired for HomeLover, or a "More" group?  3. Home: Command Center or the Dashboard's Home view?  4. Admin today is platform-owner, not workspace-owner — which owner sees it?  5. Dashboard / Pipeline sub-view lists before the tab strip is removed (D11).  6. D20: the rule for "this is a question".  7. D21: which answers stay in the panel.  8. D6: confirm moving Needs attention and + To-do out of Today.  9. The Today badge: open count or due + overdue?  10. Does a Viewer see "Needs attention"?

(Planner's answers Q1–Q10: inbox/2026-11-20-2345-app-shell-v2.txt. Jack's Nov 21 amendment to D15/D21 — Scout answers stay in a Scout window over the page, not the Scout page: inbox/2026-11-21-1600-app-shell-v2-stage2-rulings.txt.)
