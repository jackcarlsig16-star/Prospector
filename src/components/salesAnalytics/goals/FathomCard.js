import { useState, useEffect, useCallback } from 'react';
import { SA } from '../theme';
import { fathomApi } from './fathomApi';
import { ErrorNote, Btn, cardStyle, h3Style, inputStyle } from './goalsUi';

// fathom-notes-v1 Stage 2 - Connections › Fathom (the user menu's Connections page, under Microsoft and Apollo). One row per member who connected; a member acts
// on their own row, an Owner on anyone's (F-7). The key is pasted, sealed on the server and never comes back: the
// card only ever shows "Connected" and the dates. Each button is the one declared Fathom call behind it (Test 1,
// Register 1, Disconnect 1, Pull up to 5) - nothing here calls Fathom on load.
const small = { fontSize: 13, color: SA.muted };
const day = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
export const HELP = [
  'Paste the API key from Fathom › User Settings › API Access. Each member connects their own Fathom; only an Owner connects it for another member.',
  'The key is encrypted with the app’s FATHOM_TOKEN_KEY and is never shown again. It travels with the database: if the database moves without that key, every connection has to be pasted again.',
  'Disconnect removes the webhook from Fathom and stops new recordings; the notes already stored stay. To reconnect, paste the key again.',
  'Only the member’s own recordings arrive. Each lands as a call note with a proposal waiting on Today - nothing reaches a record until a member accepts it. No address or phone number is stored.',
];

// "Connected · last recording Nov 19 · last event Nov 20, 10:12 AM" - the recording date is Test's answer when Test
// just ran, else the newest recording stored here.
export function statusLine(m, tested) {
  if (!m.connected) return 'Disconnected · to reconnect, paste the key again';
  const rec = tested === undefined ? m.last_recording : tested;
  return ['Connected', rec ? `last recording ${day(rec)}` : tested === null ? 'no recording in Fathom yet' : 'no recording stored yet', m.last_event_at ? `last event ${when(m.last_event_at)}` : null].filter(Boolean).join(' · ');
}

function KeyForm({ label, busy, onConnect }) {
  const [key, setKey] = useState('');
  return (
    <form onSubmit={e => { e.preventDefault(); if (key.trim()) onConnect(key.trim()); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: '1 1 100%' }}>
      <input type="password" autoComplete="off" spellCheck={false} aria-label={label} placeholder="Paste the Fathom API key" value={key} onChange={e => setKey(e.target.value)}
        style={{ ...inputStyle, flex: '1 1 240px', minWidth: 0, height: 36 }} />
      <Btn primary type="submit" disabled={busy || !key.trim()} style={{ height: 36 }}>Connect</Btn>
    </form>
  );
}

export default function FathomCard({ businessId, canEdit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [rowError, setRowError] = useState({}); // user_id -> the last failed action's words
  const [tested, setTested] = useState({}); // user_id -> Test's last recording date (null = none in Fathom)
  const [note, setNote] = useState('');
  const [forUser, setForUser] = useState('');
  const [cap, setCap] = useState('');

  const load = useCallback(() => fathomApi.status(businessId).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [businessId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return error ? <ErrorNote message={error} /> : <span style={small}>Loading…</span>;
  const live = window.location.protocol === 'https:';
  const mine = data.members.find(m => m.user_id === data.me) || null;
  const act = async (userId, what, fn, done) => {
    setBusy(`${what}:${userId}`); setNote(''); setRowError(e => ({ ...e, [userId]: '' }));
    try { const r = await fn(userId === data.me ? null : userId); if (done) done(r); await load(); }
    catch (e) { setRowError(x => ({ ...x, [userId]: `${what} failed: ${e.message}` })); }
    finally { setBusy(''); }
  };
  const pulled = r => setNote(`${n(r.stored, 'recording', 'recordings')} stored · ${r.already} already here${r.skipped ? ` · ${r.skipped} skipped` : ''}${r.more ? ' · more exist - Pull again continues' : ''}${r.stopped ? ` · stopped: ${r.stopped}` : ''}`);

  const row = m => {
    const can = canEdit && (m.user_id === data.me || data.owner);
    const self = m.user_id === data.me;
    const err = rowError[m.user_id];
    const on = what => busy === `${what}:${m.user_id}`;
    return (
      <div key={m.user_id} data-fathom-row={m.connected ? (err ? 'error' : 'connected') : 'disconnected'} style={{ display: 'grid', gap: 8, padding: '12px 0', borderTop: `1px solid ${SA.border}` }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14, color: SA.text, fontWeight: 600 }}>{m.name}{self ? ' (you)' : ''}</b>
          <span data-fathom-status style={{ fontSize: 13, color: m.connected ? SA.good : SA.muted }}>{statusLine(m, tested[m.user_id])}</span>
        </div>
        {m.connected && (
          <span style={small}>
            {n(m.stored, 'recording', 'recordings')} stored · {m.webhook ? `webhook registered (id …${m.webhook_id_tail})` : 'webhook not registered - new recordings do not arrive until it is'}
            {m.pull.finished ? ' · last 30 days pulled' : ''}
          </span>
        )}
        {err && <span role="alert" data-fathom-error style={{ fontSize: 13, color: SA.bad }}>{err}</span>}
        {can && m.connected && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn disabled={!!busy} style={{ height: 34 }} onClick={() => act(m.user_id, 'Test', u => fathomApi.test(businessId, u), r => setTested(t => ({ ...t, [m.user_id]: r.last_recording })))}>{on('Test') ? 'Testing…' : 'Test'}</Btn>
            {!m.webhook && <Btn disabled={!!busy || !live} title={live ? undefined : 'Fathom needs an https address it can reach - register from the live site'} style={{ height: 34 }} onClick={() => act(m.user_id, 'Register webhook', u => fathomApi.register(businessId, u), () => setNote('Webhook registered - the next recording arrives by itself'))}>{on('Register webhook') ? 'Registering…' : 'Register webhook'}</Btn>}
            {!m.pull.finished && <Btn disabled={!!busy} style={{ height: 34 }} onClick={() => act(m.user_id, 'Pull', u => fathomApi.pull(businessId, u), pulled)}>{on('Pull') ? 'Pulling…' : m.pull.more ? 'Pull more of the last 30 days' : self ? 'Pull my last 30 days' : 'Pull the last 30 days'}</Btn>}
            <Btn disabled={!!busy} style={{ height: 34 }} onClick={() => act(m.user_id, 'Disconnect', u => fathomApi.disconnect(businessId, u), r => setNote(r.webhook_deleted ? 'Disconnected - the webhook was removed from Fathom' : 'Disconnected - Fathom did not confirm the webhook was removed; delete it in Fathom › API Access'))}>{on('Disconnect') ? 'Disconnecting…' : 'Disconnect'}</Btn>
            {!m.webhook && !live && <span style={small}>Register the webhook from the live site (https).</span>}
          </div>
        )}
        {can && !m.connected && <KeyForm label={`Fathom API key for ${m.name}`} busy={!!busy} onConnect={k => act(m.user_id, 'Connect', u => fathomApi.connect(businessId, k, u), () => setNote('Connected - press Test to check the key'))} />}
      </div>
    );
  };

  const x = data.extracts;
  return (
    <section aria-label="Fathom" data-fathom-card style={{ ...cardStyle, padding: 20, display: 'grid', gap: 14, maxWidth: 900 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <h2 style={{ ...h3Style, fontSize: 18 }}>Fathom</h2>
        <span style={small}>Every recorded call lands here by itself as a call note, minutes after it ends, with a proposal waiting on Today.</span>
      </div>
      <div>
        {data.members.map(row)}
        {!data.members.length && !canEdit && <span style={small}>Fathom is not connected.</span>}
        {canEdit && !mine && (
          <div data-fathom-row="new" style={{ display: 'grid', gap: 8, padding: '12px 0', borderTop: `1px solid ${SA.border}` }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <b style={{ fontSize: 14, color: SA.text, fontWeight: 600 }}>You</b>
              <span data-fathom-status style={small}>Not connected</span>
            </div>
            {rowError[data.me] && <span role="alert" data-fathom-error style={{ fontSize: 13, color: SA.bad }}>{rowError[data.me]}</span>}
            <KeyForm label="Your Fathom API key" busy={!!busy} onConnect={k => act(data.me, 'Connect', () => fathomApi.connect(businessId, k), () => setNote('Connected - press Test to check the key'))} />
          </div>
        )}
        {canEdit && data.owner && data.others.filter(o => o.user_id !== data.me).length > 0 && (
          <div data-fathom-row="other" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 0', borderTop: `1px solid ${SA.border}` }}>
            <select aria-label="Connect Fathom for another member" value={forUser} onChange={e => setForUser(e.target.value)} style={{ ...inputStyle, height: 36, width: 'auto' }}>
              <option value="">Connect for another member…</option>
              {data.others.filter(o => o.user_id !== data.me).map(o => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}
            </select>
            {forUser && <KeyForm label="Their Fathom API key" busy={!!busy} onConnect={k => act(forUser, 'Connect', u => fathomApi.connect(businessId, k, u), () => { setForUser(''); setNote('Connected - press Test on their row to check the key'); })} />}
            {forUser && rowError[forUser] && <span role="alert" data-fathom-error style={{ fontSize: 13, color: SA.bad }}>{rowError[forUser]}</span>}
          </div>
        )}
      </div>
      {note && <div role="status" data-fathom-note style={{ fontSize: 13, color: SA.text }}>{note}</div>}
      {error && <ErrorNote message={error} />}
      <div data-fathom-cap style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={small}>Calls read automatically today: <b style={{ color: SA.text, fontWeight: 500 }}>{x.used} of {x.cap}</b> · past the cap a call is stored and waits on Today for an Extract click</span>
        {canEdit && data.owner && (
          <form onSubmit={e => { e.preventDefault(); const v = Number(cap); if (cap === '' || !Number.isInteger(v)) return; setBusy('cap'); fathomApi.setCap(businessId, v).then(() => { setCap(''); setNote(`Daily cap is now ${v}`); return load(); }).catch(er => setError(er.message)).finally(() => setBusy('')); }} style={{ display: 'flex', gap: 6 }}>
            <input type="number" min="0" max="200" aria-label="Daily cap" placeholder={String(x.cap)} value={cap} onChange={e => setCap(e.target.value)} style={{ ...inputStyle, height: 32, width: 76 }} />
            <Btn type="submit" disabled={!!busy || cap === ''} style={{ height: 32 }}>Set cap</Btn>
          </form>
        )}
      </div>
      <ul data-fathom-help style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, ...small }}>{HELP.map(h => <li key={h}>{h}</li>)}</ul>
    </section>
  );
}
