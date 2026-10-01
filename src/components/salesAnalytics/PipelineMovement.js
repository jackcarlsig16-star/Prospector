import { useState, useEffect } from 'react';
import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { fetchMovement } from './pipelineApi';
import { STAGE_LABELS } from './pipelineStages';
import { laWeekStart, laDateString } from './periods';

const BUCKETS = [
  { key: 'moved_forward', label: 'Forward', color: SA.good },
  { key: 'moved_back', label: 'Back', color: SA.bad },
  { key: 'added', label: 'Added', color: SA.accent },
  { key: 'lost', label: 'Lost', color: SA.bad },
  { key: 'stalled', label: 'Stalled', color: SA.warn },
];

function shiftWeek(weekStartStr, deltaWeeks) {
  const d = new Date(weekStartStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7);
  return laDateString(d);
}
function weekEnd(weekStartStr) {
  const d = new Date(weekStartStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return laDateString(d);
}

// sales-pipeline-v1 Stage 3 - "Pipeline Movement (selected week)": a
// local Monday-start week picker (laWeekStart, same LA-timezone-aware
// helper periods.js already provides) rather than a shared component -
// sales-weekly-report-v1 is the SPEC that actually calls for a shared
// week picker across multiple views; building one here first would be
// guessing at its shape.
export default function PipelineMovement({ businessId, widgetId = 'pipeline_movement' }) {
  const [weekStart, setWeekStart] = useState(() => laWeekStart());
  const [movement, setMovement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchMovement(businessId, weekStart, weekEnd(weekStart))
      .then(data => { if (!cancelled) setMovement(data); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId, weekStart]);

  return (
    <div>
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={() => setWeekStart(w => shiftWeek(w, -1))} style={navButtonStyle()}>←</button>
        <span style={{ ...SA_TYPE.body, fontSize: 13, color: SA.text }}>Week of {weekStart} – {weekEnd(weekStart)}</span>
        <button onClick={() => setWeekStart(w => shiftWeek(w, 1))} style={navButtonStyle()}>→</button>
        {weekStart !== laWeekStart() && (
          <span onClick={() => setWeekStart(laWeekStart())} style={{ ...SA_TYPE.body, fontSize: 12, color: SA.accent, cursor: 'pointer' }}>This week</span>
        )}
      </div>
      <p className="print-only" style={{ fontSize: 12, color: SA.muted, margin: '0 0 10px' }}>Week of {weekStart} – {weekEnd(weekStart)}</p>

      {error && <p style={{ fontSize: 12, color: SA.bad }}>⚠ {error}</p>}
      {loading ? (
        <p style={{ fontSize: 12, color: SA.muted }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          {BUCKETS.map(b => {
            const rows = movement?.[b.key] || [];
            return (
              <div key={b.key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, display: 'inline-block' }} />
                  <span style={{ ...SA_TYPE.label, fontSize: 10, color: SA.muted }}>{b.label}</span>
                  <span style={{ fontSize: 11, color: SA.faint }}>({rows.length})</span>
                </div>
                {rows.length === 0 ? (
                  <p style={{ fontSize: 11, color: SA.faint, margin: 0 }}>None</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rows.map(r => (
                      <div key={r.id} style={{ fontSize: 12, color: SA.text }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.organization}>{r.organization}</div>
                        <div style={{ fontSize: 11, color: SA.muted }}>
                          {b.key === 'added' ? `added · ${STAGE_LABELS[r.stage]}`
                            : b.key === 'lost' ? `→ Lost`
                            : b.key === 'stalled' ? `${STAGE_LABELS[r.stage]}${r.next_action_date ? ` · due ${r.next_action_date}` : ''}`
                            : `→ ${STAGE_LABELS[r.stage]}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function navButtonStyle() {
  return { ...SA_TYPE.body, fontSize: 13, padding: '4px 10px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, color: SA.text, cursor: 'pointer' };
}
