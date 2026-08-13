import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';

const inp = { fontSize:14, padding:"10px 12px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", ...mono };
const label = { ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 };
const btn = { ...mono, fontSize:13, padding:"10px 20px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700, width:"100%" };

export default function JoinBusinessPage({ code, onJoined }) {
  const [business, setBusiness] = useState(null);
  const [lookupError, setLookupError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/businesses/join/${encodeURIComponent(code)}`)
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) { setLookupError(data.error || 'Invalid or expired invite link'); return; }
        setBusiness(data.business);
      })
      .catch(() => { if (!cancelled) setLookupError('Could not reach the server'); });
    return () => { cancelled = true; };
  }, [code]);

  const canSubmit = name.trim() && email.trim();

  const handleJoin = async () => {
    if (!canSubmit || joining) return;
    setJoining(true);
    setJoinError('');
    try {
      const res = await fetch('/api/businesses/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name: name.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join');
      onJoined(data.member, data.business);
    } catch (e) {
      setJoinError(e.message);
    } finally {
      setJoining(false);
    }
  };

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ width:380, background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:"28px 26px" }}>
        {lookupError ? (
          <>
            <p style={{ ...mono, fontSize:14, color:C.red, margin:"0 0 8px", fontWeight:700 }}>⚠ {lookupError}</p>
            <p style={{ ...mono, fontSize:12, color:C.dim, margin:0 }}>Ask whoever sent you this link for a fresh one.</p>
          </>
        ) : !business ? (
          <p style={{ ...mono, fontSize:13, color:C.dim, margin:0 }}>Loading…</p>
        ) : (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
              <div style={{ width:44, height:44, borderRadius:8, background:business.color||C.gold, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <span style={{ ...mono, fontSize:18, color:C.bg, fontWeight:700 }}>{(business.name||'?')[0].toUpperCase()}</span>
              </div>
              <div>
                <p style={{ ...mono, fontSize:10, color:C.dim, margin:"0 0 2px", textTransform:"uppercase", letterSpacing:"0.06em" }}>You've been invited to</p>
                <p style={{ ...mono, fontSize:16, color:C.txt, fontWeight:700, margin:0 }}>{business.name}</p>
              </div>
            </div>

            <div style={{ marginBottom:14 }}>
              <div style={label}>Your name</div>
              <input type="text" placeholder="Jane Doe" value={name} onChange={e=>setName(e.target.value)} style={inp} />
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={label}>Your email</div>
              <input
                type="email" placeholder="jane@example.com" value={email}
                onChange={e=>setEmail(e.target.value)}
                onKeyDown={e=>e.key==="Enter" && canSubmit && handleJoin()}
                style={inp}
              />
            </div>

            {joinError && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:12 }}>⚠ {joinError}</div>}

            <button onClick={handleJoin} disabled={!canSubmit||joining} style={{ ...btn, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit&&!joining ? "pointer" : "default" }}>
              {joining ? "Joining…" : "Join →"}
            </button>
            <p style={{ ...mono, fontSize:10, color:C.dim, margin:"14px 0 0", textAlign:"center", lineHeight:1.5 }}>
              No password needed — this link and your email are your access.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
