import { useEffect, useState } from 'react';
import { SA, saMono } from '../../theme';
import { labelStyle, subStyle, numStyle } from '../goalsUi';
import { stageName } from './activityTimeline';

// microsoft-connect-v1 Stage 3 - the Outlook half of the moves panel. Touches
// are facts (Record writes them, no OK), stage moves are proposals: Ready
// rows apply on the daily step or by Apply, Needs-OK rows wait for OK /
// Dismiss. Every row shows its key so Jack can OK by key in chat too.
const tiny = { all: 'unset', cursor: 'pointer', fontSize: 12, color: SA.link, padding: '0 6px', lineHeight: '24px', whiteSpace: 'nowrap' };
const pillStyle = { ...saMono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: SA.muted, border: `1px solid ${SA.border}`, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' };
const rowStyle = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 10px', alignItems: 'center', padding: '5px 0', borderTop: `1px solid ${SA.track}` };
const keyStyle = { ...saMono, fontSize: 10, color: SA.muted, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const day = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function moveLine(m) {
  return `${stageName(m.from)} → ${stageName(m.to)} · ${m.person} · ${day(m.date)}${m.meeting_date && m.meeting_date !== m.date ? ` (meeting ${day(m.meeting_date)})` : ''}`;
}

function MoveList({ name, items, pill, actions }) {
  if (!items.length) return null;
  return (
    <ul aria-label={name} style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
      {items.map(m => (
        <li key={m.key} style={rowStyle} data-key={m.key}>
          <span style={{ display: 'flex', gap: '2px 10px', flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0 }}>
            <span style={{ color: SA.text, fontWeight: 500 }}>{m.partner}</span>
            <span style={subStyle}>{moveLine(m)}</span>
            {m.hold_reason && <span style={{ ...subStyle, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.hold_reason}</span>}
          </span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={pillStyle}>{pill(m)}</span>
            <code style={keyStyle} title={m.key}>{m.key}</code>
            {actions && actions(m)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function OutlookMoves({ load, onApply, onDismiss, onRecord, onChanged = () => {} }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState('');
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
  const apply = (m, held) => act(m.key, () => onApply([m.key], held), r => (r.applied?.length ? `${m.partner} → ${stageName(m.to)} · from Outlook` : `${m.partner}: ${r.refused?.[0]?.reason || 'not applied'}`));
  const dismiss = m => act(m.key, () => onDismiss(m.key), () => `${m.partner}: dismissed - it won't come back`);
  const record = () => act('record', onRecord, r => `${r.recorded.length} touch${r.recorded.length === 1 ? '' : 'es'} recorded · ${r.people.length} people added · ${r.skipped_manual} already logged by hand${r.refused.length ? ` · ${r.refused.length} refused` : ''}`);
  const c = data?.counts;
  const t = data?.touches;
  const canAct = !!onApply;
  return (
    <div aria-label="Outlook moves" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: `1px solid ${SA.border}` }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={labelStyle}>Outlook moves</span>
        <span style={{ ...subStyle, fontSize: 12 }}>From synced Outlook mail and meetings. Touches are facts and get recorded; stage moves are proposals - a sent mail = Sent, a reply in our thread = Replied, a meeting = Meeting (needs OK). Never backwards.</span>
      </div>
      {error && <span role="alert" style={{ color: SA.bad, fontSize: 12 }}>{error}</span>}
      {note && !error && <span role="status" style={{ color: SA.good, fontSize: 12 }}>{note}</span>}
      {!data && !error && <span style={subStyle}>Loading…</span>}
      {data && (
        <>
          <span style={{ ...subStyle, ...numStyle, fontSize: 12 }}>
            {`${c.messages} messages · ${c.events} meetings read · ${c.touches} touches to record · ${c.proposed} ready · ${c.held} need OK · ${c.people} people to add · ${c.skipped_auto} auto-replies skipped · ${c.unmatched} unmatched`}
          </span>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ color: SA.text, fontWeight: 500 }}>Touches to record</span>
              <span style={{ ...subStyle, fontSize: 12 }}>{t.would_record.length ? `${t.would_record.length} new · ${t.skipped_manual.length} already logged by hand` : `Nothing new${t.skipped_manual.length ? ` · ${t.skipped_manual.length} already logged by hand` : ''}`}</span>
              {canAct && t.would_record.length > 0 && <button type="button" style={{ ...tiny, color: SA.good }} disabled={busy === 'record'} onClick={record}>Record touches</button>}
            </div>
            {t.would_record.length > 0 && (
              <ul aria-label="Outlook touches to record" style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
                {t.would_record.map(x => (
                  <li key={x.key} style={rowStyle}>
                    <span style={{ display: 'flex', gap: '2px 10px', flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0 }}>
                      <span style={{ color: SA.text, fontWeight: 500 }}>{x.partner}</span>
                      <span style={subStyle}>{x.reason}</span>
                    </span>
                    <span style={pillStyle}>{x.direction === 'received' ? 'reply' : 'email'}</span>
                  </li>
                ))}
              </ul>
            )}
            {t.skipped_manual.length > 0 && (
              <ul aria-label="Outlook touches already logged" style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
                {t.skipped_manual.map(x => (
                  <li key={x.key} style={rowStyle}>
                    <span style={{ display: 'flex', gap: '2px 10px', flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0 }}>
                      <span style={{ color: SA.text, fontWeight: 500 }}>{x.partner}</span>
                      <span style={subStyle}>{x.reason}</span>
                    </span>
                    <span style={pillStyle}>by hand</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <span style={{ color: SA.text, fontWeight: 500 }}>Ready</span>
            <span style={{ ...subStyle, fontSize: 12 }}> {data.proposed.length ? 'applies on the daily step, or now with Apply' : 'Nothing ready'}</span>
            <MoveList name="Outlook ready moves" items={data.proposed} pill={() => 'from Outlook'}
              actions={canAct ? m => <button type="button" style={{ ...tiny, color: SA.good }} disabled={busy === m.key} aria-label={`Apply ${m.partner}`} onClick={() => apply(m, false)}>Apply</button> : null} />
          </div>
          <div>
            <span style={{ color: SA.text, fontWeight: 500 }}>Needs OK</span>
            <span style={{ ...subStyle, fontSize: 12 }}> {data.held.length ? 'OK moves it, Dismiss drops it for good' : 'Nothing waiting'}</span>
            <MoveList name="Outlook held moves" items={data.held} pill={m => (m.to === 'meeting_set' ? 'meeting' : 'cold reply')}
              actions={canAct ? m => (
                <span style={{ display: 'flex', gap: 2 }}>
                  <button type="button" style={{ ...tiny, color: SA.good }} disabled={busy === m.key} aria-label={`OK ${m.partner}`} onClick={() => apply(m, true)}>OK</button>
                  <button type="button" style={tiny} disabled={busy === m.key} aria-label={`Dismiss ${m.partner}`} onClick={() => dismiss(m)}>Dismiss</button>
                </span>
              ) : null} />
          </div>
          {data.people.length > 0 && (
            <div>
              <span style={{ color: SA.text, fontWeight: 500 }}>People a Sent mail adds</span>
              <span style={{ ...subStyle, fontSize: 12 }}> added with Record touches</span>
              <ul aria-label="Outlook people" style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
                {data.people.map(p => (
                  <li key={p.key} style={rowStyle}>
                    <span style={{ display: 'flex', gap: '2px 10px', flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0 }}>
                      <span style={{ color: SA.text, fontWeight: 500 }}>{p.partner}</span>
                      <span style={subStyle}>{p.name ? `${p.name} <${p.email}>` : p.email} · first {day(p.first_seen)}</span>
                    </span>
                    <span style={pillStyle}>from Outlook</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
