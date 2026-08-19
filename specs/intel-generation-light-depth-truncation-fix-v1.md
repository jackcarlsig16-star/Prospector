# SPEC: intel-generation-light-depth-truncation-fix-v1

## Context

`homelover-intel-generation-500` audit confirmed a real, systemic soft
failure — not HomeLover-specific, not network/API related.

- Trigger: Add Intel action → `api/businesses/intel.js:14` →
  `fileCompanyIntel()` (`shared.js:573`) → `generateProfile()`
  (`shared.js:577`).
- Real Anthropic call succeeds (200, billed) — the model's JSON output
  gets cut off mid-generation by `max_tokens` before the closing brace.
  The JSON-detection regex (`shared.js:372-373`,
  `textBlock.text.match(/\{[\s\S]*\}/)`) finds no valid block and the
  app correctly throws `'No JSON in profile generation response'` —
  that string is exactly what surfaced as the 500/UI error.
- Real logged failing call: HomeLover, `profile_light`, in=15558,
  out=2048 (pinned exactly at cap), 2026-08-19T16:19:53.
- Not isolated: HumanKind hit the identical exact-cap truncation twice
  the day before (out=2048, inputs 36.5k–37.6k tokens). Confirmed
  systemic across any business with a growing intel log.
- Root cause, two compounding parts:
  1. `generateProfile()`'s light-depth `max_tokens: 2048`
     (`shared.js:361`) has not been revisited since one early raise
     (1024→2048). The full-depth path required three raises
     (4096→8192→20000) as intel logs grew — light-depth is on the same
     growth trajectory and hasn't kept pace.
  2. `callAnthropic` always enables adaptive thinking for non-FAST
     models (`shared.js:41`), so the 2048-token budget is shared
     between reasoning and JSON output — making truncation more likely
     on a path that's supposed to be fast/light in the first place.
- Confirmed unrelated to the citation-leak fix from earlier today — no
  shared imports between `textSanitize.js`/`assay.js` and
  `businesses/shared.js`/`intel.js`. Separate prompt, separate route
  family.

## Goal

Stop light-depth profile generation from truncating valid JSON output,
for every business, not just HomeLover — and make the fix durable
against continued intel-log growth, not just a one-time patch.

## Scope

- `shared.js:361` (`generateProfile()`'s light-depth `max_tokens`) and
  `shared.js:41` (adaptive thinking toggle), light-depth path only.
- Do not touch full-depth path's existing `max_tokens` (already at
  20000, already tuned through real prior incidents) unless real
  evidence during this fix shows it's also now at risk — check, don't
  assume it's fine, but don't change it without a real finding.
- Do not touch `textSanitize.js`, `assay.js`, or the citation-leak
  fix's code — confirmed unrelated, stay out of that path.

## Implementation

- Disable adaptive thinking for the light-depth generation call
  specifically. Light-depth is meant to be fast, JSON-only output — it
  shouldn't be spending budget on reasoning tokens it doesn't need.
  Confirm this is scoped to light-depth only; full-depth's thinking
  behavior is out of scope here.
- Raise light-depth `max_tokens` to a real headroom multiple of what's
  actually landing in production today — 2048 output against inputs up
  to 37k tokens is thin regardless of the thinking-budget fix. Pick a
  number with real margin (check actual light-depth JSON output sizes
  across a sample of successful historical calls in
  `business_anthropic_usage` to set this from real data, not a guess).
- Consider (real audit-first check before deciding): should light-depth
  max_tokens scale with intel-log size the way full-depth's raises were
  reactive to growth, or is a single higher static cap enough headroom
  for the foreseeable term? State the choice and reasoning, don't
  silently pick one.

## Verification bar

- Live-reproduce the fix against a real business with a large intel log
  (HomeLover or HumanKind, both have real failing history) — confirm
  Add Intel completes successfully post-fix, not just that the code
  changed.
- Check `business_anthropic_usage` post-fix for the same business —
  confirm actual `out` token count is now comfortably under the new cap,
  not just that the call succeeded once.
- Confirm no regression on a business with a small/normal intel log —
  light-depth should still behave normally there, not just fix the
  large-log case.

## Commit discipline

Single-stage SPEC — commit and push once build/lint passes and live
verification confirms the fix against a real previously-failing
business. Confirm push against the actual remote (`git ls-remote`), not
just local commit success. Don't leave commit/push as a follow-up
question.
