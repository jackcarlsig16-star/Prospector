import { useState, useEffect } from 'react';
import { SA, saMono } from '../../theme';
import { labelStyle, subStyle, inputStyle, Btn, ErrorNote } from '../goalsUi';
import { DOMAIN_SOURCES } from '../../../../constants/partnerDomains';

// partner-360-v1 Stage 2 - the partner's domains, inside Intel. Confirmed
// domains are the key Apollo (and later Outlook) matching uses; suggestions
// come from the sheet's sources and Apollo's account list and are offered
// until confirmed or dismissed. api = { load, add, update, remove }, each
// resolving to the same { domains, suggestions, apollo_account } payload.
const small = { ...saMono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: SA.muted };
const tiny = { all: 'unset', cursor: 'pointer', fontSize: 12, color: SA.link, padding: '0 3px', lineHeight: '20px' };
const chip = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 8px 0 10px', borderRadius: 999, border: `1px solid ${SA.borderStrong}`, background: SA.surface2, fontSize: 12, color: SA.text, whiteSpace: 'nowrap' };

export default function PartnerDomains({ partner, canEdit, api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null); // { id, value }
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    api.load(partner.id).then(d => { if (live) { setData(d); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [partner.id, api]);
  const run = async fn => {
    setBusy(true); setError('');
    try { setData(await fn()); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const add = async e => {
    e.preventDefault();
    if (!draft.trim()) return;
    if (await run(() => api.add(partner.id, { domain: draft.trim() }))) { setDraft(''); setAdding(false); }
  };
  const saveEdit = async e => {
    e.preventDefault();
    if (await run(() => api.update(partner.id, editing.id, { domain: editing.value.trim() }))) setEditing(null);
  };
  if (!data && !error) return <div style={{ ...subStyle, fontSize: 12 }}>Domains: loading…</div>;
  const confirmed = (data?.domains || []).filter(d => d.confirmed);
  const dismissed = (data?.domains || []).filter(d => !d.confirmed);
  const suggestions = data?.suggestions || [];
  const apollo = data?.apollo_account;
  return (
    <div role="group" aria-label="Domains" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minHeight: 24 }}>
        <span style={labelStyle}>Domain{confirmed.length === 1 ? '' : 's'}</span>
        {!confirmed.length && <span style={{ ...subStyle, fontSize: 12 }}>none confirmed{suggestions.length ? '' : canEdit ? ' - add one' : ''}</span>}
        {confirmed.map(d => (editing?.id === d.id
          ? <form key={d.id} onSubmit={saveEdit} style={{ display: 'flex', gap: 6 }}>
              <input aria-label="Edit domain" value={editing.value} onChange={e => setEditing(x => ({ ...x, value: e.target.value }))} style={{ ...inputStyle, height: 28, width: 190, fontSize: 13 }} autoFocus />
              <Btn type="submit" style={{ height: 28 }} disabled={busy}>Save</Btn><Btn type="button" style={{ height: 28 }} onClick={() => setEditing(null)}>Cancel</Btn>
            </form>
          : <span key={d.id} style={chip} title={`${DOMAIN_SOURCES[d.source] || d.source}${d.is_primary ? ' · primary (goes in the Apollo CSV)' : ''}`}>
              {d.is_primary && <span aria-label="primary" style={{ color: SA.accent }}>★</span>}
              {d.domain}
              {canEdit && <>
                {!d.is_primary && <button type="button" style={tiny} title="Make primary" aria-label={`Make ${d.domain} primary`} disabled={busy} onClick={() => run(() => api.update(partner.id, d.id, { is_primary: true }))}>☆</button>}
                <button type="button" style={tiny} title="Edit" aria-label={`Edit ${d.domain}`} disabled={busy} onClick={() => setEditing({ id: d.id, value: d.domain })}>✎</button>
                <button type="button" style={tiny} title="Remove" aria-label={`Remove ${d.domain}`} disabled={busy} onClick={() => run(() => api.remove(partner.id, d.id))}>✕</button>
              </>}
            </span>))}
        {canEdit && !adding && <button type="button" style={{ ...tiny, color: SA.link }} onClick={() => setAdding(true)}>+ Add domain</button>}
        {adding && (
          <form onSubmit={add} style={{ display: 'flex', gap: 6 }}>
            <input aria-label="New domain" placeholder="company.com" value={draft} onChange={e => setDraft(e.target.value)} style={{ ...inputStyle, height: 28, width: 190, fontSize: 13 }} autoFocus />
            <Btn type="submit" style={{ height: 28 }} disabled={busy || !draft.trim()}>Add</Btn><Btn type="button" style={{ height: 28 }} onClick={() => { setAdding(false); setDraft(''); }}>Cancel</Btn>
          </form>
        )}
        <span style={{ ...subStyle, fontSize: 12, marginLeft: 'auto' }}>
          {apollo ? `Apollo account: ${apollo.name}${apollo.domain ? ` (${apollo.domain})` : ''}` : confirmed.length ? 'Not in Apollo - goes in the CSV export' : ''}
        </span>
      </div>
      {suggestions.length > 0 && (
        <ul aria-label="Suggested domains" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <li style={small}>Suggested</li>
          {suggestions.map(s => (
            <li key={s.domain} style={{ ...chip, borderStyle: 'dashed', color: SA.soft }} title={s.apollo_account ? `Apollo has this domain: ${s.apollo_account.name}` : 'From the sheet\'s sources'}>
              {s.domain}
              <span style={small}>{DOMAIN_SOURCES[s.source]}</span>
              {canEdit && <>
                <button type="button" style={{ ...tiny, color: SA.good }} aria-label={`Confirm ${s.domain}`} title="Confirm" disabled={busy} onClick={() => run(() => api.add(partner.id, { domain: s.domain }))}>✓</button>
                <button type="button" style={tiny} aria-label={`Dismiss ${s.domain}`} title="Not this partner's domain" disabled={busy} onClick={() => run(() => api.add(partner.id, { domain: s.domain, dismiss: true }))}>✕</button>
              </>}
            </li>))}
        </ul>
      )}
      {dismissed.length > 0 && canEdit && (
        <div style={{ ...subStyle, fontSize: 12 }}>
          Dismissed: {dismissed.map((d, i) => <span key={d.id}>{i ? ', ' : ''}{d.domain} <button type="button" style={tiny} aria-label={`Restore ${d.domain}`} disabled={busy} onClick={() => run(() => api.update(partner.id, d.id, { confirmed: true }))}>restore</button></span>)}
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </div>
  );
}
