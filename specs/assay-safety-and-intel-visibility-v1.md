# assay-safety-and-intel-visibility-v1

Goal: Fix real data-safety risk, remove the truncation that's hiding intel that already exists, and add a bare test surface so richer schema output (once built) is immediately visible — no redesign, no polish.

## Part 1 — P0, data safety (verify first, fix regardless)

1. **Audit for actual data loss (report only, no code change).** `src/utils/db.js` — check whether the bulk-upsert-on-single-reassay pattern (`saveAccountsToDb` re-upserting the entire account array + delete-not-in-set, triggered via `App.js`'s `useEffect` on every `accounts` change, including every re-assay) has ever actually deleted or overwritten an account it shouldn't have. Cross-reference account creation/deletion timestamps against re-assay events if any log exists. Report findings before proceeding — this determines if there's cleanup needed, not just a forward fix.

2. **Scope writes to the single modified row.** `src/utils/db.js` (`saveAccountsToDb`) and its call site(s) — replace the account-array-wide upsert triggered by re-assay with a targeted `.update().eq('id', account.id)` (or equivalent single-row write) for the re-assay path specifically. Audit all other callers of `saveAccountsToDb` first (CSV import, manual bulk edits, etc.) — confirm this narrowing doesn't break any caller that legitimately needs full-array behavior. Do not globally narrow the function if other callers depend on the array-wide semantics; add a scoped path instead.

3. **Await the dual-write, handle failure visibly.** `src/components/AccountsPage.js` — `upsertAccountBusinessDetails(...).catch(()=>{})` in both `reassay()` and `reassayAll()` currently swallows errors silently. Await it, and on failure, surface a real error to the user (toast/inline message) rather than pretending the save succeeded.

## Part 2 — remove the truncation hiding existing intel

4. **DealWorkspace.js** — Remove the `.slice(0, 160)` caps on Business Model / Product Fit in `IntelligenceSummary`. Show full content. No expand/collapse UI needed — just stop cutting it off. If a field is genuinely very long, a simple scroll or `max-height` with native overflow is fine — no toggle component needed for this pass.

## Part 3 — bare "Full Intel" test panel

5. **Account card** — Add one new, unstyled section to the account card that renders every field currently present in `account_business_details` for that account — raw key/value dump, `fit_signals` and all nested content included, no formatting polish, no layout decisions. Gate it behind a simple toggle or always show it below existing card content — whichever is faster to build.

## Explicitly out of scope

Any visual redesign, button-gating fixes (LinkedIn/SFDC/Email — already scoped separately, P2), Jina/criteria-read parallelization, bulk concurrency, multi-phase loading states, schema expansion itself (this SPEC only prepares a place to see it once it exists).

## Verify

Confirm Part 1's audit findings before/regardless of the fix. After Part 2/3 ship, re-assay one real account and confirm on the actual card: full untruncated text visible, and the raw intel panel shows real `account_business_details` content.

## Ship

Commit + push explicitly once confidence is high.
