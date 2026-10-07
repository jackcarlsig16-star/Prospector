import { useEffect, useState } from 'react';
import { C, mono } from '../constants/colors';

// microsoft-connect-v1 - user menu > Microsoft connection. The server holds
// the token (api/lib/microsoftGrants.js); this only shows which mailbox is
// connected and starts Connect / Reconnect / Disconnect.
const when = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export function connectMicrosoft() {
  const back = window.location.pathname + window.location.search;
  window.location.assign(`/api/microsoft/connect?return=${encodeURIComponent(back)}`);
}

export default function MicrosoftConnection() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const load = () => fetch('/api/microsoft/status').then(r => r.json()).then(setStatus).catch(() => setStatus({ email: null, scopes: [], error: 'Couldn’t load the Microsoft connection' }));
  useEffect(() => { load(); }, []);

  const check = async () => {
    setBusy('check'); setNote('');
    const r = await fetch('/api/microsoft/check', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    setNote(r.ok ? `Checked just now - reading ${d.email}` : d.error || `Check failed (${r.status})`);
    setBusy(''); load();
  };
  const disconnect = async () => {
    setBusy('disconnect'); setNote('');
    await fetch('/api/microsoft/disconnect', { method: 'POST' });
    setBusy(''); setNote('Disconnected - Prospector deleted its stored Microsoft token'); load();
  };

  const connected = !!status?.email;
  const healthy = connected && !status.error;
  const btn = color => ({ ...mono, fontSize:12, padding:"5px 14px", background:`${color}14`, border:`1px solid ${color}44`, color, borderRadius:5, cursor:"pointer" });
  return (
    <div style={{ background:C.card, border:`1px solid ${healthy?"#4ade8044":C.brd}`, borderRadius:8, padding:"14px 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3, flexWrap:"wrap" }}>
        <p style={{ margin:0, fontSize:15, fontWeight:500, color:healthy?"#4ade80":C.txt }}>Microsoft 365</p>
        <span style={{ ...mono, fontSize:11, color:healthy?C.green:status?.error?C.red:C.dim, marginLeft:"auto" }}>
          {status === null ? "…" : connected ? `● ${status.email}` : "○ Not connected"}
        </span>
      </div>
      <div style={{ ...mono, fontSize:10, color:"#555", marginBottom:8 }}>READ-ONLY: YOUR MAIL AND CALENDAR. PROSPECTOR NEVER SENDS, DELETES OR CHANGES ANYTHING</div>
      {status?.configured === false && <p style={{ fontSize:13, color:C.red, margin:"0 0 8px" }}>Microsoft isn’t configured on the server yet.</p>}
      {status?.error && <p role="alert" style={{ fontSize:13, color:C.red, margin:"0 0 8px" }}>{status.error}</p>}
      {connected && (
        <div style={{ ...mono, fontSize:11, color:C.dim, marginBottom:10, display:"flex", gap:14, flexWrap:"wrap" }}>
          <span>Connected {when(status.connected_at)}</span>
          <span>Last used {when(status.last_used_at)}</span>
          <span>Access: {status.scopes.filter(s => !/^(openid|offline_access)$/i.test(s)).join(", ")}</span>
        </div>
      )}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <button onClick={connectMicrosoft} disabled={status === null || status.configured === false || !!busy} style={btn(C.gold)}>
          {connected ? "Reconnect / switch account →" : "Connect Microsoft →"}
        </button>
        {connected && !status.error && <button onClick={check} disabled={!!busy} style={btn(C.green)}>{busy === "check" ? "Checking…" : "Check connection"}</button>}
        {connected && (
          <button onClick={disconnect} disabled={!!busy}
            style={{ ...mono, fontSize:11, padding:"4px 10px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:5, cursor:"pointer", marginLeft:"auto" }}>
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
        )}
      </div>
      {note && <p role="status" style={{ ...mono, fontSize:11, color:C.dim, margin:"10px 0 0" }}>{note}</p>}
    </div>
  );
}
