import { useState } from 'react';
import { C, mono } from '../constants/colors';

const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 };
const inp = { fontSize:13, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", resize:"vertical", ...mono };
const ghostBtn = { ...mono, fontSize:11, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:5, color:C.dim, cursor:"pointer" };
const smallBtn = { ...mono, fontSize:11, padding:"5px 12px", borderRadius:5, cursor:"pointer" };

const fmtDate = iso => { try { return new Date(iso).toLocaleDateString("en-US", { month:"short", day:"numeric" }); } catch { return "—"; } };

function displayValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '';
  return value || '';
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
// new columns) - hovering the source badge highlights the matching Intel
// log row(s) already rendered below, no separate source viewer built.
export default function ProfileFieldBlock({ field, label, value, sources, entries, editable, editedManually, conflict, businessId, onSaved, onHoverSource, isArrayField }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => displayValue(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showSources, setShowSources] = useState(false);

  const sourceEntries = (sources || []).map(id => entries?.find(e => e.id === id)).filter(Boolean);

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
          <span
            onMouseEnter={() => { setShowSources(true); onHoverSource?.(sourceEntries[0].id); }}
            onMouseLeave={() => { setShowSources(false); onHoverSource?.(null); }}
            style={{ ...mono, fontSize:9, color:C.blue, cursor:"default", position:"relative", paddingBottom:2 }}
          >
            · {sourceEntries.length} source{sourceEntries.length > 1 ? 's' : ''}
            {showSources && (
              <div style={{ position:"absolute", top:"100%", left:0, zIndex:5, marginTop:4, minWidth:220, maxWidth:320, background:C.card, border:`1px solid ${C.brd}`, borderRadius:6, padding:"8px 10px", boxShadow:"0 4px 12px rgba(0,0,0,0.3)" }}>
                {sourceEntries.map(e => (
                  <div key={e.id} style={{ ...mono, fontSize:10, color:C.mut, marginBottom:4, lineHeight:1.4 }}>
                    <span style={{ color:C.dim }}>{fmtDate(e.created_at)}</span> — {(e.content || '').slice(0, 70)}{(e.content || '').length > 70 ? '…' : ''}
                  </div>
                ))}
              </div>
            )}
          </span>
        )}
        {editedManually && <span style={{ ...mono, fontSize:9, color:C.gold }}>· edited</span>}
      </div>
      <p style={{ ...mono, fontSize:13, color:C.txt, margin:0, lineHeight:1.6 }}>{displayValue(value) || '—'}</p>
      {editable && (
        <button onClick={startEdit} style={{ ...ghostBtn, marginTop:6, fontSize:10, padding:"2px 8px" }}>Edit</button>
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
