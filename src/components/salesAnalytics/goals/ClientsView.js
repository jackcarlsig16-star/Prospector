import { useState, useEffect } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi, OPEN_PIPELINE_RECORD } from './goalsApi';
import { ErrorNote, fmt, cardStyle } from './goalsUi';
import { StatusChip, livesText, mdy } from './ClientParts';
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL } from '../../../constants/clients';

// homelover-clients-v1 C5 - Pipeline › Clients: every client, sorted by status then launch date (the server sorts).
// A name opens the company window (files, Mark signed / launched); "Referred by" opens the partner's.
const open = (type, id) => window.dispatchEvent(new CustomEvent(OPEN_PIPELINE_RECORD, { detail: { key: `${type}-${id}` } }));
const th = { ...SA_TYPE.label, color: SA.muted, fontWeight: 500, textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${SA.border}`, whiteSpace: 'nowrap' };
const td = { fontSize: 13, color: SA.text, padding: '8px', borderBottom: `1px solid ${SA.border}`, verticalAlign: 'top' };
const link = { height: 24, padding: '0 2px', fontSize: 13, justifyContent: 'flex-start', textAlign: 'left' };

export default function ClientsView({ businessId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    goalsApi.clients(businessId).then(d => live && setData(d)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId]);
  if (error) return <ErrorNote message={error} />;
  if (!data) return <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>;
  const t = data.totals;
  return (
    <section aria-label="Clients" data-clients-view style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div data-clients-totals style={{ display: 'flex', gap: '6px 16px', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <b style={{ fontSize: 15, color: SA.text, fontWeight: 600 }}>{fmt(t.clients)} {t.clients === 1 ? 'client' : 'clients'} · {fmt(t.eligible_now)} eligible lives{t.eligible_added ? ` (+${fmt(t.eligible_added)} coming)` : ''}</b>
        <span style={{ fontSize: 13, color: SA.muted }}>{CLIENT_STATUSES.map(s => `${CLIENT_STATUS_LABEL[s]} ${t.by_status[s]}`).join(' · ')}</span>
      </div>
      {!data.clients.length ? <span style={{ fontSize: 13, color: SA.muted }}>No clients yet. Open an employer and use Make client, or + Add › Client.</span> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr>{['Client', 'Status', 'Eligible', 'Signed', 'Launch', 'Referred by', 'Owner', 'Files'].map(h => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.clients.map(c => (
                <tr key={c.id} data-client-row={c.id}>
                  <td style={td}><button type="button" className="ui-btn ui-btn--tertiary" style={{ ...link, fontWeight: 500, color: SA.text }} onClick={() => open('employer', c.id)}>{c.name}</button></td>
                  <td style={td}><StatusChip status={c.client_status} /></td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }} title={c.eligible_added_note || undefined}>{livesText(c)}</td>
                  <td style={td}>{mdy(c.signed_date)}</td>
                  <td style={td}>{mdy(c.launch_date)}</td>
                  <td style={td}>{c.referred_by
                    ? (c.referred_by.id ? <button type="button" className="ui-btn ui-btn--tertiary" style={link} onClick={() => open('partner', c.referred_by.id)}>{c.referred_by.name}</button> : <span style={{ color: SA.warn }}>Partner not set</span>)
                    : <span style={{ color: SA.muted }}>{c.source_kind ? 'Not a partner referral' : 'Source not set'}</span>}</td>
                  <td style={td}>{c.owner || '—'}</td>
                  <td style={td}>{fmt(c.files)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
