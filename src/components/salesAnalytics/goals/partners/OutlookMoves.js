import { useEffect, useState } from 'react';
import { SA, saMono } from '../../theme';
import { labelStyle, subStyle, numStyle } from '../goalsUi';
import { stageName } from './activityTimeline';

// microsoft-connect-v1 Stage 3 Step 1 - the Outlook half of the moves panel:
// what the dry run proposes from synced Outlook mail and meetings. Read-only
// until Step 2 (OK / Dismiss by key); Step 3 applies "auto" rows daily.
const pillStyle = { ...saMono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: SA.muted, border: `1px solid ${SA.border}`, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' };
const rowStyle = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 10px', alignItems: 'center', padding: '5px 0', borderTop: `1px solid ${SA.track}` };
const day = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function moveLine(m) {
  return `${stageName(m.from)} → ${stageName(m.to)} · ${m.person} · ${day(m.date)}${m.meeting_date && m.meeting_date !== m.date ? ` (meeting ${day(m.meeting_date)})` : ''}`;
}

function MoveList({ name, items, pill }) {
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
            <code style={{ ...saMono, fontSize: 10, color: SA.muted }}>{m.key}</code>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function OutlookMoves({ load }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    load().then(d => live && setData(d)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [load]);
  const c = data?.counts;
  return (
    <div aria-label="Outlook moves" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: `1px solid ${SA.border}` }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={labelStyle}>Outlook moves</span>
        <span style={{ ...subStyle, fontSize: 12 }}>Dry run from synced Outlook mail and meetings - a sent mail = Sent, a reply in our thread = Replied, a meeting = Meeting (needs OK). Never backwards.</span>
      </div>
      {error && <span role="alert" style={{ color: SA.bad, fontSize: 12 }}>{error}</span>}
      {!data && !error && <span style={subStyle}>Loading…</span>}
      {data && (
        <>
          <span style={{ ...subStyle, ...numStyle, fontSize: 12 }}>
            {`${c.messages} messages · ${c.events} meetings read · ${c.proposed} ready · ${c.held} need OK · ${c.people} people to add · ${c.skipped_auto} auto-replies skipped · ${c.unmatched} unmatched`}
          </span>
          <div>
            <span style={{ color: SA.text, fontWeight: 500 }}>Ready</span>
            <span style={{ ...subStyle, fontSize: 12 }}> {data.proposed.length ? 'applies on the daily step once Step 3 ships' : 'Nothing ready'}</span>
            <MoveList name="Outlook ready moves" items={data.proposed} pill={() => 'from Outlook'} />
          </div>
          <div>
            <span style={{ color: SA.text, fontWeight: 500 }}>Needs OK</span>
            <span style={{ ...subStyle, fontSize: 12 }}> {data.held.length ? 'reply with the keys to apply' : 'Nothing waiting'}</span>
            <MoveList name="Outlook held moves" items={data.held} pill={m => (m.to === 'meeting_set' ? 'meeting' : 'cold reply')} />
          </div>
          {data.people.length > 0 && (
            <div>
              <span style={{ color: SA.text, fontWeight: 500 }}>People a Sent mail would add</span>
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
