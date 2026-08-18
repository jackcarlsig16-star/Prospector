import { useState, useEffect, useRef } from 'react';
import { C, mono } from '../constants/colors';

const inp = { fontSize:12, padding:"6px 9px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:5, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };
const smallBtn = { ...mono, fontSize:11, padding:"5px 12px", borderRadius:5, cursor:"pointer" };

const FIELDS = [
  ['instagram', 'Instagram'],
  ['linkedin', 'LinkedIn'],
  ['twitter', 'Twitter / X'],
  ['facebook', 'Facebook'],
];

// business-social-links-v1 - small popover off the business avatar. Plain
// URL fields, no fetch/validation beyond trimming - these are context/seed
// hints fed into generateProfile()/web_research, never scraped directly
// (Instagram: confirmed dead end, login wall, tested 3x already; LinkedIn:
// deliberately out of scope for this pass too).
//
// business-profile-refresh-v1 - saving now also triggers a real
// resynthesis (see social-links-save.js), so this can take as long as a
// full profile refresh - same elapsed-counter + progress-bar treatment as
// Add Intel/Smart Intake, not a static "Saving…" label.
export default function BusinessSocialLinksPopover({ businessId, socialLinks, onSaved, onClose }) {
  const [draft, setDraft] = useState(() => ({
    instagram: socialLinks?.instagram || '',
    linkedin: socialLinks?.linkedin || '',
    twitter: socialLinks?.twitter || '',
    facebook: socialLinks?.facebook || '',
  }));
  const [saving, setSaving] = useState(false);
  const [savingElapsed, setSavingElapsed] = useState(0);
  const savingTimerRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => () => { if (savingTimerRef.current) clearInterval(savingTimerRef.current); }, []);

  const save = async () => {
    setSaving(true); setSavingElapsed(0); setError('');
    savingTimerRef.current = setInterval(() => setSavingElapsed(s => s + 1), 1000);
    try {
      const cleaned = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim() || null]));
      const res = await fetch(`/api/businesses/${businessId}/social-links`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ social_links: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved(data.business.social_links, data.profile);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      clearInterval(savingTimerRef.current);
      savingTimerRef.current = null;
      setSaving(false);
    }
  };

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{ position:"absolute", top:"100%", left:0, marginTop:8, zIndex:20, width:260, background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:14, boxShadow:"0 8px 24px rgba(0,0,0,0.4)" }}
    >
      <p style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 10px" }}>Social Links</p>
      {FIELDS.map(([key, label]) => (
        <div key={key} style={{ marginBottom:8 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, marginBottom:3 }}>{label}</div>
          <input value={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} placeholder="https://…" style={inp} disabled={saving} />
        </div>
      ))}
      {error && <div style={{ ...mono, fontSize:11, color:C.red, margin:"4px 0 8px" }}>⚠ {error}</div>}
      <div style={{ display:"flex", gap:8, marginTop:4 }}>
        <button onClick={save} disabled={saving} style={{ ...smallBtn, background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700 }}>{saving ? `Saving… ${savingElapsed}s` : "Save"}</button>
        <button onClick={onClose} disabled={saving} style={{ ...smallBtn, background:"transparent", border:`1px solid ${C.brd}`, color:C.mut }}>Cancel</button>
      </div>
      {saving && (
        <div style={{ marginTop:8, height:3, background:C.brd, borderRadius:2, overflow:"hidden", position:"relative" }}>
          <div style={{ position:"absolute", top:0, left:"-30%", height:"100%", width:"30%", background:C.gold, borderRadius:2, animation:"socialSaveBarSlide 1.1s ease-in-out infinite" }} />
          <style>{`@keyframes socialSaveBarSlide { 0% { left: -30%; } 100% { left: 100%; } }`}</style>
        </div>
      )}
      {saving && <p style={{ ...mono, fontSize:9, color:C.dim, margin:"6px 0 0" }}>Saving and refreshing the profile from current intel…</p>}
    </div>
  );
}
