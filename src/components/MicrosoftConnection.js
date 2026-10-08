import { useEffect, useState } from 'react';
import { C, mono } from '../constants/colors';

// microsoft-connect-v1 - user menu > Microsoft connection. The server holds
// the token (api/lib/microsoftGrants.js); this only shows which mailbox is
// connected and starts Connect / Reconnect / Disconnect, and (Stage 2) runs
// the read-only Outlook sync and shows what it holds.
const when = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const day = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const n = v => Number(v || 0).toLocaleString('en-US');
const FOLDER_LABEL = { sentitems: 'Sent', inbox: 'Inbox', calendar: 'Calendar' };

export function connectMicrosoft() {
  const back = window.location.pathname + window.location.search;
  window.location.assign(`/api/microsoft/connect?return=${encodeURIComponent(back)}`);
}

export function describeRun(f) {
  const skipped = f.skipped_draft + f.skipped_internal + f.skipped_personal;
  return `${FOLDER_LABEL[f.folder]}: ${n(f.seen)} seen · ${n(f.stored)} kept · ${n(skipped)} skipped (${n(f.skipped_internal)} internal, ${n(f.skipped_personal)} personal, ${n(f.skipped_draft)} drafts)${f.capped ? ' · capped, continues next run' : ''}${f.error ? ` · error: ${f.error}` : ''}`;
}

export default function MicrosoftConnection() {
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [runs, setRuns] = useState(null);
  const load = () => fetch('/api/microsoft/status').then(r => r.json()).then(setStatus).catch(() => setStatus({ email: null, scopes: [], error: 'Couldn’t load the Microsoft connection' }));
  const loadSummary = () => fetch('/api/microsoft/sync-summary').then(async r => { const d = await r.json().catch(() => ({})); setSummary(r.ok ? d : { unavailable: d.error || `Outlook sync unavailable (${r.status})` }); }).catch(() => setSummary(null));
  useEffect(() => { load(); loadSummary(); }, []);

  const check = async () => {
    setBusy('check'); setNote('');
    const r = await fetch('/api/microsoft/check', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    const folderLine = f => `${FOLDER_LABEL[f.folder]} ${f.total ?? f.total_error ?? '?'} total · ${f.window ?? f.window_error ?? '?'} in the 90-day window`;
    setNote(r.ok ? `Checked just now - reading ${d.email}${d.folders ? ' · ' + d.folders.map(folderLine).join(' · ') : ''}` : d.error || `Check failed (${r.status})`);
    setBusy(''); load();
  };
  const disconnect = async () => {
    setBusy('disconnect'); setNote('');
    await fetch('/api/microsoft/disconnect', { method: 'POST' });
    setBusy(''); setNote('Disconnected - Prospector deleted its stored Microsoft token'); setSummary(null); setRuns(null); load();
  };
  const sync = async dryRun => {
    setBusy(dryRun ? 'preview' : 'sync'); setRuns(null);
    const r = await fetch(`/api/microsoft/sync${dryRun ? '?dry_run=1' : ''}`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setRuns({ dry: dryRun, folders: d.folders, moves: d.moves });
    else setRuns({ dry: dryRun, error: d.error || `Sync failed (${r.status})` });
    setBusy(''); load(); loadSummary();
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

      {healthy && (
        <div data-testid="outlook-sync" style={{ marginTop:14, paddingTop:12, borderTop:`1px solid ${C.brd}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:6 }}>
            <p style={{ margin:0, fontSize:13, fontWeight:500, color:C.txt }}>Outlook sync</p>
            <span style={{ ...mono, fontSize:11, color:C.dim, marginLeft:"auto" }}>
              {summary === null ? "…" : summary.unavailable ? summary.unavailable
                : `Sent ${n(summary.sent)} · Received ${n(summary.received)} · Events ${n(summary.events)}${summary.since ? ` since ${day(summary.since)}` : ""}`}
            </span>
          </div>
          <div style={{ ...mono, fontSize:10, color:"#555", marginBottom:8 }}>
            METADATA ONLY (WHO, WHEN, SUBJECT) FOR MAIL AND MEETINGS WITH PEOPLE OUTSIDE HOMELOVER. NO BODIES. PERSONAL-MAIL DOMAINS SKIPPED.
          </div>
          {summary && !summary.unavailable && (
            <div style={{ ...mono, fontSize:11, color:C.dim, marginBottom:8, display:"flex", gap:14, flexWrap:"wrap" }}>
              <span>Last synced {when(summary.last_synced_at)}</span>
              {summary.pending?.length > 0 && <span>Continues next run: {summary.pending.map(f => FOLDER_LABEL[f]).join(", ")}</span>}
            </div>
          )}
          {summary?.can_sync && (
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <button onClick={() => sync(true)} disabled={!!busy} style={btn(C.dim)}>{busy === "preview" ? "Previewing…" : "Preview sync (stores nothing)"}</button>
              <button onClick={() => sync(false)} disabled={!!busy} style={btn(C.green)}>{busy === "sync" ? "Syncing…" : "Sync Outlook"}</button>
            </div>
          )}
          {runs && (
            <div role="status" style={{ ...mono, fontSize:11, color:runs.error ? C.red : C.dim, margin:"10px 0 0", display:"grid", gap:3 }}>
              {runs.error ? <span>{runs.error}</span> : <>
                <span style={{ color:C.txt }}>{runs.dry ? "Preview - nothing stored:" : "Synced:"}</span>
                {runs.folders.map(f => <span key={f.folder}>{describeRun(f)}</span>)}
                {runs.moves && <span>{runs.moves.error ? `Partners: error - ${runs.moves.error}` : `Partners: ${n(runs.moves.recorded)} touches recorded · ${n(runs.moves.people)} people added · ${n(runs.moves.applied)} moves applied · ${n(runs.moves.held)} waiting for OK`}</span>}
              </>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
