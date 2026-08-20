import { useState } from 'react';
import { C, mono } from '../constants/colors';

const inp = { fontSize:12, padding:"6px 9px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:5, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };
const smallBtn = { ...mono, fontSize:11, padding:"5px 12px", borderRadius:5, cursor:"pointer" };

// business-website-url-editable-v1 — mirrors BusinessSocialLinksPopover.js's
// shape (plain URL field, popover-with-Save/Cancel) but deliberately does
// NOT call generateProfile() on save the way social-links-save.js does.
// Editing the URL and re-scanning the site are two different actions -
// cascading an expensive AI resynthesis off a text-field save risks firing
// on every edit and the blast radius of getting that wrong outweighs the
// convenience. Jack triggers "Refresh profile" himself when he wants a
// resync against the new URL.
export default function BusinessWebsiteUrlPopover({ businessId, websiteUrl, onSaved, onClose }) {
  const [draft, setDraft] = useState(websiteUrl || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      setError('Must be a non-empty URL starting with http:// or https://');
      return;
    }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/website-url`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website_url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved(data.business.website_url);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{ position:"absolute", top:"100%", left:0, marginTop:8, zIndex:20, width:280, background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:14, boxShadow:"0 8px 24px rgba(0,0,0,0.4)" }}
    >
      <p style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 10px" }}>Website URL</p>
      <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="https://…" style={inp} disabled={saving} autoFocus />
      {error && <div style={{ ...mono, fontSize:11, color:C.red, margin:"8px 0 0" }}>⚠ {error}</div>}
      <div style={{ display:"flex", gap:8, marginTop:10 }}>
        <button onClick={save} disabled={saving} style={{ ...smallBtn, background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700 }}>{saving ? "Saving…" : "Save"}</button>
        <button onClick={onClose} disabled={saving} style={{ ...smallBtn, background:"transparent", border:`1px solid ${C.brd}`, color:C.mut }}>Cancel</button>
      </div>
      <p style={{ ...mono, fontSize:9, color:C.dim, margin:"8px 0 0" }}>Doesn't re-scan the site — use "Refresh profile" for that.</p>
    </div>
  );
}
