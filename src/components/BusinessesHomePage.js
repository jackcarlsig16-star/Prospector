import { useState } from 'react';
import { C, mono, PRESET_SWATCH_COLORS } from '../constants/colors';

const STATUS_PILL = {
  researching: { label: 'Researching…', color: C.orange },
  error: { label: 'Error', color: C.red },
};

function CreateBusinessModal({ userEmail, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [tagline, setTagline] = useState('');
  const [color, setColor] = useState(PRESET_SWATCH_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = name.trim() && websiteUrl.trim();

  const handleCreate = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          website_url: websiteUrl.trim(),
          tagline: tagline.trim(),
          color,
          owner_email: userEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create business');
      onCreated(data.business);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const inp = { fontSize:13, padding:"8px 11px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };
  const label = { ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget) onClose();}} style={{ position:"fixed", inset:0, zIndex:1000, background:"#00000099", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"22px 26px", width:380, boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:20 }}>
          <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>New business</span>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.mut, fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={label}>Name</div>
          <input type="text" placeholder="Acme Co" value={name} onChange={e=>setName(e.target.value)} style={inp} />
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={label}>Website *</div>
          <input
            type="text" placeholder="https://example.com" value={websiteUrl}
            onChange={e=>setWebsiteUrl(e.target.value)}
            onKeyDown={e=>e.key==="Enter" && canSubmit && handleCreate()}
            style={inp}
          />
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={label}>Tagline (optional)</div>
          <input type="text" placeholder="What this business is" value={tagline} onChange={e=>setTagline(e.target.value)} style={inp} />
        </div>

        <div style={{ marginBottom:22 }}>
          <div style={{ ...label, marginBottom:8 }}>Color</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {PRESET_SWATCH_COLORS.map(c => (
              <button key={c} onClick={()=>setColor(c)} aria-label={c}
                style={{
                  width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", padding:0,
                  border: color===c ? `2px solid ${C.txt}` : "2px solid transparent",
                  boxShadow: color===c ? `0 0 0 2px ${C.card}` : "none",
                }}
              />
            ))}
          </div>
        </div>

        {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:12 }}>⚠ {error}</div>}

        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ ...mono, fontSize:12, padding:"7px 16px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" }}>Cancel</button>
          <button onClick={handleCreate} disabled={!canSubmit||saving}
            style={{ ...mono, fontSize:12, padding:"7px 20px", background:canSubmit?C.gold:"transparent", border:`1px solid ${canSubmit?C.gold:C.brd}`, borderRadius:6, color:canSubmit?C.bg:C.dim, cursor:canSubmit&&!saving?"pointer":"default", fontWeight:700 }}>
            {saving ? "Creating…" : "Create →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BusinessesHomePage({ businesses, loading, userEmail, onSelect, onCreated }) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"48px 40px" }}>
      <div style={{ maxWidth:900, margin:"0 auto" }}>
        <h1 style={{ ...mono, fontSize:20, color:C.txt, fontWeight:700, margin:"0 0 24px" }}>Businesses</h1>

        {loading ? (
          <p style={{ ...mono, fontSize:13, color:C.dim, margin:"0 0 20px" }}>Loading…</p>
        ) : businesses.length === 0 && (
          <p style={{ ...mono, fontSize:13, color:C.dim, margin:"0 0 20px" }}>
            No businesses yet. Add your first one below.
          </p>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:16 }}>
          {businesses.map(b => {
            const pill = STATUS_PILL[b.research_status];
            return (
              <button key={b.id} onClick={()=>onSelect(b)}
                style={{
                  display:"flex", flexDirection:"column", justifyContent:"flex-end", height:140,
                  borderRadius:10, border:`1px solid ${C.brd}`, borderLeft:`4px solid ${b.color||C.gold}`,
                  background:`linear-gradient(160deg, ${b.color||C.gold}33, ${C.card})`,
                  padding:16, cursor:"pointer", textAlign:"left", position:"relative",
                }}
              >
                <div style={{ position:"absolute", top:16, right:16, width:32, height:32, borderRadius:6, background:b.color||C.gold, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ ...mono, fontSize:14, color:C.bg, fontWeight:700 }}>{(b.name||'?')[0].toUpperCase()}</span>
                </div>
                {pill && (
                  <span style={{ ...mono, fontSize:9, padding:"2px 7px", borderRadius:9, background:`${pill.color}18`, border:`1px solid ${pill.color}44`, color:pill.color, alignSelf:"flex-start", marginBottom:6 }}>
                    {pill.label}
                  </span>
                )}
                <span style={{ ...mono, fontSize:14, color:C.txt, fontWeight:700 }}>{b.name}</span>
                {b.tagline && (
                  <span style={{ ...mono, fontSize:11, color:C.dim, marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.tagline}</span>
                )}
              </button>
            );
          })}

          <button onClick={()=>setModalOpen(true)}
            style={{ display:"flex", alignItems:"center", justifyContent:"center", height:140, borderRadius:10, border:`1.5px dashed ${C.brd}`, background:"transparent", cursor:"pointer" }}>
            <span style={{ ...mono, fontSize:13, color:C.dim, fontWeight:600 }}>+ New Business</span>
          </button>
        </div>
      </div>

      {modalOpen && (
        <CreateBusinessModal
          userEmail={userEmail}
          onClose={()=>setModalOpen(false)}
          onCreated={business => { setModalOpen(false); onCreated(business); }}
        />
      )}
    </div>
  );
}
