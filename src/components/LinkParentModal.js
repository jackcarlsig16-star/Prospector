import { useState, useEffect, useMemo } from 'react';
import { mono } from '../constants/colors';
import { T } from '../constants/tokens';

const TIER_COLOR = { Gold: T.tier.gold, Silver: T.tier.silver, Tin: T.tier.tin, Slag: T.tier.slag };

export default function LinkParentModal({ acc, allAccounts = [], onPick, onClose }) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ownKids = new Set((acc.childIds || []).map(String));
    return allAccounts.filter(c => {
      if (String(c.id) === String(acc.id)) return false;
      if (c.parentId) return false;
      if (ownKids.has(String(c.id))) return false;
      if (!q) return true;
      return c.name?.toLowerCase().includes(q) || c.web?.toLowerCase().includes(q);
    }).slice(0, 8);
  }, [query, allAccounts, acc]);

  const onKey = (e) => {
    if (e.key === "Enter" && candidates.length === 1) {
      e.preventDefault();
      onPick(candidates[0].id);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.76)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, maxHeight: "80vh", overflowY: "auto", background: T.bg.card, border: `1px solid ${T.border.subtle}`, borderRadius: 12, padding: "18px 20px", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <p style={{ ...mono, margin: 0, fontSize: 11, color: T.text.primary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, flex: 1 }}>↑ Link parent — {acc.name}</p>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: T.text.dim, fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
        </div>

        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search by name or web…"
          style={{ ...mono, width: "100%", fontSize: 12, padding: "7px 10px", background: T.bg.surface, border: `1px solid ${T.border.muted}`, borderRadius: 5, color: T.text.primary, outline: "none", boxSizing: "border-box", marginBottom: 10 }}
        />

        {candidates.length === 0 ? (
          <p style={{ ...mono, fontSize: 11, color: T.text.dim, padding: "16px 0", textAlign: "center" }}>No matches</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {candidates.map(c => (
              <button
                key={c.id}
                onClick={() => onPick(c.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "transparent", border: `1px solid ${T.border.subtle}`, borderRadius: 5, cursor: "pointer", textAlign: "left", color: T.text.primary, transition: "background 0.1s" }}
                onMouseEnter={e => e.currentTarget.style.background = T.bg.cardExpanded}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ ...mono, fontSize: 12, color: T.text.primary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                {c.tier && (
                  <span style={{ ...mono, fontSize: 9, padding: "1px 6px", background: `${TIER_COLOR[c.tier] || T.text.dim}18`, border: `1px solid ${TIER_COLOR[c.tier] || T.text.dim}44`, color: TIER_COLOR[c.tier] || T.text.dim, borderRadius: 3 }}>{c.tier}</span>
                )}
                {c.web && <span style={{ ...mono, fontSize: 10, color: T.text.dim, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.web}</span>}
              </button>
            ))}
          </div>
        )}

        <p style={{ ...mono, fontSize: 9, color: T.text.dim, marginTop: 10, textAlign: "center" }}>Esc to close · Enter to pick when only one match</p>
      </div>
    </div>
  );
}
