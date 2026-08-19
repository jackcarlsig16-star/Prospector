# SPEC — intake-field-extraction-and-bulk-split-v1

## Status
Grounded entirely in `intake-ingestion-ground-truth-v1` audit findings
(no assumptions carried over from the original design proposal that
conflicted with real code). Real PDF/PPTX file upload is explicitly OUT
of scope — see rationale below. Everything else from Jack's original ask
(deterministic bulk-splitter, AI field extraction from pasted text,
diff-preview accept/reject, graceful non-blocking fallback) is in scope.

## Problem (per audit ground truth)
- Project has 5 manual textareas (objective, target_type, ask_type,
  project_hook, exclusions) + a bulk example list. Campaign adds 2 more
  (recipient_description, doctrine) + its own separate example list.
  7 free-text fields + two independent example workflows to fill out
  from scratch — the "6+ manual fields" framing holds up.
- Bulk example segmentation (`segmentOutreachExamples`,
  api/businesses/shared.js:217-239) sends the entire raw paste to one AI
  call with zero local pre-splitting. "No JSON in examples segmentation
  response" (shared.js:237) is a real, confirmed error, thrown when the
  model reply has no `{...}` block (e.g. hit its token cap mid-JSON, or
  ignored the JSON-only instruction). It's already a soft failure in one
  sense — `addWholePasteAsOne` fallback already exists
  (OutreachExamplesEditor.js:196-200) and nothing is silently lost — but
  the UI doesn't distinguish "JSON parse failed" from "model genuinely
  found 0 examples," and there's no deterministic pre-split before
  paying for an AI call at all.
- There is no existing mechanism anywhere in this codebase that extracts
  Project/Campaign fields (objective, target_type, hook, etc.) from
  pasted text. `new_project` intake (intake-confirm.js:19-31) only ever
  sets name/color/owner/business/list_id and files the pasted text as a
  generic intel-log entry for `strategy_synthesis` (free prose) — it
  never touches the 5 structured fields. The closest real precedent is
  `generateProfile` (shared.js:383+), which already does multi-field
  JSON extraction from accumulated text with a `field_sources` map — and
  has a documented history of needing higher `max_tokens` as real input
  grew (light depth: 2048 → 8192 after 3 real truncation failures; full
  depth: 4096 → 8192 → 20000).

## Design decisions (locked for this build)
1. **Diff-preview, not auto-overwrite.** Extracted field values are shown
   against current values with per-field accept/reject — never silently
   written over what's already there. (Matches the earlier discussed
   recommendation; Jack sending this audit forward is treated as
   confirmation to build it.)
2. **Graceful failure = keep the pasted text, don't discard it.** If
   extraction fails to parse, the paste textarea is NOT cleared and no
   auto-file/auto-route happens — the user can retry or fill fields
   manually. Do not repurpose `fileProjectIntel` for this; that function
   serves a different flow (`new_project` intake) and audit didn't
   confirm it's safe to dual-purpose. Simplest, lowest-risk behavior:
   nothing is lost, nothing silently mutates state.
3. **New extraction calls follow the existing async pattern, not a
   direct synchronous await.** Per audit section 6: `generateProfile`
   (the closest-sized precedent) has measured real latency of 27-68s,
   reportedly up to ~3 min. Every synchronous route in this app that
   calls a comparably-sized extraction inherits that risk by default —
   there is no platform-level timeout protection (`maxDuration` in
   `api/*.js` is vestigial; server.js's `esHandler` never reads it).
   `beginProfileSync`/`runProfileSync` (shared.js:773-783) is the one
   real, working precedent for this — new extraction endpoints must
   mirror it, not run inline in the request handler.
4. **Deterministic pre-split before any AI segmentation call**, using
   well-anchored delimiter patterns only (no fragile numbered-list
   guessing that risks false splits on text that happens to contain
   numbers).

## Out of scope — explicit
- **Real PDF/PPTX/file upload and parsing.** Audit confirmed zero infra
  exists anywhere in this app for it: no `multer`, no PDF/DOCX parsing
  library, no server-side multipart endpoint at all — every existing
  `type="file"` input reads client-side via `FileReader` and sends plain
  text/data-URLs as JSON (CSV imports, JSON config import, image
  avatars, .txt/.vtt/.srt call transcripts). `pptxgenjs` is an unused
  dependency that generates .pptx, it doesn't read them. Adding real
  deck upload means new dependencies, a new multipart route, and a
  security/size-limit review that this audit didn't cover — matches
  campaign-layer-v1 decision #7's precedent (deliberately deferred) and
  should get its own AUDIT + SPEC if Jack wants it. This build instead
  reuses the paste-text affordance the doctrine field already has today.
- Raising `SEGMENT_PASTE_MAX_CHARS` (30000, shared.js:212) — deliberate
  per its own code comment (accuracy depends on seeing every boundary).
  Not touched here.
- Fixing `distillOutreachExamples`'s silent 16000-char truncation
  (shared.js:663) — pre-existing, unrelated, not touched here.
- The other known synchronous-timeout-risk routes (call-log.js,
  assay-criteria-generate.js, profile-refresh.js, social-links-save.js,
  intake-confirm.js's `new_project`/`redirect_to_project`) — pre-existing
  and tracked separately per the handoff doc, not fixed incidentally.

## Stage 1 — Deterministic pre-split for bulk examples
File: `api/businesses/shared.js`, `segmentOutreachExamples` (217-239).

Before the existing AI call, attempt a local, dependency-free split of
`pastedText` using two well-anchored patterns, tried in order:
1. Lines matching `/^-{3,}\s*$/m` (three-plus dashes alone on a line) as
   a separator.
2. Lines matching `/^(EXAMPLE|EMAIL)\s*#?\d+[:.]?\s*$/im` as a heading
   that starts a new example (split before each match; discard the
   heading line itself, keep only body content — matches the shape of
   what the existing examples array already stores).

Accept the deterministic split only if it yields 2+ non-empty trimmed
segments. If so, return that array directly — skip the AI call entirely
for this pass. If not (0 or 1 segments), fall through unchanged to
today's existing single-AI-call behavior. The existing
`SEGMENT_PASTE_MAX_CHARS` 30000-char hard-reject check (shared.js:219-221)
still runs first, unchanged, regardless of which path is taken after it.

Done = a pasted block using `EXAMPLE 1:` / `EXAMPLE 2:` / `---` headers
resolves to the correct segment count with zero AI calls; a pasted block
with no such delimiters falls through to the existing AI segmentation
path with byte-for-byte unchanged behavior.

Verification:
- Paste a real delimiter-structured block of 15-20 example emails
  locally/staging; confirm segment count and content match expected,
  confirm no AI call is made (check logs/network).
- Paste unstructured freeform text with no delimiters; confirm it still
  reaches the existing AI segmentation call and behaves exactly as
  before this change (regression check).
- Confirm the 30000-char hard-reject still fires correctly above the cap
  regardless of delimiter presence.

## Stage 2 — Distinguish JSON-parse failure from genuine "0 found"
File: `OutreachExamplesEditor.js` (~67-105, ~196-200).

Currently both a hard JSON-parse failure (thrown `"No JSON in examples
segmentation response"`, surfaced as a 500) and a genuine "model found 0
examples" result show the same generic error + the same
`addWholePasteAsOne` fallback button. Keep the fallback button in both
cases (it's already the correct graceful behavior) but give each case
distinct copy:
- Parse/segmentation failure (request threw / non-200): "Couldn't
  automatically split this into examples — add it as one example
  instead, or try again."
- Success but empty array: "No individual examples detected in this
  text."

Done = the two states are visibly distinguishable in the UI; the
existing fallback mechanism is otherwise unchanged.

Verification: trigger both states in staging (empty-array case is easy
to force with a short non-splittable paste; parse-failure case may need
a temporary mock/throw since it depends on live model behavior — that's
acceptable for this verification only, revert the mock before commit).
Confirm distinct messaging renders and `addWholePasteAsOne` still works
identically in both cases.

## Stage 3 — Project field extraction (new)
New function `extractProjectFields(supabase, businessId, rawText)` in
`api/businesses/shared.js`, modeled directly on `generateProfile`'s
precedent (the only proven multi-field-extraction-from-text pattern in
this codebase).

- Input: `rawText` — reuses the paste-text affordance, not a file. Add a
  new "Paste deck or notes to auto-fill" textarea to
  `ProjectGuidanceCard.js`, separate from the 5 existing manual fields
  (per locked decision #1, manual fields stay editable and untouched
  unless the user accepts a diff).
- Output schema: `{objective, target_type, ask_type, project_hook,
  exclusions, field_sources}` — exact key match to the 5 existing
  `FIELD_LABELS` keys (ProjectGuidanceCard.js:8-14) so the diff-preview
  UI can iterate the same key list the manual form already uses.
- `max_tokens`: start at 8192 (matches `generateProfile` light-depth's
  post-fix value, given this extracts fewer fields than light depth's 8
  or full depth's 13). Leave an explicit code comment noting this is a
  starting value that may need raising based on real production
  truncation errors, per `generateProfile`'s own documented history
  (shared.js:430-445) — do not treat 8192 as permanently settled.
- Truncation detection: reuse the exact same `{[\s\S]*\}` regex-match
  pattern already used by the two sibling functions, throwing a third
  parallel error string (e.g. `"No JSON in project field extraction
  response"`) for consistency — do not invent a new error-handling
  approach.
- On failure (parse error or thrown exception): per locked decision #2,
  return a failure result the client can act on gracefully — do NOT
  auto-file into `fileProjectIntel` or any other side effect. The client
  keeps `rawText` visible in the textarea, unchanged, with a "couldn't
  extract — edit fields manually or try again" message.
- Must run via the existing async fire-and-forget-then-poll pattern
  (locked decision #3), mirroring `beginProfileSync`/`runProfileSync`
  (shared.js:773-783) exactly: a `beginProjectExtractionSync`/
  `runProjectExtractionSync` pair. **Before writing any migration**,
  Claude Code must confirm by real query (not memory) the exact
  status-column pattern `beginProfileSync` writes to and how the client
  currently polls it (`intel_sync_status` was named in the audit
  server-side only — the client polling implementation was NOT
  confirmed) — mirror that pattern exactly for a new
  `project_extraction_status`-equivalent, do not invent a different
  polling mechanism.
- New route (e.g. `api/projects/extract-fields.js`) calling
  `beginProjectExtractionSync`, returns 200 immediately, actual
  extraction runs in the background per the async pattern.

Done = pasting deck-length text and clicking "Extract & Auto-Fill"
returns control to the user in well under a second, extraction completes
in the background, and the 5 fields' extracted values become available
for per-field accept/reject without ever silently overwriting existing
field values.

Verification:
- Paste a real, long (several-thousand-char+) block of realistic Project
  content in staging; confirm the request returns fast while extraction
  completes async; confirm polling picks up the completed result.
- Confirm diff-preview shows extracted vs. current values per field,
  accept/reject works per field, and only accepted fields get written —
  via the existing `updateProjectGuidance` path (src/utils/db.js:461-466),
  not new write logic.
- Force a failure (mock a truncated/malformed response) and confirm the
  pasted text stays visible, nothing is auto-filed, no blocking red
  error takes over the screen.

## Stage 4 — Campaign field extraction (new)
Mirror Stage 3 exactly, scoped to `campaign_id`, targeting Campaign's 2
fields (`recipient_description`, `doctrine`). Parameterize the shared
extraction function to serve both entities (matching the precedent set
by `distillOutreachExamples`/`segmentOutreachExamples` already being
parameterized for both projects and campaigns per campaign-layer-v1) —
do not fork a second copy of the extraction logic.

Done / verification: same shape as Stage 3, scoped to Campaign's 2
fields and `CampaignGuidanceCard.js`.

## Stage 5 — Frontend wiring
- `ProjectGuidanceCard.js`: add the new paste textarea + "Extract &
  Auto-Fill" button above the 5 existing fields (existing fields remain
  manually editable, unchanged). Add the diff-preview UI: per-field
  current-vs-extracted comparison with Accept/Reject controls.
- `CampaignGuidanceCard.js`: same pattern for its 2 fields.
- `OutreachExamplesEditor.js`: no new UI needed beyond Stage 2's
  messaging fix — reused unchanged for both Project and Campaign
  examples, per existing shared-component pattern.

Done = both cards have a working extract-and-review flow that never
bypasses manual editing or auto-overwrites.

Verification: full click-through on staging then prod — Project extract
flow, Campaign extract flow, confirm no regression to manual field
editing or to the existing examples bulk-paste flow.

## Commit instructions
Build in stage order (1 → 5) with the per-stage verification above, but
land as a single commit referencing `intake-field-extraction-and-bulk-
split-v1`, per standing practice. Commit and push to `origin/main` once
all 5 stages' verification passes — do not leave this staged locally.
