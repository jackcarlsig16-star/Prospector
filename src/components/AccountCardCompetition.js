import { useState } from 'react';
import { mono } from '../constants/colors';
import { T } from '../constants/tokens';

export default function AccountCardCompetition({ acc, onUpdate }) {
  const competitors = acc.competitors || [];
  const [input, setInput] = useState("");

  const addCompetitor = (raw) => {
    const name = (raw || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (competitors.some(c => c.toLowerCase() === key)) { setInput(""); return; }
    onUpdate({ competitors: [...competitors, name] });
    setInput("");
  };

  const removeCompetitor = (name) => {
    onUpdate({ competitors: competitors.filter(c => c !== name) });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addCompetitor(input);
    }
  };

  const SH = { ...mono, fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text.muted };

  return (
    <div style={{ marginTop: 12, borderLeft: `2px solid ${T.amber2}55`, paddingLeft: 12, paddingTop: 8, paddingBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ ...SH, color: T.amber2 }}>◈ Competition {competitors.length > 0 && `(${competitors.length})`}</span>
        {acc.crayonLinked && (
          <span style={{ ...mono, fontSize: 9, padding: "1px 6px", background: `${T.cyan}14`, border: `1px solid ${T.cyan}44`, color: T.cyan, borderRadius: 3 }}>● Crayon</span>
        )}
      </div>

      {competitors.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {competitors.map(c => (
            <span key={c} style={{ ...mono, fontSize: 11, padding: T.spacing.pill, background: `${T.amber2}10`, border: `1px solid ${T.amber2}44`, color: T.amber2, borderRadius: 4, display: "inline-flex", alignItems: "center", gap: 5 }}>
              {c}
              <button onClick={e => { e.stopPropagation(); removeCompetitor(c); }} style={{ background: "transparent", border: "none", color: T.amber2, fontSize: 11, lineHeight: 1, padding: 0, cursor: "pointer", opacity: 0.6 }}>✕</button>
            </span>
          ))}
        </div>
      )}

      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) addCompetitor(input); }}
        onClick={e => e.stopPropagation()}
        placeholder="Add competitor… (Enter or comma)"
        style={{ ...mono, width: "100%", fontSize: 11, padding: "5px 9px", background: T.bg.surface, border: `1px solid ${T.border.muted}`, borderRadius: 4, color: T.text.primary, outline: "none", boxSizing: "border-box" }}
      />
    </div>
  );
}
