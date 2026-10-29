import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import { hkGet, hkPost } from '../hkApi';
import { relative } from '../hkSync';

// hkos-mcp-connector-v1 M5 - Settings › Connections › Claude connector: the URL to paste into claude.ai, how to add it,
// and the caller's own active connections with Revoke. A viewer has no connector (the server refuses them too).
const STEPS = ['In claude.ai: Customize › Connectors › Add custom connector', 'Paste the URL above, then Add', 'Click Connect, sign in to Prospector, choose Allow'];

export default function ClaudeConnector({ businessId, canEdit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    setError('');
    try { setData(await hkGet(businessId, '/connector')); } catch (e) { setError(e.message); setData({ connections: [] }); }
  }, [businessId]);
  useEffect(() => { if (canEdit) load(); }, [canEdit, load]);
  const url = data?.mcp_url || `${window.location.origin}/mcp`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied('Copied'); } catch { setCopied('Select the URL and copy it'); } };
  const revoke = async id => { setBusy(id); setError(''); try { await hkPost(businessId, `/connector/${encodeURIComponent(id)}/revoke`, {}); await load(); } catch (e) { setError(e.message); } setBusy(null); };

  return (
    <div className="hk-form" style={{ marginTop: 22, maxWidth: 620 }} data-hk-claude-connector>
      <h3 className="hk-section-title" style={{ fontSize: 16 }}>Claude connector</h3>
      {!canEdit ? <p className="hk-meta" data-hk-connector-viewer>Members connect Claude from their own login. Viewers don't get a connector.</p> : (
        <>
          <p className="hk-meta">Lets Claude check brands, claim them, read what's due and save Gmail drafts in your own mailbox, as you. It never sends.</p>
          <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <code className="hk-code" data-hk-connector-url>{url}</code>
            <Button size="sm" variant="primary" onClick={copy} data-hk-connector-copy>Copy URL</Button>
            <span className="hk-meta" role="status">{copied}</span>
          </span>
          <ol className="hk-meta" style={{ margin: '4px 0 0', paddingLeft: 20, lineHeight: 1.6 }} data-hk-connector-steps>{STEPS.map(s => <li key={s}>{s}</li>)}</ol>
          <p className="hk-meta">If claude.ai asks: Authentication <em>Sign in now</em> · OAuth client <em>Use Claude's published identity</em>.</p>
          {error && <p className="hk-error" role="alert">{error}</p>}
          <div className="hk-rows" data-hk-connector-list>
            {data === null ? <p className="hk-meta">Loading…</p> : !data.connections.length ? <p className="hk-meta" data-hk-connector-empty>No active connections.</p> : data.connections.map(c => (
              <div key={c.family_id} className="hk-row hk-row--wrap" data-hk-connection={c.family_id}>
                <span className="hk-row__name">{c.client_name}</span>
                <span className="hk-meta">Connected {relative(c.created_at)} · {c.last_used_at ? `last used ${relative(c.last_used_at)}` : 'not used yet'}</span>
                <span className="hk-row__end"><Button size="sm" variant="tertiary" disabled={busy === c.family_id} onClick={() => revoke(c.family_id)} data-hk-connector-revoke>{busy === c.family_id ? 'Revoking…' : 'Revoke'}</Button></span>
              </div>
            ))}
          </div>
          {data?.last_call_at && <p className="hk-meta" data-hk-connector-last>Last call {relative(data.last_call_at)}</p>}
        </>
      )}
    </div>
  );
}
