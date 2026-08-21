import { CARD } from './tokens';

// Compact state row per Section 9. Deliberately dumb/generic — callers
// (business/influencer state modules) build the actual controls so this
// stays a coherent layout primitive rather than knowing about deal stages
// or relationship temperatures itself.
export default function AccountStateBar({ items = [] }) {
  if (!items.length) return null;
  return (
    // account-card-density-v1 — the card-level padding and 12px bottom
    // margin belonged to this being a standalone row under the header. It
    // sits inside the expanded toolbar now, which owns its own spacing.
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
      {items.map((item, i) => (
        <div key={item.key || i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {item.control}
          {i < items.length - 1 && <span style={{ width: 1, height: 14, background: CARD.border }} />}
        </div>
      ))}
    </div>
  );
}
