import { useEffect, useState } from 'react';
import { ui } from '../ui/kitTheme';
import { KIT_MAX_WIDTH, KIT_RADIUS, KIT_SPACE, KIT_TYPE } from '../ui/tokens';
import PageHeader from '../ui/PageHeader';
import Card from '../ui/Card';
import Button, { ButtonRow } from '../ui/Button';
import StatusPill from '../ui/StatusPill';
import SectionLabel from '../ui/SectionLabel';
import { mailboxConnectionProblem } from '../utils/mailboxStatus';
import TetherMap from './connections/TetherMap';

// shell-facelift-v1 Stage 3 - user menu > Connections: the signed-in user's
// Google + Microsoft grants (held server-side; the browser only sees which
// features are granted) and the Apollo mailboxes of their sales workspaces.
// Same routes as the two pages this replaces; Apollo is read-only here.
const when = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const day = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const n = v => Number(v || 0).toLocaleString('en-US');
const FOLDER_LABEL = { sentitems: 'Sent', inbox: 'Inbox', calendar: 'Calendar' };

const row = { display: 'flex', alignItems: 'center', gap: KIT_SPACE[1], flexWrap: 'wrap', minHeight: 32 };
const small = { ...KIT_TYPE.small, color: ui.muted };
const fine = { ...KIT_TYPE.label, color: ui.faint, fontWeight: 400 };
const statusLine = (text, tone) => <p role="status" style={{ ...KIT_TYPE.small, color: tone === 'bad' ? ui.dangerInk : tone === 'ok' ? ui.good : ui.muted, margin: 0 }}>{text}</p>;

export function connectMicrosoft() {
  const back = window.location.pathname + window.location.search;
  window.location.assign(`/api/microsoft/connect?return=${encodeURIComponent(back)}`);
}

export function describeRun(f) {
  const skipped = f.skipped_draft + f.skipped_internal + f.skipped_personal;
  return `${FOLDER_LABEL[f.folder]}: ${n(f.seen)} seen · ${n(f.stored)} kept · ${n(skipped)} skipped (${n(f.skipped_internal)} internal, ${n(f.skipped_personal)} personal, ${n(f.skipped_draft)} drafts)${f.capped ? ' · capped, continues next run' : ''}${f.error ? ` · error: ${f.error}` : ''}`;
}

function MicrosoftCard({ result }) {
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [runs, setRuns] = useState(null);
  const load = () => fetch('/api/microsoft/status').then(r => r.json()).then(setStatus).catch(() => setStatus({ email: null, scopes: [], error: 'Couldn’t load the Microsoft connection' }));
  const loadSummary = () => fetch('/api/microsoft/sync-summary').then(async r => { const d = await r.json().catch(() => ({})); setSummary(r.ok ? d : { unavailable: d.error || `Outlook sync unavailable (${r.status})` }); }).catch(() => setSummary(null));
  useEffect(() => { load(); }, []);
  const connected = !!status?.email;
  const healthy = connected && !status.error;
  useEffect(() => { if (healthy) loadSummary(); }, [healthy]);

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

  const pill = status === null ? ['off', '…'] : healthy ? ['ok', 'Connected'] : connected ? ['bad', 'Needs attention'] : ['off', 'Not connected'];
  return (
    <Card title="Microsoft 365" subtitle={status === null ? '…' : connected ? status.email : 'Not connected'}
      actions={<StatusPill status={pill[0]}>{pill[1]}</StatusPill>}
      footer={healthy && (
        <div data-testid="outlook-sync" style={{ display: 'grid', gap: KIT_SPACE[1] }}>
          <div style={{ ...row, minHeight: 0 }}>
            <SectionLabel as="h3">Outlook sync</SectionLabel>
            <span style={{ ...small, marginLeft: 'auto', marginBottom: 8 }}>
              {summary === null ? '…' : summary.unavailable ? summary.unavailable
                : `Sent ${n(summary.sent)} · Received ${n(summary.received)} · Events ${n(summary.events)}${summary.since ? ` since ${day(summary.since)}` : ''}`}
            </span>
          </div>
          <div style={fine}>METADATA ONLY (WHO, WHEN, SUBJECT) FOR MAIL AND MEETINGS WITH PEOPLE OUTSIDE HOMELOVER. NO BODIES. PERSONAL-MAIL DOMAINS SKIPPED.</div>
          {summary && !summary.unavailable && (
            <div style={{ ...small, display: 'flex', gap: KIT_SPACE[2], flexWrap: 'wrap' }}>
              <span>Last synced {when(summary.last_synced_at)}</span>
              {summary.pending?.length > 0 && <span>Continues next run: {summary.pending.map(f => FOLDER_LABEL[f]).join(', ')}</span>}
            </div>
          )}
          {summary?.can_sync && (
            <ButtonRow align="start">
              <Button onClick={() => sync(true)} disabled={!!busy}>{busy === 'preview' ? 'Previewing…' : 'Preview sync (stores nothing)'}</Button>
              <Button variant="primary" onClick={() => sync(false)} disabled={!!busy}>{busy === 'sync' ? 'Syncing…' : 'Sync Outlook'}</Button>
            </ButtonRow>
          )}
          {runs && (
            <div role="status" style={{ ...small, color: runs.error ? ui.dangerInk : ui.muted, display: 'grid', gap: 3 }}>
              {runs.error ? <span>{runs.error}</span> : <>
                <span style={{ color: ui.text }}>{runs.dry ? 'Preview - nothing stored:' : 'Synced:'}</span>
                {runs.folders.map(f => <span key={f.folder}>{describeRun(f)}</span>)}
                {runs.moves && <span>{runs.moves.error ? `Partners: error - ${runs.moves.error}` : `Partners: ${n(runs.moves.recorded)} touches recorded · ${n(runs.moves.people)} people added · ${n(runs.moves.applied)} moves applied · ${n(runs.moves.held)} waiting for OK`}</span>}
              </>}
            </div>
          )}
        </div>
      )}>
      <div style={{ display: 'grid', gap: KIT_SPACE[1] }}>
        {result && statusLine(result.text, result.ok ? 'ok' : 'bad')}
        <div style={fine}>READ-ONLY: YOUR MAIL AND CALENDAR. PROSPECTOR NEVER SENDS, DELETES OR CHANGES ANYTHING</div>
        {status?.configured === false && <p style={{ ...KIT_TYPE.small, color: ui.dangerInk, margin: 0 }}>Microsoft isn’t configured on the server yet.</p>}
        {status?.error && <p role="alert" style={{ ...KIT_TYPE.small, color: ui.dangerInk, margin: 0 }}>{status.error}</p>}
        {connected && (
          <div style={{ ...small, display: 'flex', gap: KIT_SPACE[2], flexWrap: 'wrap' }}>
            <span>Connected {when(status.connected_at)}</span>
            <span>Last used {when(status.last_used_at)}</span>
            <span>Access: {status.scopes.filter(s => !/^(openid|offline_access)$/i.test(s)).join(', ')}</span>
          </div>
        )}
        <ButtonRow align="start">
          <Button variant="primary" onClick={connectMicrosoft} disabled={status === null || status.configured === false || !!busy}>
            {connected ? 'Reconnect / switch account →' : 'Connect Microsoft →'}
          </Button>
          {healthy && <Button onClick={check} disabled={!!busy}>{busy === 'check' ? 'Checking…' : 'Check connection'}</Button>}
          {connected && <Button variant="tertiary" onClick={disconnect} disabled={!!busy}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</Button>}
        </ButtonRow>
        {note && statusLine(note)}
      </div>
    </Card>
  );
}

// Apollo is connected per sales workspace, not per user: one block per
// workspace the person is in that has the sales module. Reads the latest
// mailbox snapshot + the last sync run - 0 Apollo calls.
function ApolloCard({ businesses }) {
  const sales = businesses.filter(b => b.features?.goals_sales);
  const key = sales.map(b => b.id).join(',');
  const [data, setData] = useState({});
  useEffect(() => {
    let live = true;
    for (const b of sales) {
      Promise.all([
        fetch(`/api/sales/${b.id}/entities`).then(r => r.ok ? r.json() : Promise.reject(new Error(`entities ${r.status}`))),
        fetch(`/api/sales/${b.id}/runs?limit=1`).then(r => r.ok ? r.json() : { runs: [] }),
      ]).then(([e, r]) => { if (live) setData(d => ({ ...d, [b.id]: { mailboxes: e.mailboxes || [], run: r.runs?.[0] || null } })); })
        .catch(err => { if (live) setData(d => ({ ...d, [b.id]: { error: err.message } })); });
    }
    return () => { live = false; };
  }, [key]);
  const all = Object.values(data).flatMap(d => d.mailboxes || []);
  const loaded = sales.length > 0 && sales.every(b => data[b.id]);
  const pill = !sales.length || (loaded && !all.length) ? ['off', 'Not connected'] : !loaded ? ['off', '…'] : all.some(m => mailboxConnectionProblem(m)) ? ['warn', 'Needs attention'] : ['ok', 'Connected'];
  return (
    <Card title="Apollo" subtitle={sales.length ? 'Workspace mailboxes · read-only' : 'No workspace with the sales module'}
      actions={<StatusPill status={pill[0]}>{pill[1]}</StatusPill>}>
      <div style={{ display: 'grid', gap: KIT_SPACE[2] }}>
        <div style={fine}>MANAGED IN APOLLO. PROSPECTOR READS SEQUENCES AND MAILBOX HEALTH ON SYNC NOW</div>
        {sales.map(b => {
          const d = data[b.id];
          return (
            <div key={b.id} style={{ display: 'grid', gap: KIT_SPACE[1] }}>
              {sales.length > 1 && <SectionLabel as="h3">{b.name}</SectionLabel>}
              {!d ? <span style={small}>…</span> : d.error ? <span style={{ ...small, color: ui.dangerInk }}>{d.error}</span> : <>
                <span style={small}>Last sync {d.run?.finished_at ? when(d.run.finished_at) : 'never'}{d.run?.counts?.apollo_calls != null ? ` · ${n(d.run.counts.apollo_calls)} Apollo calls` : ''}</span>
                {!d.mailboxes.length && <span style={small}>No mailboxes in the last snapshot.</span>}
                {d.mailboxes.map(m => {
                  const problem = mailboxConnectionProblem(m);
                  // Only the code: inactive_reason / unlink_error_message are free text from Apollo and can carry addresses.
                  const code = m.unlink_error_code;
                  return (
                    <div key={m.id || m.email} style={{ ...row, padding: '6px 10px', background: ui.inset, border: `1px solid ${ui.border}`, borderRadius: KIT_RADIUS.inner }}>
                      <span style={{ ...KIT_TYPE.small, color: ui.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</span>
                      <span style={{ ...KIT_TYPE.label, color: ui.faint, fontWeight: 400 }}>{m.last_synced_at ? when(m.last_synced_at) : '—'}</span>
                      {code && (problem
                        ? <span style={{ ...KIT_TYPE.label, color: ui.faint, fontWeight: 400 }}>{code}</span>
                        : <span data-mailbox-history title={`Last error from Apollo: ${code}`} style={{ ...KIT_TYPE.label, color: ui.faint, fontWeight: 400, opacity: 0.55, cursor: 'help' }}>old error</span>)}
                      <StatusPill status={problem ? 'bad' : 'ok'}>{problem || 'Active'}</StatusPill>
                    </div>
                  );
                })}
              </>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function ConnectionsPage({ businesses, microsoftResult }) {
  return (
    <div style={{ maxWidth: KIT_MAX_WIDTH, margin: '0 auto', padding: `${KIT_SPACE[4]}px 0`, minWidth: 0, ...KIT_TYPE.body, color: ui.text }}>
      <PageHeader title="Connections" subtitle="Every mailbox you connected, and the exact workspace it works for. A line means that workspace uses that mailbox. No line, no access." />
      <div data-connections-grid style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: KIT_SPACE[3], alignItems: 'start' }}>
        <div data-provider="google" style={{ gridColumn: '1 / -1' }}><TetherMap businesses={businesses} /></div>
        <div data-provider="microsoft"><MicrosoftCard result={microsoftResult} /></div>
        <div data-provider="apollo"><ApolloCard businesses={businesses} /></div>
      </div>
    </div>
  );
}
