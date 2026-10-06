import { useState } from 'react';
import { SA, SA_TYPE, SA_SHAPE, saSans } from './theme';
import { SEMANTIC } from './palette';
import { allStepsDone, timeAgo } from './huddleView';

// sales-huddle-v2 Stage 3 - flags handed to the viewer. The steps are the
// same rows as the to-do in Goals -> This week, so ticking here or there is
// one change. When every step is done the item asks once whether to mark the
// prospect contacted and close the to-do.
const btn = { ...saSans, height: 32, padding: '0 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: SA.text, border: `1px solid ${SA.border}`, background: SA.surface2 };

export default function FlaggedLane({ flags, prospectsById, lookup, canEdit, onToggleStep, onComplete, onOpen }) {
  const [error, setError] = useState('');
  const run = async fn => { setError(''); try { await fn(); } catch (e) { setError(e.message); } };
  if (!flags.length) return null;

  return (
    <section aria-labelledby="huddle-flagged" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h2 id="huddle-flagged" style={{ ...SA_TYPE.cardTitle, fontSize: 17, color: SA.text, margin: 0 }}>🚩 Flagged for you</h2>
        <span style={{ ...SA_TYPE.label, color: SA.faint }}>{flags.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {flags.map(f => {
          const p = prospectsById.get(f.prospect_contact_id);
          const done = allStepsDone(f);
          const contacted = p && ['contacted', 'booked'].includes(p.status);
          return (
            <div key={f.id} style={{ padding: '12px 14px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface, border: `1px solid ${done && !contacted ? SEMANTIC.healthy : SEMANTIC.warning}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 600, color: SA.text }}>{p?.name || f.contacts[0] || 'Prospect'}</span>
                <span style={{ fontSize: 13, color: SA.muted }}>{p?.company || f.contacts[1] || ''}</span>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => onOpen(f.prospect_contact_id)} style={{ ...btn, height: 28, color: SA.link, background: 'transparent' }}>Open</button>
              </div>
              <div style={{ fontSize: 12, color: SA.muted }}>
                From {lookup(f.flagged_by).first} · {timeAgo(f.created_at)}{f.flag_note ? ` · “${f.flag_note}”` : ''}
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {f.steps.map(s => (
                  <li key={s.id}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: canEdit ? 'pointer' : 'default', minHeight: 28, color: s.done ? SA.muted : SA.text, textDecoration: s.done ? 'line-through' : 'none' }}>
                      <input type="checkbox" checked={s.done} disabled={!canEdit} onChange={() => run(() => onToggleStep(f, s))} /> {s.text}
                    </label>
                  </li>
                ))}
              </ul>
              {done && !contacted && canEdit && (
                <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13, color: SA.soft }}>
                  All steps done — mark {p?.name || 'them'} contacted and close the to-do?
                  <button type="button" style={{ ...btn, borderColor: SEMANTIC.healthy }} onClick={() => run(() => onComplete(f))}>Mark contacted</button>
                </div>
              )}
              <span style={{ fontSize: 11, color: SA.faint }}>Also in Goals → This week · Huddle follow-ups</span>
            </div>
          );
        })}
      </div>
      {error && <p style={{ fontSize: 12, color: SA.bad, margin: '8px 0 0' }}>⚠ {error}</p>}
    </section>
  );
}
