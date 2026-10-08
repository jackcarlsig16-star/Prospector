import { useEffect, useState } from 'react';
import { SA, saSans, saMono } from '../../theme';
import { labelStyle, subStyle, numStyle } from '../goalsUi';
import { stageName } from './activityTimeline';
import OutlookMoves from './OutlookMoves';

// partner-360-v1 Stage 4 - "Apollo moves": what the daily step applied last
// (each row undoable while it is still the latest thing on its partner) and
// the held moves waiting on a person - partners whose sequenced contacts
// are all paused. OK applies the held key through the apply route with
// include_held; Dismiss writes a note carrying the key so it never comes
// back. load() = GET apollo-touches; onChanged fires after any write.
const tiny = { all: 'unset', cursor: 'pointer', fontSize: 12, color: SA.link, padding: '0 6px', lineHeight: '24px', whiteSpace: 'nowrap' };
const pillStyle = { ...saMono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: SA.muted, border: `1px solid ${SA.border}`, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' };
const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
const day = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const rowStyle = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 10px', alignItems: 'center', padding: '5px 0', borderTop: `1px solid ${SA.track}` };

export default function ApolloMoves({ load, loadOutlook, onApplyOutlook, onDismissOutlook, onRecordOutlook, onApply, onDismiss, onUndo, onChanged, onClose, lookup = () => ({ first: '' }) }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);     // key or event id in flight
  const [note, setNote] = useState('');       // last outcome line
  const [bump, setBump] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(d => live && setData(d)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [load, bump]);
  const act = async (id, fn, outcome) => {
    setBusy(id); setError('');
    try { const r = await fn(); setNote(outcome(r)); onChanged(); setBump(n => n + 1); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };
  const ok = h => act(h.key, () => onApply([h.key], true), r => (r.applied?.length ? `${h.partner} → ${stageName(h.to)} · from Apollo` : `${h.partner}: ${r.refused?.[0]?.reason || 'not applied'}`));
  const dismiss = h => act(h.key, () => onDismiss(h.key), () => `${h.partner}: dismissed - it won't come back`);
  const undo = a => act(a.event_id, () => onUndo(a.goal_id, a.event_id), () => `${a.partner}: back to ${stageName(a.from)}`);
  const last = data?.last_run;
  const held = data?.held || [];
  const proposedNow = data?.proposed?.length || 0;
  return (
    <section aria-label="Apollo moves" style={{ ...saSans, marginTop: 10, padding: 14, border: `1px solid ${SA.border}`, borderRadius: 10, background: SA.surface2, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={labelStyle}>Apollo moves</span>
        <span style={{ ...subStyle, fontSize: 12 }}>Stage moves made from stored Apollo data - in sequence = Sent, a reply = Replied. Never backwards, 0 Apollo calls.</span>
        <button type="button" onClick={onClose} style={{ all: 'unset', cursor: 'pointer', color: SA.link, fontSize: 12, marginLeft: 'auto' }}>Close</button>
      </div>
      {error && <span role="alert" style={{ color: SA.bad, fontSize: 12 }}>{error}</span>}
      {note && !error && <span role="status" style={{ color: SA.good, fontSize: 12 }}>{note}</span>}
      {!data && !error && <span style={subStyle}>Loading…</span>}
      {data && (
        <>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ color: SA.text, fontWeight: 500 }}>Last run</span>
              <span style={{ ...subStyle, ...numStyle, fontSize: 12 }}>
                {last ? `${when(last.at)} · ${last.applied.length} applied${last.refused.length ? `, ${last.refused.length} refused` : ''} · ${last.calls} Apollo calls` : 'The daily step has not run yet'}
                {proposedNow ? ` · ${proposedNow} proposed now, applies on the next sync` : ''}
              </span>
            </div>
            {last && last.applied.length > 0 && (
              <ul aria-label="Applied moves" style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
                {last.applied.map(a => (
                  <li key={a.event_id} style={rowStyle}>
                    <span style={{ display: 'flex', gap: '2px 10px', flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0, textDecoration: a.undone ? 'line-through' : 'none' }}>
                      <span style={{ color: SA.text, fontWeight: 500 }}>{a.partner}</span>
                      <span style={subStyle}>{stageName(a.from)} → {stageName(a.to)}</span>
                      <span style={{ ...subStyle, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.reason}</span>
                      <span style={pillStyle}>{a.held_ok ? 'OK’d by hand' : 'from Apollo'}</span>
                    </span>
                    {a.undone ? <span style={{ ...subStyle, fontSize: 12 }}>undone</span>
                      : a.undoable ? <button type="button" style={tiny} disabled={busy === a.event_id} aria-label={`Undo ${a.partner}`} onClick={() => undo(a)}>Undo</button>
                        : <span style={{ ...subStyle, fontSize: 12 }} title="Something happened to this partner since - undo from its Activity instead">—</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ color: SA.text, fontWeight: 500 }}>Held - needs you</span>
              <span style={{ ...subStyle, fontSize: 12 }}>{held.length ? `${held.length} partner${held.length === 1 ? '' : 's'} enrolled only in paused sequences - OK moves it to Sent, Dismiss drops it for good` : 'Nothing held'}</span>
            </div>
            {held.length > 0 && (
              <ul aria-label="Held moves" style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
                {held.map(h => (
                  <li key={h.key} style={rowStyle}>
                    <span style={{ display: 'flex', gap: '2px 10px', flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0 }}>
                      <span style={{ color: SA.text, fontWeight: 500 }}>{h.partner}</span>
                      <span style={subStyle}>{stageName(h.from)} → {stageName(h.to)}</span>
                      <span style={{ ...subStyle, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.reason} · {day(h.date)}</span>
                    </span>
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button type="button" style={{ ...tiny, color: SA.good }} disabled={busy === h.key} aria-label={`OK ${h.partner}`} onClick={() => ok(h)}>OK</button>
                      <button type="button" style={tiny} disabled={busy === h.key} aria-label={`Dismiss ${h.partner}`} onClick={() => dismiss(h)}>Dismiss</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {loadOutlook && <OutlookMoves load={loadOutlook} onApply={onApplyOutlook} onDismiss={onDismissOutlook} onRecord={onRecordOutlook} onChanged={onChanged} />}
    </section>
  );
}
