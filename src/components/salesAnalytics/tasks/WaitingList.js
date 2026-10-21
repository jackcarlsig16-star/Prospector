import { useState } from 'react';
import { SA } from '../theme';
import { goalsApi } from '../goals/goalsApi';
import { numStyle, ErrorNote } from '../goals/goalsUi';
import { md, linkBtn } from './TaskRow';
import { laDateString } from '../periods';

// call-notes-targets-v1 REV5 - what a counterpart owes us (kind 'waiting'
// rows): who · what · due. Got it closes the row (it counts as nothing in a
// report); Nudge makes OUR to-do "Nudge <who> re <what>", due today, owned
// by whoever clicked. partnerName: id -> name, or null on one partner's card.
const btn = { ...linkBtn, textDecoration: 'none', border: `1px solid ${SA.border}`, background: SA.surface2, borderRadius: 6, padding: '0 10px', height: 28, color: SA.text, fontSize: 12, fontWeight: 500 };

export const sortWaiting = rows => [...rows].sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9') || String(a.created_at).localeCompare(String(b.created_at)));

export default function WaitingList({ businessId, rows, partnerName, canEdit, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [nudged, setNudged] = useState({});
  const today = laDateString();
  const run = async (id, fn) => {
    setBusy(id); setError('');
    try { await fn(); await onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  if (!rows.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {error && <ErrorNote message={error} />}
      <ul aria-label="Waiting on them" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {sortWaiting(rows).map(w => {
          const late = w.due_date && w.due_date < today;
          return (
            <li key={w.id} data-waiting-id={w.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: `1px solid ${SA.track}`, flexWrap: 'wrap' }}>
              <span aria-hidden="true" style={{ width: 18, textAlign: 'center', flex: 'none', color: SA.muted }}>⏳</span>
              <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, overflowWrap: 'anywhere' }}><strong>{w.waiting_on}</strong>{partnerName ? ` · ${partnerName(w.link_id) || 'partner'}` : ''} · {w.text}</span>
                {nudged[w.id] && <span role="status" style={{ fontSize: 12, color: SA.good }}>Nudge to-do added for today</span>}
              </div>
              <span style={{ ...numStyle, fontSize: 12, color: late ? SA.bad : SA.muted, whiteSpace: 'nowrap', paddingTop: 2 }}>
                {w.due_date ? `${late ? 'was due' : 'due'} ${md(w.due_date)}` : 'no date'}
              </span>
              {canEdit && (
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <button type="button" disabled={busy === w.id} style={btn} aria-label={`Got it: ${w.waiting_on} - ${w.text}`}
                    onClick={() => run(w.id, () => goalsApi.updateWeekGoal(businessId, w.id, { status: 'done' }))}>Got it ✓</button>
                  <button type="button" disabled={busy === w.id || nudged[w.id]} style={btn} aria-label={`Nudge ${w.waiting_on}`}
                    onClick={() => run(w.id, async () => { await goalsApi.nudgeWaiting(businessId, w.id); setNudged(n => ({ ...n, [w.id]: true })); })}>Nudge →</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
