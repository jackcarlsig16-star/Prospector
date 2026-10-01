import { useState } from 'react';
import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { dismissInsight } from './salesApi';
import { currentUserLabel } from './huddleApi';

// sales-email-trend-v1 REV2 Stage 4 - "Why performance looks like this".
// Rules run server-side (api/sales/insightRules.js); this only renders
// them. Severity is a shape + word, never colour alone.
const SEVERITY = {
  bad: { color: SA.bad, mark: '■', word: 'Problem' },
  warn: { color: SA.warn, mark: '▲', word: 'Watch' },
  info: { color: SA.good, mark: '●', word: 'Good news' },
};

// "Clickable filters" are jump links: they scroll to the item on this page
// and flash it. Actually filtering the leaderboard would mean lifting its
// filter state up into SalesAnalyticsTab - not done here.
function jumpTo(item) {
  const id = item.type === 'sequence' ? `sa-seq-${item.id}`
    : item.type === 'mailbox' ? `sa-mailbox-${item.id}`
      : 'sa-widget-email_trend';
  const el = document.getElementById(id) || document.getElementById(item.type === 'sequence' ? 'sa-widget-sequence_leaderboard' : 'sa-widget-mailbox_health');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.animate([{ outline: `2px solid ${getComputedStyle(el).getPropertyValue('--sa-accent') || '#8FA8FF'}` }, { outline: '2px solid transparent' }], { duration: 1600 });
}

export default function InsightsPanel({ businessId, insights, onInsightsChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  // Hidden right away on dismiss - the refetch rebuilds every rule from
  // stored data and takes a few seconds.
  const [hidden, setHidden] = useState(() => new Set());

  if (!insights) return <p style={{ fontSize: 12, color: SA.muted }}>Loading…</p>;
  const visible = insights.insights.filter(i => !hidden.has(`${i.id}:${i.scope_key}`));

  const dismiss = async i => {
    setBusy(`${i.id}:${i.scope_key}`);
    setError('');
    try {
      await dismissInsight(businessId, { insight_id: i.id, scope_key: i.scope_key, dismissed_by: currentUserLabel() });
      setHidden(h => new Set(h).add(`${i.id}:${i.scope_key}`));
      await onInsightsChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {(error || insights.error) && <p style={{ fontSize: 12, color: SA.bad, margin: '0 0 8px' }}>⚠ {error || insights.error}</p>}
      {visible.length === 0 ? (
        <p style={{ fontSize: 13, color: SA.muted, margin: 0 }}>Nothing stands out right now.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))', gap: 10 }}>
          {visible.map(i => {
            const sev = SEVERITY[i.severity];
            const key = `${i.id}:${i.scope_key}`;
            return (
              <div key={key} className="print-avoid-break" style={{ padding: '14px 16px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, display: 'flex', flexDirection: 'column', gap: 8, opacity: busy === key ? 0.6 : 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ color: sev.color, fontSize: 10 }}>{sev.mark}</span>
                  <span style={{ ...SA_TYPE.label, color: SA.muted }}>{sev.word} · {i.id}</span>
                </div>
                <div style={{ ...SA_TYPE.cardTitle, fontSize: 14, color: SA.text }}>{i.title}</div>
                <div style={{ fontSize: 12, color: SA.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.45 }}>{i.evidence}</div>
                <div style={{ fontSize: 12, color: SA.muted, lineHeight: 1.45 }}><span style={{ color: SA.faint }}>Likely cause · </span>{i.cause}</div>
                <div style={{ fontSize: 12, color: SA.muted, lineHeight: 1.45 }}><span style={{ color: SA.faint }}>Suggested · </span>{i.action}</div>
                <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {i.affected.map(a => (
                    <button key={`${a.type}:${a.id}:${a.label}`} onClick={() => jumpTo(a)} title="Jump to it on this page"
                      style={{ ...SA_TYPE.body, fontSize: 11, height: 26, padding: '0 10px', borderRadius: SA_SHAPE.radiusPill, border: `1px solid ${SA.border}`, background: 'transparent', color: SA.accent, cursor: 'pointer', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.label} ↗
                    </button>
                  ))}
                  <span style={{ flex: 1 }} />
                  <button disabled={!!busy} onClick={() => dismiss(i)}
                    style={{ ...SA_TYPE.body, fontSize: 11, height: 26, padding: '0 10px', borderRadius: 7, border: `1px solid ${SA.border}`, background: 'transparent', color: SA.muted, cursor: 'pointer' }}>
                    Dismiss for 7 days
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(insights.not_enough_data.length > 0 || insights.dismissed.length > 0) && (
        <details className="no-print" style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 12, color: SA.muted, cursor: 'pointer' }}>
            Not enough data to judge: {insights.not_enough_data.length}
            {insights.dismissed.length > 0 && ` · dismissed: ${insights.dismissed.length}`}
          </summary>
          <ul style={{ fontSize: 12, color: SA.faint, paddingLeft: 18, lineHeight: 1.6 }}>
            {insights.not_enough_data.map(s => <li key={s}>{s}</li>)}
            {insights.dismissed.map(d => <li key={`${d.id}:${d.scope_key}`}>Dismissed: {d.title}</li>)}
          </ul>
        </details>
      )}
      <p style={{ fontSize: 11, color: SA.faint, margin: '10px 0 0' }}>
        Rule-based checks on stored data, not AI. Each fires only above its minimum sample; causes are likely, not certain.
      </p>
    </div>
  );
}
