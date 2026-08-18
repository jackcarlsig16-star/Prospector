import { C, mono, sans } from '../constants/colors';

// business-intel-strategy-visual-redesign-v1 — top-of-page summary/preview
// layer, not a replacement for the full field panels below. No "highest
// value" flag exists anywhere in business_profiles (checked the schema),
// so this is a small fixed candidate set rendered dynamically per-business
// — only cards whose field is actually populated show, which is what makes
// this work for both a data-rich business and a thin one without a
// hardcoded per-business list.
const CANDIDATES = [
  { field: 'industry',     label: 'Industry',     kind: 'text' },
  { field: 'core_problem', label: 'Core Problem', kind: 'text', truncate: 90 },
  { field: 'value_props',  label: 'Value Props',  kind: 'array', limit: 2 },
  { field: 'products',     label: 'Products',     kind: 'array', limit: 2 },
];

export default function BusinessIntelKpiStrip({ profile, accent = C.gold }) {
  if (!profile) return null;

  const cards = CANDIDATES.map(c => {
    const raw = profile[c.field];
    if (c.kind === 'array') {
      const items = Array.isArray(raw) ? raw.filter(Boolean) : [];
      return items.length ? { ...c, display: items.slice(0, c.limit) } : null;
    }
    if (!raw) return null;
    const display = c.truncate && raw.length > c.truncate ? raw.slice(0, c.truncate) + '…' : raw;
    return { ...c, display };
  }).filter(Boolean);

  if (!cards.length) return null;

  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:24 }}>
      {cards.map(c => (
        <div key={c.field} style={{ flex:"1 1 200px", minWidth:180, padding:"12px 14px", background:C.card, border:`1px solid ${C.brd}`, borderTop:`2px solid ${accent}`, borderRadius:8 }}>
          <p style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", margin:"0 0 6px" }}>{c.label}</p>
          {c.kind === 'array' ? (
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {c.display.map((item, i) => (
                <span key={i} style={{ ...mono, fontSize:10, padding:"2px 8px", borderRadius:10, background:`${accent}18`, color:accent }}>{item}</span>
              ))}
            </div>
          ) : (
            <p style={{ ...sans, fontSize:13, color:C.txt, margin:0, lineHeight:1.4 }}>{c.display}</p>
          )}
        </div>
      ))}
    </div>
  );
}
