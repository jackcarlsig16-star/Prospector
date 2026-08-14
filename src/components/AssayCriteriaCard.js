import { useState } from 'react';
import { C, mono } from '../constants/colors';

const fmtDate = iso => { try { return new Date(iso).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }); } catch { return "—"; } };

const FIELD_LABELS = [
  { key: 'fit_signals', label: 'Fit signals' },
  { key: 'disqualifiers', label: 'Disqualifiers' },
  { key: 'tier_guidance', label: 'Tier guidance' },
];

const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 };
const btn = { ...mono, fontSize:11, padding:"6px 14px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" };
const inp = { fontSize:12, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", resize:"vertical", ...mono };

// assay-engine-generalization-v1 — distilled, cached per-business Assay
// scoring criteria. Read-mostly card: Regenerate calls the real LLM
// (rare, explicit); Edit manually is a plain field save, no LLM call.
export default function AssayCriteriaCard({ businessId, criteria, updatedAt, editedManually, onUpdated }) {
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({
    fit_signals: criteria?.fit_signals || '',
    disqualifiers: criteria?.disqualifiers || '',
    tier_guidance: criteria?.tier_guidance || '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    setDraft({
      fit_signals: criteria?.fit_signals || '',
      disqualifiers: criteria?.disqualifiers || '',
      tier_guidance: criteria?.tier_guidance || '',
    });
    setError('');
    setEditing(true);
  };

  const regenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/assay-criteria/generate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate');
      onUpdated({ assay_criteria: data.assay_criteria, assay_criteria_updated_at: new Date().toISOString(), assay_criteria_edited_manually: false });
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/assay-criteria`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onUpdated({ assay_criteria: data.assay_criteria, assay_criteria_updated_at: new Date().toISOString(), assay_criteria_edited_manually: true });
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginBottom:32, padding:"16px 18px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
      <div style={{ display:"flex", alignItems:"flex-start", marginBottom:16 }}>
        <div>
          <h2 style={{ ...mono, fontSize:13, color:C.txt, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 4px" }}>Assay Criteria</h2>
          <p style={{ ...mono, fontSize:10, color:C.dim, margin:0 }}>
            {criteria
              ? `${editedManually ? 'Manually edited' : 'Auto-generated from company intelligence'}${updatedAt ? ` · last updated ${fmtDate(updatedAt)}` : ''}`
              : 'Not yet generated — used by Assay to score accounts against this business\'s real fit criteria instead of generic defaults.'}
          </p>
        </div>
      </div>

      {editing ? (
        <div>
          {FIELD_LABELS.map(f => (
            <div key={f.key} style={{ marginBottom:12 }}>
              <div style={sectionLabel}>{f.label}</div>
              <textarea rows={2} value={draft[f.key]} onChange={e=>setDraft(d=>({ ...d, [f.key]: e.target.value }))} style={inp} />
            </div>
          ))}
          {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:10 }}>⚠ {error}</div>}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={save} disabled={saving} style={{ ...btn, background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700 }}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={()=>{ setEditing(false); setError(''); }} style={btn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          {criteria ? FIELD_LABELS.map(f => (
            <div key={f.key} style={{ marginBottom:12 }}>
              <div style={sectionLabel}>{f.label}</div>
              <p style={{ ...mono, fontSize:12, color:C.txt, margin:0, lineHeight:1.6 }}>{criteria[f.key] || '—'}</p>
            </div>
          )) : (
            <p style={{ ...mono, fontSize:12, color:C.dim, margin:"0 0 12px" }}>No criteria yet — generate from this business's profile to replace Assay's generic default scoring.</p>
          )}
          {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:10 }}>⚠ {error}</div>}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={regenerate} disabled={generating} style={{ ...btn, color:C.gold, borderColor:`${C.gold}66` }}>{generating ? 'Generating…' : (criteria ? 'Regenerate from latest intel' : 'Generate criteria')}</button>
            {criteria && <button onClick={startEdit} style={btn}>Edit manually</button>}
          </div>
        </div>
      )}
    </div>
  );
}
