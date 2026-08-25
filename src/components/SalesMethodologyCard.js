import { useState } from 'react';
import { C, mono } from '../constants/colors';

const fmtDate = iso => { try { return new Date(iso).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }); } catch { return "—"; } };

const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 };
const btn = { ...mono, fontSize:11, padding:"6px 14px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" };
const inp = { fontSize:12, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", resize:"vertical", ...mono };

// generation-engine-rebuild-v1 Stage 4 — sibling to AssayCriteriaCard and
// OutreachRulesCard, but deliberately simpler: one pasted block, manual save,
// no Generate/Regenerate. Mirrors how campaigns.doctrine is entered, because
// there is no derived source to distil a selling method from the way there is
// for fit criteria.
export default function SalesMethodologyCard({ businessId, methodology, updatedAt, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(methodology || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/sales-methodology`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_methodology: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      onUpdated({ sales_methodology: data.sales_methodology, sales_methodology_updated_at: data.sales_methodology_updated_at });
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginBottom:32, padding:"16px 18px", background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
        <span style={{ ...sectionLabel, marginBottom:0 }}>Sales Methodology</span>
        <span style={{ ...mono, fontSize:11, color:C.dim, marginLeft:"auto" }}>
          {updatedAt ? `Saved ${fmtDate(updatedAt)}` : "Not set"}
        </span>
        {!editing && (
          <button style={btn} onClick={() => { setDraft(methodology || ''); setError(''); setEditing(true); }}>
            {methodology ? "Edit" : "Add"}
          </button>
        )}
      </div>

      {editing ? (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <textarea
            rows={12}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Paste how this business sells — the framework, the stages, the principles reps follow. Applied to every generated message for this business."
            style={inp}
          />
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button style={{ ...btn, background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700 }} onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button style={btn} onClick={() => { setEditing(false); setError(''); }} disabled={saving}>Cancel</button>
            {error && <span style={{ ...mono, fontSize:11, color:C.red }}>{error}</span>}
          </div>
        </div>
      ) : methodology ? (
        <p style={{ ...mono, fontSize:12, color:C.txt, lineHeight:1.6, margin:0, whiteSpace:"pre-wrap" }}>{methodology}</p>
      ) : (
        <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>
          No methodology set. Generated outreach falls back to the platform defaults.
        </p>
      )}
    </div>
  );
}
