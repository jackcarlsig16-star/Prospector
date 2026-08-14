import { CARD } from './tokens';

// Compact state row per Section 9. Deliberately dumb/generic — callers
// (business/influencer state modules) build the actual controls so this
// stays a coherent layout primitive rather than knowing about deal stages
// or relationship temperatures itself.
export default function AccountStateBar({ items = [] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "0 14px 12px" }} onClick={e => e.stopPropagation()}>
      {items.map((item, i) => (
        <div key={item.key || i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {item.control}
          {i < items.length - 1 && <span style={{ width: 1, height: 14, background: CARD.border }} />}
        </div>
      ))}
    </div>
  );
}
