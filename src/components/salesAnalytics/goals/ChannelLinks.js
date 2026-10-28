import { useState, useEffect } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { cardStyle, labelStyle, h3Style, numStyle, ErrorNote } from './goalsUi';
import { md } from './companyPanelFacts';

// intake-insights-v1 I5 - Dashboard > Sources "Channel links · n": the relationships people kept from notes (partner /
// office / person / company -> relation -> ...), newest seen first, filtered by the page's Partner filter (that partner
// on either end). A ✓ = the end is a Pipeline record or a known person. The visual map is partner-channel-map-v1.
const RELATION = { referred: 'referred', introduced: 'introduced', owns: 'owns', co_sells: 'co-sells with', reports_to: 'reports to', works_with: 'works with', other: '·' };
const end = (name, type) => <span>{name}{type ? <span aria-label="matched" style={{ color: SA.good }}> ✓</span> : null}</span>;
const cell = { padding: '8px 10px', borderTop: `1px solid ${SA.track}`, fontSize: 13, color: SA.text, verticalAlign: 'top' };

export default function ChannelLinks({ businessId, partner = '', narrow = false }) {
  const [links, setLinks] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    goalsApi.channelLinks(businessId, { partner: partner || undefined }).then(l => { if (live) { setLinks(l); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, partner]);
  return (
    <section aria-label="Channel links" data-channel-links style={{ ...cardStyle, padding: narrow ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h2 style={h3Style}>Channel links{links ? <span style={{ color: SA.muted, fontWeight: 400 }}> · {links.length}</span> : null}</h2>
      {error && <ErrorNote message={error} />}
      {!links && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
      {links && !links.length && <span style={{ fontSize: 13, color: SA.muted }}>No channel links kept yet - keep them from "From these notes" when you accept notes.</span>}
      {links?.length > 0 && (narrow ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {links.map(l => (
            <li key={l.id} data-link-row style={{ ...cell, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>{end(l.from_name, l.from_record_type)} <span style={{ color: SA.muted }}>→ {RELATION[l.relation] || l.relation} →</span> {end(l.to_name, l.to_record_type)}</span>
              <span style={{ fontSize: 12, color: SA.muted, ...numStyle }}>{l.link_date ? md(l.link_date) : 'no date'}{l.seen_count > 1 ? ` · seen ${l.seen_count}×` : ''}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['From', 'Relation', 'To', 'Date', 'Seen'].map(h => <th key={h} scope="col" style={{ ...labelStyle, textAlign: 'left', padding: '8px 10px' }}>{h}</th>)}</tr></thead>
            <tbody>
              {links.map(l => (
                <tr key={l.id} data-link-row>
                  <td style={cell}>{end(l.from_name, l.from_record_type)}<div style={{ fontSize: 11, color: SA.muted }}>{l.from_kind}</div></td>
                  <td style={{ ...cell, color: SA.soft }}>{RELATION[l.relation] || l.relation}</td>
                  <td style={cell}>{end(l.to_name, l.to_record_type)}<div style={{ fontSize: 11, color: SA.muted }}>{l.to_kind}</div></td>
                  <td style={{ ...cell, ...numStyle, whiteSpace: 'nowrap' }}>{l.link_date ? md(l.link_date) : '—'}</td>
                  <td style={{ ...cell, ...numStyle }}>{l.seen_count}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
