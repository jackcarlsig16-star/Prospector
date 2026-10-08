import { useState, useEffect } from 'react';
import { SA, saSans } from '../../theme';
import { labelStyle, subStyle, numStyle, Btn, ErrorNote } from '../goalsUi';

// partner-360-v1 Stage 2 - "Export to Apollo (CSV)": partners with a
// confirmed domain that aren't Apollo accounts yet, as a file Jack imports
// in Apollo himself (Prospector never writes to Apollo). Company name,
// website, category, tier, owner - no contact data. load() = GET
// goals/partners/domains; csvUrl = the export route (fetched with the
// session cookie, then saved from a blob).
export default function ApolloExport({ load, csvUrl, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    load().then(d => live && setData(d)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [load]);
  const download = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (${res.status})`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'partners-for-apollo.csv';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const c = data?.counts;
  return (
    <section aria-label="Export to Apollo" style={{ ...saSans, marginTop: 10, padding: 14, border: `1px solid ${SA.border}`, borderRadius: 10, background: SA.surface2, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={labelStyle}>Export to Apollo (CSV)</span>
        {c && <span style={{ ...subStyle, ...numStyle, fontSize: 12 }}>{c.confirmed} of {c.partners} partners have a confirmed domain · {c.in_apollo} already in Apollo · <strong style={{ color: SA.text }}>{data.candidates.length} to export</strong></span>}
        <button type="button" onClick={onClose} style={{ all: 'unset', cursor: 'pointer', color: SA.link, fontSize: 12, marginLeft: 'auto' }}>Close</button>
      </div>
      {!data && !error && <span style={subStyle}>Loading…</span>}
      {data && !data.candidates.length && <span style={subStyle}>Nothing to export yet - confirm a domain on a partner that isn't in Apollo (open its row → Intel → Domains).</span>}
      {data && data.candidates.length > 0 && (
        <ul aria-label="Partners to export" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px 16px' }}>
          {data.candidates.map(p => <li key={p.domain} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name} <span style={subStyle}>· {p.domain}</span></li>)}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn primary style={{ height: 36 }} onClick={download} disabled={busy || !data || !data.candidates.length}>{busy ? 'Preparing…' : 'Download CSV'}</Btn>
        <span style={{ ...subStyle, fontSize: 12 }}>Columns: Company Name, Website, Category, Tier, Owner. No contacts. In Apollo: Companies → Import → CSV.</span>
      </div>
      {error && <ErrorNote message={error} />}
    </section>
  );
}
