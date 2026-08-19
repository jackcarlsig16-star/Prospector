# SPEC: account-card-score-to-confidence-swap-v1

## Context

`account-score-tier-display-audit-v1` (findings: `audits/account-
score-tier-display-findings.txt`) confirmed:

- Score and Tier are one atomic model output — `1=Gold, 2=Silver,
  3=Tin, 4=Slag` (`src/utils/assay.js:135,211`). Displaying both is
  the same value shown twice, not two metrics.
- Checked against all 20 live `account_business_details` rows — zero
  exceptions to the mapping. Not a bug, just a confusing display: "1"
  reads as "low" to a human when it's actually rank, not strength.
- Traced origin: `surface-existing-intel-v1` (51c5fb0) surfaced the
  raw score believing it was hidden signal, without noticing it
  duplicates Tier.
- A real, independently-varying, already-computed field exists to
  replace it: `fit_signals.confidence` (Low/Medium/High), populated on
  100% of live rows. Some Gold accounts show Medium confidence — real
  signal, not redundant with Tier.
- Exactly one render site: `AccountCard.js:131`. (A second "Score:"
  label in `DealWorkspace.js:102` is a different, correctly-labeled
  0–100 `signalScore` under "Signal Breakdown" — unrelated, do not
  touch.)
- All 20 affected rows confirmed on the current taxonomy engine, none
  on the legacy fintech/Claim Jumper path — this is a pure display fix,
  no legacy-path entanglement.

## Goal

Remove the redundant numeric Score from `AccountCard.js:131`. Replace
that slot with the existing `fit_signals.confidence` value
(Low/Medium/High), styled consistently with the existing pill UI
pattern already shipped in `surface-existing-intel-v1`.

## Scope

- `AccountCard.js:131` only. Do not touch `DealWorkspace.js:102` — its
  Score is a different, correctly-labeled field and out of scope.
- Do not touch `assay.js`'s score/tier generation logic — this is a
  display-layer swap only, not a scoring-engine change. Score keeps
  being generated and stored exactly as today; it's just no longer
  independently rendered on this card.
- Do not touch `fit_signals.confidence`'s generation — it already
  exists and is already populated on 100% of rows. This SPEC only
  reads and displays it.

## Implementation

- Swap the Score display for a Confidence pill at the same position,
  reusing the existing pill styling pattern from `surface-existing-
  intel-v1` (`key_signals`/`traction_signals` pills) rather than
  inventing new styling.
- Label it clearly as "Confidence" so it doesn't repeat the original
  ambiguity — the whole point of the swap is removing a value that
  reads wrong at a glance.
- Confirm `fit_signals.confidence` is genuinely present on every
  account this card renders for (not just the 20 audited rows) before
  shipping — if any live account has a null confidence value, decide
  on a fallback display (e.g. "—" or hide the pill) rather than
  showing a blank or broken element.

## Verification bar

- Real Playwright click-through confirming the Confidence pill renders
  correctly across accounts with varying confidence levels (Low,
  Medium, High) and varying tiers — specifically confirm at least one
  Gold+Medium case renders correctly, since that's the exact
  independent-signal case the audit found.
- Confirm `DealWorkspace.js:102`'s Score is untouched and still renders
  its own correct 0–100 value — regression check, not just a new-
  feature check.
- Bundle-content verification (not just a hash diff) that the old
  numeric Score no longer renders anywhere on `AccountCard.js`.

## Commit discipline

Single-stage SPEC — commit and push once build/lint passes and live
verification confirms both the new Confidence pill and the
DealWorkspace regression check. Confirm push against the actual remote
(`git ls-remote`), not just local commit success. Don't leave commit/
push as a follow-up question.
