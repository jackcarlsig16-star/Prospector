# surface-existing-intel-v1

Goal: Render real fields already present in `account_business_details` that currently only appear in the raw "Full Intel" JSON dump. No new data generation, no new components — reuse the app's existing (uncomponentized but consistent) pill pattern.

Location: `src/components/accountCard/business/DealWorkspace.js`, inside `IntelligenceSummary`, as sibling sections to the existing Business Model / Product Fit / Products blocks.

## 1. Key Signals

New section, same file, directly below Product Fit:
```jsx
{detail?.fit_signals?.key_signals?.length > 0 && (
  <div style={{ marginTop: 12 }}>
    <p style={SH}>Key Signals</p>
    <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
      {detail.fit_signals.key_signals.map((s, i) => (
        <span key={i} style={{ ...mono, fontSize: 10, color: CARD.textMuted, background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: 3, padding: "2px 6px" }}>{s}</span>
      ))}
    </div>
  </div>
)}
```

## 2. Traction Signals

Identical pattern, same file, own labeled section, empty-array-hides (matches existing `products?.length > 0` convention already in this component).

## 3. Signal Breakdown

Different shape (four sub-arrays + two scalars), so not a flat pill list. Render as:
- `topSignal` and `signalScore` as a single labeled line (e.g. "Top Signal: [text] · Score: [n]")
- Each non-empty sub-array (`paymentSignals`, `onboardingSignals`, `scaleSignals`, `platformSignals`) as its own small labeled sub-group using the same pill styling, with the sub-label as plain text above it (matching `<p style={SH}>` convention used for "Business Model"/"Product Fit" already)
- Empty sub-arrays render nothing — no empty labeled section, consistent rule for every field in this SPEC, not just this one

## 4. Score

Confirmed genuinely absent from this card (only derived `tier` renders, via `AccountCard.js:120-121`'s `displayTier`). Add the raw numeric score next to the existing tier badge in `AccountHeader`'s signals — same badge component, format as e.g. `Score: 3` or integrate into the existing tier badge text, coder's call on exact format, but it must render unconditionally like tier does (collapsed or expanded state), not just inside `IntelligenceSummary`.

## 5. Disqualifier

Confirm current visibility on this card specifically; if not prominent, surface using the same `<p style={SH}>` label convention as Business Model/Product Fit.

## Empty-state rule (applies everywhere in this SPEC)

Any empty array or null field renders nothing — no empty section, no "None" placeholder, matching the existing `products?.length > 0` pattern already in this file. Don't invent a different empty-state treatment per field.

## Explicitly out of scope

Any new LLM-generated fields, any new shared/reusable Pill component (reuse the inline pattern as-is, don't refactor it in this pass), the raw Full Intel panel (unchanged), visual redesign beyond adding these sections in the existing style.

## Verify

Re-check RentPlus (or any assayed account) on the actual card — confirm key signals, traction signals, signal breakdown, and score are now visible as real rendered UI matching the existing pill/label style, not just in the raw JSON dump.

## Ship

Commit + push, confirm live deploy via bundle-hash check same as last time.
