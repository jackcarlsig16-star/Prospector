import { useState, useEffect, useCallback } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi } from './goalsApi';
import { ErrorNote, Btn, cardStyle, h3Style, inputStyle, fmt } from './goalsUi';

// email-by-member-v1 M1 - Sales › Settings: which sending mailbox belongs to which member (GET / PUT goals/mailbox-map).
// A mailbox is shown as its domain · first-seen day · delivered count behind the route's opaque key - the address
// never reaches the browser. The owner picks the member; everyone else reads. A member's own connected Microsoft
// account can only go to that member and stays there (the same map switches that member's Outlook sync on), so mapping
// one asks first.
const small = { fontSize: 13, color: SA.muted };
const th = { ...SA_TYPE.label, color: SA.muted, fontWeight: 500, textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${SA.border}` };
const td = { fontSize: 13, color: SA.text, padding: '8px', borderBottom: `1px solid ${SA.border}`, verticalAlign: 'middle' };
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const mailboxLabel = b => [b.domain, b.first_seen ? `first seen ${md(b.first_seen)}` : 'not seen sending', `${fmt(b.delivered)} delivered`].join(' · ');

export default function MailboxMapSettings({ businessId, isOwner }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState(null); // { key, user_id } - a connected account waiting for its confirm
  const [note, setNote] = useState('');
  const load = useCallback(() => goalsApi.mailboxMap(businessId).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [businessId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return error ? <ErrorNote message={error} /> : null;
  const nameOf = id => data.members.find(m => m.id === id)?.name || 'a former member';
  const save = async (b, userId) => {
    setBusy(b.key); setError(''); setNote(''); setAsk(null);
    try { await goalsApi.saveMailbox(businessId, { key: b.key, user_id: userId }); await load(); setNote(userId ? `Mapped to ${nameOf(userId)} - the email numbers by member follow on the next load.` : 'Unmapped - it reads as Unassigned mailbox.'); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };
  const pick = (b, userId) => (b.connected_account_of && userId ? setAsk({ key: b.key, user_id: userId }) : save(b, userId));
  return (
    <section data-mailbox-map aria-labelledby="h-mailbox-map" style={{ ...cardStyle, maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h2 id="h-mailbox-map" style={h3Style}>Team mailboxes</h2>
        <p style={{ ...small, margin: '4px 0 0' }}>Which member each sending mailbox belongs to - the Email page, the Scorecard and the Friday email read their by-member numbers from this. Only the domain is shown. {isOwner ? '' : 'The workspace owner sets this.'}</p>
      </div>
      {error && <ErrorNote message={error} />}
      {note && <span role="status" style={{ fontSize: 13, color: SA.good }}>{note}</span>}
      {data.mailboxes.length === 0 ? <span style={small}>No mailbox has sent yet.</span> : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th scope="col" style={th}>Mailbox</th><th scope="col" style={th}>Member</th></tr></thead>
          <tbody>
            {data.mailboxes.map((b, i) => {
              const own = b.connected_account_of, locked = !!own && b.user_id === own;
              const options = own ? data.members.filter(m => m.id === own) : data.members;
              const asking = ask?.key === b.key;
              return (
                <tr key={b.key} data-mailbox={i + 1}>
                  <td style={td}>
                    <span data-mailbox-label style={{ fontVariantNumeric: 'tabular-nums' }}>{mailboxLabel(b)}</span>
                    {own && <div style={{ ...small, fontSize: 12 }}>{nameOf(own)}'s own connected Microsoft account</div>}
                  </td>
                  <td style={td}>
                    {!isOwner ? <span data-mailbox-member>{b.user_id ? nameOf(b.user_id) : 'Unassigned mailbox'}</span> : locked ? <span data-mailbox-member title="A member's own connected account stays with that member">{nameOf(own)} · stays with {nameOf(own)}</span> : asking ? (
                      <span data-mailbox-confirm style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={{ fontSize: 13, color: SA.warn }}>This is {nameOf(ask.user_id)}'s own connected account: mapping it also starts {nameOf(ask.user_id)}'s Outlook sync into this workspace, and it can't be unmapped here.</span>
                        <span style={{ display: 'flex', gap: 8 }}><Btn primary disabled={!!busy} onClick={() => save(b, ask.user_id)}>Map to {nameOf(ask.user_id)}</Btn><Btn onClick={() => setAsk(null)}>Cancel</Btn></span>
                      </span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <select aria-label={`Member for mailbox ${i + 1}: ${mailboxLabel(b)}`} value={b.user_id || ''} disabled={!!busy} onChange={e => pick(b, e.target.value || null)} style={{ ...inputStyle, height: 34, fontSize: 13, minWidth: 190 }}>
                          <option value="">Unassigned mailbox</option>
                          {options.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        {!b.user_id && b.suggested_user_id && <span data-mailbox-suggested style={{ ...small, fontSize: 12 }}>looks like {nameOf(b.suggested_user_id)}'s</span>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
