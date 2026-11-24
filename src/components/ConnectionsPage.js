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
import FathomCard from './salesAnalytics/goals/FathomCard';
import { SA_THEME_CSS, SA_THEME_CLASS } from './salesAnalytics/theme';
import { roleAtLeast } from '../constants/roles';

// shell-facelift-v1 Stage 3 - user menu > Connections: the signed-in user's
// Google + Microsoft grants (held server-side; the browser only sees which
// features are granted) and the Apollo mailboxes of their sales workspaces.
// Same routes as the two pages this replaces; Apollo is read-only here.
// fathom-notes-v1 follow-up (ruling S-1): the one Connections page - each sales workspace's Fathom card sits under
// Microsoft and Apollo (the same card Sales › Settings showed; a Member acts on their own row, an Owner on anyone's).
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

export function enableTeamSending() {
  const back = window.location.pathname + window.location.search;
  window.location.assign(`/api/microsoft/connect?scope=send&return=${encodeURIComponent(back)}`);
}

const PROBLEM_NEXT = {
  expired: 'Click Reconnect.',
  sign_in: 'Click Reconnect and sign in again.',
  needs_admin: 'A Microsoft admin has to approve it once for the organization; then click Reconnect.',
  other_org: 'Reconnect with a mailbox in the organization Prospector is registered to.',
};

export function describeRun(f) {
  const skipped = f.skipped_draft + f.skipped_internal + f.skipped_personal;
  return `${FOLDER_LABEL[f.folder]}: ${n(f.seen)} seen · ${n(f.stored)} kept · ${n(skipped)} skipped (${n(f.skipped_internal)} internal, ${n(f.skipped_personal)} personal, ${n(f.skipped_draft)} drafts)${f.capped ? ' · capped, continues next run' : ''}${f.error ? ` · error: ${f.error}` : ''}`;
}

// plain (app-shell-v2 S1) = no address on the card: who connected reads as "your account", never the mailbox.
function MicrosoftCard({ result, plain = false }) {
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [runs, setRuns] = useState(null);
  const load = () => fetch('/api/microsoft/status').then(r => r.json()).then(setStatus).catch(() => setStatus({ email: null, scopes: [], error: 'Couldn’t load the Microsoft connection' }));
  const loadSummary = () => fetch('/api/microsoft/sync-summary').then(async r => { const d = await r.json().catch(() => ({})); setSummary(r.ok ? d : { unavailable: d.error || `Outlook sync unavailable (${r.status})` }); }).catch(() => setSummary(null));
  useEffect(() => { load(); }, []);
  const connected = !!status?.connected;
  const healthy = connected && !status.error;
  useEffect(() => { if (healthy) loadSummary(); }, [healthy]);

  const check = async () => {
    setBusy('check'); setNote('');
    const r = await fetch('/api/microsoft/check', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    const folderLine = f => `${FOLDER_LABEL[f.folder]} ${f.total ?? f.total_error ?? '?'} total · ${f.window ?? f.window_error ?? '?'} in the 90-day window`;
    setNote(r.ok ? `Checked just now - Microsoft answered${d.domain ? ` for a ${d.domain} mailbox` : ''}${d.folders ? ' · ' + d.folders.map(folderLine).join(' · ') : ''}` : d.error || `Check failed (${r.status})`);
    setBusy(''); load();
  };
  const copyAdminLink = async () => {
    try { await navigator.clipboard.writeText(`${status.admin_consent.note}\n\n${status.admin_consent.url}`); setNote('Admin consent link copied - send it to your Microsoft admin'); }
    catch { setNote(status.admin_consent.url); }
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
    <Card title={plain ? 'Microsoft' : 'Microsoft 365'} subtitle={status === null ? '…' : plain ? 'Outlook mail, calendar and sent items for the team' : connected ? `A ${status.domain} mailbox` : 'Not connected'}
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
        <div style={fine}>READS YOUR MAIL AND CALENDAR. NEVER DELETES OR CHANGES ANYTHING. SENDS ONLY THE HOMELOVER TEAM EMAILS, TO THE TEAM’S OWN LIST</div>
        {status?.configured === false && <p style={{ ...KIT_TYPE.small, color: ui.dangerInk, margin: 0 }}>Microsoft isn’t configured on the server yet.</p>}
        {status?.problem
          ? <p role="alert" data-microsoft-problem={status.problem.family} style={{ ...KIT_TYPE.small, color: ui.dangerInk, margin: 0 }}><b>What is wrong:</b> {status.problem.text}. {PROBLEM_NEXT[status.problem.family] || ''}</p>
          : status?.error && <p role="alert" style={{ ...KIT_TYPE.small, color: ui.dangerInk, margin: 0 }}>{status.error}</p>}
        {healthy && status.team_email && status.team_email !== 'ready' && (
          <p role="status" data-team-email-reconnect style={{ ...KIT_TYPE.small, color: ui.text, margin: 0 }}>
            <b>{status.team_email}.</b> The daily and Friday team emails wait for it - mail and calendar reads work either way.
          </p>
        )}
        {connected && (
          <div data-microsoft-facts style={{ ...small, display: 'flex', gap: KIT_SPACE[2], flexWrap: 'wrap' }}>
            <span>Mailbox at {status.domain || '—'}</span>
            <span>Organization {status.organization || '—'}</span>
            <span>Access: {status.scopes.filter(s => !/^(openid|offline_access)$/i.test(s)).join(', ')}</span>
            <span>Connected {when(status.connected_at)}</span>
            <span>Last refresh: {status.last_refresh ? `${status.last_refresh.ok ? 'ok' : 'failed'} ${when(status.last_refresh.at)}` : 'not yet'}</span>
          </div>
        )}
        <ButtonRow align="start">
          <Button variant="primary" onClick={connectMicrosoft} disabled={status === null || status.configured === false || !!busy}>
            {connected ? 'Reconnect / switch account →' : 'Connect Microsoft →'}
          </Button>
          {healthy && status.is_owner && !status.can_send && <Button onClick={enableTeamSending} disabled={!!busy}>Enable team email sending →</Button>}
          {connected && <Button onClick={check} disabled={!!busy}>{busy === 'check' ? 'Checking…' : 'Check connection'}</Button>}
          {status?.admin_consent && <Button variant="tertiary" onClick={copyAdminLink} disabled={!!busy}>Copy admin consent link</Button>}
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
function ApolloCard({ businesses, plain = false }) {
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
    <Card title="Apollo" subtitle={plain ? 'People, sequences, opens and replies' : sales.length ? 'Workspace mailboxes · read-only' : 'No workspace with the sales module'}
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
                {d.mailboxes.map((m, mi) => {
                  const problem = mailboxConnectionProblem(m);
                  // Only the code: inactive_reason / unlink_error_message are free text from Apollo and can carry addresses.
                  const code = m.unlink_error_code;
                  return (
                    <div key={m.id || m.email} style={{ ...row, padding: '6px 10px', background: ui.inset, border: `1px solid ${ui.border}`, borderRadius: KIT_RADIUS.inner }}>
                      <span style={{ ...KIT_TYPE.small, color: ui.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{plain ? `Mailbox ${mi + 1}` : m.email}</span>
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

// app-shell-v2 S1: the last pull of the website-visitor feed, from the same read the Needs attention drawer uses.
function VisitorsCard({ businessId, feed }) {
  const [src, setSrc] = useState(undefined);
  useEffect(() => {
    let live = true;
    fetch(`/api/sales/${businessId}/goals/attention`).then(r => (r.ok ? r.json() : Promise.reject(new Error(`attention ${r.status}`)))).then(d => { if (live) setSrc((d.sources || []).find(x => x.id === 'visitors') || null); }).catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [businessId]);
  const pill = src === undefined ? ['off', '…'] : !src || src.status === 'not_connected' ? ['off', 'Not connected'] : src.status === 'failed' ? ['bad', 'Needs attention'] : ['ok', 'Connected'];
  return (
    <Card title={feed.label} subtitle={feed.note} actions={<StatusPill status={pill[0]}>{pill[1]}</StatusPill>}>
      <span style={small}>{src?.last_at ? `Last pull ${when(src.last_at)}` : src === undefined ? '…' : 'No pull yet'} · run it from Needs attention in the header</span>
    </Card>
  );
}

// feeds (app-shell-v2 S1) = the workspace's registry entry lists its Connections cards, in order: only those render,
// for that one workspace, and no card shows an address or a key. Without feeds (a workspace with no entry) the page is
// the one it was: every mailbox the person connected and the workspace it works for.
export default function ConnectionsPage({ businesses, microsoftResult, me = null, feeds = null }) {
  const sales = businesses.filter(b => b.features?.goals_sales);
  const canEdit = b => !!me && (!!me.profile?.is_platform_owner || roleAtLeast(me.memberships?.find(m => m.business_id === b.id)?.role, 'member'));
  if (feeds) {
    const b = businesses[0];
    const card = f => (f.id === 'microsoft' ? <MicrosoftCard result={microsoftResult} plain />
      : f.id === 'apollo' ? <ApolloCard businesses={[b]} plain />
      : f.id === 'fathom' ? <div className={`${SA_THEME_CLASS} ui-theme-dark`}><FathomCard businessId={b.id} canEdit={canEdit(b)} /></div>
      : f.id === 'visitors' ? <VisitorsCard businessId={b.id} feed={f} /> : null);
    return (
      <div style={{ maxWidth: KIT_MAX_WIDTH, minWidth: 0, ...KIT_TYPE.body, color: ui.text }} data-connections="feeds">
        <style>{SA_THEME_CSS}</style>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: KIT_SPACE[2] }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: ui.text }}>Connections</h2>
          <span style={small}>What {b.name} reads from, and when it last did</span>
        </div>
        <div data-connections-grid style={{ display: 'grid', gap: KIT_SPACE[3] }}>
          {feeds.map(f => <div key={f.id} data-provider={f.id}>{card(f)}</div>)}
        </div>
        <p style={{ ...small, marginTop: KIT_SPACE[3] }}>A connection never shows an address or a key. A failed run turns its status red here and raises “Needs attention” in the header.</p>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: KIT_MAX_WIDTH, margin: '0 auto', padding: `${KIT_SPACE[4]}px 0`, minWidth: 0, ...KIT_TYPE.body, color: ui.text }}>
      {sales.length > 0 && <style>{SA_THEME_CSS}</style>}
      <PageHeader title="Connections" subtitle="Every mailbox you connected, and the exact workspace it works for. A line means that workspace uses that mailbox. No line, no access." />
      <div data-connections-grid style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: KIT_SPACE[3], alignItems: 'start' }}>
        <div data-provider="google" style={{ gridColumn: '1 / -1' }}><TetherMap businesses={businesses} /></div>
        <div data-provider="microsoft"><MicrosoftCard result={microsoftResult} /></div>
        <div data-provider="apollo"><ApolloCard businesses={businesses} /></div>
        {sales.map(b => (
          <div key={b.id} data-provider="fathom" className={`${SA_THEME_CLASS} ui-theme-dark`} style={{ gridColumn: '1 / -1', display: 'grid', gap: KIT_SPACE[1] }}>
            {sales.length > 1 && <SectionLabel>{b.name}</SectionLabel>}
            <FathomCard businessId={b.id} canEdit={canEdit(b)} />
          </div>
        ))}
      </div>
    </div>
  );
}
