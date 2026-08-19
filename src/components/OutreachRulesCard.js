import { useState } from 'react';
import { C, mono } from '../constants/colors';

const fmtDate = iso => { try { return new Date(iso).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }); } catch { return "—"; } };

const FIELD_LABELS = [
  { key: 'tone', label: 'Tone' },
  { key: 'structure', label: 'Structure' },
  { key: 'key_points', label: 'Key points' },
  { key: 'dos', label: "Do's" },
  { key: 'donts', label: "Don'ts" },
  { key: 'example_snippets', label: 'Example snippets' },
];

const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 };
const btn = { ...mono, fontSize:11, padding:"6px 14px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" };
const inp = { fontSize:12, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", resize:"vertical", ...mono };

// outreach-intelligence-v1 Section 1 — distilled, cached per-business
// outreach messaging rules. Same shape as AssayCriteriaCard, but the
// generate/regenerate input is a pasted document (there's no derived
// business-profile source for messaging rules the way there is for fit
// criteria), so Generate/Regenerate open a paste box rather than firing
// immediately.
export default function OutreachRulesCard({ businessId, rules, updatedAt, editedManually, onUpdated }) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => FIELD_LABELS.reduce((acc, f) => ({ ...acc, [f.key]: rules?.[f.key] || '' }), {}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    setDraft(FIELD_LABELS.reduce((acc, f) => ({ ...acc, [f.key]: rules?.[f.key] || '' }), {}));
    setError('');
    setEditing(true);
  };

  const generate = async () => {
    if (!pasteText.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/outreach-rules/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pastedText: pasteText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate');
      onUpdated({ outreach_rules: data.outreach_rules, outreach_rules_updated_at: new Date().toISOString(), outreach_rules_edited_manually: false });
      setPasteOpen(false);
      setPasteText('');
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
      const res = await fetch(`/api/businesses/${businessId}/outreach-rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onUpdated({ outreach_rules: data.outreach_rules, outreach_rules_updated_at: new Date().toISOString(), outreach_rules_edited_manually: true });
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
          <h2 style={{ ...mono, fontSize:13, color:C.txt, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 4px" }}>Outreach Rules</h2>
          <p style={{ ...mono, fontSize:10, color:C.dim, margin:0 }}>
            {rules
              ? `${editedManually ? 'Manually edited' : 'Distilled from a pasted document'}${updatedAt ? ` · last updated ${fmtDate(updatedAt)}` : ''}`
              : 'Not yet generated — paste an outreach-training document to distill business-level messaging rules.'}
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
      ) : pasteOpen ? (
        <div>
          <div style={sectionLabel}>Paste outreach-training document</div>
          <textarea rows={8} value={pasteText} onChange={e=>setPasteText(e.target.value)} style={{ ...inp, marginBottom:10 }} placeholder="Paste the doc here — tone guide, past outreach notes, example emails, whatever describes how outreach for this business should read." />
          {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:10 }}>⚠ {error}</div>}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={generate} disabled={generating || !pasteText.trim()} style={{ ...btn, background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700 }}>{generating ? 'Distilling…' : 'Generate rules'}</button>
            <button onClick={()=>{ setPasteOpen(false); setPasteText(''); setError(''); }} style={btn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          {rules ? FIELD_LABELS.map(f => (
            <div key={f.key} style={{ marginBottom:12 }}>
              <div style={sectionLabel}>{f.label}</div>
              <p style={{ ...mono, fontSize:12, color:C.txt, margin:0, lineHeight:1.6 }}>{rules[f.key] || '—'}</p>
            </div>
          )) : (
            <p style={{ ...mono, fontSize:12, color:C.dim, margin:"0 0 12px" }}>No rules yet — paste a document to replace generic outreach defaults with this business's real messaging rules.</p>
          )}
          {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:10 }}>⚠ {error}</div>}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>{ setPasteOpen(true); setError(''); }} style={{ ...btn, color:C.gold, borderColor:`${C.gold}66` }}>{rules ? 'Regenerate from new document' : 'Generate rules'}</button>
            {rules && <button onClick={startEdit} style={btn}>Edit manually</button>}
          </div>
        </div>
      )}
    </div>
  );
}
