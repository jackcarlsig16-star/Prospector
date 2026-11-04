import { useState, useEffect } from 'react';
import { SA } from '../salesAnalytics/theme';
import AuthLayout, { primaryButton, secondaryButton, ErrorBanner, Notice } from './AuthLayout';

// homelover-clients-v1 C11 - the consent step of the HomeLover Claude connector's OAuth sign-in (/hl/oauth/consent).
// AuthGate has already made sure the person is signed in. Everything shown comes from the server's stored request; the
// page sends back only the request id (in the path) and allow / deny.
const REFUSAL = {
  no_workspace: ['No HomeLover workspace', "You're not a member of a HomeLover sales workspace, so Claude has nothing to connect to. Ask an owner to add you."],
  many_workspaces: ["Can't tell which workspace", "You're a member of more than one HomeLover sales workspace. The connector works with exactly one - ask a workspace owner to sort out the extra membership."],
};

export default function HlConsentPage() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id'), resume = params.get('resume'), refusal = REFUSAL[params.get('error')];
  const [req, setReq] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (resume && resume.startsWith('/hl/oauth/authorize?')) { window.location.replace(resume); return; }
    if (!id) return;
    fetch(`/api/hl-oauth/consent/${encodeURIComponent(id)}`)
      .then(async res => { const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `Couldn't load this request (${res.status})`); setReq(data); })
      .catch(e => setError(e.message));
  }, [id, resume]);

  const decide = async decision => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/hl-oauth/consent/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.redirect) throw new Error(data.error || `That didn't go through (${res.status})`);
      window.location.assign(data.redirect);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  if (resume) return <AuthLayout title="Connecting…" />;
  if (refusal) return <AuthLayout title={refusal[0]} subtitle={refusal[1]} />;
  if (!id) return <AuthLayout title="Nothing to approve" subtitle="Start the connection from claude.ai (Settings > Connectors)." />;
  if (error && !req) return <AuthLayout title="Couldn't connect"><ErrorBanner>{error}</ErrorBanner></AuthLayout>;
  if (!req) return <AuthLayout title="Loading…" />;
  return (
    <AuthLayout title={`${req.client_name} wants to use HomeLover Prospector as you`} subtitle={`Signed in as ${req.you || 'you'}${req.workspace_name ? ` · workspace ${req.workspace_name}` : ''}`}>
      <div style={{ fontSize: 14, color: SA.text, lineHeight: 1.5 }}>
        It will be able to add and update clients, mark them signed, file lookalike companies as targets, and check which domains Upside owns. It never writes to Apollo and never sends anything.
      </div>
      <Notice>After you choose, you'll go back to <strong>{req.redirect_host}</strong>.</Notice>
      <ErrorBanner>{error}</ErrorBanner>
      <button type="button" onClick={() => decide('allow')} disabled={busy} style={primaryButton}>{busy ? 'Working…' : 'Allow'}</button>
      <button type="button" onClick={() => decide('deny')} disabled={busy} style={secondaryButton}>Deny</button>
    </AuthLayout>
  );
}
