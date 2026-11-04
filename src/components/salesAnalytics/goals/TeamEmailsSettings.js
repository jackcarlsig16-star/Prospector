import { useState, useEffect, useCallback, useRef } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi } from './goalsApi';
import { ErrorNote, Btn, cardStyle, h3Style, inputStyle } from './goalsUi';
import { connectMicrosoft } from '../../ConnectionsPage';

// homelover-team-emails-v1 T2 (REV2) - Sales › Settings › Team emails. The owner edits everything; everyone else
// reads (counts only - the server never hands a non-owner an address). Every list change can be undone for 10 s.
const KIND_LABEL = { visitor: 'Visitor email', client: 'New-client alert' };
const STATUS_LABEL = { sent: 'Sent', failed: 'Failed', needs_reconnect: 'Needs reconnect', skipped: 'Not sent' };
const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const small = { fontSize: 13, color: SA.muted };
const th = { ...SA_TYPE.label, color: SA.muted, fontWeight: 500, textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${SA.border}` };
const td = { fontSize: 13, color: SA.text, padding: '8px', borderBottom: `1px solid ${SA.border}`, verticalAlign: 'middle' };
const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;

export default function TeamEmailsSettings({ businessId, isOwner, meId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState(null); // { text, changeId? }
  const [clients, setClients] = useState([]);
  const [testClient, setTestClient] = useState('');
  const undoTimer = useRef(null);

  const load = useCallback(() => goalsApi.teamEmails(businessId).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [businessId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isOwner) return undefined;
    let live = true;
    goalsApi.clients(businessId).then(d => live && setClients(d.clients || [])).catch(() => {});
    return () => { live = false; };
  }, [businessId, isOwner]);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const flash = (text, changeId = null) => {
    clearTimeout(undoTimer.current);
    setNote({ text, changeId });
    undoTimer.current = setTimeout(() => setNote(null), 10e3);
  };
  const act = async (key, fn, done) => {
    setBusy(key); setError('');
    try { const r = await fn(); if (done) done(r); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };
  const undo = id => act('undo', () => goalsApi.undoTeamEmailChange(businessId, id), r => flash(`Undone · ${n(r.count, 'address', 'addresses')} on the list`));

  if (!data) return error ? <ErrorNote message={error} /> : <span style={small}>Loading…</span>;
  const isSender = data.sender?.user_id === meId;
  const domains = (data.domains || []).map(d => `@${d}`).join(' or ');

  const banner = data.banner && (
    <div role="alert" data-team-email-banner style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 14px', borderRadius: 8, border: `1px solid ${SA.warn}`, background: SA.inset }}>
      <span style={{ fontSize: 14, color: SA.text, flex: '1 1 260px' }}>
        <b style={{ color: SA.warn }}>{data.banner}.</b>{' '}
        {isSender ? 'Reconnect Microsoft and approve the "Send mail as you" permission; nothing is sent until then.' : `${data.sender?.first_name || 'The sender'} needs to reconnect Microsoft; nothing is sent until then.`}
      </span>
      {isSender && <Btn primary onClick={connectMicrosoft}>Reconnect Microsoft →</Btn>}
    </div>
  );

  const emailRow = kind => {
    const on = kind === 'visitor' ? data.visitor_on : data.client_on;
    const c = data.counts[kind];
    return (
      <div key={kind} data-team-email-kind={kind} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 0', borderTop: `1px solid ${SA.border}` }}>
        <div style={{ flex: '1 1 260px', display: 'grid', gap: 2 }}>
          <b style={{ fontSize: 14, color: SA.text, fontWeight: 600 }}>{KIND_LABEL[kind]}</b>
          <span style={small}>
            {kind === 'visitor' ? 'Weekdays at 7:00 AM PT · ' : 'Once per new client · '}
            {on ? n(c.count, 'recipient', 'recipients') : 'Off'}
            {c.dropped ? ` · ${c.dropped} outside ${domains} skipped` : ''}{c.capped ? ` · ${c.capped} over the ${data.max} cap` : ''}
          </span>
        </div>
        {isOwner ? (
          <>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: SA.text }}>
              <input type="checkbox" checked={on} disabled={!!busy} onChange={e => act(`on-${kind}`, () => goalsApi.updateTeamEmails(businessId, { [`${kind}_on`]: e.target.checked }))} /> On
            </label>
            {kind === 'client' && (
              <select aria-label="Client for the test alert" value={testClient} onChange={e => setTestClient(e.target.value)} style={{ ...inputStyle, height: 36, maxWidth: 200 }}>
                <option value="">Pick a client…</option>
                {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
              </select>
            )}
            <Btn disabled={!!busy || !data.ready || (kind === 'client' && !testClient)} style={{ height: 36 }}
              onClick={() => act(`test-${kind}`, () => goalsApi.teamEmailTest(businessId, kind === 'client' ? { kind, opportunity_id: testClient } : { kind }),
                r => flash(r.status === 'sent' ? `Test sent to your mailbox (${n(r.recipients, 'recipient', 'recipients')})` : `Test not sent: ${STATUS_LABEL[r.status] || r.status}`))}>
              {busy === `test-${kind}` ? 'Sending…' : 'Send a test to me only'}
            </Btn>
          </>
        ) : <span style={small}>{on ? 'On' : 'Off'}</span>}
      </div>
    );
  };

  const add = body => act('add', () => goalsApi.addTeamRecipient(businessId, body), r => { setAddress(''); flash(`Added · ${n(r.count, 'address', 'addresses')} on the list`, r.change_id); });
  const recipients = isOwner && (
    <section aria-label="Recipients" data-team-email-recipients style={{ display: 'grid', gap: 10 }}>
      <h3 style={h3Style}>Recipients</h3>
      <span style={small}>Only addresses at {domains || 'the sending mailbox’s domain'} can get team emails · up to {data.max}.</span>
      {data.recipients.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
            <thead><tr>{['Address', 'Visitor email', 'New-client alert', ''].map(h => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.recipients.map(r => (
                <tr key={r.id} data-recipient-row={r.id}>
                  <td style={td}>{r.address}{!r.allowed && <span style={{ color: SA.warn, marginLeft: 8 }}>outside {domains} - won’t receive</span>}</td>
                  {['visitor_email', 'client_alert'].map(k => (
                    <td key={k} style={td}>
                      <input type="checkbox" aria-label={`${k === 'visitor_email' ? 'Visitor email' : 'New-client alert'} for ${r.address}`} checked={r[k]} disabled={!!busy}
                        onChange={e => act(`edit-${r.id}`, () => goalsApi.editTeamRecipient(businessId, r.id, { [k]: e.target.checked }), x => flash('Saved', x.change_id))} />
                    </td>
                  ))}
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button type="button" className="ui-btn ui-btn--tertiary" disabled={!!busy} style={{ height: 28 }}
                      onClick={() => act(`remove-${r.id}`, () => goalsApi.removeTeamRecipient(businessId, r.id), x => flash(`Removed · ${n(x.count, 'address', 'addresses')} on the list`, x.change_id))}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <span style={small}>No recipients yet - nobody gets the team emails until you add them.</span>}
      <form onSubmit={e => { e.preventDefault(); if (address.trim()) add({ address: address.trim() }); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="email" aria-label="Add an address" placeholder={`name${data.domains[0] ? `@${data.domains[0]}` : '@company.com'}`} value={address} onChange={e => setAddress(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 240px', height: 36 }} />
        <Btn primary type="submit" disabled={!!busy || !address.trim() || data.recipients.length >= data.max} style={{ height: 36 }}>Add</Btn>
      </form>
      {data.suggestions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={small}>Members:</span>
          {data.suggestions.map(s => <Btn key={s.user_id} disabled={!!busy} style={{ height: 30, fontSize: 13 }} onClick={() => add({ member_user_id: s.user_id })}>Add {s.first_name}</Btn>)}
        </div>
      )}
    </section>
  );

  const sender = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 14, color: SA.text }}>Sent from</span>
      {isOwner && data.senders.length > 1 ? (
        <select aria-label="Sending mailbox" value={data.sender?.user_id || ''} disabled={!!busy} onChange={e => act('sender', () => goalsApi.updateTeamEmails(businessId, { sender_user_id: e.target.value }))} style={{ ...inputStyle, height: 36 }}>
          {data.senders.map(s => <option key={s.user_id} value={s.user_id}>{s.first_name}’s Microsoft 365 mailbox</option>)}
        </select>
      ) : <b style={{ fontSize: 14, color: SA.text }}>{data.sender ? `${data.sender.first_name}’s Microsoft 365 mailbox` : 'No sender yet'}</b>}
      {!isOwner && <span style={small}>The owner manages team emails.</span>}
    </div>
  );

  return (
    <section aria-label="Team emails" data-team-emails style={{ ...cardStyle, padding: 20, display: 'grid', gap: 16, maxWidth: 900 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <h2 style={{ ...h3Style, fontSize: 18 }}>Team emails</h2>
        <span style={small}>Two internal emails to the HomeLover team, sent from one member’s Microsoft 365 mailbox. Nothing here emails anyone outside {domains || 'the company'}.</span>
      </div>
      {banner}
      {sender}
      <div>{['visitor', 'client'].map(emailRow)}</div>
      {!isOwner && <span style={small}>{n(data.total, 'address is', 'addresses are')} on the list.</span>}
      {recipients}
      {note && (
        <div role="status" style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: SA.text }}>
          {note.text}
          {note.changeId && isOwner && <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 26 }} disabled={!!busy} onClick={() => { const id = note.changeId; setNote(null); undo(id); }}>Undo</button>}
        </div>
      )}
      {error && <ErrorNote message={error} />}
      <section aria-label="Last sends" style={{ display: 'grid', gap: 6 }}>
        <h3 style={h3Style}>Last 10 sends</h3>
        {data.sends.length ? data.sends.map(s => (
          <div key={s.id} data-send-row style={{ ...small, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ minWidth: 120 }}>{when(s.at)}</span>
            <span style={{ color: SA.text }}>{KIND_LABEL[s.kind]}{s.test ? ' (test)' : ''}</span>
            <span>{n(s.recipients, 'recipient', 'recipients')}</span>
            <span style={{ color: s.status === 'sent' ? SA.good : s.status === 'skipped' ? SA.muted : SA.warn }}>{STATUS_LABEL[s.status] || s.status}{s.error ? ` · ${s.error}` : ''}</span>
          </div>
        )) : <span style={small}>Nothing sent yet.</span>}
      </section>
      {data.changes.length > 0 && (
        <section aria-label="List changes" style={{ display: 'grid', gap: 6 }}>
          <h3 style={h3Style}>List changes</h3>
          {data.changes.map(c => (
            <div key={c.id} style={{ ...small, display: 'flex', gap: 10 }}>
              <span style={{ minWidth: 120 }}>{when(c.at)}</span>
              <span>{c.action === 'undo' ? 'Undo' : c.action === 'add' ? 'Added' : c.action === 'remove' ? 'Removed' : 'Edited'} · recipients: {c.count_before} → {c.count_after}{c.undone_at ? ' (undone)' : ''}</span>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
