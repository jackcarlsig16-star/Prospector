import { useState, useEffect } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { numStyle } from './goalsUi';
import { sourceColor, SOURCE_LABELS } from '../palette';

// intent-score-v1 S4 - the company window's "Intent 83 · P1" fact with the expandable component list ("+12 Brad
// referral · +17 visits (6 in 7 d, 3 people) …") and a per-company Recompute (any Member). Reads GET
// goals/scores/:type/:id; nothing until the first recompute ("No score yet").
// company-panel-v3 T: compact = the title row's "INTENT 73 · P1 · ● source"; the breakdown opens under it.
export default function IntentFact({ businessId, row, canEdit, version = 0, compact = false }) {
  const [score, setScore] = useState(undefined); // undefined = loading, null = none yet
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    goalsApi.scoreOf(businessId, row.type, row.id).then(d => live && setScore(d)).catch(() => live && setScore(null));
    return () => { live = false; };
  }, [businessId, row.type, row.id, version, tick]);
  const recompute = async () => {
    setBusy(true);
    try { await goalsApi.recomputeScores(businessId, { type: row.type, id: row.id }); setTick(t => t + 1); } catch { /* the fact keeps its last value */ } finally { setBusy(false); }
  };
  if (score === undefined) return null;
  const r = score?.row;
  return (
    <details data-intent-fact style={{ fontSize: 13, color: SA.text, ...(compact ? { position: 'relative' } : {}) }}>
      <summary style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span className="ui-group-label">Intent</span>
        {r ? <b style={{ ...numStyle, fontWeight: 600, textDecoration: 'underline dotted', textDecorationColor: 'var(--sa-muted)', textUnderlineOffset: 4 }}>{r.score} · {r.band}{r.closed ? ' · closed' : r.live ? ' · live' : ''}</b> : <span style={{ color: SA.muted }}>No score yet</span>}
        {r && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: SA.muted }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: sourceColor(r.source_label) }} />{SOURCE_LABELS[r.source_label] || r.source_label}</span>}
        {r?.trend && r.band_changed && <span data-trend={r.trend} style={{ fontSize: 12, color: r.trend === 'up' ? SA.good : SA.bad }}>{r.trend === 'up' ? '▲' : '▼'} since {r.prev_band}</span>}
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: compact ? 10 : '6px 0 0 4px', ...(compact ? { position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', left: 0, minWidth: 260, background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' } : {}) }}>
        {(score?.lines || []).map(l => <span key={l} style={{ ...numStyle, fontSize: 12, color: l.startsWith('-') ? SA.bad : SA.text }}>{l}</span>)}
        {r && !score.lines?.length && <span style={{ fontSize: 12, color: SA.muted }}>No points yet</span>}
        {canEdit && <span><button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} onClick={recompute}>{busy ? 'Recomputing…' : 'Recompute'}</button></span>}
      </div>
    </details>
  );
}
