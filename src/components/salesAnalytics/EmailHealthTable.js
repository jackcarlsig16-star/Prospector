import { SA, SA_TYPE } from './theme';
import { EMAIL_HEALTH_THRESHOLDS } from './metrics.registry';
import { pct } from './emailTrendData';

// Health status only on the deliverability rows (SPEC). Shape + word, not
// colour alone.
function health(v) {
  if (v === null) return null;
  if (v < EMAIL_HEALTH_THRESHOLDS.good) return { color: SA.good, mark: '●', word: 'good' };
  if (v <= EMAIL_HEALTH_THRESHOLDS.concerning) return { color: SA.warn, mark: '▲', word: 'watch' };
  return { color: SA.bad, mark: '■', word: 'concerning' };
}

const ROWS = [
  { key: 'sent', label: 'Sent', kind: 'count' },
  { key: 'hardBounce', label: 'Hard bounce', kind: 'health' },
  { key: 'spamBlock', label: 'Spam block', kind: 'health' },
  { key: 'totalBounce', label: 'Total (Apollo-style)', hint: 'Hard bounce + spam block — matches Apollo’s own “Bounce %”', kind: 'health' },
  { key: 'open', label: 'Apollo open', kind: 'rate' },
  { key: 'humanOpen', label: 'Human open (est.)', hint: 'Apollo opens × the human share of that week’s tracked opens', kind: 'rate' },
  { key: 'reply', label: 'Reply', kind: 'rate' },
  { key: 'click', label: 'Click', kind: 'rate' },
];

const cell = { padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', borderTop: `1px solid ${SA.border}` };

export default function EmailHealthTable({ buckets }) {
  const shown = buckets.filter(b => b.sent > 0);
  if (!shown.length) return null;
  return (
    <div style={{ overflowX: 'auto', marginTop: 16 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', ...SA_TYPE.body }}>
        <thead>
          <tr>
            <th style={{ ...cell, borderTop: 0, textAlign: 'left', position: 'sticky', left: 0, background: SA.surface, ...SA_TYPE.label, color: SA.muted }}>By send date</th>
            {shown.map(b => (
              <th key={b.key} style={{ ...cell, borderTop: 0, ...SA_TYPE.label, fontSize: 10, color: SA.muted, opacity: b.lowVolume ? 0.6 : 1 }}
                title={b.lowVolume ? 'low volume — rates unreliable' : undefined}>
                {b.label}{b.partial ? ' · partial' : ''}{b.lowVolume ? ' · low vol' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(row => (
            <tr key={row.key}>
              <td title={row.hint} style={{ ...cell, textAlign: 'left', position: 'sticky', left: 0, background: SA.surface, color: SA.text }}>{row.label}</td>
              {shown.map(b => {
                if (row.kind === 'count') return <td key={b.key} style={{ ...cell, color: SA.text }}>{b.sent.toLocaleString()}</td>;
                const v = b.rates[row.key];
                const h = row.kind === 'health' && !b.lowVolume ? health(v) : null;
                return (
                  <td key={b.key} title={`${pct(v)} (${b.counts[row.key] ?? '—'} / ${b.sent})${b.lowVolume ? ' — low volume, rates unreliable' : ''}`}
                    style={{ ...cell, color: b.lowVolume ? SA.faint : SA.text }}>
                    {h && <span aria-label={h.word} style={{ color: h.color, fontSize: 9, marginRight: 5 }}>{h.mark}</span>}
                    {pct(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: SA.muted, marginTop: 8 }}>
        <span><span style={{ color: SA.good }}>●</span> under {pct(EMAIL_HEALTH_THRESHOLDS.good, 0)} good</span>
        <span><span style={{ color: SA.warn }}>▲</span> {pct(EMAIL_HEALTH_THRESHOLDS.good, 0)}–{pct(EMAIL_HEALTH_THRESHOLDS.concerning, 0)} watch</span>
        <span><span style={{ color: SA.bad }}>■</span> over {pct(EMAIL_HEALTH_THRESHOLDS.concerning, 0)} concerning</span>
        <span>Bounce / spam rows only · not judged under 50 sent</span>
      </div>
    </div>
  );
}
