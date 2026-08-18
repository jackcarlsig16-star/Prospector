# business-intel-smart-upload-v1

Goal: Extend the already-real business-intel pipeline (`business_intel_entries` → `generateProfile()` → `business_profiles`, rendered on `BusinessDetailPage.js`'s overview) with content-type classification, a fuller set of distilled fields, and field-level source traceability with a cheap diff-check-on-write mechanism — without rebuilding any of the routing, storage, or view layer that already works.

Status note: this SPEC went through two rounds of clarification before build — (1) whether the diff-check-on-write traceability design was final vs. still open, (2) whether the Intel Library (localStorage) question was resolved. Both confirmed final/resolved 2026-08-17; see "Resolved before build" below. Master Magnetics' `research_depth` light→deep bump (mentioned in earlier drafts as a companion action) is a separate, already-completed action — not part of this SPEC.

## Resolved before build (do not re-litigate)

- **Traceability approach**: full field-level source pointers + diff-check-on-write (Section 4 below), not full incremental updates. Confirmed final — "we build then iterate from there." Full incremental updates (only reprocessing fields a new note plausibly affects) is an explicit V2 follow-on, not rejected — revisit if/when `business_intel_entries` volume grows enough that full resynthesis cost/latency becomes a real problem (the weekly site-scan SPEC, separate and upcoming, is the most likely thing to push volume there — worth checking entry counts against this trigger once that SPEC has shipped and run for a while).
- **Intel Library (localStorage `prospector_intel_docs`)**: out of scope, confirmed via a live trace of `clientAssay()` this session. `buildGeneralizedPrompt()` structurally cannot read it — it's a fallback path only, used exclusively when a business has no real `assay_criteria` yet (`buildLegacyFintechPrompt()`). It was genuinely live and consequential for Master Magnetics specifically until its `assay_criteria` was generated (2026-08-17) — before that, its accounts scored against 3 hardcoded fintech product docs seeded into that key. Provably inert for HumanKind/HomeLover the entire time (both have had real `assay_criteria` since before this SPEC). Correct, intentional safety-net behavior for a business mid-onboarding — leave as-is, not a migration target.

## What's already real — do not rebuild

- `business_profiles` already has structure: `vision`, `positioning`, `icp`, `gtm_strategy`, `competitors`, `raw_synthesis` (text), plus real structured JSON for `assay_criteria` (`fit_signals`, `disqualifiers`, `tier_guidance`) and `outreach_rules` (`tone`, `structure`, `key_points`, `dos`, `donts`, `example_snippets`). This SPEC extends this schema additively — it does not replace it with a parallel one.
- `BusinessDetailPage.js`'s overview view already renders live data: a `ProfileBlock` per populated field, `AssayCriteriaCard`, `OutreachRulesCard`, plus a chronological raw "Intel log" of every `business_intel_entries` row (`SOURCE_LABEL` badge, timestamp, content). Extend this view, don't rebuild it.
- `classifyIntake()` (`api/businesses/shared.js:522`) is real and shipped — routes to `company_intel` / `existing_project` / `new_project` / `existing_account` / `new_account` / `ambiguous`, with confirm-before-file for uncertain cases. Reuse this routing layer; do not build a second classifier.
- `business_intel_entries` is a real append-only raw log (`business_id`, `project_id`, `source`, `content`, `created_by`, `created_at`, plus `source_type`/`call_platform`/`call_date`/`call_duration_seconds`/`call_participants`/`account_id` from the call-log feature). This is where full raw visibility already lives at the business level — nothing here needs rebuilding.

## Real gaps this SPEC addresses

- **Gap 1 — no content-type classification, only destination routing.** `classifyIntake()` decides which table content goes to, not what kind of document it is.
- **Gap 2 — full-log resynthesis, no field-level traceability.** `generateProfile()` re-reads every entry every time and overwrites the whole profile; no pointer from a distilled sentence back to the note(s) that produced it.
- **Gap 3 — missing fields.** No `industry`, `core_problem`, `sub_issues`, `products`, `value_props`, or `motto` today — the existing fields don't cover main issue / sub-issues / products / things solved / motto.
- **Gap 4 — account-level intel storage is structurally different from business-level.** Smart Intake's `existing_account` path writes into `accounts.data.handoffNotes` (a single concatenated string), not a table. Full field-level traceability is only buildable at the business level until this asymmetry is resolved. **Explicitly NOT solved by this SPEC** — flag as a real follow-on once this ships and is live-verified, business-level only for now.

---

## 1. Schema migration

New migration in `supabase/migrations/`, additive only — do not touch any existing column.

`business_intel_entries`:
- `content_type` (text, nullable) — e.g. `strategy_doc` / `marketing_asset` / `pricing` / `competitive` / `other`.

`business_profiles`:
- `industry` (text)
- `core_problem` (text) — the main issue this business solves
- `sub_issues` (jsonb array of strings)
- `products` (jsonb array of strings)
- `value_props` (jsonb array of strings)
- `motto` (text, short)
- `strategic_philosophy` (text, short freeform) — the one intentionally loose field, for business-specific doctrine (e.g. Master Magnetics' 80/20 tier-based framing)
- `field_sources` (jsonb) — see Section 4
- `industry_edited_manually`, `core_problem_edited_manually`, `sub_issues_edited_manually`, `products_edited_manually`, `value_props_edited_manually`, `motto_edited_manually`, `strategic_philosophy_edited_manually` (boolean, default `false`) — one per new field, same pattern as the existing `assay_criteria_edited_manually`/`outreach_rules_edited_manually`. Scoped to the 7 new fields only — the existing six fields (`vision`/`positioning`/`icp`/`gtm_strategy`/`competitors`/`raw_synthesis`) do not get this protection in this SPEC; that's an existing gap, not something to fix here.

Run and live-verify (real `schema` check, not assumption) before any code in Sections 2-4 depends on these columns.

## 2. Content-type classification (Gap 1)

After `classifyIntake()` routes content to `company_intel` (before it's stored via `fileCompanyIntel()`), add a lightweight classification step that tags the entry with a `content_type`. Doesn't need to be exhaustive — exists so Section 4's synthesis can weight sources (a strategy doc should carry more weight toward `core_problem`/`strategic_philosophy` than a conference flyer). Coder's call whether this is a cheap heuristic or a small model call folded into the existing `classifyIntake()` request — don't add a second round-trip if it can ride along with the existing classification call.

`handleAddEntry` on `BusinessDetailPage.js` (the "Add Intel" textarea) skips `classifyIntake()` entirely today and always writes business-level — leave that routing behavior as-is (deliberate, business-level-only entry point), but make sure whatever entry it inserts still gets a `content_type` tag and feeds the same distillation path as Smart Intake's `company_intel` route, not a separate one.

## 3. New distilled fields (Gap 3)

Extend `generateProfile()`'s existing synthesis call (`FULL_SYSTEM_PROMPT`/`LIGHT_SYSTEM_PROMPT` in `api/businesses/shared.js`) to also output `industry`, `core_problem`, `sub_issues`, `products`, `value_props`, `motto`, `strategic_philosophy`. Same call, bigger output shape — do not build a second synthesis pass. Respect the depth split already in place (light vs. full) for whichever of these fields makes sense to skip on light depth, consistent with how `positioning`/`icp`/`competitors` are currently nulled on light.

## 4. Field-level source traceability (Gap 2 — diff-check version, v1)

`generateProfile()` already receives `business_intel_entries` as identifiable items in its prompt. Extend the prompt to require the model to cite which entry ID(s) it drew on for **each** field it outputs — same grounding-honesty pattern already shipped for account-level Assay (sourced vs. inferred claims, the Coconut Cult case).

Store as new `field_sources` jsonb column on `business_profiles`, keyed by field name (dot-notation for nested fields):
```json
{
  "vision": ["entry-id-1", "entry-id-4"],
  "core_problem": ["entry-id-2"],
  "assay_criteria.fit_signals": ["entry-id-1", "entry-id-6"]
}
```
A field with no real source cited stays blank rather than being populated with an unsupported inference — same rule as the account-level grounding fix.

**Diff-check on write** (the actual v1 mechanism — architecture does not change, `generateProfile()` still reads the full history and regenerates the whole profile every run): before writing the new result, compare each field's newly-generated value against its currently stored value.
- Value unchanged → keep the existing `field_sources` entry for that field as-is, do not overwrite with whatever this run happened to cite. This is what fixes citation flicker cheaply, without a merge/router system.
- Value changed → write the new value and its new `field_sources` together.
- Field marked `*_edited_manually` (Section 1) → exclude from the write entirely; the next resynthesis does not touch it. If the freshly-generated value would have differed from the stored (edited) value, surface that as a conflict (Section 5) rather than silently discarding either side.

## 5. Consumption — extend `generateAssayCriteria()`

Currently reads only `vision`/`positioning`/`icp`/`gtm_strategy`/`raw_synthesis` from `business_profiles` (`buildBusinessFitContext()`). Extend to also read `core_problem`/`sub_issues`/`products`/`value_props`/`motto`/`strategic_philosophy` as additional context. Still a single read of the current profile row — no added model strain at score time, same architecture as today.

## 6. Visibility (extend the existing Business Profile view)

All on `BusinessDetailPage.js`'s overview view — extend, do not rebuild:
- `ProfileBlock` entries for the 7 new fields, same component/pattern as the existing ones.
- **Hover-to-source**: hovering/clicking a field's badge shows a small popover citing which `business_intel_entries` id(s) it came from (via `field_sources`), and highlights the corresponding row(s) in the Intel log already rendered below. Don't build a separate source viewer — cross-reference the existing log.
- **"Derived N fields" counter** on each Intel log entry — a lightweight reverse-index over `field_sources`, so it's visible at a glance which entries actually contributed vs. which contributed nothing (the HomeLover password-wall entry from the site-scan audit is exactly the kind of entry this would expose).
- **Content-type badge** (Section 2) on each Intel log entry, reusing the existing `SOURCE_LABEL` badge pattern.
- **Edited-field indicator**: a field marked `*_edited_manually` gets a visually distinct state (e.g. solid vs. dashed border) so it's obvious which fields are protected from the next resynthesis.
- **Diff-on-conflict**: if a resynthesis produces a different value for a field marked `*_edited_manually`, don't silently overwrite — surface a small non-blocking banner ("New intel conflicts with 1 manual edit — [Review]") letting the user keep their edit or accept the new value.
- Editing affordance for the 7 new fields (needed for the edited-manually flag and diff-on-conflict to have any real trigger) isn't separately specced here beyond "reuse the `AssayCriteriaCard.js`/`OutreachRulesCard.js` edit-save pattern" — coder's call on exact form, same latitude as the rest of this section.

Keep the Intel log's existing name exactly as-is ("Intel log") — do not call anything here "Intel Library," which already refers to the separate, out-of-scope localStorage tab. Reusing that name would recreate the confusion this SPEC's clarification round just resolved.

## Explicitly out of scope

- File/PDF upload — no document-parsing infra exists in this repo today; text-paste only for this SPEC.
- Intel Library (localStorage) — resolved out of scope, see above.
- Gap 4 (account-level storage asymmetry / `accounts.data.handoffNotes`) — business-level only in this SPEC.
- Full incremental updates (V2 follow-on) — deferred, not rejected; revisit per the trigger noted above.
- Retrofitting `*_edited_manually` protection onto the existing six fields (`vision`/`positioning`/`icp`/`gtm_strategy`/`competitors`/`raw_synthesis`) — only the 7 new fields get this in this SPEC.
- Any change to `classifyIntake()`'s routing logic itself — this SPEC sits downstream of routing, once content has already landed as `company_intel`.

## Verify

- Real migration applied and schema-confirmed (`scripts/live-audit.js schema business_profiles` / `business_intel_entries`), not assumed.
- Paste a real strategic doc for a real business (Master Magnetics is the natural test case, given its profile/assay_criteria were just regenerated) → confirm the 7 new fields populate with real, business-specific content and `field_sources` cites real entry ids.
- Paste a second, unrelated note → confirm unchanged fields keep their prior `field_sources` (diff-check working), only the actually-affected field(s) get new sources.
- Manually edit one new field → confirm its `*_edited_manually` flag sets, it survives the next resynthesis unchanged, and a conflicting resynthesis surfaces the non-blocking banner rather than overwriting silently.
- Confirm the Intel log's "Derived N fields" counter and content-type badges render against real data, and hover-to-source correctly highlights the right log row(s).
- Confirm `generateAssayCriteria()`'s output visibly reflects the new fields when regenerated (e.g. `core_problem`/`strategic_philosophy` language showing up in `fit_signals`/`tier_guidance` reasoning).

## Ship

Fix-by-fix per the numbered sections above, build gate + separate commit after each, per the standard `/spec` workflow. Push and live-verify (bundle hash + a real Supabase query) after the final fix, same as prior SPECs this cycle.
