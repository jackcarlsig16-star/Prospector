import { useEffect, useState } from 'react';
import { C, mono } from '../constants/colors';
import { GOOGLE_FEATURE_LABELS, googleStatus, connectGoogle, disconnectGoogle } from '../utils/google';

// Admin > API Keys: which Google features this signed-in user has granted.
// Each one is asked for separately, on first use or from here.
export default function GoogleConnections() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    googleStatus().then(s => { if (live) setStatus(s); });
    return () => { live = false; };
  }, []);
  const any = !!status?.features.length;

  return (
    <div style={{ background:C.card, border:`1px solid ${any?"#4ade8044":C.brd}`, borderRadius:8, padding:"14px 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
        <p style={{ margin:0, fontSize:15, fontWeight:500, color:any?"#4ade80":C.txt }}>Google</p>
        <span style={{ ...mono, fontSize:11, color:any?C.green:C.dim, marginLeft:"auto" }}>
          {status === null ? "…" : any ? `● ${status.email}` : "○ Disconnected"}
        </span>
      </div>
      <div style={{ ...mono, fontSize:10, color:"#555", marginBottom:8 }}>EACH FEATURE ASKS GOOGLE SEPARATELY, THE FIRST TIME YOU USE IT</div>
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        {Object.entries(GOOGLE_FEATURE_LABELS).map(([feature, label]) =>
          status?.features.includes(feature)
            ? <span key={feature} style={{ ...mono, fontSize:12, color:C.green }}>✓ {label}</span>
            : <button key={feature} onClick={() => connectGoogle(feature)} disabled={status === null}
                style={{ ...mono, fontSize:12, padding:"5px 14px", background:`${C.gold}14`, border:`1px solid ${C.gold}44`, color:C.gold, borderRadius:5, cursor:"pointer" }}>
                Connect {label} →
              </button>
        )}
        {any && (
          <button onClick={async () => { await disconnectGoogle(); setStatus({ email: null, features: [] }); }}
            title="Google removes Prospector's access to all three at once"
            style={{ ...mono, fontSize:11, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:5, cursor:"pointer", marginLeft:"auto" }}>
            Disconnect Google
          </button>
        )}
      </div>
    </div>
  );
}
