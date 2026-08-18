import { useState } from 'react';
import { C, mono, sans } from '../constants/colors';

const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 };
const inp = { fontSize:13, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", resize:"vertical", ...mono };
const ghostBtn = { ...mono, fontSize:11, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:5, color:C.dim, cursor:"pointer" };
const smallBtn = { ...mono, fontSize:11, padding:"5px 12px", borderRadius:5, cursor:"pointer" };

const fmtDate = iso => { try { return new Date(iso).toLocaleDateString("en-US", { month:"short", day:"numeric" }); } catch { return "—"; } };

function displayValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '';
  return value || '';
}

// business-intel-strategy-visual-redesign-v1 — bolds the opening phrase of
// each sentence in a prose field (up to the first comma/colon, or first 5
// words if none) rather than restructuring the underlying text. Short
// sentences (<8 words) are left plain so the bolding doesn't swallow the
// whole sentence.
function ProseWithLeadBold({ text }) {
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.map((s, i) => {
    const words = s.split(' ');
    const sep = i < sentences.length - 1 ? ' ' : '';
    if (words.length < 8) return <span key={i}>{s}{sep}</span>;
    const commaIdx = s.search(/[,;:]/);
    const leadLen = commaIdx > 0 && commaIdx < 60 ? commaIdx + 1 : words.slice(0, 5).join(' ').length;
    return <span key={i}><strong style={{ color:C.txt }}>{s.slice(0, leadLen)}</strong>{s.slice(leadLen)}{sep}</span>;
  });
}

function ChipList({ items, accent }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
      {items.map((item, i) => (
        <span key={i} style={{ ...mono, fontSize:11, padding:"3px 10px", borderRadius:12, background:`${accent}18`, border:`1px solid ${accent}44`, color:accent }}>{item}</span>
      ))}
    </div>
  );
}

// business-intel-smart-upload-v1 Fix 6 — one field of the Business Profile
// view: label + value (same look as the plain ProfileBlock the original 6
// fields still use), plus three things only the 7 new fields get:
// - editable (pencil -> inline textarea -> PUT /profile-field)
// - editedManually gets a dashed border - visibly protected from the next
//   resynthesis, per Fix 4's diff-check-on-write skipping these fields
// - a pending field_conflicts entry (Fix 4) renders as a non-blocking
//   "New intel conflicts with your edit" banner with Keep/Accept actions
//
// sources/entries/onHoverSource are shared by BOTH old and new fields
// (field_sources tracks all of generateProfile()'s output, not just the
// new columns) - click-to-expand accordion (business-intel-strategy-
// visual-redesign-v1; was hover-popover before), hovering an expanded
// source row highlights the matching Intel log row already rendered below.
export default function ProfileFieldBlock({ field, label, value, sources, entries, editable, editedManually, conflict, businessId, onSaved, onHoverSource, isArrayField, accent = C.gold }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => displayValue(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showSources, setShowSources] = useState(false);

  const sourceEntries = (sources || []).map(id => entries?.find(e => e.id === id)).filter(Boolean);
  const arrayItems = isArrayField && Array.isArray(value) ? value.filter(Boolean) : null;

  if (!value && !editing && !editable) return null;
  if (!value && !editing && editable && !conflict) {
    return (
      <div style={{ marginBottom:16 }}>
        <div style={sectionLabel}>{label}</div>
        <button onClick={() => { setDraft(''); setEditing(true); }} style={ghostBtn}>+ Add {label.toLowerCase()}</button>
      </div>
    );
  }

  const startEdit = () => { setDraft(displayValue(value)); setError(''); setEditing(true); };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = isArrayField ? draft.split(',').map(s => s.trim()).filter(Boolean) : draft.trim();
      const res = await fetch(`/api/businesses/${businessId}/profile-field`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved(data.profile);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const resolveConflict = async (action) => {
    setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/profile-field/resolve-conflict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve');
      onSaved(data.profile);
    } catch (e) {
      setError(e.message);
    }
  };

  if (editing) {
    return (
      <div style={{ marginBottom:16 }}>
        <div style={sectionLabel}>{label}{isArrayField && <span style={{ color:C.dim, fontWeight:400, textTransform:"none" }}> (comma-separated)</span>}</div>
        <textarea rows={2} value={draft} onChange={e => setDraft(e.target.value)} style={inp} autoFocus />
        {error && <div style={{ ...mono, fontSize:11, color:C.red, marginTop:6 }}>⚠ {error}</div>}
        <div style={{ display:"flex", gap:6, marginTop:6 }}>
          <button onClick={save} disabled={saving} style={{ ...smallBtn, background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700 }}>{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={() => { setEditing(false); setError(''); }} style={{ ...smallBtn, background:"transparent", border:`1px solid ${C.brd}`, color:C.mut }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom:16, paddingLeft: editedManually ? 10 : 0, borderLeft: editedManually ? `2px dashed ${C.gold}88` : "none" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <div style={sectionLabel}>{label}</div>
        {sourceEntries.length > 0 && (
          <button
            onClick={() => setShowSources(s => !s)}
            style={{ ...mono, fontSize:9, color:C.blue, cursor:"pointer", background:"transparent", border:"none", padding:0, display:"inline-flex", alignItems:"center", gap:3 }}
          >
            · {sourceEntries.length} source{sourceEntries.length > 1 ? 's' : ''} {showSources ? '▲' : '▼'}
          </button>
        )}
        {editedManually && <span style={{ ...mono, fontSize:9, color:C.gold }}>· edited</span>}
      </div>

      {showSources && (
        <div style={{ margin:"6px 0 8px", paddingLeft:10, borderLeft:`2px solid ${C.brd}` }}>
          {sourceEntries.map(e => (
            <div key={e.id}
              onMouseEnter={() => onHoverSource?.(e.id)}
              onMouseLeave={() => onHoverSource?.(null)}
              style={{ ...mono, fontSize:10, color:C.mut, marginBottom:4, lineHeight:1.4, cursor:"default" }}
            >
              <span style={{ color:C.dim }}>{fmtDate(e.created_at)}</span> — {(e.content || '').slice(0, 90)}{(e.content || '').length > 90 ? '…' : ''}
            </div>
          ))}
        </div>
      )}

      {arrayItems && arrayItems.length > 0 ? (
        <ChipList items={arrayItems} accent={accent} />
      ) : (
        <p style={{ ...sans, fontSize:13, color:C.txt, margin:0, lineHeight:1.65 }}>
          {value ? <ProseWithLeadBold text={displayValue(value)} /> : '—'}
        </p>
      )}
      {editable && (
        <button onClick={startEdit} style={{ ...ghostBtn, marginTop:8, fontSize:10, padding:"2px 8px" }}>Edit</button>
      )}

      {conflict && (
        <div style={{ marginTop:8, padding:"8px 10px", background:`${C.orange}0F`, border:`1px solid ${C.orange}44`, borderRadius:6 }}>
          <p style={{ ...mono, fontSize:11, color:C.orange, margin:"0 0 6px" }}>New intel conflicts with your edit</p>
          <p style={{ ...mono, fontSize:11, color:C.mut, margin:"0 0 8px", lineHeight:1.5 }}>{displayValue(conflict.candidate_value) || '—'}</p>
          {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:6 }}>⚠ {error}</div>}
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={() => resolveConflict('accept')} style={{ ...smallBtn, background:"transparent", border:`1px solid ${C.orange}66`, color:C.orange }}>Accept new</button>
            <button onClick={() => resolveConflict('keep')} style={{ ...smallBtn, background:"transparent", border:`1px solid ${C.brd}`, color:C.mut }}>Keep mine</button>
          </div>
        </div>
      )}
    </div>
  );
}
